## Context

See `proposal.md` for motivation. Relevant current state (verified against the live tree,
`premise-validation.md`):

- `usePanelData(panel)` (`frontend/src/features/panels/hooks/usePanelData.ts`) exposes `refresh()`,
  which resets `prevFetchKey.current = null` and bumps a `refreshToken` state, forcing the fetch
  effect (`dispatch(fetchPanelPage(...))`) to re-run. Neither `refresh()` nor the effect nor the
  `fetchPanelPage` thunk (`panelThunks.ts`, no `condition` guard) currently de-duplicate an
  already-in-flight fetch for the same key — a pre-existing gap.
- Three callers already exist or will exist for `refresh()`: `usePanelPolling` (interval),
  `usePanelRunRefresh`/`handleFanoutRefresh` (HEL-1094 SSE fan-out on pipeline-run-succeeded), and
  this ticket's new manual button. All three ultimately call the SAME closure returned by one
  `usePanelData` instance per panel, so a guard placed inside `usePanelData` covers all three
  uniformly with no per-caller coordination.
- `fetchPanelPage.pending`'s reducer keeps existing `rows` and sets `isLoadingMore: true`;
  `usePanelData`'s existing `isLoading = paginationEntry == null || (isLoadingMore && rows.length
  === 0)` is therefore already `false` during a refresh of already-loaded data — this is what keeps
  `PanelContent`'s full skeleton from flashing on refresh today, and must not change.
- Non-output panel kinds (`markdown`/`image`/`divider`/`form`) never fetch — `getOutputId(panel)` is
  `null` for them (`usePanelData`'s own header comment).
- Shared primitives already exist and need no new component: `Spinner` (`shared/ui/Spinner.tsx`,
  DESIGN.md §7's border-spinner, `aria-hidden`, sizes sm–2xl), `IconButton` (`shared/ui/IconButton.tsx`,
  mandatory `aria-label`, DESIGN.md §8), `useInFlightGuard` (already used in this same file for
  `handleDuplicate` — see Decision 2 for why it is NOT reused here).

## Goals / Non-Goals

**Goals:**
- A keyboard-accessible Refresh control per output-bound panel that calls the existing `refresh()`.
- At most one fetch in flight per panel at a time, regardless of which of the three triggers fired.
- Accent-spinner in-flight feedback with no full-skeleton flash, per DESIGN.md §7.

**Non-Goals:**
- Re-running the pipeline (HEL-1096's "Run to update" owns that; out of scope per the ticket).
- Changing the polling interval model, the SSE fan-out subscription, or backend refresh semantics.
- A dashboard-wide "refresh all" control (ticket's own out-of-scope list; triaged as a follow-up
  candidate at Delivery per the ticket's "could be a follow-up" note).
- A data-freshness ("updated N ago") label — see Decision 4.

## Decisions

**D1 — Control placement: a header `IconButton`, not an `ActionsMenu` item — AND `usePanelData`
moves up to `PanelCard`.** (Revised after design-gate skeptic round 2 REFUTE — see
`skeptic-design-2.md`: the cycle-1/2 drafts placed the button in `PanelCard`'s header while
`usePanelData`/`refresh`/`isRefreshing` were only ever called inside `PanelCardBody`, a CHILD of
`PanelCard` — `PanelCardBody` cannot pass anything "down" to its own parent; that direction of prop
flow doesn't exist in React. Two non-viable fixes were considered and rejected: lifting the button
into `PanelCardBody` — that component's `if (frozen) return null` early return is what keeps the
header visible-but-body-hidden during a drag (per its own doc comment: "title and handle remain
visible" while dragging), so a header-scoped control cannot live inside it; and giving `PanelCard` a
SECOND, independent `usePanelData` instance — that would create two disjoint `inFlightRef`/
`prevFetchKey`/`refreshToken` state trees for the same panel, one driving the button, one driving
poll/fan-out/body rendering, completely defeating Decision 2's "one shared instance guards all three
triggers" premise and silently reintroducing the double-fetch race this whole design exists to
close.)

The correct fix: `usePanelData(panel)` is called exactly ONCE, in `PanelCard` — the nearest common
ancestor of the header (where the button must render) and the body (where the data is consumed).
`PanelCard` already computes `getOutputId(panel)` for its assertion-status effect; this becomes the
single `outputId` feeding both that effect and the new `usePanelData` call. `PanelCard` renders the
Refresh `IconButton` directly from this call's `refresh`/`isRefreshing`, in `panel-grid-card__actions`
before the existing `ActionsMenu` trigger, only when `outputId` is non-null. `PanelCard` passes the
REST of `usePanelData`'s return fields down to `PanelCardBody` as individual props (`data, rawRows,
headers, isLoading, error, errorKind, noData, neverMaterialized, chartAggregate, rowsTruncated,
refresh, isRefreshing`) — NOT as one spread object (a fresh object literal every render would defeat
`PanelCardBody`'s `React.memo` shallow-prop comparison on every single render, dragging or not).
Passed as individual props, memo semantics are UNCHANGED from today: `refresh` stays a
`useCallback([])`-stable reference, `rawRows`/`headers` stay `useMemo`-stable, and only the
primitives that SHOULD trigger a re-render (`isLoading`, `isRefreshing`, etc.) do. `PanelCardBody`
keeps `usePanelPolling(refresh, ...)`, `usePanelRunRefresh(outputId, handleFanoutRefresh)`, and the
`refreshAnnouncement` live region exactly as they are today — it now receives `refresh`/`outputId` as
props instead of computing them itself, with no other change to that wiring.

*Trade-off, stated rather than silently absorbed:* `PanelCard` (header markup, title-editing state,
`ActionsMenu`, drag handle) now re-renders on every fetch/poll/refresh event for its panel —
previously isolated entirely inside `PanelCardBody`'s memo boundary. This is not avoidable: showing a
spinner IN THE HEADER on a fetch event requires SOME re-render path to reach the header when a fetch
starts/stops — there is no way to satisfy the ticket's AC without it. Drag performance is unaffected:
`PanelCardBody`'s existing `frozen`-early-return (checked after hooks run, before any expensive
`PanelContent` chart/table work) is what protects drag performance, not `React.memo`'s prop-diffing,
and that mechanism is untouched by this change — during a drag, `PanelCardBody` still returns `null`
immediately regardless of which props it received.
*Alternative considered (menu placement):* an `ActionsMenu` entry alongside Rename/Customize/
Duplicate/Delete — rejected because a menu item (only visible while the menu is open) cannot show
live in-flight spinner feedback, exactly the same reasoning `PanelContent`'s own
`onRetry`/`retryVariant="icon-only"` already uses for its error-state retry control.

**D2 — In-flight guard lives inside `usePanelData`, as a ref mutated synchronously inline —
never mirrored from Redux state via a second `useEffect`.** (Revised after design-gate skeptic
round 1 REFUTE — see `skeptic-design-1.md`: a cycle-1 draft of this decision mirrored
`paginationEntry?.isLoadingMore` into a ref via its own `useEffect`, which lags the real dispatch
by a full render-plus-passive-effect-flush cycle and does not close the same-tick double-activation
race it claimed to.) `useInFlightGuard<K>` (already used in this file for `handleDuplicate`) is
still not reused directly — it keys re-entry by an opaque id the CALLER supplies per action, with no
visibility into the fetch that `usePanelPolling`/`usePanelRunRefresh` also drive through the same
`refresh()` closure — but its ROOT IDIOM is exactly what this decision now adopts: `guardedRun`
mutates `pendingRef.current` synchronously, inline, before the guarded async work starts, closing
the "two synchronous activations in the same event-loop tick" race by construction, per its own doc
comment. `usePanelData` gains one `inFlightRef = useRef(false)`, set/cleared at the two points where
this hook actually knows a fetch is starting or has settled, with no Redux round-trip and no second
effect in between:
- `refresh()` is the guard's entry point for the manual/poll/fan-out callers: it synchronously
  checks `inFlightRef.current` and no-ops if already `true`; otherwise it sets
  `inFlightRef.current = true` INLINE, in the same synchronous call, before resetting
  `prevFetchKey.current` or touching any state — mirroring `guardedRun`'s ordering exactly, so a
  second `refresh()` call arriving before React has re-rendered (a genuine same-tick double-click,
  or a poll/fan-out event racing a manual click) sees the ref already `true` and no-ops.
- The fetch effect ALSO sets `inFlightRef.current = true` at the top of its dispatch branch
  (covering the initial mount / output-changed dispatch, which doesn't go through `refresh()` at
  all) and clears it in a `.finally()` once `fetchPanelPage` settles (fulfilled or rejected) —
  the one place this hook already knows the fetch is done. The early-return branch
  (`!currentFetchKey || !outputId`) also resets `inFlightRef.current = false`, so a panel that loses
  its Output binding mid-fetch never leaves the guard permanently wedged `true` for a hook instance
  that might later be rebound to a new Output.
*Alternative considered:* an AbortController that cancels the in-flight request and starts a fresh
one — rejected as unnecessary complexity; the ticket asks for "no duplicate concurrent fetch," not
"latest-wins cancellation."

**D3 — `isRefreshing` is a new, separate return field, not a repurposed `isLoading`.**
`isLoading` must stay `false` during a refresh of already-loaded data (Context, above) — that is
exactly what keeps `PanelContent`'s full skeleton suppressed today, an existing, load-bearing
behavior this ticket must not regress. A new field, `isRefreshing: paginationEntry?.isLoadingMore ??
false`, is returned alongside it: `true` during ANY pending fetch (first load or refresh) — consumed
only by the new Refresh button (swap its icon for `<Spinner size="sm" />` and set `disabled`), never
by `PanelContent`. The button itself is rendered only when `getOutputId(panel)` is non-null (Goals),
so non-output panel kinds render no control at all — nothing to disable or spin.

**D4 — No freshness ("updated N ago") label; not deferred, decided.** The ticket marks this
optional. Two things argue against adding it now rather than leaving it undecided: (1) `PanelCard`'s
footer already renders `Updated {date}` from `panel.meta.lastUpdated` — the panel CONFIG's own
last-edit timestamp, unrelated to data-fetch recency; a second, differently-sourced "updated" string
on the same card is a cohesion problem the ticket's own "optional" framing doesn't resolve for us.
(2) `openspec/specs/panel-data-freshness/spec.md` already describes a "Data as of" freshness
indicator sourced from a `panel.dataAsOf` field — but `dataAsOf` was removed from the frontend
`PanelBase` type entirely during the HEL-903/904 pipelines-and-outputs remodel and now exists only
on the backend's public/shared-dashboard route (`PublicDashboardRoutes`), never wired to the
authenticated dashboard grid this ticket touches. That capability spec is effectively orphaned on
the authenticated path. Building a NEW, differently-sourced (local fetch-timestamp) freshness label
under a similar-sounding label risks exactly the confusion HEL-234/HEL-906's own comments were
written to head off. Reviving `dataAsOf` on the authenticated grid, or retiring the orphaned spec, is
its own decision with its own scope — out of bounds for this ticket. This is a self-approved scope
decision, not an escalation: it declines an explicitly-optional item for a stated, code-grounded
reason, changes nothing architecturally, and is fully reversible in a follow-up.

## Risks / Trade-offs

- [Risk] (Resolved by the D2 revision above, kept here for the record — cycle-1 draft only) A
  guard that mirrors Redux state into a ref via its own `useEffect` lags a full
  render-plus-passive-effect-flush cycle behind the real dispatch and does not actually close a
  same-tick double-activation race. → Mitigation: `inFlightRef` is now mutated synchronously,
  inline, at the two points this hook itself triggers or completes a fetch (`refresh()`'s own call
  body, and the fetch effect's dispatch/`.finally()`), the same idiom `useInFlightGuard` already
  uses elsewhere in this file — no Redux round-trip, no second effect, so there is no window where
  a same-tick second activation can race past a stale read. The button's `disabled={isRefreshing}`
  remains a second, UI-level guard for the human-click path, genuinely independent of the hook-level
  one now that the hook-level guard no longer shares its root cause.
- [Trade-off] No AbortController — a manual refresh clicked the instant a poll tick starts is a
  no-op rather than "jump the queue." Acceptable: the poll's own fetch will complete within one
  cycle and the data is current either way; the ticket asks for freshness-on-demand, not
  lowest-latency-on-demand.

## Migration Plan

None — pure frontend addition, no schema/API/migration involved. No rollback beyond reverting the
PR.

## Planner Notes

- D4 (no freshness label) is a self-approved planning decision per the "self-approve everything
  else" default — not escalated, since it declines an explicitly optional scope item for a
  documented, code-grounded reason and changes nothing else in the ticket's required ACs.
- Filing a follow-up for reviving/removing the orphaned `panel-data-freshness` capability (D4) is
  deferred to Delivery's follow-up triage, not done here — it's adjacent, not blocking.
