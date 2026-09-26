## Evaluation Report — Cycle 3 (evaluation-3.md)

Re-run at the orchestrator's request per Standing Constraint C6 (CON-228): the final-gate skeptic
REFUTEd cycle 2's HEAD (`skeptic-final-1.md`); the executor committed `e1cb38f6` fixing the
truncation-disclosure defect the skeptic found, and I'm re-evaluating that new HEAD before the
final gate is re-invoked. I did NOT re-read the ticket/proposal/design/tasks (stable since cycle 1
per this role's resumability contract); I did read `skeptic-final-1.md` in full and re-diffed
`52a36dbe...e1cb38f6`.

### Phase 1: Spec Review — FAIL

The skeptic's own defect (D7 truncation-disclosure mismatch, `PanelCard.tsx:587-588` wrongly
wiring `crossFilteredRawRows`/`crossFilteredHeaders` into `<PanelFullscreenOverlay>`) is correctly
fixed: `PanelCard.tsx` now passes `panelData.rawRows`/`panelData.headers` (raw) into
`<PanelFullscreenOverlay>`, matching `PanelCardBody`'s own call and the architecture the
surrounding doc comment already described. I independently re-verified this live (see Phase 3).

**However, the executor's own fix transparently introduces a new, real, live-reproducible
inconsistency that I confirmed by direct reproduction, and I am treating it as a Phase 1 failure**
(it is a spec/design-intent violation in code this ticket owns), not merely a
non-blocking follow-up:

**Answering the orchestrator's three questions directly:**

1. **Is this a real, live-reproducible inconsistency? Yes — reproduced live, not inferred.** I
   built an independent test panel (a chart with `fieldMapping: {xAxis: "region", yAxis: "revenue",
   annotation: "quarter"}`, over a 16-row dataset with every region present in every quarter — no
   correlation between the two columns, unlike this ticket's earlier synthetic fixtures) so the
   panel is filterable-by-`quarter` (via its `annotation` slot) while its own chart plots by
   `region`, a genuinely different dimension. With a `quarter = Q1` cross-filter active:
   - The panel's chart (both grid card and Fullscreen) correctly renders only its 4 Q1 rows
     (East/West/North/South) — narrowing itself is unaffected by this fix, confirmed visually.
   - Clicking the "West" point from the **grid card** opens Inspect showing exactly **1 row**
     (`Q1 / West / 105`) — correctly scoped to what's actually plotted.
   - Clicking the identical "West" point from **inside that same panel's Fullscreen overlay**
     opens its own nested Inspect showing **4 rows** (`Q1/Q2/Q3/Q4`, all West) — silently ignoring
     the active cross-filter, even though the very chart behind that dialog visibly plots only 1 of
     those 4 rows. Screenshot: `cycle3-fullscreen-inspect-unfiltered-bug.png` (shows the underlying
     Fullscreen chart with only 4 Q1 points alongside the nested Inspect's 4-row, all-quarters
     table for a single clicked point — the contradiction is visible in one frame).
   - This is a regression introduced by `e1cb38f6` itself, not a pre-existing issue: in cycle 2's
     code, `PanelFullscreenOverlay` received the SAME `crossFilteredRawRows` the grid-context
     Inspect uses, so both were internally consistent (the cycle-2 bug was the truncation
     denominator being wrong for BOTH surfaces' shared value being wrong, not a cross-surface
     inconsistency). Fixing the denominator by switching to raw rows is what created this new,
     narrower defect — a straightforward "fixed one shared-variable bug, introduced a
     dual-consumer-of-one-prop bug in its place," one call site further down (mirroring the exact
     shape of the cycle-1→cycle-2 defect this ticket already fixed once).

2. **Does it violate spec.md/design.md's stated intent?** `specs/panel-cross-filtering/spec.md`
   does not name Fullscreen's nested Inspect explicitly, but `proposal.md` ("Every downstream
   consumer (grid, fullscreen, inspect, mobile) sees the same filtered rows automatically") and
   `tasks.md` 3.3 ("pass the (possibly filtered) values to every existing downstream consumer
   (`PanelContent`, `PanelFullscreenOverlay`, `PanelInspectView`, mobile stack)") both explicitly
   enumerate Fullscreen and Inspect as in-scope consumers that must agree — and this ticket's own
   HEL-572 dependency (`chart-drilldown-inspect`, explicitly left "unchanged" per this ticket's own
   proposal.md) states Inspect "shows exactly the plotted rows for its selection." The Fullscreen
   chart itself DOES only plot the cross-filtered rows (confirmed above) — its nested Inspect
   showing 4x that is a direct violation of "exactly the plotted rows," not a new HEL-588
   requirement being stretched, but an EXISTING, explicitly-preserved invariant being broken by
   this ticket's own wiring. **design.md's D4 text is now stale and should not be trusted as
   ground truth**: it was written in cycle 1 (before cycle 2 restructured filtering into
   `OutputPanelContent`) and has not been touched since (confirmed via `git diff` — `design.md` has
   zero changes across cycles 2 and 3); its literal "the filtered result replaces both below,
   threaded to every downstream consumer" no longer describes the actual call graph.
   `PanelCard.tsx`'s own inline comment (updated in both cycle 2 and cycle 3) is the accurate,
   current statement of intent, and even IT explicitly flags this exact side effect as a "deliberate,
   accepted consequence... not an oversight."
3. **Is this in scope to fix now, or a defensible follow-up?** **In scope, and should be fixed
   now** — this is not the pie-chart-resize-glitch class of "pre-existing, unrelated code this
   ticket never touches." It is a defect in `PanelCard.tsx`/`PanelFullscreenOverlay.tsx`, files
   this ticket has repeatedly modified across all three cycles, caused directly by this cycle's own
   fix, in exactly the enumerated scope (`tasks.md` 3.3) this ticket claims to cover. The fix is
   also well-scoped and low-risk: `PanelCard` already computes `crossFilteredRawRows`/
   `crossFilteredHeaders` (via the existing `useCrossFilteredPanelData` call, no new fetch, no new
   hook); `PanelFullscreenOverlay` needs a second, separate prop pair for its nested
   `PanelInspectView` specifically (distinct from the raw `rawRows`/`headers` its `PanelContent`
   call correctly needs for truncation-count correctness) — mirroring exactly the pattern
   `PanelCard` already uses to thread filtered values to the grid-context `PanelInspectView`. This
   does not require re-litigating the truncation fix; it is additive.

The orchestrator's framing note ("HEL-572's own Inspect-view spec scenario... was about the ORIGIN
panel's own selection, not a SIBLING panel narrowed by someone else's cross-filter") is a fair
observation about HEL-572's ORIGINAL scope, but it does not exempt HEL-588: HEL-588 is precisely
the ticket that introduced the "a sibling panel's rows can be narrowed by someone else's selection"
concept, and its own planning artifacts (cited above) commit to Fullscreen and Inspect staying
consistent under exactly that condition.

### Phase 2: Code Review — PASS (mechanically), with the Phase 1 finding as an open item

Gates (run fresh in `WORKTREE_PATH`, at commit `e1cb38f6`):
- `npm run lint` — PASS (zero warnings)
- `npm run format:check` — PASS
- `npm test` — PASS (382 suites / 3863+271 tests total — 1 new test since cycle 2, the truncation
  regression test)
- `npm --prefix frontend run build` — PASS
- `npx playwright test e2e/hel588-cross-filter-panels.spec.ts` (run by me) — PASS, 3/3, 17.5s

Code quality of the truncation fix itself:
- `PanelCard.tsx:587-588`'s fix is exactly what `skeptic-final-1.md`'s change request 1 asked for,
  correctly matching `PanelCardBody`'s own call.
- The new regression test (`PanelCard.crossFilter.test.tsx`, "Fullscreen disclosure agrees with the
  grid card") is well-targeted: it seeds `rowsTruncated: true`, asserts BOTH the grid ("2 of 3")
  and Fullscreen ("2 of 3", explicitly NOT "2 of 2") disclosure text for the same panel/filter
  state — exactly the kind of two-surface-agreement test this bug class needs, mirroring
  `skeptic-final-1.md`'s change request 2's own template.
- The new e2e assertion (`fullscreen-truncation-disclosure-matches-grid.png`) does the equivalent
  check against a real backend/browser with a genuine >200-row dataset — I re-ran it myself, PASS.
- **Neither the new unit test nor the new e2e assertion exercises the nested-Inspect-inside-
  Fullscreen path at all** (confirmed by reading both diffs in full) — this is exactly why the
  Phase 1 defect above shipped past this cycle's own verification: the fix's own test coverage
  proves the denominator is now correct, but never opens Fullscreen's nested Inspect to check its
  row *set*, so it cannot catch the new discrepancy it created one level down.

### Phase 3: UI Review — FAIL

Dev servers re-verified serving this worktree (`readlink /proc/<pid>/cwd` for both listeners still
resolved into `.../worktrees/feature/cross-filter-panels/HEL-588/{frontend,backend}`); reloaded to
pick up `e1cb38f6` via HMR.

- [x] **Truncation-disclosure fix — independently re-verified live**, not trusted from the
  executor's report or its own tests alone: reused the existing 260-row Table/Chart setup, set the
  `quarter = Q1` cross-filter, and read both the grid card's and the Fullscreen overlay's
  `panel-content__loaded-scope-note` text directly via `page.evaluate`/DOM inspection. Both now
  correctly agree.
- [ ] **FAIL — nested Inspect inside Fullscreen ignores the active cross-filter for a sibling
  panel**, while the grid-context Inspect for the identical selection correctly narrows. Live
  repro detailed above (Phase 1), screenshot `cycle3-fullscreen-inspect-unfiltered-bug.png`
  persisted.
- [x] No console errors attributable to this cycle's code change (the same pre-existing, unrelated
  `502` `/run-events` SSE noise from this evaluation's own accumulated ad hoc test pipelines was
  observed again, as in every prior cycle — not from code this diff touches).

### Overall: FAIL

### Change Requests

1. **`frontend/src/features/panels/ui/PanelFullscreenOverlay.tsx`** (and its caller,
   `frontend/src/features/panels/ui/PanelCard.tsx`) — decouple the two consumers currently sharing
   one `rawRows`/`headers` prop pair inside `PanelFullscreenOverlay`: keep `panelData.rawRows`/
   `panelData.headers` (raw) feeding `<PanelContent>` (needed for D7 truncation-count correctness,
   just fixed this cycle), but add a second, separate prop pair — e.g. `inspectRawRows`/
   `inspectHeaders` — feeding the nested `<PanelInspectView>` specifically, sourced from
   `PanelCard`'s existing `crossFilteredRawRows`/`crossFilteredHeaders` (already computed via
   `useCrossFilteredPanelData`, no new fetch/hook needed — the exact same values already threaded
   to the grid-context `PanelInspectView`). This restores "Inspect shows exactly the plotted rows
   for its selection" inside Fullscreen too, without touching the truncation fix.
2. Add a regression test for this specific two-mount agreement: open a sibling panel's Inspect from
   the grid card AND from inside its own Fullscreen overlay, for the identical click selection,
   with an active cross-filter, and assert both show the same narrowed row set — mirroring
   `PanelCard.crossFilter.test.tsx`'s existing pattern (and this cycle's own truncation-agreement
   test) but for row CONTENT, not the truncation count.
3. Re-run the live grid-vs-Fullscreen-Inspect scenario after the fix (this report's own repro is a
   reusable template — a panel whose own click-dimension differs from the active cross-filter's
   dimension is necessary to make the discrepancy visible; a same-dimension panel masks it, which
   is exactly why this class of bug survives casual re-testing).
4. (Documentation hygiene, non-blocking but worth doing alongside the code fix) `design.md`'s D4
   text has not been updated since cycle 1 and no longer describes the actual architecture
   (filtering now lives in `OutputPanelContent`, not at a single `PanelCard` call site) — update it
   once the above fix lands, so the next reader of `design.md` isn't misled the way this ticket's
   own inline code comments already had to correct for.

### Non-blocking Suggestions (carried over, unaffected by this cycle)

- File a follow-up ticket for the pie-chart resize/theme-toggle rendering glitch (evaluation-2.md's
  independent assessment stands: pre-existing, unrelated, zero overlap with this diff's files).
- The pre-existing metric `fieldMapping` key-order fragility (out of scope, unrelated file).
- `PanelCard.tsx`'s file size (pre-existing, ~620 lines, not worsened this cycle net of the fix).
