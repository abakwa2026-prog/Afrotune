import type { SupabaseClient } from "@supabase/supabase-js";

export interface GenerationJobRow {
  id: string;
  song_id: string;
  status: "queued" | "running" | "succeeded" | "failed" | "cancelled";
  attempts: number;
  last_error: string | null;
  idempotency_key: string;
  queued_at: string;
  started_at: string | null;
  completed_at: string | null;
}

/** Idempotency_key is unique - re-enqueuing the same song generation is a no-op. */
export async function createGenerationJob(
  db: SupabaseClient,
  params: { songId: string; idempotencyKey: string },
): Promise<GenerationJobRow> {
  const { data, error } = await db
    .from("generation_jobs")
    .upsert(
      { song_id: params.songId, idempotency_key: params.idempotencyKey },
      { onConflict: "idempotency_key", ignoreDuplicates: false },
    )
    .select("*")
    .single();
  if (error) throw error;
  return data as GenerationJobRow;
}

export async function markJobRunning(db: SupabaseClient, id: string): Promise<void> {
  const { error } = await db
    .from("generation_jobs")
    .update({ status: "running", started_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw error;
}

export async function incrementJobAttempt(db: SupabaseClient, id: string): Promise<void> {
  const { data, error: readError } = await db
    .from("generation_jobs")
    .select("attempts")
    .eq("id", id)
    .single();
  if (readError) throw readError;
  const { error } = await db
    .from("generation_jobs")
    .update({ attempts: (data.attempts ?? 0) + 1 })
    .eq("id", id);
  if (error) throw error;
}

export async function markJobSucceeded(db: SupabaseClient, id: string): Promise<void> {
  const { error } = await db
    .from("generation_jobs")
    .update({ status: "succeeded", completed_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw error;
}

export async function markJobFailed(db: SupabaseClient, id: string, lastError: string): Promise<void> {
  const { error } = await db
    .from("generation_jobs")
    .update({ status: "failed", last_error: lastError, completed_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw error;
}

/** Records the error from a non-final retry attempt without changing job status. */
export async function recordJobAttemptError(
  db: SupabaseClient,
  id: string,
  lastError: string,
): Promise<void> {
  const { error } = await db.from("generation_jobs").update({ last_error: lastError }).eq("id", id);
  if (error) throw error;
}
