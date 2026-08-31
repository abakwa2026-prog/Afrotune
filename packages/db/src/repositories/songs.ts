import type { SupabaseClient } from "@supabase/supabase-js";

export interface SongRow {
  id: string;
  song_request_id: string;
  user_id: string;
  title: string | null;
  lyrics: string | null;
  provider: string;
  provider_job_id: string | null;
  provider_metadata: Record<string, unknown>;
  original_audio_path: string | null;
  delivery_audio_path: string | null;
  duration_seconds: number | null;
  status: string;
  failure_reason: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

export async function createSong(
  db: SupabaseClient,
  params: { songRequestId: string; userId: string; provider: string; title?: string },
): Promise<SongRow> {
  const { data, error } = await db
    .from("songs")
    .insert({
      song_request_id: params.songRequestId,
      user_id: params.userId,
      provider: params.provider,
      title: params.title,
      status: "queued",
    })
    .select("*")
    .single();
  if (error) throw error;
  return data as SongRow;
}

export async function getSongById(db: SupabaseClient, id: string): Promise<SongRow | null> {
  const { data, error } = await db.from("songs").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  return (data as SongRow) ?? null;
}

export async function getSongBySongRequestId(
  db: SupabaseClient,
  songRequestId: string,
): Promise<SongRow | null> {
  const { data, error } = await db
    .from("songs")
    .select("*")
    .eq("song_request_id", songRequestId)
    .maybeSingle();
  if (error) throw error;
  return (data as SongRow) ?? null;
}

export async function getLatestCompletedSongForUser(
  db: SupabaseClient,
  userId: string,
): Promise<SongRow | null> {
  const { data, error } = await db
    .from("songs")
    .select("*")
    .eq("user_id", userId)
    .eq("status", "completed")
    .order("completed_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return (data as SongRow) ?? null;
}

export async function listRecentSongsForUser(
  db: SupabaseClient,
  userId: string,
  limit = 5,
): Promise<SongRow[]> {
  const { data, error } = await db
    .from("songs")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data as SongRow[]) ?? [];
}

export async function markSongGenerating(
  db: SupabaseClient,
  id: string,
  providerJobId: string,
): Promise<void> {
  const { error } = await db
    .from("songs")
    .update({ status: "generating", provider_job_id: providerJobId })
    .eq("id", id);
  if (error) throw error;
}

export async function markSongCompleted(
  db: SupabaseClient,
  id: string,
  params: {
    title: string;
    lyrics?: string;
    originalAudioPath: string;
    deliveryAudioPath: string;
    durationSeconds: number;
    providerMetadata?: Record<string, unknown>;
  },
): Promise<void> {
  const { error } = await db
    .from("songs")
    .update({
      status: "completed",
      title: params.title,
      lyrics: params.lyrics,
      original_audio_path: params.originalAudioPath,
      delivery_audio_path: params.deliveryAudioPath,
      duration_seconds: params.durationSeconds,
      provider_metadata: params.providerMetadata ?? {},
      completed_at: new Date().toISOString(),
    })
    .eq("id", id);
  if (error) throw error;
}

export async function markSongFailed(
  db: SupabaseClient,
  id: string,
  reason: string,
): Promise<void> {
  const { error } = await db
    .from("songs")
    .update({ status: "failed", failure_reason: reason })
    .eq("id", id);
  if (error) throw error;
}
