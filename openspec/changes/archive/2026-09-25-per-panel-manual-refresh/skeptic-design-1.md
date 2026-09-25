## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence)

- Read `ticket.md`, `proposal.md`, `design.md`, `tasks.md`,
  `specs/panel-manual-refresh/spec.md` in full.
- Cross-checked every factual claim in `design.md`'s Context section against the
  live tree:
  - `usePanelData.ts:56-86` — confirmed `refresh()` resets `prevFetchKey.current`
    and bumps `refreshToken`; confirmed the fetch effect and `fetchPanelPage`
    thunk (`panelThunks.ts:317-336`, no `condition` option) have no in-flight
    dedup today — the "pre-existing gap" claim is accurate.
  - `panelsSlice.ts:199-232` — confirmed `fetchPanelPage.pending` sets
    `isLoadingMore: true`, `fulfilled`/`rejected` set it `false`; confirmed
    `usePanelData`'s existing `isLoading` formula
    (`isLoading = paginationEntry == null || (isLoadingMore && rows.length === 0)`)
    matches design.md line 17-19 exactly.
  - `PanelCard.tsx:79-99` — confirmed `usePanelPolling(refresh, ...)` and
    `usePanelRunRefresh(outputId, handleFanoutRefresh)` (which itself calls
    `refresh()`, line 96) are both wired to the SAME `refresh` closure from one
    `usePanelData(panel)` call in one `PanelCardBody` per panel — confirms the
    "same closure, three callers" premise.
  - `usePanelPolling.ts` / `usePanelRunRefresh.ts` — confirmed both are
    independent async triggers (interval / SSE subscription) that call
    `refresh()` via a stable ref, not through any shared guard today.
  - `panelNarrowing.ts:33-37` (`getOutputId`) — confirmed non-output panel kinds
    return `null`.
  - `IconButton.tsx`, `Spinner.tsx`, `PanelContent.tsx` (`onRetry`,
    `retryVariant="icon-only"`) — confirmed the shared-primitive claims in
    Context and Decision 1/3 are accurate to the actual component APIs.
  - `dataAsOf` (Decision 4) — `grep -rn dataAsOf` across `frontend/src` (outside
    tests) returns **zero** hits; it exists only in
    `backend/.../PublicDashboardRoutes.scala` and
    `openspec/specs/panel-data-freshness/spec.md`. Confirmed `PanelCard.tsx:382`
    already renders `Updated {date}` from `panel.meta.lastUpdated`. Decision 4's
    factual basis is accurate and its reasoning (cohesion risk of a second,
    differently-sourced "updated" string; reviving an orphaned capability is its
    own out-of-scope decision) is sound and appropriately self-approved — no
    issue found here.
  - `frontend/src/hooks/useInFlightGuard.ts:3-15` — read its doc comment in
    full (see below — this is the basis for Change Request 1).

### Verdict: REFUTE

### Change Requests

1. **Decision 2's chosen in-flight-guard mechanism reproduces, rather than
   closes, the exact race the codebase's own `useInFlightGuard` primitive was
   built to eliminate — and the design's justification for not reusing it
   attacks a strawman, not the strongest alternative.**

   `design.md` Decision 2 proposes: "`usePanelData` gains an internal ref
   mirroring `paginationEntry?.isLoadingMore` (synced via a `useEffect`...);
   `refresh()` checks that ref first." This ref is updated only after a render
   commit, inside a **passive** `useEffect` — i.e. it lags the actual dispatch
   by a full render-plus-effect-flush cycle.

   Compare `useInFlightGuard.ts`'s own doc comment (lines 3-15), which exists
   *in this same codebase* specifically to close this class of bug: "A
   `useState`-only guard is not re-entry-proof: `setState` inside an event
   handler is batched, so two synchronous activations in the same event-loop
   tick (**a genuine double-click**) both read the same pre-update state
   snapshot and both pass a 'not pending' check before either commits its
   update. `ref.current` is mutated synchronously, inline, before either
   activation's `fn` is invoked." That comment explicitly frames the same-tick
   double-activation as a *genuine*, real-world scenario (not contrived).

   `design.md`'s own Risks section (lines 99-103) acknowledges essentially the
   identical race — "could theoretically read one render behind Redux state in
   a contrived same-tick double-dispatch" — but (a) mischaracterizes it as
   "contrived" against the very primitive in this file that treats it as
   real, and (b) its stated mitigation, "React commits synchronously within one
   macrotask," does not actually establish safety: `useEffect` callbacks are
   **passive effects**, scheduled to run after paint, not guaranteed to flush
   before a second native click or Enter/Space keydown (a fast double-click, or
   keyboard repeat while holding Enter on the focused Refresh button) is
   processed. The claim conflates React's synchronous *state-update batching
   within one event* with passive-effect *flush timing*, which are not the
   same guarantee.

   This also undermines the "belt and suspenders" framing in Decision
   3/tasks 2.4: the component-level guard (`disabled={isRefreshing}`) derives
   `isRefreshing` from the same `paginationEntry?.isLoadingMore` value, so it
   is subject to the identical render lag — the two "independent" guards share
   one root cause and can both be beaten by the same race window.

   Decision 2's "Alternative considered" paragraph only rejects "wrapping only
   the new button's `onClick`" in `useInFlightGuard` — a weaker variant than
   the one actually available. The stronger, natural alternative — set an
   `inFlightRef` to `true` synchronously at the point `dispatch(fetchPanelPage(...))`
   is called inside `usePanelData`'s existing effect, and clear it in the
   `.then()`/`.catch()` handlers already present there (lines 74-85) — needs no
   Redux round-trip, no second `useEffect`, and closes the race completely,
   using the same synchronous-ref idiom `useInFlightGuard` already established
   as necessary in this file for exactly this reason. Decision 2 never
   considers or rejects this variant.

   **Required revision:** either (a) redesign the guard to set/clear the ref
   synchronously at the dispatch/resolution boundary inside the existing fetch
   effect (no Redux-state mirroring), or (b) if the mirrored-ref design is kept,
   replace the Risk section's incorrect "commits synchronously within one
   macrotask" claim with an accurate analysis of passive-effect flush timing
   and either prove the window is unreachable or accept and document the
   residual risk explicitly as a known gap (not as already-closed). Update
   `tasks.md` 1.1/1.2 accordingly — 1.2's red-first test should also prove the
   guard holds under a same-tick double-activation (calling `refresh()` twice
   before any `act()`-driven render/effect flush intervenes), not only two
   calls separated by a flushed render, since the latter would pass even under
   the weaker mirrored-ref design and would mask the exact race this Change
   Request identifies.

### Non-blocking notes

- Decision 1 (header `IconButton` vs. `ActionsMenu` item) and Decision 3
  (`isRefreshing` as a new field, `isLoading` unchanged) are both accurately
  grounded in the live `PanelContent`/`usePanelData` code and are sound as
  written.
- Decision 4 (no freshness label) is well-justified and correctly self-approved
  per the ticket's "optional" framing; the `dataAsOf`-orphan analysis is
  accurate.
- Spec.md's three "in-flight" scenarios (repeat manual click, poll-during-manual,
  SSE-during-manual) are all traceable to real triggers in the live code
  (`usePanelPolling`, `usePanelRunRefresh`) — good coverage once Change Request
  1 is resolved.
