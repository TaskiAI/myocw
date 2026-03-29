"""Stage 2: Split pset markdown into individual problems via OpenAI,
or package non-problem content as raw markdown.

Reads markdown files produced by ingest.py (Stage 1). For problem-type PDFs
(problem sets, exams), sends to OpenAI to extract structured problems.
For content-type PDFs (lecture notes, readings), packages raw markdown as-is.

Usage:
    uv run python structure.py <slug>
"""

import argparse
import json
import re
import sys
from pathlib import Path

from dotenv import load_dotenv
from openai import OpenAI

# --- Constants ---

MODEL = "gpt-5-nano"

PROBLEM_PATTERN = re.compile(
    r"_ps\d|pset|problem.set|prob|exam|midterm|final|quiz", re.IGNORECASE
)
SOLUTION_PATTERN = re.compile(r"sol|solution|ans", re.IGNORECASE)

SYSTEM_PROMPT = (
    "Insert <problem label=\"N\"> and </problem> XML tags around each "
    "top-level numbered problem. Do not modify, paraphrase, or omit "
    "any text. Preserve all LaTeX and formatting exactly."
)

SOLUTION_SYSTEM_PROMPT = (
    "This is a solutions document. Wrap each solution in "
    "<solution label=\"N\"> and </solution> XML tags, where N matches "
    "the problem number it solves (e.g. \"1.1\", \"2\", \"3a\"). "
    "Do not modify, paraphrase, or omit any text. "
    "Preserve all LaTeX and formatting exactly."
)

# --- Setup ---

env_path = Path(__file__).resolve().parent.parent / ".env.local"
load_dotenv(env_path)

client = OpenAI()


def split_problems(markdown: str) -> list[dict]:
    """Send markdown to OpenAI, parse <problem> tags from response."""
    response = client.chat.completions.create(
        model=MODEL,
        messages=[
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": markdown},
        ],
        **({"temperature": 0} if "gpt-5" not in MODEL else {}),
    )

    tagged = response.choices[0].message.content

    pattern = re.compile(
        r'<problem\s+label="([^"]+)">\s*(.*?)\s*</problem>',
        re.DOTALL,
    )
    matches = pattern.findall(tagged)

    if not matches:
        print(f"  WARNING: No <problem> tags found in response")
        return []

    return [
        {"problem_label": label, "question_text": text}
        for label, text in matches
    ]


def split_solutions(markdown: str) -> list[dict]:
    """Send solution markdown to OpenAI, parse <solution> tags from response."""
    response = client.chat.completions.create(
        model=MODEL,
        messages=[
            {"role": "system", "content": SOLUTION_SYSTEM_PROMPT},
            {"role": "user", "content": markdown},
        ],
        **({"temperature": 0} if "gpt-5" not in MODEL else {}),
    )

    tagged = response.choices[0].message.content

    pattern = re.compile(
        r'<solution\s+label="([^"]+)">\s*(.*?)\s*</solution>',
        re.DOTALL,
    )
    matches = pattern.findall(tagged)

    if not matches:
        print(f"  WARNING: No <solution> tags found in response")
        return []

    return [
        {"problem_label": label, "solution_text": text}
        for label, text in matches
    ]


def main():
    parser = argparse.ArgumentParser(description="Stage 2: Markdown → Structured JSON")
    parser.add_argument("slug", help="Course slug (e.g. 18-06sc-linear-algebra-fall-2011)")
    args = parser.parse_args()

    course_slug = args.slug
    markdown_dir = Path("/tmp/ocw_ingestion/markdown") / course_slug
    output_dir = Path("/tmp/ocw_ingestion/structured") / course_slug

    if not markdown_dir.exists():
        print(f"Markdown directory not found: {markdown_dir}")
        print("Run ingest.py (Stage 1) first.")
        sys.exit(1)

    md_files = sorted(markdown_dir.glob("*.md"))
    if not md_files:
        print(f"No markdown files in {markdown_dir}")
        sys.exit(1)

    output_dir.mkdir(parents=True, exist_ok=True)

    print(f"Found {len(md_files)} markdown file(s) in {markdown_dir}")

    for md_path in md_files:
        out_path = output_dir / f"{md_path.stem}.json"

        if out_path.exists():
            print(f"Already done: {out_path.name}")
            continue

        print(f"\nProcessing {md_path.name}...")
        markdown = md_path.read_text()
        print(f"  Input: {len(markdown)} chars")

        is_solution = bool(SOLUTION_PATTERN.search(md_path.stem))
        is_problem_type = bool(PROBLEM_PATTERN.search(md_path.stem))

        if is_solution:
            solutions = split_solutions(markdown)
            print(f"  Extracted {len(solutions)} solution(s)")
            result = {
                "source_file": md_path.name,
                "type": "solutions",
                "solutions": solutions,
            }
        elif is_problem_type:
            problems = split_problems(markdown)
            print(f"  Extracted {len(problems)} problem(s)")
            result = {
                "source_file": md_path.name,
                "type": "problems",
                "problems": problems,
            }
        else:
            print(f"  Content type — packaging raw markdown")
            result = {
                "source_file": md_path.name,
                "type": "content",
                "content_text": markdown,
            }

        out_path.write_text(json.dumps(result, indent=2, ensure_ascii=False))
        print(f"  Saved → {out_path.name}")

    print(f"\nDone. Structured JSON in {output_dir}")


if __name__ == "__main__":
    main()
