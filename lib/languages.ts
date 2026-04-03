/** Language display names → ISO 639-1 codes. */
export const LANGUAGES: Record<string, string> = {
  English: "en",
  Spanish: "es",
  French: "fr",
  German: "de",
  Portuguese: "pt",
  Chinese: "zh",
  Japanese: "ja",
  Korean: "ko",
  Arabic: "ar",
  Hindi: "hi",
  Russian: "ru",
  Turkish: "tr",
  Italian: "it",
  Dutch: "nl",
  Polish: "pl",
};

/** Display names in order (for UI selectors). */
export const LANGUAGE_NAMES = Object.keys(LANGUAGES);

/** Languages that use right-to-left text direction. */
export const RTL_LANGUAGES = new Set(["Arabic"]);

/** Get the ISO code for a display name, or undefined. */
export function languageCode(name: string): string | undefined {
  return LANGUAGES[name];
}
