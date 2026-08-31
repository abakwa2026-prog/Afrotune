import { randomUUID } from "node:crypto";
import type { Job } from "bullmq";
import type { SupabaseClient } from "@supabase/supabase-js";
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
  listRecentSongsForUser,
  upsertRating,
  listActiveCountries,
  listGenresForCountry,
  listLanguagesForCountry,
  getCreditPackById,
  findCountryById,
  findGenreById,
  type ConversationSessionRow,
  type ConversationState,
  type FlowState,
  type GuidedStep,
  type UserRow,
} from "@afrotune/db";
import {
  mergeSongBriefSlots,
  missingRequiredSlots,
  normalizeLanguagesToCodes,
  formatMinorUnits,
  type SongBriefSlots,
} from "@afrotune/core";
import type { IncomingMessageJob } from "@afrotune/queue";
import { getLLMProvider, getWhatsAppProvider, getPaystackClient } from "../lib/providers.js";
import { tryStartGeneration } from "../lib/generationStarter.js";
import { formatBriefSummary, buildReviewSummary } from "../lib/summary.js";
import { needsModeration } from "../lib/moderation.js";
import { resolveFlow, patchFlow, nextGuidedStep } from "../lib/flow.js";
import { loadEnv, type Env } from "../env.js";

const CREDIT_BALANCE_RE = /how many credits|credit balance|my credits|check.*credit/i;
const RESTART_RE = /^(start over|restart|forget (that|it)|let'?s begin again)\.?$/i;
const RATING_RE = /^[1-5]$/;

export async function processIncomingMessage(job: Job<IncomingMessageJob>): Promise<void> {
  const env = loadEnv();
  const db = getSupabaseServiceClient();
  const whatsapp = getWhatsAppProvider(env);
  const { whatsappPhoneNumber, text, messageId, interactiveReplyId } = job.data;

  // eslint-disable-next-line no-console
  console.log(
    `[incoming-message] conversation processing started jobId=${job.id} messageId=${messageId} from=${whatsappPhoneNumber} type=${interactiveReplyId ? "interactive" : "text"} whatsappProvider=${env.WHATSAPP_PROVIDER} flowV2=${env.FLOW_V2_ENABLED}`,
  );

  const user = await findOrCreateUserByPhone(db, whatsappPhoneNumber);
  const session = await getOrCreateActiveSession(db, user.id);

  if (!env.FLOW_V2_ENABLED) {
    await processLegacyFlow({ db, whatsapp, env, user, session, phone: whatsappPhoneNumber, text, interactiveReplyId });
    return;
  }

  const ctx: Ctx = { db, whatsapp, env, user, session, phone: whatsappPhoneNumber, songRequestId: session.current_song_request_id };
  await processGuidedFlow(ctx, text, interactiveReplyId);
}

/** Ends the session (e.g. after a hard "start over", or a soft cancel keeps it - see handleInteractiveReply's cancel_song). */
async function resetConversation(
  db: SupabaseClient,
  sessionId: string,
  currentSongRequestId: string | null,
) {
  if (currentSongRequestId) {
    await setSongRequestStatus(db, currentSongRequestId, "cancelled");
  }
  await closeSession(db, sessionId, "abandoned");
}

// =============================================================================
// Guided flow (v2) - main menu, step-by-step creation, review/edit, pack picker.
// See C:\Users\HP\.claude\plans\clever-booping-scott.md for the full design.
// =============================================================================

interface Ctx {
  db: SupabaseClient;
  whatsapp: ReturnType<typeof getWhatsAppProvider>;
  env: Env;
  user: UserRow;
  session: ConversationSessionRow;
  phone: string;
  /** Mutable - handleMenuCreate may replace this with a fresh draft's id. */
  songRequestId: string | null;
}

const OCCASION_LABELS: Record<string, string> = {
  birthday: "birthday",
  wedding: "wedding",
  love: "love",
  worship: "worship",
  business: "business jingle",
};

const MOOD_LABELS: Record<string, string> = {
  happy: "happy",
  romantic: "romantic",
  energetic: "energetic",
  emotional: "emotional",
  reverent: "reverent",
};

const EDIT_TARGET_ROWS: { id: string; title: string }[] = [
  { id: "edit_occasion", title: "Occasion" },
  { id: "edit_country", title: "Sound" },
  { id: "edit_genre", title: "Genre" },
  { id: "edit_language", title: "Language" },
  { id: "edit_vocal", title: "Voice" },
  { id: "edit_mood", title: "Mood" },
  { id: "edit_story", title: "Story" },
];
const EDITABLE_FIELDS = new Set(EDIT_TARGET_ROWS.map((r) => r.id.slice("edit_".length)));

const STEP_QUESTION_DESCRIPTION: Record<GuidedStep, string> = {
  occasion: "what occasion the song is for",
  country: "which country's musical style should influence the song",
  genre: "which music genre they want",
  language: "which language(s) the lyrics should be in",
  vocal: "male, female, or surprise-me vocals",
  mood: "what mood/feeling the song should have",
  recipient: "the recipient's name and their relationship to the user",
  story: "a personal story or details about the recipient to reflect in the lyrics",
};

async function processGuidedFlow(ctx: Ctx, text: string, interactiveReplyId?: string): Promise<void> {
  const { db, whatsapp, user, session, phone } = ctx;

  // ---- Real button/list taps short-circuit everything else. ----
  if (interactiveReplyId) {
    const handled = await handleInteractiveReply(ctx, interactiveReplyId);
    if (handled) return;
  }

  // ---- Typed reply answering the last set of options offered (non-Meta providers, or a user who just types). ----
  if (!interactiveReplyId && session.state.pendingChoice?.length) {
    const trimmed = text.trim();
    const numericIndex = /^[1-9]\d*$/.test(trimmed) ? Number(trimmed) - 1 : -1;
    const pendingChoice = session.state.pendingChoice;
    const matched =
      (numericIndex >= 0 ? pendingChoice[numericIndex] : undefined) ??
      pendingChoice.find((c) => c.title.toLowerCase() === trimmed.toLowerCase());

    const clearedState: ConversationState = { ...session.state, pendingChoice: undefined };
    await updateSessionState(db, session.id, clearedState);
    session.state = clearedState;

    if (matched) {
      const handled = await handleInteractiveReply(ctx, matched.id);
      if (handled) return;
    }
  }

  // ---- Deterministic intents that must never depend on the LLM. ----
  if (CREDIT_BALANCE_RE.test(text)) {
    const balance = await getWalletBalance(db, user.id);
    await whatsapp.sendText(phone, `You have ${balance} credit${balance === 1 ? "" : "s"} available. 🎵`);
    return;
  }

  if (RATING_RE.test(text.trim())) {
    const song = await getLatestCompletedSongForUser(db, user.id);
    if (song) {
      await upsertRating(db, { songId: song.id, userId: user.id, rating: Number(text.trim()) });
      await whatsapp.sendText(phone, "Thanks for rating your song! 🙏 Want to create another one?");
      return;
    }
    // No recent song to rate - fall through, this might just be a "5 minutes" type reply mid-conversation.
  }

  if (RESTART_RE.test(text.trim())) {
    await resetConversation(db, session.id, session.current_song_request_id);
    await whatsapp.sendText(phone, "No problem, let's start fresh! Tell me about the song you'd like me to create.");
    return;
  }

  const flow = resolveFlow(session.state);

  // ---- Very first contact: greet with the main menu once. Any later free
  // text (even from someone who never taps a menu item) always falls
  // through to full guided/LLM processing below instead of re-showing this. ----
  if (
    flow.screen === "main_menu" &&
    !ctx.songRequestId &&
    Object.keys(session.state.slots).length === 0 &&
    session.state.history.length === 0
  ) {
    await renderMainMenu(ctx);
    return;
  }

  // ---- Free text: full brief interpretation via the LLM, scoped with a hint
  // about whatever's currently being asked, but never restricted to only
  // that field - the user can always volunteer more at once. ----
  if (!ctx.songRequestId) {
    const draft = await createDraftSongRequest(db, { userId: user.id, conversationSessionId: session.id });
    ctx.songRequestId = draft.id;
    await linkSessionToSongRequest(db, session.id, ctx.songRequestId);
    session.current_song_request_id = ctx.songRequestId;
  }

  const knownSlots: SongBriefSlots = session.state.slots ?? {};
  const missing = missingRequiredSlots(knownSlots);
  const intentHints = buildIntentHints(flow);

  const llm = getLLMProvider(ctx.env);
  const result = await llm.interpretTurn({
    userMessage: text,
    knownSlots,
    missingSlots: missing,
    recentHistory: session.state.history.slice(-8),
    intentHints,
  });
  // eslint-disable-next-line no-console
  console.log(
    `[incoming-message] LLM response generated jobId=${session.id} llmProvider=${ctx.env.LLM_PROVIDER} restartRequested=${result.restartRequested} confirmationDetected=${result.confirmationDetected} step=${flow.step ?? flow.screen}`,
  );

  if (result.restartRequested) {
    const buttons = [
      { id: "confirm_restart", title: "Yes, start over" },
      { id: "cancel_restart", title: "No, keep going" },
    ];
    await whatsapp.sendButtons(
      phone,
      "Just to confirm - do you want to start over? You'll lose the song details gathered so far.",
      buttons,
    );
    const newState: ConversationState = { ...session.state, pendingChoice: buttons };
    await updateSessionState(db, session.id, newState);
    session.state = newState;
    return;
  }

  const mergedSlots = mergeSongBriefSlots(knownSlots, result.slotUpdates);

  const moderation = needsModeration(mergedSlots.story ?? mergedSlots.occasion);
  if (moderation.flagged) {
    await db.from("moderation_queue").insert({
      song_request_id: ctx.songRequestId,
      reason: moderation.reason ?? "flagged",
    });
    await updateSongRequestBrief(db, ctx.songRequestId, mergedSlots, "moderation_required");
    await whatsapp.sendText(
      phone,
      "Thanks for sharing that. This particular request needs a quick manual review by our team before we can continue - we'll follow up shortly.",
    );
    await persistTurnState(db, session, mergedSlots, text, result.assistantReply);
    return;
  }

  await persistTurnState(db, session, mergedSlots, text, result.assistantReply);
  await commitSlotsAndRoute(ctx, mergedSlots, { confirmationDetected: result.confirmationDetected });
}

function buildIntentHints(flow: FlowState): string[] | undefined {
  if (flow.screen === "review" || flow.returnTo === "review") {
    return [
      "The user is looking at a review summary of their song and may be describing changes to make. Extract any updates they mention.",
    ];
  }
  if (!flow.step) return undefined;
  return [
    `The user was just asked about ${STEP_QUESTION_DESCRIPTION[flow.step]}. If their reply is short or ambiguous, interpret it against that question first, but still extract any other song details they volunteer.`,
  ];
}

async function persistTurnState(
  db: SupabaseClient,
  session: ConversationSessionRow,
  slots: SongBriefSlots,
  userMessage: string,
  assistantReply: string,
): Promise<void> {
  const newHistory = [
    ...session.state.history,
    { role: "user" as const, content: userMessage },
    { role: "assistant" as const, content: assistantReply },
  ].slice(-16);
  const newState: ConversationState = { ...session.state, slots, history: newHistory };
  await updateSessionState(db, session.id, newState);
  session.state = newState;
}

/** After any merge (guided tap or free-text/LLM), decide what to show next. */
async function commitSlotsAndRoute(
  ctx: Ctx,
  mergedSlots: SongBriefSlots,
  opts: { confirmationDetected?: boolean } = {},
): Promise<void> {
  if (ctx.songRequestId) {
    const status = missingRequiredSlots(mergedSlots).length === 0 ? "ready_for_confirmation" : "collecting_details";
    await updateSongRequestBrief(ctx.db, ctx.songRequestId, mergedSlots, status);
  }

  const previousFlow = resolveFlow(ctx.session.state);
  const wasOnReview = previousFlow.screen === "review" || previousFlow.returnTo === "review";

  if (wasOnReview) {
    if (opts.confirmationDetected && ctx.songRequestId) {
      await handleConfirmation(ctx, mergedSlots);
      return;
    }
    await renderReview(ctx, mergedSlots);
    return;
  }

  await advanceGuided(ctx, mergedSlots);
}

async function advanceGuided(ctx: Ctx, slots: SongBriefSlots): Promise<void> {
  const next = nextGuidedStep(slots);
  if (!next) {
    await renderReview(ctx, slots);
    return;
  }
  await sendStepPrompt(ctx, next, slots);
}

async function mergeSlotsFromStep(ctx: Ctx, patch: Partial<SongBriefSlots>): Promise<void> {
  const merged = mergeSongBriefSlots(ctx.session.state.slots, patch);
  ctx.session.state = { ...ctx.session.state, slots: merged };
  await commitSlotsAndRoute(ctx, merged);
}

async function persistStepFlow(
  ctx: Ctx,
  slots: SongBriefSlots,
  step: GuidedStep,
  pendingChoice: { id: string; title: string }[] | undefined,
  editing?: boolean,
): Promise<void> {
  const flow: FlowState = editing
    ? { screen: "editing", step, editingField: step, returnTo: "review" }
    : { screen: "guided_creation", step };
  const newState: ConversationState = { ...ctx.session.state, slots, flow, pendingChoice };
  await updateSessionState(ctx.db, ctx.session.id, newState);
  ctx.session.state = newState;
}

async function sendStepPrompt(
  ctx: Ctx,
  step: GuidedStep,
  slots: SongBriefSlots,
  opts: { editing?: boolean } = {},
): Promise<void> {
  const { db, whatsapp, phone } = ctx;

  switch (step) {
    case "occasion": {
      const rows = [
        { id: "occasion_birthday", title: "Birthday" },
        { id: "occasion_wedding", title: "Wedding" },
        { id: "occasion_love", title: "Love" },
        { id: "occasion_worship", title: "Worship" },
        { id: "occasion_business", title: "Business Jingle" },
        { id: "occasion_other", title: "Something Else" },
      ];
      await whatsapp.sendList(phone, "What's the occasion?", "Choose", [{ rows }]);
      await persistStepFlow(ctx, slots, step, rows, opts.editing);
      return;
    }
    case "country": {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const countries = (await listActiveCountries(db)) as any[];
      const rows = countries.map((c) => ({ id: `country_${String(c.code).toLowerCase()}`, title: c.name }));
      await whatsapp.sendList(phone, "Which country's musical style should inspire your song?", "Choose", [{ rows }]);
      await persistStepFlow(ctx, slots, step, rows, opts.editing);
      return;
    }
    case "genre": {
      const country = slots.countryCode ? await findCountryByCode(db, slots.countryCode) : null;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const genres = (country ? await listGenresForCountry(db, country.id) : []) as any[];
      const rows = genres.map((g) => ({ id: `genre_${g.id}`, title: g.name, description: g.description ?? undefined }));
      await whatsapp.sendList(phone, "Pick a genre for your song:", "Choose", [{ rows }]);
      await persistStepFlow(ctx, slots, step, rows, opts.editing);
      return;
    }
    case "language": {
      const country = slots.countryCode ? await findCountryByCode(db, slots.countryCode) : null;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const languages = (country ? await listLanguagesForCountry(db, country.id) : []) as any[];
      const already = new Set(slots.languages ?? []);
      const rows = languages.filter((l) => !already.has(l.code)).map((l) => ({ id: `lang_${l.code}`, title: l.name }));
      if (rows.length === 0) {
        // Every known language for this country is already picked - move on.
        await advanceGuided(ctx, slots);
        return;
      }
      await whatsapp.sendList(phone, "Which language should the lyrics be in?", "Choose", [{ rows }]);
      await persistStepFlow(ctx, slots, step, rows, opts.editing);
      return;
    }
    case "vocal": {
      const rows = [
        { id: "vocal_male", title: "Male" },
        { id: "vocal_female", title: "Female" },
        { id: "vocal_surprise", title: "Surprise me" },
      ];
      await whatsapp.sendButtons(phone, "Male or female vocals?", rows);
      await persistStepFlow(ctx, slots, step, rows, opts.editing);
      return;
    }
    case "mood": {
      const rows = [
        { id: "mood_happy", title: "Happy" },
        { id: "mood_romantic", title: "Romantic" },
        { id: "mood_energetic", title: "Energetic" },
        { id: "mood_emotional", title: "Emotional" },
        { id: "mood_reverent", title: "Reverent" },
        { id: "mood_other", title: "Something Else" },
      ];
      await whatsapp.sendList(phone, "What mood should the song have?", "Choose", [{ rows }]);
      await persistStepFlow(ctx, slots, step, rows, opts.editing);
      return;
    }
    case "recipient": {
      await whatsapp.sendText(
        phone,
        `Who's this song for, and what's your relationship to them? (e.g. "My brother Daniel")`,
      );
      await persistStepFlow(ctx, slots, step, undefined, opts.editing);
      return;
    }
    case "story": {
      await whatsapp.sendText(
        phone,
        "Tell me about them - a memory, an inside joke, something important, or a message you want the song to carry. The more detail, the more personal the song.",
      );
      await persistStepFlow(ctx, slots, step, undefined, opts.editing);
      return;
    }
  }
}

async function handleLanguagePicked(ctx: Ctx, code: string): Promise<void> {
  const { db, whatsapp, phone, session } = ctx;
  const current = session.state.slots.languages ?? [];
  const languages = current.includes(code) ? current : [...current, code];
  const mergedSlots = mergeSongBriefSlots(session.state.slots, { languages });

  if (ctx.songRequestId) {
    const status = missingRequiredSlots(mergedSlots).length === 0 ? "ready_for_confirmation" : "collecting_details";
    await updateSongRequestBrief(db, ctx.songRequestId, mergedSlots, status);
  }

  const previousFlow = resolveFlow(session.state);
  const rows = [
    { id: "lang_add_yes", title: "Yes, add another" },
    { id: "lang_add_no", title: "No, that's all" },
  ];
  await whatsapp.sendButtons(phone, `Added ${code.toUpperCase()} to the lyrics languages. Add another?`, rows);
  const flow: FlowState = {
    ...previousFlow,
    screen: previousFlow.screen === "editing" ? "editing" : "guided_creation",
    step: "language",
    languageLoopActive: true,
  };
  const newState: ConversationState = { ...session.state, slots: mergedSlots, flow, pendingChoice: rows };
  await updateSessionState(db, session.id, newState);
  session.state = newState;
}

async function renderMainMenu(ctx: Ctx): Promise<void> {
  const rows = [
    { id: "menu_create", title: "Create Song" },
    { id: "menu_my_songs", title: "My Songs" },
    { id: "menu_buy_credits", title: "Buy Credits" },
    { id: "menu_profile", title: "Profile" },
    { id: "menu_help", title: "Help" },
  ];
  await ctx.whatsapp.sendList(
    ctx.phone,
    "Welcome to AfroTune! I turn your story into a personalized song. What would you like to do?",
    "Menu",
    [{ rows }],
  );
  const newState: ConversationState = { ...ctx.session.state, flow: { screen: "main_menu" }, pendingChoice: rows };
  await updateSessionState(ctx.db, ctx.session.id, newState);
  ctx.session.state = newState;
}

async function handleMenuCreate(ctx: Ctx): Promise<void> {
  const { db, session, user } = ctx;
  let resumable = false;

  if (ctx.songRequestId) {
    const existing = await getSongRequestById(db, ctx.songRequestId);
    if (existing && (existing.status === "collecting_details" || existing.status === "ready_for_confirmation")) {
      resumable = true;
    } else {
      ctx.songRequestId = null;
    }
  }

  if (!ctx.songRequestId) {
    const draft = await createDraftSongRequest(db, { userId: user.id, conversationSessionId: session.id });
    ctx.songRequestId = draft.id;
    await linkSessionToSongRequest(db, session.id, ctx.songRequestId);
    session.current_song_request_id = ctx.songRequestId;
  }

  const slots = resumable ? session.state.slots : {};
  if (!resumable) session.state = { ...session.state, slots };

  await commitSlotsAndRoute(ctx, slots);
}

async function handleMenuMySongs(ctx: Ctx): Promise<void> {
  const { db, whatsapp, phone, user } = ctx;
  const songs = await listRecentSongsForUser(db, user.id, 5);
  if (songs.length === 0) {
    await whatsapp.sendText(phone, "You haven't created any songs yet - tap Create Song to make your first one!");
    return;
  }
  const lines = songs.map((s, i) => `${i + 1}. ${s.title ?? "Untitled"} - ${s.status}`);
  await whatsapp.sendText(phone, `Your recent songs:\n\n${lines.join("\n")}`);
}

async function handleMenuBuyCredits(ctx: Ctx): Promise<void> {
  const { db, whatsapp, phone, user, session } = ctx;
  const packs = await getActiveCreditPacks(db, user.country_id ?? undefined);
  if (packs.length === 0) {
    await whatsapp.sendText(phone, "No credit packs are available right now - please check back soon.");
    return;
  }
  const balance = await getWalletBalance(db, user.id);
  const rows = packs.map((p) => ({
    id: `pack_${p.id}`,
    title: `${p.credits} credit${p.credits === 1 ? "" : "s"}`,
    description: formatMinorUnits(p.price_minor_units, p.currency_code),
  }));
  await whatsapp.sendList(phone, `Your balance: ${balance} credit${balance === 1 ? "" : "s"}\n\nChoose a credit pack:`, "Choose", [{ rows }]);
  const newState: ConversationState = { ...session.state, pendingChoice: rows };
  await updateSessionState(db, session.id, newState);
  session.state = newState;
}

async function handleMenuProfile(ctx: Ctx): Promise<void> {
  const { db, whatsapp, phone, user } = ctx;
  const balance = await getWalletBalance(db, user.id);
  const lines = [`Phone: ${user.whatsapp_phone_number}`, `Credits: ${balance}`];
  if (user.country_id) {
    const country = await findCountryById(db, user.country_id);
    if (country) lines.push(`Preferred sound: ${country.name}`);
  }
  if (user.preferred_genre_id) {
    const genre = await findGenreById(db, user.preferred_genre_id);
    if (genre) lines.push(`Preferred genre: ${genre.name}`);
  }
  await whatsapp.sendText(phone, lines.join("\n"));
}

async function handleMenuHelp(ctx: Ctx): Promise<void> {
  await ctx.whatsapp.sendText(
    ctx.phone,
    `AfroTune turns your story into a personalized song. Tap "Create Song" to start, or just type what you have in mind and I'll pick it up from there. You can check "My Songs", "Buy Credits" or your "Profile" any time by typing "menu".`,
  );
}

async function renderReview(ctx: Ctx, slots: SongBriefSlots): Promise<void> {
  const { db, whatsapp, phone, user, session } = ctx;

  const country = slots.countryCode ? await findCountryByCode(db, slots.countryCode) : null;
  const genre = slots.genre ? await findGenreByName(db, slots.genre, country?.id) : null;
  const languageCodes = normalizeLanguagesToCodes(slots.languages ?? []);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const languages = (await findLanguagesByCodes(db, languageCodes)) as any[];
  const pricingRule = await getPricingRuleForCountry(db, country?.id ?? undefined);
  const balance = await getWalletBalance(db, user.id);

  const summary = buildReviewSummary({
    slots,
    countryName: country?.name,
    genreName: genre?.name,
    languageNames: languages.map((l) => l.name),
    creditsRequired: pricingRule.credits_per_song,
    balance,
  });

  const buttons = [
    { id: "confirm_song", title: "Create Song" },
    { id: "edit_song", title: "Change Something" },
    { id: "cancel_song", title: "Cancel" },
  ];
  await whatsapp.sendButtons(phone, summary, buttons);

  const newState: ConversationState = { ...session.state, slots, flow: { screen: "review" }, pendingChoice: buttons };
  await updateSessionState(db, session.id, newState);
  session.state = newState;
}

async function handleConfirmation(ctx: Ctx, slots: SongBriefSlots): Promise<void> {
  const { db, whatsapp, env, user, phone, session } = ctx;
  const songRequestId = ctx.songRequestId;
  if (!songRequestId) return;

  const country = slots.countryCode
    ? await findCountryByCode(db, slots.countryCode)
    : env.DEFAULT_COUNTRY_CODE
      ? await findCountryByCode(db, env.DEFAULT_COUNTRY_CODE)
      : null;

  const genre = slots.genre ? await findGenreByName(db, slots.genre, country?.id) : null;
  const secondaryGenre = slots.secondaryGenre
    ? await findGenreByName(db, slots.secondaryGenre, country?.id)
    : null;

  const languageCodes = normalizeLanguagesToCodes(slots.languages ?? []);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const languages = (await findLanguagesByCodes(db, languageCodes)) as any[];
  const pricingRule = await getPricingRuleForCountry(db, country?.id ?? undefined);

  await confirmSongRequest(db, songRequestId, {
    genreId: genre?.id ?? null,
    secondaryGenreId: secondaryGenre?.id ?? null,
    languageIds: languages.map((l) => l.id),
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

  const outcome = await tryStartGeneration(db, songRequest, env);
  // eslint-disable-next-line no-console
  console.log(
    `[confirmation] generation start outcome=${outcome} songRequestId=${songRequestId} creditsRequired=${songRequest.credits_required}`,
  );

  if (outcome === "started") {
    await whatsapp.sendText(
      phone,
      "Perfect - creating your song now! This usually takes a few minutes. I'll message you the moment it's ready. 🎶",
    );
    const newState: ConversationState = { ...session.state, flow: { screen: "main_menu" } };
    await updateSessionState(db, session.id, newState);
    session.state = newState;
    return;
  }

  // Not enough credits - offer a real pack picker (upgrade from the old
  // hardcoded-smallest-pack single CTA link).
  const packs = await getActiveCreditPacks(db, country?.id ?? undefined);
  if (packs.length === 0) {
    await whatsapp.sendText(
      phone,
      "You'll need credits to create this song, but no credit packs are configured yet - please contact support.",
    );
    return;
  }

  const rows = packs.map((p) => ({
    id: `pack_${p.id}`,
    title: `${p.credits} credit${p.credits === 1 ? "" : "s"}`,
    description: formatMinorUnits(p.price_minor_units, p.currency_code),
  }));
  const balance = await getWalletBalance(db, user.id);
  const summary = buildReviewSummary({
    slots,
    countryName: country?.name,
    genreName: genre?.name,
    languageNames: languages.map((l) => l.name),
    creditsRequired: songRequest.credits_required,
    balance,
  });
  await whatsapp.sendList(phone, `${summary}\n\nChoose a credit pack to continue:`, "Choose", [{ rows }]);
  const newState: ConversationState = { ...session.state, pendingChoice: rows };
  await updateSessionState(db, session.id, newState);
  session.state = newState;
}

async function handlePackPurchase(ctx: Ctx, packId: string): Promise<void> {
  const { db, whatsapp, env, user, phone } = ctx;
  const pack = await getCreditPackById(db, packId);
  if (!pack) {
    await whatsapp.sendText(phone, "Sorry, that credit pack isn't available anymore - please try again.");
    return;
  }

  const reference = `afrotune_${randomUUID()}`;
  await createPendingPayment(db, {
    userId: user.id,
    providerReference: reference,
    creditPackId: pack.id,
    credits: pack.credits,
    amountMinorUnits: pack.price_minor_units,
    currencyCode: pack.currency_code,
  });

  // eslint-disable-next-line no-console
  console.log(
    `[confirmation] paystack initialize attempted reference=${reference} amount=${pack.price_minor_units} currency=${pack.currency_code}`,
  );
  const paystack = getPaystackClient(env);
  let authorizationUrl: string;
  try {
    ({ authorizationUrl } = await paystack.initializeTransaction({
      email: `${phone}@users.afrotune.app`,
      amountMinorUnits: pack.price_minor_units,
      currencyCode: pack.currency_code,
      reference,
      metadata: { userId: user.id, creditPackId: pack.id, songRequestId: ctx.songRequestId },
      callbackUrl: `${env.APP_URL}/pay/complete?reference=${reference}`,
    }));
    // eslint-disable-next-line no-console
    console.log(`[confirmation] paystack initialize succeeded reference=${reference}`);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(
      `[confirmation] paystack initialize FAILED reference=${reference}`,
      err instanceof Error ? err.message : err,
    );
    await whatsapp.sendText(
      phone,
      "Sorry, I couldn't start the payment for your credits just now - please try again in a moment, or contact support if this keeps happening.",
    );
    return;
  }

  await whatsapp.sendCtaUrl(
    phone,
    `${pack.credits} credit${pack.credits === 1 ? "" : "s"} for ${formatMinorUnits(pack.price_minor_units, pack.currency_code)} - I'll start your song right after payment.`,
    "Buy credits",
    authorizationUrl,
  );
}

async function handleInteractiveReply(ctx: Ctx, replyId: string): Promise<boolean> {
  const { db, whatsapp, phone, session } = ctx;

  // ---- Main menu ----
  if (replyId === "menu_create") {
    await handleMenuCreate(ctx);
    return true;
  }
  if (replyId === "menu_my_songs") {
    await handleMenuMySongs(ctx);
    return true;
  }
  if (replyId === "menu_buy_credits") {
    await handleMenuBuyCredits(ctx);
    return true;
  }
  if (replyId === "menu_profile") {
    await handleMenuProfile(ctx);
    return true;
  }
  if (replyId === "menu_help") {
    await handleMenuHelp(ctx);
    return true;
  }

  // ---- Post-delivery ----
  if (replyId === "postdelivery_create_another") {
    await handleMenuCreate(ctx);
    return true;
  }
  if (replyId === "postdelivery_menu") {
    await renderMainMenu(ctx);
    return true;
  }

  // ---- Guided creation steps ----
  if (replyId.startsWith("occasion_")) {
    const value = replyId.slice("occasion_".length);
    if (value === "other") {
      await whatsapp.sendText(phone, "No problem - tell me the occasion in your own words.");
      return true;
    }
    const label = OCCASION_LABELS[value];
    if (label) await mergeSlotsFromStep(ctx, { occasion: label });
    return true;
  }

  if (replyId.startsWith("country_")) {
    const code = replyId.slice("country_".length).toUpperCase();
    await mergeSlotsFromStep(ctx, { countryCode: code });
    return true;
  }

  if (replyId.startsWith("genre_")) {
    const genreId = replyId.slice("genre_".length);
    const genre = await findGenreById(db, genreId);
    if (genre) await mergeSlotsFromStep(ctx, { genre: genre.name });
    return true;
  }

  if (replyId === "lang_add_yes") {
    await sendStepPrompt(ctx, "language", session.state.slots);
    return true;
  }
  if (replyId === "lang_add_no") {
    await commitSlotsAndRoute(ctx, session.state.slots);
    return true;
  }
  if (replyId.startsWith("lang_")) {
    const code = replyId.slice("lang_".length);
    await handleLanguagePicked(ctx, code);
    return true;
  }

  if (replyId.startsWith("mood_")) {
    const value = replyId.slice("mood_".length);
    if (value === "other") {
      await whatsapp.sendText(phone, "No problem - describe the mood in your own words.");
      return true;
    }
    const label = MOOD_LABELS[value];
    if (label) await mergeSlotsFromStep(ctx, { mood: label });
    return true;
  }

  if (replyId.startsWith("vocal_")) {
    const vocal = replyId.slice("vocal_".length) as "male" | "female" | "surprise";
    const normalized = vocal === "surprise" ? "surprise_me" : vocal;
    await mergeSlotsFromStep(ctx, { vocalPreference: normalized });
    return true;
  }

  if (replyId.startsWith("pack_")) {
    const packId = replyId.slice("pack_".length);
    await handlePackPurchase(ctx, packId);
    return true;
  }

  // ---- Review / edit ----
  if (replyId === "confirm_song" && ctx.songRequestId) {
    await handleConfirmation(ctx, session.state.slots);
    return true;
  }

  if (replyId === "edit_song") {
    await whatsapp.sendList(phone, "What would you like to change?", "Choose", [{ rows: EDIT_TARGET_ROWS }]);
    const newState: ConversationState = {
      ...session.state,
      flow: { screen: "editing", returnTo: "review" },
      pendingChoice: EDIT_TARGET_ROWS,
    };
    await updateSessionState(db, session.id, newState);
    session.state = newState;
    return true;
  }

  if (replyId.startsWith("edit_")) {
    const field = replyId.slice("edit_".length);
    if (EDITABLE_FIELDS.has(field)) {
      await sendStepPrompt(ctx, field as GuidedStep, session.state.slots, { editing: true });
      return true;
    }
  }

  if (replyId === "cancel_song") {
    // Soft cancel: draft song request and session are left intact, resumable via "Create Song".
    await renderMainMenu(ctx);
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

// =============================================================================
// Legacy flow (v1) - free-form LLM-led conversation, used only when
// FLOW_V2_ENABLED=false. Unchanged from before the guided-flow rewrite; this
// is the kill-switch fallback, so it's kept fully independent of everything
// above rather than sharing helpers that could regress it.
// =============================================================================

async function processLegacyFlow(args: {
  db: SupabaseClient;
  whatsapp: ReturnType<typeof getWhatsAppProvider>;
  env: Env;
  user: UserRow;
  session: ConversationSessionRow;
  phone: string;
  text: string;
  interactiveReplyId?: string;
}): Promise<void> {
  const { db, whatsapp, env, user, session, phone, text, interactiveReplyId } = args;

  if (interactiveReplyId) {
    const handled = await handleInteractiveReplyLegacy({ db, whatsapp, env, user, session, phone, replyId: interactiveReplyId });
    if (handled) return;
  }

  if (!interactiveReplyId && session.state.pendingChoice?.length) {
    const trimmed = text.trim();
    const numericIndex = /^[1-9]\d*$/.test(trimmed) ? Number(trimmed) - 1 : -1;
    const pendingChoice = session.state.pendingChoice;
    const matched =
      (numericIndex >= 0 ? pendingChoice[numericIndex] : undefined) ??
      pendingChoice.find((c) => c.title.toLowerCase() === trimmed.toLowerCase());

    await updateSessionState(db, session.id, { ...session.state, pendingChoice: undefined });
    session.state = { ...session.state, pendingChoice: undefined };

    if (matched) {
      const handled = await handleInteractiveReplyLegacy({ db, whatsapp, env, user, session, phone, replyId: matched.id });
      if (handled) return;
    }
  }

  if (CREDIT_BALANCE_RE.test(text)) {
    const balance = await getWalletBalance(db, user.id);
    await whatsapp.sendText(phone, `You have ${balance} credit${balance === 1 ? "" : "s"} available. 🎵`);
    return;
  }

  if (RATING_RE.test(text.trim())) {
    const song = await getLatestCompletedSongForUser(db, user.id);
    if (song) {
      await upsertRating(db, { songId: song.id, userId: user.id, rating: Number(text.trim()) });
      await whatsapp.sendText(phone, "Thanks for rating your song! 🙏 Want to create another one?");
      return;
    }
  }

  if (RESTART_RE.test(text.trim())) {
    await resetConversation(db, session.id, session.current_song_request_id);
    await whatsapp.sendText(phone, "No problem, let's start fresh! Tell me about the song you'd like me to create.");
    return;
  }

  let songRequestId = session.current_song_request_id;
  if (!songRequestId) {
    const draft = await createDraftSongRequest(db, { userId: user.id, conversationSessionId: session.id });
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
    const buttons = [
      { id: "confirm_restart", title: "Yes, start over" },
      { id: "cancel_restart", title: "No, keep going" },
    ];
    await whatsapp.sendButtons(
      phone,
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
      phone,
      "Thanks for sharing that. This particular request needs a quick manual review by our team before we can continue - we'll follow up shortly.",
    );
    await persistTurnLegacy(db, session.id, mergedSlots, session.state.history, text, result.assistantReply);
    return;
  }

  const newStatus = stillMissing.length === 0 ? "ready_for_confirmation" : "collecting_details";
  await updateSongRequestBrief(db, songRequestId, mergedSlots, newStatus);
  const persistedState = await persistTurnLegacy(db, session.id, mergedSlots, session.state.history, text, result.assistantReply);

  const readyToConfirm = stillMissing.length === 0 && result.confirmationDetected;

  if (readyToConfirm) {
    await handleConfirmationLegacy({ db, whatsapp, env, user, phone, songRequestId, slots: mergedSlots });
    return;
  }

  if (stillMissing.length === 0) {
    const summary = formatBriefSummary(mergedSlots);
    const buttons = [
      { id: "confirm_song", title: "Yes, create it" },
      { id: "edit_song", title: "Let me change it" },
    ];
    await whatsapp.sendButtons(
      phone,
      `Here's what I've got:\n\n${summary}\n\nShall I go ahead and create this song?`,
      buttons,
    );
    await updateSessionState(db, session.id, { ...persistedState, pendingChoice: buttons });
    return;
  }

  await whatsapp.sendText(phone, result.assistantReply);
}

async function persistTurnLegacy(
  db: SupabaseClient,
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

async function handleConfirmationLegacy(params: {
  db: SupabaseClient;
  whatsapp: ReturnType<typeof getWhatsAppProvider>;
  env: Env;
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
    priceMinorUnits: 0,
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

  const packs = await getActiveCreditPacks(db, country?.id ?? undefined);
  const paystack = getPaystackClient(params.env);

  if (packs.length === 0) {
    await whatsapp.sendText(
      phone,
      "You'll need credits to create this song, but no credit packs are configured yet - please contact support.",
    );
    return;
  }

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

  let authorizationUrl: string;
  try {
    ({ authorizationUrl } = await paystack.initializeTransaction({
      email: `${phone}@users.afrotune.app`,
      amountMinorUnits: pack.price_minor_units,
      currencyCode: pack.currency_code,
      reference,
      metadata: { userId: user.id, creditPackId: pack.id, songRequestId },
      callbackUrl: `${params.env.APP_URL}/pay/complete?reference=${reference}`,
    }));
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(`[confirmation-legacy] paystack initialize FAILED reference=${reference}`, err instanceof Error ? err.message : err);
    await whatsapp.sendText(
      phone,
      "Sorry, I couldn't start the payment for your credits just now - please try again in a moment, or contact support if this keeps happening.",
    );
    return;
  }

  const summary = formatBriefSummary(slots);
  await whatsapp.sendCtaUrl(
    phone,
    `Your song is ready to go:\n\n${summary}\n\nYou'll need ${songRequest.credits_required} credit(s) - grab ${pack.credits} for ${(pack.price_minor_units / 100).toLocaleString()} ${pack.currency_code} and I'll start right after payment.`,
    "Buy credits",
    authorizationUrl,
  );
}

async function handleInteractiveReplyLegacy(params: {
  db: SupabaseClient;
  whatsapp: ReturnType<typeof getWhatsAppProvider>;
  env: Env;
  user: { id: string; country_id: string | null };
  session: ConversationSessionRow;
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
    await handleConfirmationLegacy({
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
