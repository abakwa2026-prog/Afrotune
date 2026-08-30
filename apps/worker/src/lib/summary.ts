import type { SongBriefSlots } from "@afrotune/core";

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
