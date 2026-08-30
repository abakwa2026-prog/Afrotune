import type { SupabaseClient } from "@supabase/supabase-js";
import type { SongBriefSlots } from "@afrotune/core";

export interface ConversationState {
  slots: SongBriefSlots;
  history: { role: "user" | "assistant"; content: string }[];
  // The buttons most recently offered to the user (if any), so a bare text
  // reply like "1" - which is what happens whenever the transport can't
  // deliver a real interactive button tap (console dev provider, or a
  // customer who just types instead of tapping) - can still be resolved to
  // the choice it was answering, instead of falling through to the LLM with
  // no idea what "1" refers to. Cleared after the next reply is read,
  // whether or not it matched.
  pendingChoice?: { id: string; title: string }[];
}

export interface ConversationSessionRow {
  id: string;
  user_id: string;
  status: "active" | "completed" | "abandoned";
  current_song_request_id: string | null;
  state: ConversationState;
  created_at: string;
  updated_at: string;
}

const EMPTY_STATE: ConversationState = { slots: {}, history: [] };

export async function getOrCreateActiveSession(
  db: SupabaseClient,
  userId: string,
): Promise<ConversationSessionRow> {
  const { data: existing, error: findError } = await db
    .from("conversation_sessions")
    .select("*")
    .eq("user_id", userId)
    .eq("status", "active")
    .maybeSingle();

  if (findError) throw findError;
  if (existing) return existing as ConversationSessionRow;

  const { data: created, error: insertError } = await db
    .from("conversation_sessions")
    .insert({ user_id: userId, state: EMPTY_STATE })
    .select("*")
    .single();

  if (insertError) throw insertError;
  return created as ConversationSessionRow;
}

export async function updateSessionState(
  db: SupabaseClient,
  sessionId: string,
  state: ConversationState,
): Promise<void> {
  const { error } = await db
    .from("conversation_sessions")
    .update({ state })
    .eq("id", sessionId);
  if (error) throw error;
}

export async function linkSessionToSongRequest(
  db: SupabaseClient,
  sessionId: string,
  songRequestId: string,
): Promise<void> {
  const { error } = await db
    .from("conversation_sessions")
    .update({ current_song_request_id: songRequestId })
    .eq("id", sessionId);
  if (error) throw error;
}

/** Ends the session (e.g. after confirmation hands off to payment/generation, or "start over"). */
export async function closeSession(
  db: SupabaseClient,
  sessionId: string,
  status: "completed" | "abandoned",
): Promise<void> {
  const { error } = await db
    .from("conversation_sessions")
    .update({ status })
    .eq("id", sessionId);
  if (error) throw error;
}
