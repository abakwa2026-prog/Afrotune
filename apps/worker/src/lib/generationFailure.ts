import {
  getSupabaseServiceClient,
  markJobFailed,
  markSongFailed,
  setSongRequestStatus,
  getSongRequestById,
  refundForFailedGeneration,
  getUserById,
} from "@afrotune/db";
import type { GenerationJob } from "@afrotune/queue";
import { getWhatsAppProvider } from "./providers.js";
import { loadEnv } from "../env.js";

/**
 * Called once retries are exhausted for a generation job. Guarantees the
 * customer never silently loses a credit: the song is marked failed and the
 * credit that was debited at confirmation time is refunded, both before the
 * customer is told anything went wrong.
 */
export async function handleTerminalGenerationFailure(
  data: GenerationJob,
  error: Error,
): Promise<void> {
  const env = loadEnv();
  const db = getSupabaseServiceClient();
  const whatsapp = getWhatsAppProvider(env);

  await markJobFailed(db, data.generationJobId, error.message);
  await markSongFailed(db, data.songId, error.message);
  await setSongRequestStatus(db, data.songRequestId, "failed");

  const songRequest = await getSongRequestById(db, data.songRequestId);
  if (!songRequest) return;

  await refundForFailedGeneration(db, {
    userId: songRequest.user_id,
    songRequestId: songRequest.id,
    credits: songRequest.credits_required,
    idempotencyKey: `refund:${songRequest.id}`,
  });

  const user = await getUserById(db, songRequest.user_id);
  if (!user) return;

  await whatsapp.sendText(
    user.whatsapp_phone_number,
    "Sorry - something went wrong generating your song and it didn't complete. We've refunded the credit back to your wallet, no charge to you. Want to try again, maybe with a slightly different direction?",
  );
}
