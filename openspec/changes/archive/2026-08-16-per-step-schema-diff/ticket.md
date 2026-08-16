# HEL-405: Authoring UX: per-step schema diff (columns added / dropped / renamed / retyped vs input)

## Description

Authors need to see at a glance what each step does to the schema. `StepCard.tsx` currently renders a HARDCODED placeholder diff (fake chips `+ col_a`, `− col_b`, `~ col_c` in the fallback branch). This ticket replaces that placeholder with a real diff computed from the analyze endpoint's per-step `inputSchema` vs `outputSchema` (`useAnalyzePipeline` in `frontend/src/features/pipelines/hooks/useAnalyzePipeline.ts`; the analyze response already carries both schemas per step — see `PipelineAnalyzeService`).

## Scope

Frontend:

* Compute the diff between a step's `inputSchema` and `outputSchema`: added columns, dropped columns, renamed (best-effort, e.g. rename op), and retyped (same name, different type).
* Render real diff chips on every StepCard (replace the hardcoded placeholder chips), not only the fallback branch.
* Extract the diff logic into a small tested helper (e.g. under `frontend/src/features/pipelines/state/`).

## Acceptance criteria

- [ ] Each StepCard shows a real added/dropped/retyped diff derived from analyze `inputSchema`→`outputSchema`; the hardcoded `col_a/col_b/col_c` placeholder is gone.
- [ ] Rename is shown as a rename (not add+drop) where the op makes that determinable.
- [ ] The diff helper is unit-tested (added/dropped/retyped/rename cases).
- [ ] Follows `DESIGN.md`; backward compatible (no wire change; reads existing analyze response).

## Out of scope

* Backend analyze changes (it already returns both schemas).

## Dependencies

* None. Reads the existing `analyze_pipeline` response; complements the inline-preview ticket (HEL-404, merged as e71968c5 — this branch is based on it).

## Delivery notes (orchestrator)

* Priority: Medium. Part of epic HEL-339 (Pipeline Authoring UX). Successor to HEL-404 (shipped): both read the same analyze plumbing; HEL-404 threaded `analyzeOutputSchema` into StepCard already.
* Frontend-only expected — no Flyway migration anticipated. If one ever becomes necessary, check origin/main HEAD for the latest V<N> first (shared dev Postgres with parallel deliveries).
* Live UI checks must use this run's assigned ports (dev 5837 / backend 8744) via `scripts/concertino/start-servers.sh`; never leave servers running.
* Adjacent-file caution: `StepCard.tsx` (440 lines) and `PipelineDetailPage.tsx` (583 lines) are past the 400-line budget; a standalone split ticket (HEL-682) exists — do not bundle that refactor here, but avoid growing the files more than necessary and note growth in files-modified.md.
