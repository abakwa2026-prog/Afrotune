import type { SongBriefSlots } from "./songBrief.js";

/** A single cultural/musical data point pulled from AfroTune's own genre data. */
export interface GenreContext {
  name: string;
  description?: string;
  culturalNotes?: Record<string, unknown>;
  instruments: string[];
  parentGenreName?: string;
}

/**
 * The output of AfroTune's music intelligence layer: a SongBrief enriched
 * with country/genre/instrument/language context, ready to be translated by
 * a MusicGenerationProvider into an actual provider request. This is the
 * artifact that should get *more* sophisticated over time without touching
 * conversation, payments, or delivery code.
 */
export interface CompositionSpec {
  songRequestId: string;
  occasion: string;
  recipientName?: string;
  relationship?: string;
  story?: string;
  genre: GenreContext;
  secondaryGenre?: GenreContext;
  languages: string[];
  mood: string;
  vocalPreference: "male" | "female" | "surprise_me";
  targetDurationSeconds: number;
  requiredPhrases: string[];
  /** Free-text prompt assembled from the above, handed to the provider. */
  compositionPrompt: string;
  /** Suggested lyric title, used until the provider/LLM produces a better one. */
  workingTitle: string;
}

const DEFAULT_DURATION_SECONDS = 120;

/**
 * Shared by CompositionSpec generation and the WhatsApp review screen so the
 * two never disagree on what the song is titled. `occasion` must be
 * non-empty (callers already require it before reaching this point).
 */
export function deriveWorkingTitle(params: {
  occasion: string;
  recipientName?: string;
  genreName: string;
}): string {
  return params.recipientName
    ? `${params.occasion} song for ${params.recipientName}`
    : `${params.genreName} ${params.occasion} song`;
}

export function buildCompositionSpec(params: {
  songRequestId: string;
  slots: SongBriefSlots;
  genre: GenreContext;
  secondaryGenre?: GenreContext;
}): CompositionSpec {
  const { songRequestId, slots, genre, secondaryGenre } = params;

  if (!slots.occasion) throw new Error("Cannot build composition spec without an occasion");
  if (!slots.mood) throw new Error("Cannot build composition spec without a mood");
  if (!slots.languages || slots.languages.length === 0) {
    throw new Error("Cannot build composition spec without at least one language");
  }

  const instrumentsLine = genre.instruments.length
    ? `Instrumentation should draw on ${genre.name} tradition: ${genre.instruments.join(", ")}.`
    : "";

  const fusionLine = secondaryGenre
    ? `Blend in ${secondaryGenre.name} influence (${secondaryGenre.description ?? "characteristic style"}).`
    : "";

  const storyLine = slots.story ? `Personal story to reflect in the lyrics: ${slots.story}.` : "";

  const recipientLine = slots.recipientName
    ? `This song is for ${slots.recipientName}${slots.relationship ? ` (${slots.relationship})` : ""}.`
    : "";

  const phrasesLine = slots.requiredPhrases?.length
    ? `The lyrics must include: ${slots.requiredPhrases.join(", ")}.`
    : "";

  const compositionPrompt = [
    `A ${genre.name} song for a ${slots.occasion}.`,
    recipientLine,
    `Mood: ${slots.mood}.`,
    `Languages: ${slots.languages.join(", ")}.`,
    `Vocal: ${slots.vocalPreference ?? "surprise_me"}.`,
    instrumentsLine,
    fusionLine,
    storyLine,
    phrasesLine,
  ]
    .filter(Boolean)
    .join(" ");

  const workingTitle = deriveWorkingTitle({
    occasion: slots.occasion,
    recipientName: slots.recipientName,
    genreName: genre.name,
  });

  return {
    songRequestId,
    occasion: slots.occasion,
    recipientName: slots.recipientName,
    relationship: slots.relationship,
    story: slots.story,
    genre,
    secondaryGenre,
    languages: slots.languages,
    mood: slots.mood,
    vocalPreference: slots.vocalPreference ?? "surprise_me",
    targetDurationSeconds: slots.targetDurationSeconds ?? DEFAULT_DURATION_SECONDS,
    requiredPhrases: slots.requiredPhrases ?? [],
    compositionPrompt,
    workingTitle,
  };
}
