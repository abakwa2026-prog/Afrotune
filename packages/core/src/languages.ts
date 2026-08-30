/**
 * Normalizes free-text language mentions from conversation (e.g. "Yoruba",
 * "pidgin") to ISO-ish codes matching the `languages.code` seed data. This is
 * a pragmatic Phase 1 lookup, not a general NLP language identifier - extend
 * the map as new markets/languages are added.
 */
const LANGUAGE_NAME_TO_CODE: Record<string, string> = {
  english: "en",
  en: "en",
  yoruba: "yo",
  yo: "yo",
  igbo: "ig",
  ig: "ig",
  hausa: "ha",
  ha: "ha",
  pidgin: "pcm",
  "nigerian pidgin": "pcm",
  pcm: "pcm",
};

export function normalizeLanguageToCode(input: string): string | null {
  const key = input.trim().toLowerCase();
  return LANGUAGE_NAME_TO_CODE[key] ?? null;
}

export function normalizeLanguagesToCodes(inputs: string[]): string[] {
  const codes = inputs.map(normalizeLanguageToCode).filter((c): c is string => c !== null);
  return Array.from(new Set(codes));
}
