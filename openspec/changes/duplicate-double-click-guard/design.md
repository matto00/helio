## Context

See proposal.md - Why. Three duplicate call sites exist today, none guarded:
`PanelCard.tsx`'s `handleDuplicate` (fire-and-forget `dispatch(duplicatePanel(...))`),
`DashboardList.tsx`'s `handleDuplicateDashboard` (an `async function` that awaits
`dispatch(duplicateDashboard(...)).unwrap()`), and
`usePipelineDetailPage.ts`'s `handleDuplicateStep` (an async `useCallback` that awaits
`duplicatePipelineStep(stepId)`). All three render a list of cards keyed by entity id
(panels, dashboards, steps), so the guard must be **per-entity-id**, not a single global
flag — duplicating panel A must not block duplicating panel B.

## Goals / Non-Goals

**Goals:**
- One shared hook used identically by all three call sites.
- Guard is synchronous and re-entry-proof against two activations in the same
  event-loop tick (a `useState`-only guard is not: `setState` during an event handler
  is batched, so a second synchronous `onClick` in the same tick reads the pre-update
  state and passes the guard too — see HEL-412's skeptic finding).
- Guard clears on both success and failure, re-enabling the affordance.

**Non-Goals:**
- No change to the duplicate endpoints' server-side behavior.
- No global/app-wide request de-duplication layer — scoped to these three UI call sites.
- No change to Delete/Export/Rename or any other action.

## Decisions

**Decision 1 — new shared hook `useInFlightGuard<K>()` in `frontend/src/hooks/`.**
Holds a `useRef<Set<K>>` (the synchronous source of truth, checked/mutated before any
`await`) mirrored into `useState<ReadonlySet<K>>` (a render-triggering copy, read only
for the `disabled` prop). Exposes:
- `isPending(key: K): boolean` — reads the state copy, for rendering.
- `guardedRun(key: K, fn: () => Promise<unknown>): void` — if `ref.current.has(key)`,
  no-op and return immediately (this is the re-entry-proof check: it runs synchronously,
  inline in the event handler, before React ever gets a chance to batch a state update).
  Otherwise add `key` to the ref set, mirror it into state, then call `fn()` and attach
  cleanup as `fn().catch(() => {}).finally(() => { ref.current.delete(key); mirror to
  state; })`. The `.catch(() => {})` is defensive only: it exists purely so the
  `.finally()` cleanup is reachable and no unhandled-rejection warning is raised if a
  future call site's `fn` ever rejects — it does not replace or swallow a call site's
  own error handling. **Contract**: every call site's `fn` is responsible for handling
  its own rejection (reporting an error, setting error state, etc.) before it would
  reach `guardedRun` — exactly as each of the three existing call sites already does
  today (`DashboardList`'s `try/catch` around `.unwrap()`, the pipeline step handler's
  own `try/catch` + toast, and `PanelCard`'s plain non-`unwrap()`'d dispatch, which
  cannot reject at all). `guardedRun` itself returns `void`, not the promise — no call
  site needs to chain off it.

Alternative considered: a `useState<Set<K>>`-only guard (no ref). Rejected — this is
exactly the HEL-412 bug: two synchronous `onClick` calls in one tick both read the same
pre-update state snapshot, so both pass the "not pending" check before either commits
its update.

Alternative considered: `AbortController`-based single-flight per key with no ref/Set,
canceling a stale duplicate call. Rejected as unnecessary complexity — the ask is
"ignore the second activation," not "cancel and restart"; a plain re-entry guard is a
better match for the acceptance criteria and is simpler to test.

**Decision 2 — wiring stays call-site-specific, not a wrapped dispatch/thunk.**
Each of the three call sites already has its own async shape (raw dispatch, `.unwrap()`,
a plain async function). `guardedRun` takes a plain `() => Promise<unknown>` so each
call site wraps its existing logic without restructuring it — e.g.
`onClick={() => guardedRun(panel.id, () => dispatch(duplicatePanel(...)))}`. This keeps
the diff minimal and avoids coupling the hook to Redux specifically (the pipeline-step
call site doesn't dispatch a thunk at all — it calls a service function directly).
Note: `PanelCard.tsx`'s current `handleDuplicate` is `() => void dispatch(...)` — the
`void` operator discards the dispatch promise. `guardedRun` needs that promise to know
when to clear the guard, so this call site changes to
`() => dispatch(duplicatePanel({ panelId: panel.id, dashboardId }))` (returning the
promise, no `void`) wrapped as `guardedRun`'s `fn` argument.

**Decision 3 — disabling the affordance.**
- `PanelCard`/`DashboardList`: pass `disabled: isPending(id)` into the existing
  `ActionsMenu`/menu-item `disabled` prop (`ActionsMenuItem.disabled` already exists and
  is wired into focus/keyboard handling) — panel/dashboard actions render through
  `ActionsMenu` items already. Also note (required for the test design below):
  `ActionsMenu` closes the menu immediately on any item's `onClick` before that
  `onClick` runs (`ActionsMenu.tsx` lines ~73-76) — a genuine "double-click" on this
  surface is really "activate, the menu closes, reopen the menu, activate again," not
  two clicks on the same still-open menu item. Tests below reflect this.
- `StepCard`: the duplicate control is a plain `<button>` (not routed through
  `ActionsMenu`), so it needs a new prop — named `isDuplicating`, not `disabled`,
  since `StepCard` already overloads "disabled" for the unrelated step
  enable/disable toggle (the spec's "Disabled cards SHALL render visually muted"
  refers to that toggle, not the duplicate button; `isDuplicating` only disables the
  "Duplicate step" button itself). **Corrected wiring path** (verified against the
  live tree — the original draft of this decision wrongly assumed
  `PipelineDetailPage.tsx` renders `StepCard` directly, and a later revision wrongly
  counted `RootColumn.tsx` as a fourth render site; neither is true):
  `usePipelineDetailPage.ts` owns the guard and exposes `duplicatingStepIds:
  ReadonlySet<string>` (the hook's `isPending`-backing state, exposed as a set rather
  than a function — see the memoization note below) alongside the existing
  `handleDuplicateStep`. `PipelineDetailPage.tsx` passes `duplicatingStepIds` into
  `PipelineRiverView.tsx` exactly like it already passes `onDuplicateStep`.
  `PipelineRiverView.tsx` in turn passes it into `RootColumn.tsx` and `LaneColumn.tsx`
  exactly like it already passes `onDuplicateStep` (see `PipelineRiverView.tsx` lines
  ~469 and ~546, `LaneColumn.tsx` line ~137 for the recursive fan-out through nested
  lanes) purely so it can reach the components that actually render `StepCard` —
  `RootColumn.tsx` itself only renders `LaneColumn`, it renders no `StepCard`.
  There are exactly three actual `<StepCard onDuplicate={onDuplicateStep} .../>` call
  sites: `PipelineRiverView.tsx` ~line 399, and `LaneColumn.tsx` ~lines 175 and 218.
  At each, add `isDuplicating={duplicatingStepIds.has(step.id)}` — a plain boolean
  computed inline at each call site, not a function prop. `StepCard` is wrapped in
  `React.memo`; a function prop (e.g. `isDuplicating: (id) => boolean`) would get a
  new identity on every parent render and defeat that memoization for every step
  card on every render, not just the duplicating one — a boolean primitive avoids
  that.

## Gate-Chain Implications Checklist

Not applicable — this change touches only `frontend/src/**` TSX/TS application code and
its tests. No `.husky/**` file or any script a `.husky/pre-commit` hook invokes is
created, modified, or newly exercised by this change.

## Risks / Trade-offs

- [Threading a new `duplicatingStepIds`/`isDuplicating` prop through
  `PipelineDetailPage.tsx` → `PipelineRiverView.tsx` → `RootColumn.tsx`/`LaneColumn.tsx`
  adds one more prop to an already-large prop surface] → Mitigation: thread it
  alongside the existing `onDuplicateStep` prop at every layer (same shape of change,
  same call sites) and keep the guard's own public surface to exactly
  `isPending`/`guardedRun` so it reads as one concern, not a new abstraction to learn
  per call site.
- [A duplicate request that never settles (hung request, no client-side timeout) leaves
  the affordance permanently disabled for that entity] → Mitigation: unchanged from
  today's behavior (none of the three call sites has a request timeout today); out of
  scope for this ticket, which only fixes the double-activation race, not general
  request-hang handling.

## Planner Notes

- Scoped the guard to exactly the three named surfaces per the ticket; the widened
  search (command palette, mobile nav, keyboard shortcuts) found no other duplicate
  affordances to extend this to (see `ticket.md`'s "Confirmed current file locations").
- Modified `pipeline-step-lifecycle`'s existing requirement (rather than adding a new
  one) since duplicate-guard behavior is a refinement of the same "Duplicate step"
  requirement HEL-412 already specified there.
