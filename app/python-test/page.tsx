"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import type { CodingStep } from "@/app/components/python-player/CodingStepCard";

const PythonPsetPlayer = dynamic(
  () => import("@/app/components/python-player/PythonPsetPlayer"),
  { ssr: false }
);

const DEMO_STEPS: CodingStep[] = [
  {
    label: "1",
    title: "is_word_guessed",
    instructions:
      "Implement the function `is_word_guessed` that determines if the player has successfully guessed all the letters in the secret word.\n\n### Requirements:\n- Takes two parameters: a string `secret_word` and a list of strings `letters_guessed`.\n- Returns a boolean: `True` if all letters of `secret_word` are in `letters_guessed`, and `False` otherwise.\n\n### Example:\n```python\nsecret_word = 'apple'\nletters_guessed = ['e', 'i', 'k', 'p', 'r', 's']\nprint(is_word_guessed(secret_word, letters_guessed))\n# Output: False\n```",
    test_snippet:
      "secret_word = 'apple'\nletters_guessed = ['a', 'p', 'l', 'e']\nprint(f\"Test 1: {is_word_guessed(secret_word, letters_guessed)}\") # Expected: True\n\nletters_guessed = ['e', 'i', 'k', 'p', 'r', 's']\nprint(f\"Test 2: {is_word_guessed(secret_word, letters_guessed)}\") # Expected: False",
  },
  {
    label: "2",
    title: "get_guessed_word",
    instructions:
      "Implement `get_guessed_word` to show the user their progress.\n\n### Requirements:\n- Returns a string comprised of letters and underscores based on what letters in `letters_guessed` are in `secret_word`.\n- Use an underscore followed by a space (`_ `) to represent an unknown letter.\n\n### Example:\n```python\nsecret_word = 'apple'\nletters_guessed = ['e', 'i', 'k', 'p', 'r', 's']\nprint(get_guessed_word(secret_word, letters_guessed))\n# Output: '_ pp_ e'\n```",
    test_snippet:
      "secret_word = 'apple'\nletters_guessed = ['e', 'i', 'k', 'p', 'r', 's']\nresult = get_guessed_word(secret_word, letters_guessed)\nprint(f\"Test 1: '{result}'\") # Expected: '_ pp_ e'",
  },
  {
    label: "3",
    title: "get_available_letters",
    instructions:
      "Implement `get_available_letters` to show the player which letters they haven't guessed yet.\n\n### Requirements:\n- Returns a single string containing all lowercase English letters that are **not** in `letters_guessed`.\n- The letters should be in alphabetical order.\n- **Hint:** You can use `string.ascii_lowercase` to get all 26 letters.\n\n### Example:\n```python\nletters_guessed = ['e', 'i', 'k', 'p', 'r', 's']\nprint(get_available_letters(letters_guessed))\n# Output: 'abcdfghjlmnoqtuvwxyz'\n```",
    test_snippet:
      "letters_guessed = ['e', 'i', 'k', 'p', 'r', 's']\nresult = get_available_letters(letters_guessed)\nprint(f\"Test 1: {result}\") # Expected: abcdfghjlmnoqtuvwxyz",
  },
  {
    label: "4",
    title: "hangman",
    instructions:
      "Implement the main interactive game loop in the function `hangman`.\n\n### Game Rules:\n1. **Start:** The user begins with 6 guesses and 3 warnings.\n2. **Display:** Before each turn, show the number of remaining guesses and the available letters.\n3. **Input:** Ask for one letter. Convert to lowercase. If invalid or already guessed, lose a warning (or a guess if 0 warnings left).\n4. **Feedback:** Correct guess shows updated word. Wrong consonant loses 1 guess. Wrong vowel (a,e,i,o,u) loses 2 guesses.\n5. **Win:** Score = `guesses_remaining` * (number of unique letters in `secret_word`). **Lose:** Reveal the word.\n\n*This function uses `input()` — the test just verifies it's callable.*",
    test_snippet:
      "print(f\"hangman is callable: {callable(hangman)}\")",
  },
  {
    label: "5",
    title: "match_with_gaps",
    instructions:
      "Implement `match_with_gaps` to help find potential matches for the current guessed word.\n\n### Requirements:\n- Takes `my_word` (with `_ ` for unknowns) and `other_word` (plain word).\n- Returns `True` if `other_word` could be a match.\n- Rules: same length (after removing spaces from `my_word`), revealed letters must match, underscored positions can't be letters already revealed elsewhere.\n\n### Examples:\n- `match_with_gaps(\"te_ t\", \"tact\")` -> `False`\n- `match_with_gaps(\"a_ _ le\", \"apple\")` -> `True`\n- `match_with_gaps(\"a_ ple\", \"apple\")` -> `False`",
    test_snippet:
      "print(f\"Test 1: {match_with_gaps('te_ t', 'tact')}\")       # Expected: False\nprint(f\"Test 2: {match_with_gaps('a_ _ le', 'apple')}\")   # Expected: True\nprint(f\"Test 3: {match_with_gaps('a_ ple', 'apple')}\")     # Expected: False",
  },
  {
    label: "6",
    title: "show_possible_matches",
    instructions:
      "Implement `show_possible_matches` which searches the wordlist and prints all words that match the current progress.\n\n### Requirements:\n- Iterates through the global `wordlist` and prints every word where `match_with_gaps(my_word, word)` is `True`.\n- If no words match, print `\"No matches found\"`.\n\n### Example:\n```python\nshow_possible_matches(\"t_ _ t\")\n# Output: tact tart taut teat tent test text ...\n```",
    test_snippet:
      "print(\"Possible matches for 't_ _ t':\")\nshow_possible_matches(\"t_ _ t\")",
  },
  {
    label: "7",
    title: "hangman_with_hints",
    instructions:
      "Implement `hangman_with_hints`, a version of the game that allows users to ask for help.\n\n### Requirements:\n- Behaves identically to `hangman` with one addition: if the user inputs `*`, call `show_possible_matches` to display all possible words.\n- The user should **not** lose a guess when they input `*`.\n\n*This function uses `input()` — the test just verifies it's callable.*",
    test_snippet:
      "print(f\"hangman_with_hints is callable: {callable(hangman_with_hints)}\")",
  },
];

export default function PythonTestPage() {
  const [stepped, setStepped] = useState(true);

  return (
    <div className="mx-auto max-w-7xl p-6">
      <div className="mb-4 flex items-center gap-4">
        <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">
          Python Pset Player — Test
        </h1>
        <button
          onClick={() => setStepped((v) => !v)}
          className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm text-zinc-600 hover:bg-zinc-100 dark:border-zinc-600 dark:text-zinc-400 dark:hover:bg-zinc-800"
        >
          {stepped ? "Switch to Full Template" : "Switch to Stepped"}
        </button>
      </div>
      <PythonPsetPlayer
        courseId={0}
        psetId="hangman"
        templateCodeUrl="/content/courses/6-0001-intro-to-python/psets/hangman/template.py"
        resourceFiles={[
          {
            name: "words.txt",
            url: "/content/courses/6-0001-intro-to-python/psets/hangman/words.txt",
          },
        ]}
        steps={stepped ? DEMO_STEPS : undefined}
      />
    </div>
  );
}
