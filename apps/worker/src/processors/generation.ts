import { join } from "node:path";
import { readFile } from "node:fs/promises";
import type { Job } from "bullmq";
import {
  getSupabaseServiceClient,
  getSongRequestById,
  getSongById,
  setSongRequestStatus,
  setCompositionSpec,
  markSongGenerating,
  markSongCompleted,
  markJobRunning,
  incrementJobAttempt,
  recordJobAttemptError,
  getGenreContext,
  getUserById,
  getOrCreateActiveSession,
  updateSessionState,
} from "@afrotune/db";
import { buildCompositionSpec, type GenreContext, type SongBriefSlots } from "@afrotune/core";
import { probeAudioFile, processForDelivery } from "@afrotune/providers";
import type { GenerationJob } from "@afrotune/queue";
import { getMusicProvider, getWhatsAppProvider } from "../lib/providers.js";
import { downloadToTempFile } from "../lib/download.js";
import { patchFlow } from "../lib/flow.js";
import { loadEnv } from "../env.js";

const POLL_INTERVAL_MS = 5000;
const MAX_POLL_MS = 8 * 60 * 1000; // 8 minutes

export async function processGeneration(job: Job<GenerationJob>): Promise<void> {
  const env = loadEnv();
  const db = getSupabaseServiceClient();
  const { songRequestId, songId, generationJobId } = job.data;

  await incrementJobAttempt(db, generationJobId);
  await markJobRunning(db, generationJobId);

  try {
    const songRequest = await getSongRequestById(db, songRequestId);
    if (!songRequest) throw new Error(`song_request ${songRequestId} not found`);

    const genre: GenreContext = songRequest.genre_id
      ? await getGenreContext(db, songRequest.genre_id)
      : { name: songRequest.brief.genre ?? "Afrobeats", instruments: [] };

    const secondaryGenre: GenreContext | undefined = songRequest.secondary_genre_id
      ? await getGenreContext(db, songRequest.secondary_genre_id)
      : undefined;

    const spec = buildCompositionSpec({
      songRequestId,
      slots: songRequest.brief as SongBriefSlots,
      genre,
      secondaryGenre,
    });

    await setCompositionSpec(db, songRequestId, spec);
    await setSongRequestStatus(db, songRequestId, "generating");

    const provider = getMusicProvider(env);
    const handle = await provider.generate(spec);
    await markSongGenerating(db, songId, handle.providerJobId);

    const result = await pollForResult(provider, handle);

    if (result.status !== "succeeded" || !result.audioUrl) {
      throw new Error(
        `Music provider did not return a completed track: ${result.error?.message ?? "unknown error"}`,
      );
    }

    await setSongRequestStatus(db, songRequestId, "processing");

    const downloaded = await downloadToTempFile(result.audioUrl);
    try {
      await probeAudioFile(downloaded.path);

      const deliveryPath = join(downloaded.dir, "delivery.mp3");
      await processForDelivery(downloaded.path, deliveryPath);

      const originalKey = `songs/${songRequest.user_id}/${songId}/${basename(downloaded.path)}`;
      const deliveryKey = `songs/${songRequest.user_id}/${songId}/delivery.mp3`;

      const originalBuffer = await readFile(downloaded.path);
      const deliveryBuffer = await readFile(deliveryPath);

      const bucket = db.storage.from(env.SUPABASE_MUSIC_BUCKET);
      const [originalUpload, deliveryUpload] = await Promise.all([
        bucket.upload(originalKey, originalBuffer, { upsert: true }),
        bucket.upload(deliveryKey, deliveryBuffer, { upsert: true, contentType: "audio/mpeg" }),
      ]);
      if (originalUpload.error) throw originalUpload.error;
      if (deliveryUpload.error) throw deliveryUpload.error;

      const probed = await probeAudioFile(deliveryPath);

      await markSongCompleted(db, songId, {
        title: spec.workingTitle,
        lyrics: result.lyrics,
        originalAudioPath: originalKey,
        deliveryAudioPath: deliveryKey,
        durationSeconds: probed.durationSeconds,
        providerMetadata: { providerJobId: handle.providerJobId },
      });
      await setSongRequestStatus(db, songRequestId, "completed");

      await notifySongReady(db, env, songRequestId, songId);
    } finally {
      await downloaded.cleanup();
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await recordJobAttemptError(db, generationJobId, message);
    throw err; // let BullMQ retry per queue config; terminal handling lives in the worker's 'failed' listener
  }
}

async function pollForResult(
  provider: ReturnType<typeof getMusicProvider>,
  handle: { providerJobId: string },
) {
  const deadline = Date.now() + MAX_POLL_MS;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const result = await provider.getResult(handle);
    if (result.status === "succeeded" || result.status === "failed") return result;
    if (Date.now() > deadline) {
      return { status: "failed" as const, error: { code: "timeout", message: "Generation timed out", retryable: true } };
    }
    await sleep(POLL_INTERVAL_MS);
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function basename(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

async function notifySongReady(
  db: ReturnType<typeof getSupabaseServiceClient>,
  env: ReturnType<typeof loadEnv>,
  songRequestId: string,
  songId: string,
) {
  const songRequest = await getSongRequestById(db, songRequestId);
  const song = await getSongById(db, songId);
  if (!songRequest || !song) return;

  const user = await getUserById(db, songRequest.user_id);
  if (!user) return;

  const whatsapp = getWhatsAppProvider(env);

  const { data: signed } = song.delivery_audio_path
    ? await db.storage.from(env.SUPABASE_MUSIC_BUCKET).createSignedUrl(song.delivery_audio_path, 60 * 60 * 24 * 7)
    : { data: null };

  await whatsapp.sendText(user.whatsapp_phone_number, `Your song "${song.title ?? "AfroTune track"}" is ready! 🎉`);

  if (signed?.signedUrl) {
    await whatsapp.sendAudioLink(user.whatsapp_phone_number, signed.signedUrl);
  }

  if (song.lyrics) {
    await whatsapp.sendText(user.whatsapp_phone_number, `Lyrics:\n\n${song.lyrics}`);
  }

  // Song delivery is via the audio message above (signed URL, works
  // standalone) - deliberately no web link here, apps/web's /song/[id] page
  // isn't reliable yet and a broken link undermines trust right after a
  // successful delivery. See the plan doc for context.
  const buttons = [
    { id: "postdelivery_create_another", title: "Create another song" },
    { id: "postdelivery_menu", title: "Back to menu" },
  ];
  await whatsapp.sendButtons(
    user.whatsapp_phone_number,
    "How would you rate it? Reply with a number from 1 to 5.\n\nWhat would you like to do next?",
    buttons,
  );

  const session = await getOrCreateActiveSession(db, songRequest.user_id);
  const newState = patchFlow(session.state, { screen: "post_delivery" });
  await updateSessionState(db, session.id, { ...newState, pendingChoice: buttons });
}
