import { deriveWorkingTitle, type SongBriefSlots } from "@afrotune/core";

const STORY_PREVIEW_MAX_CHARS = 220;

/**
 * The pre-payment review screen (guided flow v2) - a fuller summary than
 * formatBriefSummary, including the story, resolved display names (not raw
 * slot strings, which may be free text) and the cost/balance the user is
 * about to commit to. Callers resolve country/genre/language names via the
 * catalog repositories first (this stays a pure formatter, no DB access).
 */
export function buildReviewSummary(params: {
  slots: SongBriefSlots;
  countryName?: string;
  genreName?: string;
  languageNames: string[];
  creditsRequired: number;
  balance: number;
}): string {
  const { slots, countryName, genreName, languageNames, creditsRequired, balance } = params;
  const resolvedGenreName = genreName ?? slots.genre;

  const title = slots.occasion
    ? deriveWorkingTitle({
        occasion: slots.occasion,
        recipientName: slots.recipientName,
        genreName: resolvedGenreName ?? "Your",
      })
    : "Your song";

  const lines: string[] = [title, ""];
  if (slots.occasion) lines.push(`Occasion: ${capitalize(slots.occasion)}`);
  if (countryName) lines.push(`Sound: ${countryName}`);
  if (resolvedGenreName) {
    lines.push(
      `Genre: ${resolvedGenreName}${slots.secondaryGenre ? ` with ${slots.secondaryGenre} influence` : ""}`,
    );
  }
  if (languageNames.length) lines.push(`Language: ${languageNames.join(", ")}`);
  if (slots.vocalPreference) {
    lines.push(`Voice: ${slots.vocalPreference === "surprise_me" ? "Surprise me" : capitalize(slots.vocalPreference)}`);
  }
  if (slots.mood) lines.push(`Mood: ${capitalize(slots.mood)}`);
  if (slots.story) {
    lines.push("");
    lines.push(`Story:\n${truncate(slots.story, STORY_PREVIEW_MAX_CHARS)}`);
  }
  lines.push("");
  lines.push(`Cost: ${creditsRequired} credit${creditsRequired === 1 ? "" : "s"}`);
  lines.push(`Balance: ${balance} credit${balance === 1 ? "" : "s"}`);

  return lines.join("\n");
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1).trimEnd()}…`;
}

export function formatBriefSummary(slots: SongBriefSlots): string {
  const lines: string[] = [];
  if (slots.occasion) lines.push(`Occasion: ${capitalize(slots.occasion)}`);
  if (slots.recipientName) {
    lines.push(`For: ${slots.recipientName}${slots.relationship ? ` (${slots.relationship})` : ""}`);
  }
  if (slots.genre) {
    lines.push(`Genre: ${slots.genre}${slots.secondaryGenre ? ` with ${slots.secondaryGenre} influence` : ""}`);
  }
  if (slots.languages?.length) lines.push(`Language(s): ${slots.languages.join(", ")}`);
  if (slots.mood) lines.push(`Mood: ${capitalize(slots.mood)}`);
  if (slots.vocalPreference) lines.push(`Vocal: ${slots.vocalPreference.replace("_", " ")}`);
  return lines.join("\n");
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
