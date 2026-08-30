import type { SupabaseClient } from "@supabase/supabase-js";
import type { SongBriefSlots } from "@afrotune/core";

export type SongRequestStatus =
  | "draft"
  | "collecting_details"
  | "ready_for_confirmation"
  | "awaiting_payment"
  | "queued"
  | "generating"
  | "processing"
  | "completed"
  | "failed"
  | "moderation_required"
  | "cancelled";

export interface SongRequestRow {
  id: string;
  user_id: string;
  conversation_session_id: string | null;
  status: SongRequestStatus;
  country_id: string | null;
  occasion: string | null;
  recipient_name: string | null;
  relationship: string | null;
  story: string | null;
  genre_id: string | null;
  secondary_genre_id: string | null;
  language_ids: string[];
  mood: string | null;
  vocal_preference: string | null;
  target_duration_seconds: number | null;
  required_phrases: string[];
  brief: SongBriefSlots;
  composition_spec: unknown | null;
  price_minor_units: number | null;
  currency_code: string | null;
  credits_required: number;
  moderation_status: "pending" | "approved" | "rejected";
  created_at: string;
  updated_at: string;
  confirmed_at: string | null;
}

export async function createDraftSongRequest(
  db: SupabaseClient,
  params: { userId: string; conversationSessionId: string },
): Promise<SongRequestRow> {
  const { data, error } = await db
    .from("song_requests")
    .insert({
      user_id: params.userId,
      conversation_session_id: params.conversationSessionId,
      status: "collecting_details",
      brief: {},
    })
    .select("*")
    .single();
  if (error) throw error;
  return data as SongRequestRow;
}

export async function getSongRequestById(
  db: SupabaseClient,
  id: string,
): Promise<SongRequestRow | null> {
  const { data, error } = await db.from("song_requests").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  return (data as SongRequestRow) ?? null;
}

export async function updateSongRequestBrief(
  db: SupabaseClient,
  id: string,
  brief: SongBriefSlots,
  status?: SongRequestStatus,
): Promise<void> {
  const patch: Record<string, unknown> = { brief };
  if (status) patch.status = status;
  const { error } = await db.from("song_requests").update(patch).eq("id", id);
  if (error) throw error;
}

export async function confirmSongRequest(
  db: SupabaseClient,
  id: string,
  params: {
    genreId: string | null;
    secondaryGenreId: string | null;
    languageIds: string[];
    priceMinorUnits: number;
    currencyCode: string;
    creditsRequired: number;
  },
): Promise<void> {
  const { error } = await db
    .from("song_requests")
    .update({
      status: "awaiting_payment",
      genre_id: params.genreId,
      secondary_genre_id: params.secondaryGenreId,
      language_ids: params.languageIds,
      price_minor_units: params.priceMinorUnits,
      currency_code: params.currencyCode,
      credits_required: params.creditsRequired,
      confirmed_at: new Date().toISOString(),
    })
    .eq("id", id);
  if (error) throw error;
}

/** Used after a credit top-up completes, to resume a song that was waiting on payment. */
export async function findLatestAwaitingPaymentSongRequest(
  db: SupabaseClient,
  userId: string,
): Promise<SongRequestRow | null> {
  const { data, error } = await db
    .from("song_requests")
    .select("*")
    .eq("user_id", userId)
    .eq("status", "awaiting_payment")
    .order("confirmed_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return (data as SongRequestRow) ?? null;
}

export async function setSongRequestStatus(
  db: SupabaseClient,
  id: string,
  status: SongRequestStatus,
): Promise<void> {
  const { error } = await db.from("song_requests").update({ status }).eq("id", id);
  if (error) throw error;
}

export async function setCompositionSpec(
  db: SupabaseClient,
  id: string,
  compositionSpec: unknown,
): Promise<void> {
  const { error } = await db
    .from("song_requests")
    .update({ composition_spec: compositionSpec })
    .eq("id", id);
  if (error) throw error;
}
