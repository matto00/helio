## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed tree: f63ab8365d2b0e6cac36154a83437b6d26b3a209 (worktree HEAD; the only change is the untracked change dir).
origin/main has since moved to 51a8f593c (HEL-1455, #986). `git diff --name-only f63ab8365 origin/main` touches nothing
under `frontend/src/features/panels`, `shared/ui`, `theme`, `write-path-audit`, `DESIGN.md` or `e2e/support`, so there is no
overlap.

### What I verified (with evidence)

- **Spawn cwd**: assert-cwd.sh printed `READY ambient=/home/matt/Development/helio branch=task/hel1399-followups-split-tablerenderer/HEL-1449`.
- **Owner ruling**: events.jsonl line 5 is `escalation.answered` with `answer:"scroll-hint"` and `answer_source:"human"`. D5 is judged on how it is executed only.
- **TableRenderer ranges (D1)**: `wc -l` gives 903. I checked each boundary against the file:
  - L31-121: the interface. L123-241: helpers. L243-282: persistence. L284: the `export function TableRenderer`. All correct.
  - L337: `usingPagination`. L468: `displayRows`. Both correct. The D6a/HEL-1027 comment block (L322-336) stays in the host above the call. The byte-identity proof accepts this, but it is worth knowing.
  - L470 starts the HEL-448 D6 timer comment. Correct.
  - **L611 is wrong.** The flush effect closes at L603 (`}, [outputId]);`). L605-611 is the doc comment for `handleSort` ("The persist fires from THIS handler …"), and `function handleSort` is at L612. See CR1.
  - L752-783 is exactly the `emptyAction` JSX. Correct.
  - The two `eslint-disable-next-line` lines are at L448 and L577. Correct.
- **Line budget (D1/AC3)**: deleting exactly the D1 a-e ranges from the file leaves **379 lines**, before any additions (awk transcript in this session). The design has not yet added any of these:
  - new import lines;
  - the `useTableRows({...})` call. It needs about 10 inputs (paginationRows, rawRows, headers, schema, columnOrder, columnFormats, formatIntl, columnFilters, columnSort, onSortChange) and about 12 outputs. Prettier puts each on its own line;
  - the `useTablePersistTimers({...})` destructure, about 10 outputs.

  Together that is about 35-45 lines, so the host comes to about 415-425. D1f takes out 32 lines and adds back a multi-line call, which lands at about 395-405. The design's own stop condition ("if still ≥ 400, stop and report") is therefore a likely outcome, not an edge case. See CR3.
- **D4**: OutputControlsEditor.tsx:56 calls `getFilterCapabilities(...)` and reads `response.columns.map((c) => [c.column, c.operators])`. The `outputService` mock in chartTypeDefault.test.tsx (L24-31) does not include it. The premise is confirmed and the fix is well-defined (`{ columns: [] }`). `panelDetailChartState.ts:14-16` contains the HEL-1378 no-default-chartType logic, so the planned mutation target exists.
- **D5 hook**: `useScrollEdges.ts` attaches its listeners and ResizeObserver in a `useEffect(..., [measure])`, which runs once per host mount. It observes `ref.current` and the children that exist at that moment, and bails out if `ref.current` is null.
- **D5 host**: in `PanelDetailModal.tsx` the edit `<form className="panel-detail-modal__content">` (L268-302) is rendered **only when `modalMode !== "view"`**.
  - `initialMode` defaults to `"view"` (L40).
  - `MobilePanelStack.tsx:192` never passes `initialMode`, so mobile always opens in view mode.
  - View-to-edit happens through the Edit button (L183-193) and the `e` key (`usePanelDetailEditState.ts:107`).
  - Save and Cancel set the mode back to view (L102/L120/L156).

  So the scroll container is usually mounted after the hook's effect has already run, and in that case it is never observed. See CR2.
- **D5 "direct panel switch"**: both call sites key the modal by panel id (DesktopPanelGrid.tsx:423-428 and MobilePanelStack.tsx:192-195, HEL-307). A panel switch therefore **remounts** the whole modal. It does not "swap the form's children", as D5's second bullet says. That case is harmless. The view-to-edit case is the one that matters.
- **D5 CSS visibility**: the form's children include opaque surfaces:
  - `.output-controls-editor__row` has `background: var(--app-surface)` (OutputControlsEditor.css:26);
  - `PanelDetailModal.binding.css` has several `--app-surface-soft` fills.

  An inset `box-shadow` on a scroll container paints beneath its in-flow children. At the bottom edge, where the off-screen Controls rows sit, the fade is likely to be hidden. The design leaves this as "judged live" and names no fallback. See CR4.
- **D3**: I re-ran the planned grep and got 20 hits. They include the named ones and others the classification step will pick up:
  - `MarkdownRenderer.tsx:10`, the same stale "`PanelContent.tsx`'s static import" pattern as ChartRenderer (which is now at :18, not :14);
  - `TableRenderer.test.tsx:1083` and `columnFormatting.ts:6`, which cite `TableRenderer.tsx:243`. That line is already stale (it is `PERSIST_DEBOUNCE_MS` today), and after D1 the `getSortValue` call lives in `useTableRows.ts`.

  The grep-and-classify approach covers all of these. `write-path-audit/spec.md`: a `test -e` loop over its `frontend/src/` paths prints exactly 7 MISSING, matching the design. The `### Source Locations` table sits under `## Write Path Reference`, outside `## Requirements`.
- **D6**: `e2e/support/db.cjs` and `userCleanupCore.cjs` both exist. `buildUserDeleteSql` (L79) already deletes the `pipeline_run_rate_window` rows (L37) first. The 3 HEL-1399 id files exist.
- **Importers**: `OutputPanelContent.tsx`, `HistoryRows.tsx` and 4 test files import `./TableRenderer` or the `renderers/TableRenderer` path. This matches the design.

### Verdict: REFUTE

### Change Requests

1. **D1(e) range is wrong (design.md D1e, tasks 2.3).**
   - **Problem:** `useTablePersistTimers` is specified as "body L470-611 verbatim", but L605-611 is `handleSort`'s doc comment. Followed literally, that comment would end up orphaned at the bottom of the hook, separated from the function it documents. The D2(i) byte-identity proof would **pass** anyway, because the text is identical, so no gate would catch it.
   - **Fix:** change the range to **L470-603** and the handlers range to **L605-711**.
   - **Also:** the D2 proof should state the exact range of each block, so that a misplaced comment counts as a defect.

2. **D5 misses the main lifecycle: the edit form mounts after the hook's effect has already run (design.md D5 bullets 2-3, tasks 4.3 and 6.2).**
   - **Problem:** `useScrollEdges`' attach effect runs once per host mount with deps `[measure]`. In the default flow the form element does not exist at that point, so the scroll listener, ResizeObserver and initial measure are never attached and the fades never appear:
     - desktop opened in view mode, then Edit or `E`;
     - **every** mobile open;
     - edit, then Save/Cancel back to view, then edit again. Here the listeners stay bound to the detached old form, or to nothing.

     The proposed remedy (a `MutationObserver` on children) does not address a container that is null at mount.
   - **Required revisions:**
     - (a) Name this case explicitly.
     - (b) Choose a fix and keep it additive to the shared hook, for example:
       - a callback ref that attaches and detaches per element, or
       - keying the attach effect on the element (`useState`-held node).

       Calling the hook from a small component that wraps only the edit form would also avoid it. If that is chosen, say which.
     - (c) The PanelDetailModal test (6.2) must cover **opening in view mode and toggling to edit**, and edit to view to edit. It must not render with `initialMode="edit"` alone, which would pass even with the defect. It must be red before the fix.
     - (d) The live check (4.3) must include view-to-edit on desktop and a mobile-width open.
     - (e) Correct the "direct panel switch swaps the form's children" claim. A switch remounts the modal (`key=` on both call sites), so that case is trivially covered.

3. **AC3 line budget is likely to trip the design's own stop condition (design.md D1/D1f, task 2.4).**
   - **Problem:** removing exactly the a-e ranges leaves 379 host lines. The hook call sites and import changes add about 35-45 more (Prettier puts each destructured identifier on its own line). D1f brings that to roughly 395-405, at the 400 threshold.
   - **Required:**
     - Record the estimate.
     - Pre-approve one more behaviour-preserving seam, so the executor is not forced into "stop and report" on a predictable outcome. One option that needs no new tree layer and no hook-order change is the pin/sort/filter persist handlers (`handleSort`, `handleFilterChange`, `handleClearFilters`, `handlePinToggle`, L605-711) moving into `useTablePersistTimers` as returned closures, with bodies verbatim. Another is a single-object call/return shape for the hooks to cut destructure lines. If neither is acceptable, say why.
   - **D2(i)'s permitted-additions list must be updated to match** whichever seam is chosen.

4. **D5 fade visibility has no committed fallback (design.md D5 CSS bullet, Risks bullet 2).**
   - **Problem:** an inset `box-shadow` on `.panel-detail-modal__content` paints beneath its children. The Controls rows have an opaque `background: var(--app-surface)` (OutputControlsEditor.css:26), and those rows are exactly what sits at the bottom edge the hint exists to signal. "Judged live" leaves the core AC4 / spec scenario 1 decision open.
   - **Required:**
     - State the visibility acceptance signal: the bottom fade must be visibly present over a Controls row in both themes, in the 1440×900 and 1280×720 screenshots.
     - Name the fallback if the inset is covered, for example sticky top/bottom gradient pseudo-elements on the form, using `--app-text`/`--app-surface` tokens via `color-mix`, with `pointer-events: none`.
     - Say how `elevationTokenGuard.css.test.ts` and DESIGN.md are updated in the fallback case. The fallback is not a box-shadow, so the "pin each new box-shadow" plan would not apply.

### Non-blocking notes

- D1(b): "each moved top-level declaration **the host uses** gains `export`". After the move the host itself uses only `UNSORTED_SENTINEL`. `useTableRows` and `useTablePersistTimers` use the rest (`deriveKeys`, `orderedColumns`, `getSortValue`, `sortFilterDisabledReason`, `leadingPinnedCount`). Reword this as "used by any other module". tsc will force the right set either way.
- D4: resolving `getFilterCapabilities` now triggers a `setCapabilities` state update after mount. Check that it does not add a new `act()` warning in place of the AggregateErrors, and record the console-warning count before and after, not only the AggregateError count.
- D3: the write-path-audit rows' **Role** text ("Panel appearance and data binding saves") may be stale even after the paths are re-pointed. Verify each role against the new file, or say that only the path is re-pointed.
- D3: `ChartRenderer.tsx`'s stale pointer is at :18 now, not :14. `MarkdownRenderer.tsx:10` has the identical stale text. The grep will catch both. Do not hand-fix only the named ones.
- `PanelDetailModal.tsx` is 336 lines. D5's additions must keep it under 400. Include it in the 2.4 `wc -l` list.
