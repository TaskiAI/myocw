// Maps resource IDs to coding pset configurations.
// Hardcoded for now — can move to DB when we scale past a few courses.

export interface CodingPsetConfig {
  psetId: string;
  templateCodeUrl: string;
  resourceFiles: { name: string; url: string }[];
}

const BASE = "/content/courses/6-0001-intro-to-python/psets";

export const CODING_PSETS: Record<number, CodingPsetConfig> = {
  // 6.0001 PS1 — House Hunting (no resource files)
  29882: {
    psetId: "ps1-house-hunting",
    templateCodeUrl: `${BASE}/ps1/template.py`,
    resourceFiles: [],
  },

  // 6.0001 PS2 — Hangman
  29890: {
    psetId: "ps2-hangman",
    templateCodeUrl: `${BASE}/hangman/template.py`,
    resourceFiles: [
      { name: "words.txt", url: `${BASE}/hangman/words.txt` },
    ],
  },

  // 6.0001 PS3 — Word Game
  29899: {
    psetId: "ps3-word-game",
    templateCodeUrl: `${BASE}/word-game/template.py`,
    resourceFiles: [
      { name: "words.txt", url: `${BASE}/word-game/words.txt` },
    ],
  },

  // 6.0001 PS4 — Caesar Cipher (combined A/B/C)
  29903: {
    psetId: "ps4-caesar-cipher",
    templateCodeUrl: `${BASE}/ps4/template.py`,
    resourceFiles: [
      { name: "words.txt", url: `${BASE}/ps4/words.txt` },
      { name: "story.txt", url: `${BASE}/ps4/story.txt` },
    ],
  },

  // 6.0001 PS5 — RSS Feed Filter (stripped for Pyodide)
  29910: {
    psetId: "ps5-rss-filter",
    templateCodeUrl: `${BASE}/ps5/template.py`,
    resourceFiles: [
      { name: "triggers.txt", url: `${BASE}/ps5/triggers.txt` },
    ],
  },
};
