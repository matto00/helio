## Context

HEL-304 split panel persistence in two:

- `usePanelUpdatesFlush` (owned by `PanelGrid`, mounts at every width): 30s auto-save interval, Save-now
  registration, dashboard-switch flush, and a layout-flush *slot* (`layoutFlushRef`).
- `useLayoutSave` (mounted only by `DesktopPanelGrid`): stages layout changes in `latestLayoutRef` /
  `persistedLayoutRef`, exposes `persistLayout`, and registers it into the parent slot on mount /
  clears it on unmount.

The staging state lives entirely inside `DesktopPanelGrid`'s hook instance. When the container width
crosses below `panelGridConfig.breakpoints.sm` (768px), `PanelGrid` swaps in `MobilePanelStack`;
`DesktopPanelGrid` unmounts, destroying the refs and clearing the slot. A staged-but-unflushed layout
change (drag/resize within the 30s window) is lost with no PATCH and no error. This is the HEL-306 bug.

Binding constraint (HEL-301, hazard §4.1 of `notes/mobile-pwa-handoff.md`): mobile browsing must never
PATCH dashboard layout — the xs byte-identity guard and the structural no-layout-write-path-below-sm
tests in `PanelGrid.test.tsx` must keep passing.

## Goals / Non-Goals

**Goals**

- A layout change staged on desktop survives `DesktopPanelGrid` unmounting for any reason (viewport
  shrink below 768px, dashboard switch, route navigation) — it is flushed at unmount.
- Preserve the structural guarantee: no layout-write code path mounts below the `sm` boundary.
- Rapid repeated 768px crossings must not double-PATCH or corrupt state.

**Non-Goals**

- Restore-on-remount buffering; retrying a failed unmount flush; changing `usePanelUpdatesFlush`.

## Decisions

### D1: Flush-on-unmount, not restore-on-remount

`useLayoutSave` gains an unmount effect that calls `persistLayout()` before/as the flush-slot
registration is cleared.

Why over restore-on-remount (buffering the staged layout in `PanelGrid` and re-seeding on remount):

- The user's intent (the drag) is complete and durable — persisting it immediately is strictly better
  than holding it hostage to a return-to-desktop that may never happen (tab closed while narrow).
- Restore-on-remount would move staged-layout state up into the width-independent parent, weakening the
  "layout state exists only while the desktop grid is mounted" invariant and complicating the HEL-301
  structural argument. Flush-on-unmount keeps every layout-write line inside `useLayoutSave`.
- `persistLayout` already carries the equality + in-flight guards, so a flush at unmount with no staged
  change is a no-op — a pure resize (browse-only crossing) dispatches nothing, preserving HEL-301.

### D2: Implementation shape — dedicated unmount-only effect with refs, not the registration effect

The registration effect (`[registerLayoutFlush, persistLayout]`) re-runs whenever `persistLayout`'s
identity changes (`dashboardId`/`dispatch`); its cleanup also runs on every dep change. Piggybacking the
flush there would work but couples flush timing to dependency identity — future edits to
`persistLayout`'s dep list would silently change when the flush fires. Instead add a separate effect
with a dedicated single-purpose story: keep the latest `persistLayout` in a ref (standard latest-ref
pattern, already used for `latestLayoutRef`) and flush in a
`useEffect(() => () => persistLayoutRef.current(), [])` cleanup that runs exactly once, at true unmount.

Remount ground truth: `PanelList.tsx:211` is the only `<PanelGrid>` call site and it is keyed by
`key={selectedDashboardId}`, so a dashboard switch fully unmounts the old `PanelGrid`/`DesktopPanelGrid`
subtree and mounts a fresh one — a true unmount, exactly like the phone-shrink crossing. In practice
`persistLayout`'s deps therefore never change within a single mounted instance; the ref-based unmount
effect is chosen for simplicity and decoupling from dependency identity, not because a mid-lifecycle
dep-change flush path exists today. The unmount flush covers both unmount causes (boundary crossing and
dashboard switch) with the same mechanism.

Note on React semantics: effect cleanups run before the component's refs are torn down, and Redux
`dispatch` from an unmounting component is safe (the thunk owns the async lifecycle; no setState on an
unmounted component is involved).

### D3: Dispatch order at unmount

The unmount flush must observe the still-registered state of its own hook instance but does not depend
on the parent slot — it calls `persistLayout` directly. Slot clearing (`registerLayoutFlush(null)`) and
the unmount flush are independent effects; order between them is irrelevant because the flush does not
go through the slot.

### D4: Tests live beside the existing HEL-301/HEL-304 guards

Extend `PanelGrid.test.tsx` (which already simulates width crossings and asserts the xs byte-identity /
no-PATCH-below-sm guarantees) with:

1. Shrink-mid-edit: stage a layout change (simulate `onLayoutChange`), shrink below 768px, assert exactly
   one layout PATCH fires with the staged layout.
2. Browse-only crossing: no staged change, shrink below 768px, assert zero layout PATCHes (explicitly
   re-runs the HEL-301 guard through the new unmount path).
3. Rapid repeated crossings: stage once, cross down/up/down quickly, assert exactly one PATCH (in-flight
   + equality guards) and no PATCH originates while the mobile stack is mounted.
4. Existing HEL-301 xs byte-identity and structural no-persist tests must pass unmodified.

## Risks / Trade-offs

- [Unmount flush fires a PATCH that fails while user is on mobile] → Existing `persistLayout` catch
  swallows the error and normally retries "on the next layout change"; below the boundary there is no
  next change, so a failed unmount flush is lost. Accepted: identical durability to today's 30s-interval
  failure mode, and strictly better than the current guaranteed loss. Not widened in this ticket.
- [Double PATCH on rapid crossings] → `inFlightLayoutRef` + `areDashboardLayoutsEqual` guards; new hook
  instance on remount re-seeds from `resolvedLayout`, and a remount-then-re-drag while the unmount PATCH
  is in flight resolves last-write-wins with the newer layout. Covered by test 3.
- [Violating HEL-301] → The flush runs in the desktop hook's teardown, on desktop-staged data only; the
  mobile stack still imports nothing layout-write-capable. Guard tests re-run explicitly.

## Migration Plan

Frontend-only, no schema/API change. Ship with the fix + tests in one commit; revert is a one-file revert.

## Planner Notes (self-approved)

- Chose flush-on-unmount over restore-on-remount (D1 rationale). Ticket allows either.
- Column-widths re-verify (repro-widening): column widths flow through `accumulatePanelUpdate` →
  `usePanelUpdatesFlush`, which lives in width-independent `PanelGrid` and is not affected by the shell
  swap; executor re-confirms via the existing HEL-304 tests plus a code audit, no new code expected.

## Open Questions

None.
