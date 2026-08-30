import type { SongBriefSlots } from "./songBrief.js";

/**
 * Provider-agnostic contract for the conversational layer. The LLM's job is
 * strictly understanding + extraction + phrasing. It never decides credits,
 * pricing, or generation state - those are deterministic backend concerns
 * (see packages/db repositories and apps/worker processors).
 */
export interface LLMProvider {
  readonly name: string;

  /**
   * Interpret one user message in the context of the running conversation
   * and the slots already known. Returns structured slot updates plus a
   * natural-language reply to send back. The reply text should NOT ask
   * about slots that are already filled.
   */
  interpretTurn(input: LLMTurnInput): Promise<LLMTurnOutput>;
}

export interface LLMTurnInput {
  userMessage: string;
  knownSlots: SongBriefSlots;
  missingSlots: string[];
  /** Short rolling history, oldest first. Kept small; full history lives in the DB. */
  recentHistory: { role: "user" | "assistant"; content: string }[];
  /** Special commands the backend has already resolved go through separate code paths
   *  (e.g. "how many credits do I have?" is answered from the ledger, not the LLM),
   *  but the LLM still needs to recognize them so it doesn't try to answer instead. */
  intentHints?: string[];
}

export interface LLMTurnOutput {
  slotUpdates: Partial<SongBriefSlots>;
  /** True when the user is asking to restart the brief from scratch. */
  restartRequested: boolean;
  /** True when the model believes the user has confirmed the summarized direction. */
  confirmationDetected: boolean;
  assistantReply: string;
}
