import { randomUUID } from "node:crypto";
import type { Job } from "bullmq";
import {
  getSupabaseServiceClient,
  findOrCreateUserByPhone,
  getOrCreateActiveSession,
  updateSessionState,
  linkSessionToSongRequest,
  closeSession,
  createDraftSongRequest,
  getSongRequestById,
  updateSongRequestBrief,
  confirmSongRequest,
  setSongRequestStatus,
  getWalletBalance,
  findGenreByName,
  findCountryByCode,
  findLanguagesByCodes,
  getActiveCreditPacks,
  getPricingRuleForCountry,
  updateUserPreferences,
  createPendingPayment,
  getLatestCompletedSongForUser,
  upsertRating,
} from "@afrotune/db";
import {
  mergeSongBriefSlots,
  missingRequiredSlots,
  normalizeLanguagesToCodes,
  type SongBriefSlots,
} from "@afrotune/core";
import type { IncomingMessageJob } from "@afrotune/queue";
import { getLLMProvider, getWhatsAppProvider, getPaystackClient } from "../lib/providers.js";
import { tryStartGeneration } from "../lib/generationStarter.js";
import { formatBriefSummary } from "../lib/summary.js";
import { needsModeration } from "../lib/moderation.js";
import { loadEnv } from "../env.js";

const CREDIT_BALANCE_RE = /how many credits|credit balance|my credits|check.*credit/i;
const RESTART_RE = /^(start over|restart|forget (that|it)|let'?s begin again)\.?$/i;
const RATING_RE = /^[1-5]$/;

export async function processIncomingMessage(job: Job<IncomingMessageJob>): Promise<void> {
  const env = loadEnv();
  const db = getSupabaseServiceClient();
  const whatsapp = getWhatsAppProvider(env);
  const { whatsappPhoneNumber, text, interactiveReplyId } = job.data;

  const user = await findOrCreateUserByPhone(db, whatsappPhoneNumber);
  const session = await getOrCreateActiveSession(db, user.id);

  // ---- Interactive button replies short-circuit the LLM entirely. ----
  if (interactiveReplyId) {
    const handled = await handleInteractiveReply({
      db,
      whatsapp,
      env,
      user,
      session,
      phone: whatsappPhoneNumber,
      replyId: interactiveReplyId,
    });
    if (handled) return;
  }

  // ---- A plain-text reply answering the last set of buttons we sent. ----
  // Real WhatsApp button taps arrive as interactiveReplyId above, but a
  // customer can always just type "1" instead of tapping (and the console
  // dev provider has no way to simulate a tap at all - it explicitly asks
  // the tester to type the number). Without this, that text falls through
  // to RATING_RE/the LLM with zero context, which is what produced the
  // "start over" / repeated-question loop.
  if (!interactiveReplyId && session.state.pendingChoice?.length) {
    const trimmed = text.trim();
    const numericIndex = /^[1-9]\d*$/.test(trimmed) ? Number(trimmed) - 1 : -1;
    const pendingChoice = session.state.pendingChoice;
    const matched =
      (numericIndex >= 0 ? pendingChoice[numericIndex] : undefined) ??
      pendingChoice.find((c) => c.title.toLowerCase() === trimmed.toLowerCase());

    // The choice only ever applies to the immediate next reply - clear it
    // now regardless of whether this message matched it.
    await updateSessionState(db, session.id, { ...session.state, pendingChoice: undefined });
    session.state = { ...session.state, pendingChoice: undefined };

    if (matched) {
      const handled = await handleInteractiveReply({
        db,
        whatsapp,
        env,
        user,
        session,
        phone: whatsappPhoneNumber,
        replyId: matched.id,
      });
      if (handled) return;
    }
  }

  // ---- Deterministic intents that must never depend on the LLM. ----
  if (CREDIT_BALANCE_RE.test(text)) {
    const balance = await getWalletBalance(db, user.id);
    await whatsapp.sendText(
      whatsappPhoneNumber,
      `You have ${balance} credit${balance === 1 ? "" : "s"} available. 🎵`,
    );
    return;
  }

  if (RATING_RE.test(text.trim())) {
    const song = await getLatestCompletedSongForUser(db, user.id);
    if (song) {
      await upsertRating(db, { songId: song.id, userId: user.id, rating: Number(text.trim()) });
      await whatsapp.sendText(whatsappPhoneNumber, "Thanks for rating your song! 🙏 Want to create another one?");
      return;
    }
    // No recent song to rate - fall through, this might just be a "5 minutes" type reply mid-conversation.
  }

  if (RESTART_RE.test(text.trim())) {
    await resetConversation(db, session.id, session.current_song_request_id);
    await whatsapp.sendText(
      whatsappPhoneNumber,
      "No problem, let's start fresh! Tell me about the song you'd like me to create.",
    );
    return;
  }

  // ---- Ensure there is a draft song request attached to this session. ----
  let songRequestId = session.current_song_request_id;
  if (!songRequestId) {
    const draft = await createDraftSongRequest(db, {
      userId: user.id,
      conversationSessionId: session.id,
    });
    songRequestId = draft.id;
    await linkSessionToSongRequest(db, session.id, songRequestId);
  }

  const songRequest = await getSongRequestById(db, songRequestId);
  if (!songRequest) throw new Error(`song_request ${songRequestId} disappeared`);

  const knownSlots: SongBriefSlots = session.state.slots ?? {};
  const missing = missingRequiredSlots(knownSlots);

  const llm = getLLMProvider(env);
  const result = await llm.interpretTurn({
    userMessage: text,
    knownSlots,
    missingSlots: missing,
    recentHistory: session.state.history.slice(-8),
  });

  if (result.restartRequested) {
    // This is the LLM's own (softer, less reliable) restart signal - RESTART_RE
    // above already caught the unambiguous phrasing deterministically with no
    // confirmation needed. Never wipe a session on this weaker signal alone;
    // confirm first since a false positive silently destroys everything
    // gathered so far.
    const buttons = [
      { id: "confirm_restart", title: "Yes, start over" },
      { id: "cancel_restart", title: "No, keep going" },
    ];
    await whatsapp.sendButtons(
      whatsappPhoneNumber,
      "Just to confirm - do you want to start over? You'll lose the song details gathered so far.",
      buttons,
    );
    await updateSessionState(db, session.id, { ...session.state, pendingChoice: buttons });
    return;
  }

  const mergedSlots = mergeSongBriefSlots(knownSlots, result.slotUpdates);
  const stillMissing = missingRequiredSlots(mergedSlots);

  const moderation = needsModeration(mergedSlots.story ?? mergedSlots.occasion);
  if (moderation.flagged) {
    await db.from("moderation_queue").insert({
      song_request_id: songRequestId,
      reason: moderation.reason ?? "flagged",
    });
    await updateSongRequestBrief(db, songRequestId, mergedSlots, "moderation_required");
    await whatsapp.sendText(
      whatsappPhoneNumber,
      "Thanks for sharing that. This particular request needs a quick manual review by our team before we can continue - we'll follow up shortly.",
    );
    await persistTurn(db, session.id, mergedSlots, session.state.history, text, result.assistantReply);
    return;
  }

  const newStatus = stillMissing.length === 0 ? "ready_for_confirmation" : "collecting_details";
  await updateSongRequestBrief(db, songRequestId, mergedSlots, newStatus);
  const persistedState = await persistTurn(db, session.id, mergedSlots, session.state.history, text, result.assistantReply);

  const readyToConfirm = stillMissing.length === 0 && result.confirmationDetected;

  if (readyToConfirm) {
    await handleConfirmation({ db, whatsapp, env, user, phone: whatsappPhoneNumber, songRequestId, slots: mergedSlots });
    return;
  }

  if (stillMissing.length === 0) {
    // Everything is known but the user hasn't explicitly confirmed yet - show
    // the summary and ask, rather than silently guessing they're done.
    const summary = formatBriefSummary(mergedSlots);
    const buttons = [
      { id: "confirm_song", title: "Yes, create it" },
      { id: "edit_song", title: "Let me change it" },
    ];
    await whatsapp.sendButtons(
      whatsappPhoneNumber,
      `Here's what I've got:\n\n${summary}\n\nShall I go ahead and create this song?`,
      buttons,
    );
    await updateSessionState(db, session.id, { ...persistedState, pendingChoice: buttons });
    return;
  }

  await whatsapp.sendText(whatsappPhoneNumber, result.assistantReply);
}

async function persistTurn(
  db: ReturnType<typeof getSupabaseServiceClient>,
  sessionId: string,
  slots: SongBriefSlots,
  history: { role: "user" | "assistant"; content: string }[],
  userMessage: string,
  assistantReply: string,
) {
  const newHistory = [
    ...history,
    { role: "user" as const, content: userMessage },
    { role: "assistant" as const, content: assistantReply },
  ].slice(-16);
  const state = { slots, history: newHistory };
  await updateSessionState(db, sessionId, state);
  return state;
}

async function resetConversation(
  db: ReturnType<typeof getSupabaseServiceClient>,
  sessionId: string,
  currentSongRequestId: string | null,
) {
  if (currentSongRequestId) {
    await setSongRequestStatus(db, currentSongRequestId, "cancelled");
  }
  await closeSession(db, sessionId, "abandoned");
}

async function handleConfirmation(params: {
  db: ReturnType<typeof getSupabaseServiceClient>;
  whatsapp: ReturnType<typeof getWhatsAppProvider>;
  env: ReturnType<typeof loadEnv>;
  user: { id: string; country_id: string | null };
  phone: string;
  songRequestId: string;
  slots: SongBriefSlots;
}) {
  const { db, whatsapp, user, phone, songRequestId, slots } = params;

  const country = slots.countryCode
    ? await findCountryByCode(db, slots.countryCode)
    : params.env.DEFAULT_COUNTRY_CODE
      ? await findCountryByCode(db, params.env.DEFAULT_COUNTRY_CODE)
      : null;

  const genre = slots.genre ? await findGenreByName(db, slots.genre, country?.id) : null;
  const secondaryGenre = slots.secondaryGenre
    ? await findGenreByName(db, slots.secondaryGenre, country?.id)
    : null;

  const languageCodes = normalizeLanguagesToCodes(slots.languages ?? []);
  const languages = await findLanguagesByCodes(db, languageCodes);
  const pricingRule = await getPricingRuleForCountry(db, country?.id ?? undefined);

  await confirmSongRequest(db, songRequestId, {
    genreId: genre?.id ?? null,
    secondaryGenreId: secondaryGenre?.id ?? null,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    languageIds: (languages as any[]).map((l) => l.id),
    priceMinorUnits: 0, // price is expressed in credits, not a per-song currency amount
    currencyCode: country?.currency_code ?? "NGN",
    creditsRequired: pricingRule.credits_per_song,
  });

  if (genre?.id) {
    await updateUserPreferences(db, user.id, {
      preferred_genre_id: genre.id,
      country_id: country?.id ?? undefined,
    });
  }

  const songRequest = await getSongRequestById(db, songRequestId);
  if (!songRequest) return;

  const outcome = await tryStartGeneration(db, songRequest, params.env);

  if (outcome === "started") {
    await whatsapp.sendText(
      phone,
      "Perfect - creating your song now! This usually takes a few minutes. I'll message you the moment it's ready. 🎶",
    );
    return;
  }

  // Not enough credits - offer packs.
  const packs = await getActiveCreditPacks(db, country?.id ?? undefined);
  const paystack = getPaystackClient(params.env);

  if (packs.length === 0) {
    await whatsapp.sendText(
      phone,
      "You'll need credits to create this song, but no credit packs are configured yet - please contact support.",
    );
    return;
  }

  // Offer the smallest pack via a direct payment link (WhatsApp buttons cap
  // at 3 options; a fuller picker lives on the small web credit-purchase page).
  const pack = packs[0];
  const reference = `afrotune_${randomUUID()}`;
  await createPendingPayment(db, {
    userId: user.id,
    providerReference: reference,
    creditPackId: pack.id,
    credits: pack.credits,
    amountMinorUnits: pack.price_minor_units,
    currencyCode: pack.currency_code,
  });

  const { authorizationUrl } = await paystack.initializeTransaction({
    email: `${phone}@users.afrotune.app`,
    amountMinorUnits: pack.price_minor_units,
    currencyCode: pack.currency_code,
    reference,
    metadata: { userId: user.id, creditPackId: pack.id, songRequestId },
    callbackUrl: `${params.env.APP_URL}/pay/complete?reference=${reference}`,
  });

  const summary = formatBriefSummary(slots);
  await whatsapp.sendCtaUrl(
    phone,
    `Your song is ready to go:\n\n${summary}\n\nYou'll need ${songRequest.credits_required} credit(s) - grab ${pack.credits} for ${(pack.price_minor_units / 100).toLocaleString()} ${pack.currency_code} and I'll start right after payment.`,
    "Buy credits",
    authorizationUrl,
  );
}

async function handleInteractiveReply(params: {
  db: ReturnType<typeof getSupabaseServiceClient>;
  whatsapp: ReturnType<typeof getWhatsAppProvider>;
  env: ReturnType<typeof loadEnv>;
  user: { id: string; country_id: string | null };
  session: Awaited<ReturnType<typeof getOrCreateActiveSession>>;
  phone: string;
  replyId: string;
}): Promise<boolean> {
  const { db, whatsapp, user, session, phone, replyId } = params;

  if (replyId.startsWith("vocal_")) {
    const vocal = replyId.replace("vocal_", "") as "male" | "female" | "surprise";
    const normalized = vocal === "surprise" ? "surprise_me" : vocal;
    const slots = mergeSongBriefSlots(session.state.slots, { vocalPreference: normalized });
    await updateSessionState(db, session.id, { ...session.state, slots });
    if (session.current_song_request_id) {
      await updateSongRequestBrief(db, session.current_song_request_id, slots);
    }
    await whatsapp.sendText(phone, "Got it 👍");
    return true;
  }

  if (replyId === "confirm_song" && session.current_song_request_id) {
    await handleConfirmation({
      db,
      whatsapp,
      env: params.env,
      user,
      phone,
      songRequestId: session.current_song_request_id,
      slots: session.state.slots,
    });
    return true;
  }

  if (replyId === "edit_song") {
    await whatsapp.sendText(phone, "Sure - what would you like to change?");
    return true;
  }

  if (replyId === "confirm_restart") {
    await resetConversation(db, session.id, session.current_song_request_id);
    await whatsapp.sendText(
      phone,
      "No problem, let's start fresh! Tell me about the song you'd like me to create.",
    );
    return true;
  }

  if (replyId === "cancel_restart") {
    await whatsapp.sendText(phone, "Okay, keeping everything as is - what would you like to add or change?");
    return true;
  }

  return false;
}
