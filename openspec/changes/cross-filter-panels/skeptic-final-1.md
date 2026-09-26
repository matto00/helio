## Skeptic Report — final gate (round 1, skeptic-final-1.md)

### What I verified (with evidence)

- **Spawn-cwd guard**: `assert-cwd.sh` → `READY ambient=/home/matt/Development/helio branch=feature/cross-filter-panels/HEL-588`.
- **Read all planning artifacts in full**: `proposal.md`, `design.md`, `tasks.md`,
  `specs/panel-cross-filtering/spec.md`, `evaluation-1.md`, `evaluation-2.md`.
- **Re-derived the diff base live** (not a cached SHA):
  `scripts/concertino/resolve-review-base.sh` → `40960cad7d647400c5c137a1d4c19cada32787e2`
  (exit 0), confirmed against `git log --oneline` (matches the repo's actual `main` tip at
  review time, i.e. the commit immediately preceding this branch's first commit).
  `git diff 40960cad...HEAD --stat` shows the expected 33 files / +2944/-62.
- **Static/code-level trace of every design decision** against the live diff: `crossFilterRows.ts`
  (D4 numeric-safe `cellMatchesValue`, D4 origin no-op, filterable-panel criterion CR2 per-kind),
  `useCrossFilteredPanelData.ts`, `PanelContent.tsx`'s `OutputPanelContent` (cycle-2's single
  call-site fix, D7 truncation reuse), `PanelCard.tsx`, `PanelInspectView.tsx` (D3 footer action,
  ordinary `<button>`, click handler unchanged), `panelsSlice.ts` (D2 reducers, idempotent re-set,
  `fetchPanels.pending` + `deletePanel.fulfilled` clear points).
- **Gates re-run fresh, read myself** (commit `52a36dbe`, `frontend/`):
  - `npx jest --testPathPatterns="PanelCard.crossFilter|PanelContent|PanelFullscreenOverlay|panelsSlice|CrossFilterIndicator|PanelInspectView"` → 7 suites / 99 tests, all PASS.
  - `npm run lint` → clean (`eslint src --max-warnings=0`, zero output, exit 0).
- **Live app verification**, servers re-verified serving this worktree (`assert-phase.sh servers` → `PASS`) at
  `DEV_PORT=6020`/`BACKEND_PORT=8927`:
  - Confirmed via the existing "HEL-588 eval cross-filter dashboard" (dev account, still live
    from prior cycles) that a chart click / ActionsMenu → Inspect opens Inspect with a
    "Nothing selected" empty state (click-only-opens-Inspect path unaffected), and that the
    Table/Chart/Metric/Collection panels and 2-slice pie from cycle 2's own evidence are present.
  - Wrote and ran my own standalone Playwright probe (not committed — deleted after use; worktree
    left clean, confirmed via `git status --porcelain`) against the same live dev server,
    reproducing the ticket's own truncation scenario end-to-end via the real backend/browser:
    registered a user, seeded a 260-row dataset (quarter/revenue) so the Table's first page loads
    exactly 200 rows (confirmed via `GET /api/outputs/:id/rows` capping at 200), created a pie
    Chart output + Table output (`columnOrder: ["quarter","revenue"]`) sharing `quarter`, clicked
    the pie via real `page.mouse.click` (pixel-scanned marker, matching the executor's/evaluator's
    own established click-reliability technique), and activated the Inspect footer's "Filter
    dashboard by quarter = Q1" action.
  - **Grid-context disclosure (correct):** `"50 of 200 loaded rows match."` — the Table's own
    `panel-content__loaded-scope-note`, matching the design's D7 wording and the ticket's own
    "62 of 250"-style example the evaluator cited.
  - **Fullscreen-context disclosure (WRONG):** opening the SAME Table panel's Fullscreen overlay
    (`Fullscreen Skeptic Table Panel` → `dialog` "Skeptic Table Panel fullscreen") and reading its
    own `panel-content__loaded-scope-note` returned `"50 of 50 loaded rows match."` — the
    denominator collapses to the already-narrowed match count instead of the panel's true 200
    loaded rows. Screenshot persisted (see ref below).

### Root cause (read, not guessed)

`PanelCard.tsx:587-588` passes `rawRows={crossFilteredRawRows} headers={crossFilteredHeaders}`
(the ALREADY cross-filtered values from `useCrossFilteredPanelData`) into
`<PanelFullscreenOverlay>`. This directly contradicts the doc comment immediately above it
(`PanelCard.tsx:292-302`), which states: *"`PanelCardBody`/`PanelFullscreenOverlay`'s own
`<PanelContent>` calls receive the RAW `panelData.rawRows`/`panelData.headers` instead ...
`OutputPanelContent` filters those itself, using ITS OWN already-resolved `output`"* — i.e. the
code's own comment describes the correct architecture, but the code three call sites below does
something different.

`PanelFullscreenOverlay.tsx` forwards whatever `rawRows`/`headers` props it receives straight into
its own `<PanelContent>` call (no filtering logic of its own). Because `OutputPanelContent` (the
actual filtering site, per cycle 2's fix) then filters an ALREADY-filtered array a second time —
idempotent for content (same rows both times, so the Fullscreen Table's actually-rendered rows are
NOT wrong) — but `crossFilterLoadedRowCount = rawRows?.length` inside `OutputPanelContent` reads
the (pre-filtered) prop it was handed, not the panel's true total loaded row count. The Inspect
view nested inside Fullscreen happens to want the pre-filtered values (by design, per
`useCrossFilteredPanelData`'s own comment), which is likely why this one wrong wire went
unnoticed — the SAME `crossFilteredRawRows` variable is correct for one sibling prop
(`PanelInspectView`) and wrong for another (`PanelFullscreenOverlay`) on the very same lines.

### Why this is a real spec violation, not a nitpick

spec.md's "A cross-filtered panel discloses when its own data is truncated" requirement: *"the
panel SHALL disclose that the filtered result reflects only the currently loaded rows, rather than
implying it is complete."* `"50 of 50 loaded rows match."` does not merely omit information — it
misrepresents the loaded scope as 50 when it is actually 200, actively implying (falsely) that
every loaded row already matches and there is no larger loaded set to reconsider. This is exactly
the "implying completeness" failure mode the requirement exists to prevent, and it reproduces in
the Fullscreen overlay specifically — a surface both `proposal.md` ("Every downstream consumer
(grid, fullscreen, inspect, mobile) sees the same filtered rows automatically") and `tasks.md`
3.3 ("pass the (possibly filtered) values to every existing downstream consumer (`PanelContent`,
`PanelFullscreenOverlay`, `PanelInspectView`, mobile stack)") explicitly list as in scope.

Neither evaluation cycle caught this: evaluation-2.md's Phase 2 code review asserts
`PanelFullscreenOverlay`'s cross-filter props were "cleanly removed ... no longer needed now that
filtering lives inside `OutputPanelContent`, which `PanelFullscreenOverlay` also reaches via
`PanelContent`" — true that filtering happens there, but this claim was never independently
verified against a live Fullscreen-plus-truncation combination; both cycles' live testing
(including cycle 2's dedicated "Load more"/truncation re-check) exercised only the grid card. No
unit test (`PanelFullscreenOverlay.test.tsx`, `PanelCard.crossFilter.test.tsx`) and no e2e test
(`e2e/hel588-cross-filter-panels.spec.ts`, confirmed via grep — zero hits for
"fullscreen"/"Fullscreen") exercises Fullscreen at all in combination with cross-filtering.

### Verdict: REFUTE

### Change Requests

1. **`frontend/src/features/panels/ui/PanelCard.tsx:587-588`** — pass `panelData.rawRows`/
   `panelData.headers` (the raw, unfiltered values) into `<PanelFullscreenOverlay rawRows={...}
   headers={...}>`, matching what the comment at `PanelCard.tsx:292-302` already documents as the
   intended architecture, and matching `PanelCardBody`'s own call (which correctly passes
   `panelData.rawRows`/`panelData.headers`, not the cross-filtered variant). `crossFilteredRawRows`/
   `crossFilteredHeaders` should remain wired only to `PanelInspectView`'s grid-context mount, as
   the surrounding comment already says.
2. Add a regression test that would have caught this: a `PanelFullscreenOverlay` (or
   `PanelCard`-level) test with an active cross-filter AND `rowsTruncated: true` on a sibling
   panel, asserting the Fullscreen-rendered `LoadedScopeDisclosure`'s `loadedCount` equals the
   panel's true total loaded row count (not the post-filter match count) — mirroring
   `PanelCard.crossFilter.test.tsx`'s existing pattern but for the Fullscreen mount specifically,
   since this is exactly the class of "two consumers of the same derived value disagreeing" bug
   this ticket's own cycle-1→cycle-2 fix was about, recurring one call site over.
3. Re-run the live Fullscreen-plus-truncation-plus-cross-filter scenario after the fix (this
   report's own probe is a reasonable template) and confirm the Fullscreen disclosure text matches
   the grid card's for the same panel/filter state.

### Non-blocking notes

- Everything else traced cleanly to the design/spec: numeric-safe matching (`cellMatchesValue`),
  the per-output-kind filterable-panel criterion (CR2), origin-panel exemption, clear-on-delete and
  clear-on-dashboard-switch (`panelsSlice.ts`), idempotent re-set, the Inspect footer action's
  keyboard reachability (ordinary `<button>`, no bespoke plumbing), and the Table-kind narrowing
  fix from cycle 1 (independently re-confirmed live via my own probe: `"50 of 200 loaded rows
  match."` in the grid context, with the matching rows actually narrowed).
- I did not independently re-chase the pie-chart "needle slices" glitch beyond reading
  evaluation-2.md's own reproduction/non-reproduction account and confirming (via `git diff --stat`
  above) that this diff has zero touched lines in `ChartPanel.tsx`/`ChartRenderer.tsx` — consistent
  with "pre-existing, unrelated" and not a blocker for this PR, per the task brief's framing.
- The evidence-mtime discipline note (CON-160 gate-defect check) does not apply here: I did not
  rely on any mtime ordering from evaluation-1.md/evaluation-2.md's evidence directory for this
  verdict — the Fullscreen defect was established by my own fresh, self-authenticating probe (live
  DOM text read via Playwright, screenshot, source-line citation), not by inference from file
  timestamps.

Evidence: `/home/matt/Development/helio/.concertino/runs/HEL-588/evidence/.skeptic-evidence/fullscreen-disclosure-bug.png`
(screenshot of the Fullscreen dialog showing "50 of 50 loaded rows match." alongside the grid
card's correct "50 of 200 loaded rows match." having been read moments earlier in the same
session — console output of both reads is quoted verbatim above).
