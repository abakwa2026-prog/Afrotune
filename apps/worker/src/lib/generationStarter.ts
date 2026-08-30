import type { SupabaseClient } from "@supabase/supabase-js";
import {
  getWalletBalance,
  debitForGeneration,
  setSongRequestStatus,
  getSongBySongRequestId,
  createSong,
  createGenerationJob,
  applyCreditLedgerEntry,
  type SongRequestRow,
} from "@afrotune/db";
import { getGenerationQueue } from "@afrotune/queue";
import type { Env } from "../env.js";

/**
 * Called both right after a user confirms a song brief (if they already have
 * enough credits) and right after a Paystack top-up completes (if there's a
 * song sitting in awaiting_payment). Debiting is idempotent per song request,
 * so it is always safe to call this more than once for the same request.
 * Callers are responsible for messaging the user with the result - this
 * function only knows the user's internal id, not their phone number.
 */
export async function tryStartGeneration(
  db: SupabaseClient,
  songRequest: SongRequestRow,
  env: Pick<Env, "DEV_BYPASS_PAYMENT" | "NODE_ENV">,
): Promise<"started" | "insufficient_credits"> {
  let balance = await getWalletBalance(db, songRequest.user_id);

  // Development-only escape hatch so the ElevenLabs/generation loop can be
  // validated before Paystack is wired up (e.g. testing through the Twilio
  // Sandbox). Double-gated on top of the env flag itself: NODE_ENV must not
  // be "production". Goes through the same ledger function as a real
  // purchase (type "admin_adjustment") rather than skipping the credit
  // check, so debit/refund logic downstream is exercised exactly as it
  // would be for a real customer.
  if (balance < songRequest.credits_required && env.DEV_BYPASS_PAYMENT && env.NODE_ENV !== "production") {
    const topUp = songRequest.credits_required - balance;
    const result = await applyCreditLedgerEntry(db, {
      userId: songRequest.user_id,
      amount: topUp,
      type: "admin_adjustment",
      referenceType: "dev_bypass",
      referenceId: songRequest.id,
      idempotencyKey: `dev-bypass:${songRequest.id}`,
    });
    balance = result.balance;
  }

  if (balance < songRequest.credits_required) {
    return "insufficient_credits";
  }

  // The balance check above and the debit below are not one atomic step, so
  // two concurrent generations for the same underfunded user could both pass
  // it. That race is closed by the credit_wallets.balance >= 0 check
  // constraint inside apply_credit_ledger_entry(): the losing debit throws
  // instead of taking the wallet negative. A real double-confirm from one
  // user is rare enough in this product that retry-via-exception is an
  // acceptable Phase 1 tradeoff rather than adding row-level locking here.
  await debitForGeneration(db, {
    userId: songRequest.user_id,
    songRequestId: songRequest.id,
    credits: songRequest.credits_required,
    idempotencyKey: `debit:${songRequest.id}`,
  });

  await setSongRequestStatus(db, songRequest.id, "queued");

  let song = await getSongBySongRequestId(db, songRequest.id);
  if (!song) {
    song = await createSong(db, {
      songRequestId: songRequest.id,
      userId: songRequest.user_id,
      provider: process.env.MUSIC_PROVIDER ?? "elevenlabs",
    });
  }

  const generationJob = await createGenerationJob(db, {
    songId: song.id,
    // Hyphenated, not colon-separated: this value doubles as the BullMQ
    // job's custom jobId below, and BullMQ reserves ':' in jobId strings for
    // its own repeatable-job format (rejects any jobId containing ':' unless
    // it splits into exactly 3 segments) - see packages/queue's QUEUE_NAMES
    // comment for the same constraint on queue names.
    idempotencyKey: `gen-${songRequest.id}`,
  });

  const queue = getGenerationQueue();
  await queue.add(
    "generate",
    { songRequestId: songRequest.id, songId: song.id, generationJobId: generationJob.id },
    { jobId: generationJob.idempotency_key },
  );

  return "started";
}
