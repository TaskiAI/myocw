"""Stage 3: Load structured problems and content into Supabase.

Reads structured JSON produced by structure.py (Stage 2), matches each file
to a resource in the database, and either inserts problem rows or updates
the resource's content_text.

Usage:
    uv run python load.py <slug>
    uv run python load.py <slug> --force   # overwrite existing data
"""

import argparse
import json
import re
import sys
from pathlib import Path

from dotenv import load_dotenv
import os
from supabase import create_client

# --- Setup ---

env_path = Path(__file__).resolve().parent.parent / ".env.local"
load_dotenv(env_path)

supabase = create_client(
    os.environ["NEXT_PUBLIC_SUPABASE_URL"],
    os.environ["SUPABASE_SECRET_KEY"],
)


def get_course_id(slug: str) -> int:
    """Look up course by slug (the URL-friendly identifier stored in courses.url)."""
    result = (
        supabase.table("courses")
        .select("id")
        .ilike("url", f"%{slug}%")
        .limit(1)
        .execute()
    )
    if not result.data:
        print(f"ERROR: No course found matching slug '{slug}'")
        sys.exit(1)
    return result.data[0]["id"]


def get_all_resources(course_id: int) -> list[dict]:
    """Fetch all resources for the course."""
    result = (
        supabase.table("resources")
        .select("id, title, pdf_path, resource_type, content_text, ordering")
        .eq("course_id", course_id)
        .order("ordering")
        .execute()
    )
    return result.data or []


def slugify(s: str) -> str:
    """Normalize a string for fuzzy matching: lowercase, strip non-alphanumeric."""
    return re.sub(r"[^a-z0-9]", "", s.lower())


def extract_original_name(source_file: str) -> str:
    """Extract the original PDF name from a source_file like
    '0903b4b404284cd14b66ecccea103fd4_MIT18_06SCF11_Ses1.2sum.md'.
    The hash prefix is a 32-char hex string followed by underscore.
    """
    stem = Path(source_file).stem
    # Strip leading hash prefix (32 hex chars + underscore)
    stripped = re.sub(r"^[0-9a-f]{32}_", "", stem)
    return stripped


def match_resource(source_file: str, resources: list[dict]) -> dict | None:
    """Match a structured JSON source_file to a resource by pdf_path or title.

    Handles scholar courses where pdf_path is a Supabase URL with slugified
    filenames and source_file has a hash prefix.
    """
    original = extract_original_name(source_file)
    slugified = slugify(original)

    # Try pdf_path match (slugified comparison for Supabase URLs)
    for r in resources:
        if r.get("pdf_path") and slugified in slugify(r["pdf_path"]):
            return r

    # Try title match (original name comparison)
    for r in resources:
        if r.get("title") and slugified in slugify(r["title"]):
            return r

    # Try title match with .pdf suffix (some titles are like "MIT18_06SCF11_ex2.pdf")
    for r in resources:
        title = r.get("title", "")
        if title and slugify(Path(title).stem) == slugified:
            return r

    return None


def existing_problem_count(resource_id: int) -> int:
    """Check how many problems already exist for a resource."""
    result = (
        supabase.table("problems")
        .select("id", count="exact")
        .eq("resource_id", resource_id)
        .execute()
    )
    return result.count or 0


def delete_problems_for_resource(resource_id: int):
    """Delete all problems for a resource (used with --force)."""
    supabase.table("problems").delete().eq("resource_id", resource_id).execute()


def update_resource_content(resource_id: int, content_text: str):
    """Update a resource's content_text column."""
    supabase.table("resources").update({"content_text": content_text}).eq("id", resource_id).execute()


def get_problems_for_course(course_id: int) -> list[dict]:
    """Fetch all problems for a course."""
    result = (
        supabase.table("problems")
        .select("id, resource_id, problem_label, solution_text")
        .eq("course_id", course_id)
        .execute()
    )
    return result.data or []


def find_matching_problem_resource(source_file: str, resources: list[dict]) -> dict | None:
    """For a solution file like 'Ses1.4sol', find the corresponding problem resource 'Ses1.4prob'.

    Replaces 'sol' with 'prob' in the original name, then matches against resources.
    """
    original = extract_original_name(source_file)
    # Try replacing sol → prob in the name
    prob_name = re.sub(r"sol", "prob", original, flags=re.IGNORECASE)
    if prob_name == original:
        # For exam solutions like ex1s → ex1
        prob_name = re.sub(r"s$", "", original)

    prob_slugified = slugify(prob_name)

    for r in resources:
        if r.get("pdf_path") and prob_slugified in slugify(r["pdf_path"]):
            return r

    for r in resources:
        if r.get("title") and prob_slugified in slugify(r["title"]):
            return r

    return None


def update_solution_text(problem_id: int, solution_text: str):
    """Update a problem's solution_text."""
    supabase.table("problems").update({"solution_text": solution_text}).eq("id", problem_id).execute()


def main():
    parser = argparse.ArgumentParser(description="Stage 3: JSON → Supabase")
    parser.add_argument("slug", help="Course slug (e.g. 18-06sc-linear-algebra-fall-2011)")
    parser.add_argument("--force", action="store_true", help="Overwrite existing data")
    args = parser.parse_args()

    course_slug = args.slug
    structured_dir = Path("/tmp/ocw_ingestion/structured") / course_slug

    if not structured_dir.exists():
        print(f"Structured directory not found: {structured_dir}")
        print("Run structure.py (Stage 2) first.")
        sys.exit(1)

    json_files = sorted(structured_dir.glob("*.json"))
    if not json_files:
        print(f"No JSON files in {structured_dir}")
        sys.exit(1)

    print(f"Found {len(json_files)} structured JSON file(s)")

    course_id = get_course_id(course_slug)
    print(f"Course ID: {course_id}")

    resources = get_all_resources(course_id)
    print(f"Found {len(resources)} resource(s) in database")

    total_problems_inserted = 0
    total_solutions_matched = 0
    total_content_updated = 0
    total_skipped = 0

    # Two-pass: first load problems/content, then match solutions (needs fresh problem IDs)
    solution_files: list[Path] = []

    for json_path in json_files:
        data = json.loads(json_path.read_text())
        source_file = data.get("source_file", json_path.name)
        entry_type = data.get("type", "problems")  # backward compat

        if entry_type == "solutions":
            solution_files.append(json_path)
            continue

        resource = match_resource(source_file, resources)
        if not resource:
            print(f"\n  WARNING: {source_file} — no matching resource found, skipping")
            total_skipped += 1
            continue

        resource_id = resource["id"]

        if entry_type == "content":
            content_text = data.get("content_text", "")
            if not content_text:
                print(f"\n  {source_file}: empty content, skipping")
                total_skipped += 1
                continue

            if resource.get("content_text") and not args.force:
                print(f"\n  {source_file} → resource {resource_id} ({resource['title']}): "
                      f"already has content_text, skipping (use --force to overwrite)")
                total_skipped += 1
                continue

            update_resource_content(resource_id, content_text)
            print(f"\n  {source_file} → resource {resource_id} ({resource['title']}): "
                  f"updated content_text ({len(content_text)} chars)")
            total_content_updated += 1

        else:  # "problems"
            problems = data.get("problems", [])
            if not problems:
                print(f"\n  {source_file}: no problems, skipping")
                total_skipped += 1
                continue

            existing = existing_problem_count(resource_id)

            if existing > 0 and not args.force:
                print(f"\n  {source_file} → resource {resource_id} ({resource['title']}): "
                      f"already has {existing} problems, skipping (use --force to overwrite)")
                total_skipped += 1
                continue

            if existing > 0 and args.force:
                print(f"\n  {source_file} → resource {resource_id}: deleting {existing} existing problems")
                delete_problems_for_resource(resource_id)

            rows = [
                {
                    "resource_id": resource_id,
                    "course_id": course_id,
                    "problem_label": p["problem_label"],
                    "question_text": p["question_text"],
                    "solution_text": None,
                    "ordering": i,
                }
                for i, p in enumerate(problems)
            ]

            result = supabase.table("problems").insert(rows).execute()
            count = len(result.data) if result.data else 0
            print(f"\n  {source_file} → resource {resource_id} ({resource['title']}): "
                  f"inserted {count} problem(s)")
            total_problems_inserted += count

    # Pass 2: match solutions to freshly-inserted problems
    if solution_files:
        print(f"\n--- Pass 2: Matching {len(solution_files)} solution file(s) ---")
        all_problems = get_problems_for_course(course_id)
        print(f"Found {len(all_problems)} problem(s) for solution matching")

        for json_path in solution_files:
            data = json.loads(json_path.read_text())
            source_file = data.get("source_file", json_path.name)
            solutions = data.get("solutions", [])
            if not solutions:
                print(f"\n  {source_file}: no solutions, skipping")
                total_skipped += 1
                continue

            prob_resource = find_matching_problem_resource(source_file, resources)
            if not prob_resource:
                print(f"\n  WARNING: {source_file} — no matching problem resource found, skipping")
                total_skipped += 1
                continue

            prob_resource_id = prob_resource["id"]
            resource_problems = sorted(
                [p for p in all_problems if p["resource_id"] == prob_resource_id],
                key=lambda p: p.get("id", 0),
            )

            matched = 0
            for sol_idx, sol in enumerate(solutions):
                sol_label = slugify(sol["problem_label"])
                target = None
                # Match by slugified label
                for p in resource_problems:
                    if slugify(p["problem_label"]) == sol_label:
                        target = p
                        break
                # Fallback: partial match
                if not target:
                    for p in resource_problems:
                        if sol_label in slugify(p["problem_label"]) or slugify(p["problem_label"]) in sol_label:
                            target = p
                            break
                # Fallback: positional match
                if not target and sol_idx < len(resource_problems):
                    target = resource_problems[sol_idx]

                if target:
                    if target.get("solution_text") and not args.force:
                        continue
                    update_solution_text(target["id"], sol["solution_text"])
                    target["solution_text"] = sol["solution_text"]
                    matched += 1

            print(f"\n  {source_file} → resource {prob_resource_id} ({prob_resource['title']}): "
                  f"matched {matched}/{len(solutions)} solution(s)")
            total_solutions_matched += matched

    print(f"\nDone. Problems inserted: {total_problems_inserted}, "
          f"Solutions matched: {total_solutions_matched}, "
          f"Content updated: {total_content_updated}, Skipped: {total_skipped}.")


if __name__ == "__main__":
    main()
