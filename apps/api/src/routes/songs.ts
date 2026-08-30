import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { getSupabaseServiceClient, getSongById, getSongRequestById, upsertRating } from "@afrotune/db";
import type { Env } from "../env.js";

const RatingBody = z.object({
  rating: z.number().int().min(1).max(5),
  feedback: z.string().max(2000).optional(),
});

export function registerSongsRoutes(app: FastifyInstance, env: Env) {
  const db = getSupabaseServiceClient();

  app.get("/api/songs/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const song = await getSongById(db, id);
    if (!song) return reply.status(404).send({ error: "not_found" });

    const songRequest = await getSongRequestById(db, song.song_request_id);

    let audioUrl: string | null = null;
    if (song.delivery_audio_path) {
      const { data, error } = await db.storage
        .from(env.SUPABASE_MUSIC_BUCKET)
        .createSignedUrl(song.delivery_audio_path, 3600);
      if (!error) audioUrl = data.signedUrl;
    }

    return {
      id: song.id,
      title: song.title,
      lyrics: song.lyrics,
      status: song.status,
      durationSeconds: song.duration_seconds,
      audioUrl,
      occasion: songRequest?.occasion ?? null,
      mood: songRequest?.mood ?? null,
      recipientName: songRequest?.recipient_name ?? null,
      createdAt: song.created_at,
      completedAt: song.completed_at,
    };
  });

  app.post("/api/songs/:id/rating", async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = RatingBody.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: "invalid_body" });

    const song = await getSongById(db, id);
    if (!song) return reply.status(404).send({ error: "not_found" });

    await upsertRating(db, {
      songId: song.id,
      userId: song.user_id,
      rating: parsed.data.rating,
      feedback: parsed.data.feedback,
    });

    return { ok: true };
  });
}
