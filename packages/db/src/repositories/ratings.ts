import type { SupabaseClient } from "@supabase/supabase-js";

export async function upsertRating(
  db: SupabaseClient,
  params: { songId: string; userId: string; rating: number; feedback?: string },
): Promise<void> {
  const { error } = await db.from("ratings").upsert(
    {
      song_id: params.songId,
      user_id: params.userId,
      rating: params.rating,
      feedback: params.feedback,
    },
    { onConflict: "song_id,user_id" },
  );
  if (error) throw error;
}
