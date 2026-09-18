## Evaluation Report — Cycle 2 (evaluation-2.md)

Reviewed commit `d1fc4fc1dc52a886e0bb87cd0e4327ae18179b86` on `feature/form-field-type-builder/HEL-1084` (on top of cycle 1's `7b104e84`), diffed against `origin/main` at `ab4cad578d05576beb3a19ef7244799db6953172` (resolved fresh via `resolve-review-base.sh`). Resumed from cycle 1 — ticket/planning artifacts not re-read (stable); only the new diff and evaluation-1.md's open Change Request were in scope.

### Housekeeping

An untracked `claude_sha.txt` at the worktree root was my own cycle-1 tooling residue (a `tee` typo that wrote the reviewed SHA to a stray file instead of `/tmp`). Removed it (`rm -f .../HEL-1084/claude_sha.txt`) before starting this review.

### Phase 1: Spec Review — PASS

Cycle 2 is scoped entirely to evaluation-1.md's single Change Request (focus management on Remove); no spec/AC surface changed. Confirmed the diff (`git diff 7b104e84...d1fc4fc1`) touches only `useFormEditorState.ts`, `useFormEditorState.test.ts`, `FormEditor.tsx`, and the planning/evidence artifacts (`evaluation-1.md`, `files-modified.md`, `mutation-evidence.md`) — no scope creep, no AC reinterpretation, no unrelated changes. `files-modified.md` and `mutation-evidence.md` accurately describe the fix.

### Phase 2: Code Review — PASS

Gates run fresh, in `WORKTREE_PATH`:
- `npm run lint` — clean.
- `npm run format:check` — clean.
- `npm run typecheck` — clean.
- `npm test` (root, incl. helio-mcp) — 28 suites / 271 tests passed; `npm --prefix frontend test` — 327 suites / **3525** tests passed (5 new, matching the executor's claim: 4 `focusTargetIndexAfterRemove` edge cases + 1 `rowKeys` structural case in `useFormEditorState.test.ts`).
- `npm --prefix frontend run build` — succeeds.
- Backend: confirmed 0 backend files changed since cycle 1 (`git diff --name-only ... | grep '^backend/'` unchanged at 7, all already covered by cycle 1's full green `sbt test` run of 4630/4630) — no need to re-run `sbt test` for a frontend-only diff, per the gate-selection rule (changed files determine which gates apply).

Code quality of the fix:
- Root cause correctly diagnosed and fixed at its source (systematic-debugging discipline): `rowIds`/`rowKeys` give each row a stable identity independent of array position or `sourceField` (both prior collision sources are explicitly documented in the code comment), replacing the `key={index}` that caused the original defect's "works by accident" behavior. `focusTargetIndexAfterRemove` is a pure, exported function — correctly separates the untestable-in-jsdom DOM-focus consequence from the testable index-computation logic, and the code/mutation-evidence.md are explicit and honest that this pure-function coverage is not a substitute for the rendered measurement the evaluator must still do (no evidence-shaped non-evidence).
- Mutation evidence for the fix (`mutation-evidence.md` Cycle 2 section) mutates `focusTargetIndexAfterRemove` to reproduce the actual pre-fix defect's effective behavior and shows the new regression test catches it (1 failed / 14 passed → 15 passed after restore) — correctly scoped, not a re-worded string check.
- No new dead code, no magic values, `rowKeys` threaded cleanly through `add`/`remove`/`moveUp`/`moveDown`/`reset` in the reducer.

### Phase 3: UI Review — PASS

Re-verified against the running app on this run's ports; confirmed cwd of both the reused dev server (Vite, PID 1779583) and backend (PID 1779198) still resolve to this worktree via `readlink /proc/<pid>/cwd`, and `location.href` re-checked as `http://localhost:6516/` throughout. Did a hard `location.reload()` before testing to bypass any HMR staleness (a transient HMR-reload console error from the mid-session file swap was observed once, pre-reload, and did not reappear after a fresh navigation/reload — not a live defect).

All three focus-management cases from evaluation-1.md's Change Request, re-measured live via `document.activeElement`:
- **Removing the last row of a 2+-row list** (the exact original defect: a 2-field list, removing field index 1): focus landed on the remaining row's field-select control ("Field for Note"), not `document.body`. **Fixed.**
- **Removing to an empty list** (last remaining field): focus landed on the "Add field" button. Unchanged/correct, as before.
- **Removing a middle row of a longer list** (5 fields, removing index 2): focus landed on the field-select of the row that shifted into that position ("Field for label"). Correct, no longer dependent on incidental `key={index}` DOM reuse (confirmed structurally via the `rowKeys` diff, confirmed behaviorally live).

Regression check on cycle-1-verified behaviors (all re-confirmed live, this cycle's diff does not touch any of these code paths):
- Orphan-field surfacing on dataset switch: switching the bound dataset to one lacking the existing field immediately surfaced the field-associated error and issue summary ("'note' is not declared by the bound dataset").
- Save-blocking: clicking Save with the above issue present left the modal in edit mode with the issue and inline error still showing (confirmed by reopening the panel and finding the SAME unsaved edit state, not a reset to the original valid config) — Save was not silently accepted.
- Keyboard reorder (Move up/down): verified a down-move correctly swapped two distinctly-labeled rows ("label"/"note") by position.
- No console errors/warnings after a fresh reload and through the full retest flow.

### Overall: PASS

### Non-blocking Suggestions

- (Carried from evaluation-1.md, still open, not blocking) `FormEditor.tsx`'s stale-saveError-clearing effect only clears the exact pinned `BLOCKING_ISSUES_MESSAGE` string, which is deliberate and correct per its own comment — no further action needed; noting only that this was re-confirmed intentional, not re-flagging it.
