## Skeptic Report — final gate (round 2, skeptic-final-2.md)

### What I verified (with evidence)

**Ground truth re-established independently** (not trusting `evaluation-2.md`, `files-modified.md`,
or `skeptic-final-1.md` on assertion — round 1's own findings were re-derived from scratch here,
not carried over as fact):

- `git show ea726167 --stat` — 7 files: `StepCard.tsx`, `StepCard.test.tsx`, `design.md`,
  `evaluation-2.md`, `files-modified.md`, `skeptic-final-1.md`, `workflow-state.md`. No backend
  files, no scope creep beyond the two change requests.
- Read the full `StepCard.tsx` diff: adds `import { InlineError } from
  "../../../shared/chrome/InlineError"` and one new line,
  `{step.opType.id !== "compute" && <InlineError error={validationError ?? null} />}`, inserted
  immediately after `StepSchemaDiffChips` in the expanded body — exactly where CR1 prescribed.
  Confirmed via `grep` that `ComputeFieldConfig.tsx:84` still renders its own
  `<InlineError error={validationError ?? null} />` unchanged, and the new generic render is
  correctly gated to skip `compute` — this is the double-render guard, and it's structurally
  sound (not merely commented as such).
- Read the full `design.md` diff for Decision 8: the false "badges/editors" claim is replaced
  with an accurate description (refresh is genuinely zero-additions via `stepsFingerprint`;
  surfacing is the new generic `InlineError` render, `compute` excluded to avoid double-render).
  Matches CR2 exactly.

**Gates — fresh run, this session, this worktree:**
- `npm run lint` → clean (zero-warnings policy).
- `npm run format:check` → clean.
- `npx jest` (full suite) → **1791/1791 pass, 177 suites** — matches the executor's claimed
  count exactly, independently reproduced.
- `npm run check:schemas` → clean (59 schemas / 45 protocol files, panel-type enums in sync).
- `git diff --name-only c363a9ed...HEAD -- backend/` → empty; no backend files have changed
  since the initial implementation commit, so backend gates (already verified fresh by
  `skeptic-final-1.md`: 34/34 `PipelineStepRoutesSpec` tests) did not need re-running this cycle.

**Regression-test non-tautology check (probe-confirmed, not just read):**
- Ran `npx jest --testPathPatterns=StepCard.test.tsx -t "validationError surfacing"` against the
  as-committed code → **3/3 pass**.
- Temporarily reverted the fix locally (`{step.opType.id !== "compute" && ...}` →
  `{false && ...}`, i.e. disabled the generic render exactly the way pre-fix code behaved for
  non-compute ops) and re-ran the same targeted test → **1 failed** exactly as predicted:
  `getByText("Unknown field(s): 'full_name'")` could not find the element. Restored the file
  from a clean copy immediately after (`git diff --stat` on the file showed no residual changes).
  This directly falsifies the possibility that the new test is tautological or passes
  independent of the fix.

**Live UI verification** (dev 5839 / backend 8746, via `start-servers.sh` →
`assert-phase.sh servers` → `PASS servers`). Built a fresh, disposable fixture via the API
(`HEL-407 skeptic final-2 source` / `HEL-407 skeptic final-2 pipeline`) rather than touching the
evaluator's/round-1's leftover `HEL-407 eval reorder test` / `Skeptic Test *` fixtures — replicated
round 1's exact scenario:
- Created a 2-step pipeline: `Rename` (`raw_name` → `full_name`, position 0) then `Pivot`
  (`index: [full_name]`, position 1) — valid order.
- Clicked "Move step up" on Pivot → order became `[Pivot, Rename]`. Confirmed via direct
  `GET /api/pipelines/:id/analyze` that the backend recomputed
  `"validationError": "Unknown field(s): 'full_name'"` on the now-misordered Pivot step.
- Expanded the Pivot card in the UI: the paragraph `"Unknown field(s): 'full_name'"` now renders
  in the expanded body, immediately below the header and above the "Index (group by)" config —
  **CR1 is genuinely fixed live, not just in unit tests.** Screenshotted in both dark and light
  theme: consistent placement, uses `--app-error` / `--text-xs` tokens (confirmed by reading
  `InlineError.css`), correct semantic-red coloring in both themes, no layout breakage.
- **Double-render check for `compute`**: added a `compute` step with an intentionally-broken
  expression (`$totally_missing_field`) via `PATCH /api/pipeline-steps/:id`. Backend confirmed
  `"validationError": "Unknown field: totally_missing_field"`. Expanded the Compute card in the
  UI — the error text appears **exactly once**, inline below the Expression input (via
  `ComputeFieldConfig`'s own existing placement), with no duplicate generic render above it.
  Screenshotted for confirmation.
- **No regression to round 1's validated behaviors** (spot-check, per the task brief): used
  keyboard "Move step up" on the Compute step (`[Pivot, Rename, Compute]` →
  `[Pivot, Compute, Rename]`), reloaded the page, confirmed the new order survived reload byte-for-byte
  (`[Pivot, Compute, Rename]` on fresh page load) — persistence-across-reload still works, keyboard
  reorder still works, matching round 1's findings for this cycle's untouched
  `PipelineRiverView.tsx`/backend code paths.
- Console: only the same pre-existing, unrelated 404 on `.../schedule` noted by every prior round
  — no new errors from any interaction.
- Cleanup: `DELETE`'d the test pipeline (204) and data source (204) with the required
  `X-Helio-Requested-With` CSRF header; removed my 3 screenshots from the repo root (confirmed
  `git status` clean, only the pre-existing unrelated `run-history-dark-passing.png` remains, not
  mine to touch); stopped both dev processes (verified `ss -ltnp` shows both ports free
  afterward). Did not touch the evaluator's/round-1's `HEL-407 eval reorder test` / `Skeptic Test *`
  leftovers.

### Acceptance criteria — traced (re-confirmed this round)

1. "Steps can be reordered by drag and by keyboard; the new order persists and survives reload."
   **Met** — spot-checked keyboard reorder + reload persistence live this round; drag path
   untouched since round 1's full live verification, no code changed in that path this cycle.
2. "Analyze + previews refresh after reorder, surfacing any newly-invalid step." **Now fully
   met** — the *surfacing* half (round 1's sole REFUTE reason) is live-reproduced fixed above:
   a non-compute step (`pivot`) now visibly surfaces `validationError` in its expanded card, and
   the `compute` op does not double-render.
3. "Follows DESIGN.md; frontend tests cover reorder → persisted order + analyze refresh." **Met**
   — `InlineError` reuse is a shared component (no reinvented one-off), token-based CSS
   (`--app-error`/`--text-xs`), light/dark parity screenshotted; 3 new non-tautological tests
   (probe-confirmed above) cover exactly the surfacing gap.
4. "Backward compatible... additive batch endpoint only." **Met** — unchanged this cycle; no
   backend files touched.

### Verdict: CONFIRM

Both of round 1's change requests are genuinely resolved: CR1 (AC2's surfacing gap) is fixed with
a small, surgical, correctly-scoped change that I reproduced live for both the previously-broken
case (non-compute) and the previously-working case (compute, now guarded against double-render),
and I falsified the regression test's own effectiveness by reverting the fix and watching it fail
exactly as predicted. CR2 (the design.md wording overclaim) is corrected accurately. All gates
re-run fresh and green (1791/1791 tests, lint, format, schema-drift). No regression to drag/
keyboard/persistence behavior from prior rounds.

### Non-blocking notes

- The `overIndex !== draggedIndex` vs. `targetIndex !== draggedIndex` redundant-PUT observation
  from `evaluation-2.md` still applies (unchanged this cycle, still genuinely non-blocking).
- No `evaluation-3.md` exists for the `ea726167` fix — the task brief routed this fix straight to
  a second skeptic round rather than through a fresh evaluator cycle first. I did not rely on any
  evaluator claim for this cycle's fix; every finding above is derived from my own fresh reads,
  gate re-runs, and live reproduction, so this doesn't weaken the verdict, but flagging the gap
  in the paper trail for the record.
