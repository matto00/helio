## Skeptic Report — design gate (round 1)

### What I verified (with evidence)

- Read `ticket.md`, `proposal.md`, `design.md`, `tasks.md`, and
  `specs/frontend-layout-persistence/spec.md` in full.
- Read `frontend/src/features/panels/hooks/useLayoutSave.ts` and
  `usePanelUpdatesFlush.ts` in full — confirmed the HEL-304 split the design
  describes is accurate: `useLayoutSave` stages layout in
  `latestLayoutRef`/`persistedLayoutRef`, registers `persistLayout` into the
  parent's `layoutFlushRef` slot on mount, clears it on unmount
  (`useLayoutSave.ts:92-97`); `usePanelUpdatesFlush` owns the width-independent
  30s interval/dashboard-switch/Save-now flush and only invokes the layout
  slot when populated (`usePanelUpdatesFlush.ts:94-99`).
- Read `PanelGrid.tsx` and `DesktopPanelGrid.tsx` — confirmed `DesktopPanelGrid`
  is the only caller of `useLayoutSave`, gated behind `isPhone` in `PanelGrid`
  (`PanelGrid.tsx:49-64`), matching the HEL-301 structural guarantee described
  in hazard §4.1 of `notes/mobile-pwa-handoff.md` (confirmed by reading that
  section directly, lines 138-164).
- Read `PanelGrid.test.tsx` in full (662 lines) — confirmed the existing
  HEL-301 xs byte-identity / no-layout-write-below-`sm` guards (lines 406-550)
  and the HEL-304 width-independent-flush guards (lines 553-661) that the new
  tests must sit beside and not disturb.
- Traced the actual render tree for where `dashboardId` changes originate:
  `frontend/src/features/panels/ui/PanelList.tsx:211` renders
  `<PanelGrid key={selectedDashboardId} dashboardId={selectedDashboardId} ... />`
  — the only call site of `<PanelGrid>` in the app (verified via
  `grep -rn "<PanelGrid" frontend/src`). This is ground truth the design
  document's own reasoning depends on (see Change Request 1 below).
- Worked through the equality/in-flight guard logic in `persistLayout`
  (`useLayoutSave.ts:64-90`) against the design's D2/D3/risk sections for the
  rapid-repeated-crossing and dashboard-switch scenarios, and against
  `updateDashboardLayout.fulfilled` in `dashboardsSlice.ts:242-247` (confirmed
  `hasPendingLayout`/`dashboard.layout` update via the Redux extraReducer
  independent of the dispatching component's mount state, so a PATCH that
  resolves after the flushing instance unmounts is still applied correctly).

### Verdict: REFUTE

### Change Requests

1. **`design.md` D2's stated rationale is contradicted by ground truth and
   must be corrected before the executor encodes it in permanent code
   comments (task 2.2).** D2 (lines 57-61) says: *"when `dashboardId` changes,
   `DesktopPanelGrid` itself does NOT remount (same component position), so
   the registration-effect cleanup path would fire `persistLayout` mid-lifecycle
   with a stale closure."* This is false for the current codebase:
   `PanelList.tsx:211` is the **only** place `<PanelGrid>` is rendered, and it
   is keyed by `key={selectedDashboardId}`. A dashboard switch therefore always
   forces React to fully unmount the old `PanelGrid`/`DesktopPanelGrid` subtree
   and mount a brand-new one — it is a true unmount, not a mid-lifecycle
   prop change. Consequences:
   - The design's justification for choosing "separate ref-based effect over
     piggybacking on the registration effect" (D2) rests on a scenario that
     doesn't occur in this codebase (dashboardId changing without a remount).
     Given the key-based remount, `persistLayout`'s deps (`[dashboardId,
     dispatch]`) never actually change within a single mounted instance, so
     the registration effect's cleanup would in practice *also* only ever run
     at real unmount — the "stale closure mid-lifecycle" risk the design
     warns about does not exist today.
   - This doesn't break the chosen mechanism (ref + empty-dep unmount effect
     still fires correctly at every real unmount, including dashboard switch
     and the phone-shrink crossing), but it means task 2.2 ("update
     `useLayoutSave`/`DesktopPanelGrid`/`usePanelUpdatesFlush` header comments
     to document... why it preserves the HEL-301 structural guarantee") would,
     if implemented from the design as written, bake an incorrect claim about
     React remount semantics into the load-bearing hazard comments this
     codebase relies on (see the existing "Do not add a call to
     `useLayoutSave`... without re-reading that hazard section first" comment
     in `DesktopPanelGrid.tsx:14-16`, and the extensive mount/unmount-based
     reasoning throughout `useLayoutSave.ts` and `usePanelUpdatesFlush.ts`).
     Given how much of the HEL-301/304/306 line of work depends on precise,
     comment-encoded reasoning about exactly when each hook mounts/unmounts,
     an inaccurate premise here is a real risk to future maintainers of this
     exact hazard area, not a cosmetic nit.
   - **Required revision:** correct D2 to state the accurate mechanism
     (`PanelGrid` is remounted wholesale via `key={selectedDashboardId}` in
     `PanelList.tsx`, so dashboard switch is a true unmount like the
     phone-shrink crossing) and re-derive the "why a dedicated ref-based
     effect" justification from that accurate premise (e.g., simplicity /
     not coupling flush timing to `persistLayout`'s dependency identity is
     still a fine reason to keep it separate — but say so honestly instead of
     citing a non-remount scenario that doesn't exist).

### Non-blocking notes

- `proposal.md`'s Impact section (lines 39-41) lists only
  `useLayoutSave.ts` and the test file as touched, but `tasks.md` task 2.2 and
  `design.md`'s note about updating comments also touch
  `DesktopPanelGrid.tsx` and `usePanelUpdatesFlush.ts` (header-comment-only
  edits). Minor omission in the Impact list; worth a one-line addition when
  the design doc is corrected, not blocking on its own.
- Everything else — the HEL-301 structural guarantee, the choice of
  flush-on-unmount over restore-on-remount (D1), the equality/in-flight guard
  reasoning for rapid crossings, and the test plan (D4) — checks out against
  ground truth and is sound once Change Request 1 is fixed.
