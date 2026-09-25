## 1. `usePanelData` — shared in-flight guard + `isRefreshing`

- [x] 1.1 (Revised after design-gate skeptic round 1 REFUTE — see design.md Decision 2 and
      `skeptic-design-1.md`.) Add `inFlightRef = useRef(false)`, mutated SYNCHRONOUSLY INLINE at
      the two points this hook actually starts/settles a fetch — never mirrored from Redux state
      via a second `useEffect`:
      - `refresh()`: checks `inFlightRef.current` first and no-ops if `true`; otherwise sets
        `inFlightRef.current = true` as its very first statement (before touching
        `prevFetchKey`/`setErrorForKey`/`setRefreshToken`), mirroring `useInFlightGuard.guardedRun`'s
        own synchronous-inline ordering.
      - The fetch effect: sets `inFlightRef.current = true` at the top of its dispatch branch
        (covers the initial mount / output-changed dispatch, which never goes through `refresh()`),
        and clears it in a `.finally()` once `fetchPanelPage` settles (fulfilled or rejected).
      - The effect's early-return branch (`!currentFetchKey || !outputId`) also resets
        `inFlightRef.current = false`, so losing the Output binding mid-fetch never wedges the
        guard `true` for a hook instance that could later be rebound to a new Output.
- [x] 1.2 (Revised AGAIN after design-gate skeptic round 2 REFUTE — see `skeptic-design-2.md`. The
      round-1-revised test below — two synchronous `refresh()` calls in one `act()` — does NOT
      actually exercise the guard: React's automatic batching coalesces two synchronous
      `setRefreshToken` bumps into a single render, so the dependent fetch effect fires exactly
      once regardless of whether the guard exists — a false red-first proof that would pass even
      against the pre-guard code. The REAL race the guard closes is a second `refresh()` call
      arriving AFTER the first has already triggered its effect/dispatch but BEFORE that fetch has
      resolved — exactly what a real double-click produces, since a fetch takes real (async) time
      and React will already have committed the first render by the time a second physical click
      lands.) Add a red-first unit test in `usePanelData.test.ts` with this shape:
      1. Render the hook, call `refresh()` once, and flush so its effect runs and dispatches
         `fetchPanelPage` (mock the thunk so the dispatched promise stays pending/unresolved).
      2. While that promise is still unresolved, call `refresh()` a second time.
      3. Assert the dispatch spy's call count is exactly 1 (not 2).
      4. Resolve the mocked promise, flush, and assert a THIRD `refresh()` call now DOES dispatch
         again (call count 2) — proving the guard clears once the fetch settles, not permanently.
      Show step 3's assertion FAILING against a build with 1.1 reverted (or written before 1.1
      lands) per the standing red-first-proof constraint, then make it pass with 1.1 in place.
      (Design-gate skeptic round 3 non-blocking note: isolate the refresh-cycle dispatch-count
      assertion from the mount-triggered initial fetch — e.g. flush the initial mount fetch to
      completion first, THEN start the refresh-cycle sequence in steps 1-4, so the counted dispatch
      calls unambiguously refer to refresh()-triggered fetches only.)
- [x] 1.3 Add `isRefreshing: paginationEntry?.isLoadingMore ?? false` to `PanelDataResult` and both
      return branches (`!currentFetchKey` early return and the main return). Do not change
      `isLoading`'s existing definition.
- [x] 1.4 Unit-test `isRefreshing` is `true` while a fetch (of any trigger) is pending and `false`
      once resolved, independent of `isLoading`'s value during a refresh-of-loaded-data case.

## 2. `PanelCard`/`PanelCardBody` — lift `usePanelData`, add the Refresh control

(Revised after design-gate skeptic round 2 REFUTE — see design.md Decision 1 and
`skeptic-design-2.md`: `usePanelData` moves from `PanelCardBody` up to `PanelCard`, its sole call
site for a given panel; `PanelCardBody` receives the result as props instead of calling the hook.)

- [x] 2.1 In `PanelCard`, call `usePanelData(panel)` once, reusing the `outputId` already computed
      there (`getOutputId(panel)`, currently used only for the assertion-status effect).
- [x] 2.2 Remove the `usePanelData(panel)` call from `PanelCardBody`; add `PanelDataResult`'s fields
      PLUS `outputId` (currently computed inside `PanelCardBody` via its own `getOutputId(panel)`
      call, now supplied by `PanelCard`) to `PanelCardBodyProps` as individual props — itemized:
      `outputId, data, rawRows, headers, isLoading, error, errorKind, noData, neverMaterialized,
      chartAggregate, rowsTruncated, refresh, isRefreshing` — NOT one spread object (see design.md
      Decision 1 for why a single object prop would defeat `PanelCardBody`'s `React.memo`).
      `PanelCardBody` destructures them from props instead of from the hook; `usePanelPolling(refresh,
      ...)` and `usePanelRunRefresh(outputId, handleFanoutRefresh)` are otherwise UNCHANGED, now
      reading `refresh`/`outputId` from props. Update `PanelCardBody`'s own doc comment to reflect
      that it now receives fetch state as props rather than computing it itself.
- [x] 2.3 Update `<PanelCardBody panel={panel} frozen={isDragging} />`'s call site in `PanelCard` to
      pass the new props through from the lifted `usePanelData` result.
- [x] 2.4 In `PanelCard`'s header (`panel-grid-card__actions`), render an `IconButton` before the
      existing `ActionsMenu` trigger, only when `outputId` is non-null. `aria-label`:
      `` `Refresh ${panel.title}` ``. Icon: a refresh glyph (`lucide-react`, matching the existing
      `GripVertical`/icon usage in this file) when not refreshing; `<Spinner size="sm" />` when
      `isRefreshing` is true. `disabled={isRefreshing}`. `onClick` calls `refresh()` directly (now
      in scope in `PanelCard` itself — no prop-threading needed for the button).
- [x] 2.5 Confirm no control renders for `markdown`/`image`/`divider`/`form` panel fixtures (existing
      `PanelCard.test.tsx` fixtures cover these kinds — extend rather than duplicate).
- [x] 2.6 Unit test: activating the control calls `refresh()`; activating it again while
      `isRefreshing` is true does not call `refresh()` again (component-level guard, on top of the
      hook-level guard from 1.1 — belt and suspenders per design.md's Risk mitigation).
- [x] 2.7 Keyboard test: the control is reachable via Tab and activatable via Enter/Space (native
      `<button>` semantics via `IconButton` — verify no custom `onKeyDown` is needed, matching every
      other `IconButton` consumer in this file).
- [x] 2.8 Regression-check `PanelCardBody`'s existing drag-freeze/memo tests (or add one if none
      exist today): confirm passing the new individual props does not cause `PanelCardBody` to
      re-render during a drag (`frozen=true` still short-circuits to `null` before any expensive
      work) and that `refresh`/`rawRows`/`headers` reference-stability is preserved across an
      unrelated `PanelCard` re-render (e.g. title-edit keystrokes) — i.e. `PanelCardBody` does not
      spuriously re-render when only unrelated `PanelCard` state changes.

## 3. Visual + gates

- [x] 3.1 Visually check the new header control against the RUNNING dev server in BOTH light and
      dark themes (DESIGN.md's cohesion standard — token compliance alone is not sufficient):
      confirm the refresh icon and its `Spinner` swap read correctly against
      `panel-grid-card__actions`'s existing spacing/sizing alongside the drag handle and
      `ActionsMenu` trigger, in both themes.
- [x] 3.2 `npm run lint` / `npm run typecheck` / `npm test` all pass with zero new warnings.
- [x] 3.3 Confirm `openspec validate per-panel-manual-refresh --type change` passes.

## Standing Constraints

Driver-supplied constraints for this run (given directly at dispatch, not skeptic-promoted —
tracked here so the executor/evaluator see them; the methodology-carryover `CONSTRAINTS`/
`CONSTRAINT_REVIEWS` bookkeeping in `workflow-state.md` is reserved for constraints a skeptic
verdict or Planning ESCALATION actually promotes):

- Every `git commit` invocation uses Bash `timeout: 600000`; never re-run a commit while one is
  already in flight; never `git add -A` (add specific files only).
- `files-modified.md` lists EVERY touched file, including test fixtures.
- Proof is red-first: task 1.2's in-flight-guard test must be shown failing before the fix, not
  just passing after it.
- Budget exhaustion (including `DEBUG_ATTEMPTS`) is a mandatory escalation to the human — never a
  self-approved workaround.
- Migration ledger: this ticket is frontend-only and is not expected to need a migration; if one
  becomes necessary, V111 is next free (V110 is highest) — flag it explicitly rather than silently
  taking it.
- This is lane 1 of 5 in a strictly sequential HEL-350 batch (HEL-579 → HEL-584 → HEL-566 → HEL-572
  → HEL-588), all touching `PanelCard.tsx`/`ChartPanel.tsx` — no parallel work on this file tree.
