import { z } from "zod";

/**
 * The Song Brief is AfroTune's internal representation of what a customer
 * wants. It is intentionally provider-agnostic: nothing here couples to
 * ElevenLabs or any specific music generation API. A CompositionSpec (see
 * composition.ts) is derived from a confirmed SongBrief plus cultural/music
 * intelligence data, and *that* is what gets translated into a provider call.
 */

export const VocalPreference = z.enum(["male", "female", "surprise_me"]);
export type VocalPreference = z.infer<typeof VocalPreference>;

// Slots the conversation layer is trying to fill. Every field is optional
// because the brief is built incrementally across a multi-turn conversation.
// `null` means "the user was asked and explicitly has no preference / it does
// not apply"; `undefined`/absent means "not yet known".
export const SongBriefSlots = z.object({
  countryCode: z.string().length(2).optional(),
  occasion: z.string().optional(), // e.g. "birthday", "wedding", "anniversary"
  recipientName: z.string().optional(),
  relationship: z.string().optional(), // e.g. "wife", "best friend"
  story: z.string().optional(), // free-text personal details/story
  genre: z.string().optional(), // e.g. "Afrobeats"
  secondaryGenre: z.string().optional(), // fusion/variation, e.g. "Highlife"
  languages: z.array(z.string()).optional(), // language codes, e.g. ["en", "yo"]
  mood: z.string().optional(), // e.g. "romantic", "celebratory", "emotional"
  vocalPreference: VocalPreference.optional(),
  targetDurationSeconds: z.number().int().positive().optional(),
  requiredPhrases: z.array(z.string()).optional(), // names/phrases that must appear
});
export type SongBriefSlots = z.infer<typeof SongBriefSlots>;

/**
 * The minimum set of slots required before a brief can move to
 * ready_for_confirmation. Business logic (not the LLM) enforces this.
 */
export const REQUIRED_SLOTS_FOR_CONFIRMATION: (keyof SongBriefSlots)[] = [
  "occasion",
  "genre",
  "languages",
  "mood",
];

export function missingRequiredSlots(slots: SongBriefSlots): (keyof SongBriefSlots)[] {
  return REQUIRED_SLOTS_FOR_CONFIRMATION.filter((key) => {
    const value = slots[key];
    if (value === undefined || value === null) return true;
    if (Array.isArray(value) && value.length === 0) return true;
    return false;
  });
}

/**
 * Merge newly extracted slots onto an existing brief. Newly extracted
 * defined values win (the user is treating this as an update, e.g. "actually
 * change it to Yoruba" or "her name is Grace, not Gloria"); undefined values
 * in the patch never erase existing data.
 */
export function mergeSongBriefSlots(
  existing: SongBriefSlots,
  patch: Partial<SongBriefSlots>,
): SongBriefSlots {
  const merged: SongBriefSlots = { ...existing };
  for (const key of Object.keys(patch) as (keyof SongBriefSlots)[]) {
    const value = patch[key];
    if (value !== undefined) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (merged as any)[key] = value;
    }
  }
  return merged;
}
