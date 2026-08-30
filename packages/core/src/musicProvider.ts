import type { CompositionSpec } from "./composition.js";

/**
 * Provider-agnostic contract for music generation. ElevenLabs is the first
 * implementation (packages/providers/src/music/elevenlabs.ts); swapping to
 * another provider means writing a new implementation of this interface,
 * not touching conversation, payments, database or delivery code.
 */
export interface MusicGenerationProvider {
  readonly name: string;

  /** Kick off generation. Must return quickly; actual rendering is async. */
  generate(spec: CompositionSpec): Promise<MusicGenerationHandle>;

  /** Poll for the current status/result of a previously started generation. */
  getResult(handle: MusicGenerationHandle): Promise<MusicGenerationResult>;

  /** Best-effort cost estimate in the given currency's minor units, for internal tracking. */
  estimateCostMinorUnits(spec: CompositionSpec): Promise<number | null>;

  capabilities(): MusicProviderCapabilities;
}

export interface MusicGenerationHandle {
  providerJobId: string;
  raw?: unknown;
}

export type MusicGenerationStatus = "pending" | "processing" | "succeeded" | "failed";

export interface MusicGenerationResult {
  status: MusicGenerationStatus;
  /** Populated when status === "succeeded". A remote URL or readable stream location. */
  audioUrl?: string;
  lyrics?: string;
  durationSeconds?: number;
  /** Normalized error info when status === "failed", never a raw provider exception. */
  error?: ProviderError;
  raw?: unknown;
}

export interface ProviderError {
  code: string;
  message: string;
  retryable: boolean;
}

export interface MusicProviderCapabilities {
  supportsLyricsInput: boolean;
  supportsDurationTarget: boolean;
  maxDurationSeconds: number;
  supportedLanguageCodes: string[] | "any";
}
