# TODOS

## P2 — Learning Streak / Daily Goal
Track consecutive days of activity, show streak counter on dashboard. Proven retention driver (Duolingo, Khan Academy). Needs design decisions: what counts as "activity" (video watch? problem attempt? page visit?), streak break rules (grace period?), timezone handling. Effort: M.
- Depends on: Dashboard (must ship first)

## P3 — Decompose parse-problems.ts
Split the 75KB monolith into modules: PDF rendering, LLM provider abstraction, JSON repair utilities, DB persistence, batch orchestration. Currently all concerns are in one file, making it hard to debug or modify individual parts. Effort: M.
- No blockers
