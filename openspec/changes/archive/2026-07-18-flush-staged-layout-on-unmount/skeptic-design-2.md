## Skeptic Report — design gate (round 2)

### What I verified (with evidence)

- Read `ticket.md`, `proposal.md`, `design.md`, `tasks.md`,
  `specs/frontend-layout-persistence/spec.md`, and the prior
  `skeptic-design-1.md` in full.
- **Change Request 1 (prior round) verification** — confirmed the false remount
  claim is fixed:
  - `design.md` D2 (lines 60-66) now states: *"`PanelList.tsx:211` is the only
    `<PanelGrid>` call site and it is keyed by `key={selectedDashboardId}`, so a
    dashboard switch fully unmounts the old `PanelGrid`/`DesktopPanelGrid`
    subtree and mounts a fresh one — a true unmount, exactly like the
    phone-shrink crossing. In practice `persistLayout`'s deps therefore never
    change within a single mounted instance; the ref-based unmount effect is
    chosen for simplicity and decoupling from dependency identity, not because
    a mid-lifecycle dep-change flush path exists today."* This matches ground
    truth exactly.
  - Re-verified ground truth directly:
    `frontend/src/features/panels/ui/PanelList.tsx:211-212` renders
    `<PanelGrid key={selectedDashboardId} dashboardId={selectedDashboardId} ...>`,
    and `grep -rn "<PanelGrid" frontend/src` confirms it is still the only
    non-test call site.
  - The rationale for D2's chosen mechanism (dedicated ref-based unmount effect
    vs. piggybacking on the registration effect) is now honestly grounded in
    "simplicity / decoupling from dependency identity" rather than the false
    "stale closure mid-lifecycle" scenario. This is no longer at risk of being
    baked into permanent hazard comments via task 2.2.
  - `proposal.md`'s Impact section (lines 39-41) now lists
    `DesktopPanelGrid.tsx` and `usePanelUpdatesFlush.ts` alongside
    `useLayoutSave.ts` and the test file, addressing the round-1 non-blocking
    note about the incomplete Impact list.
- Re-read `useLayoutSave.ts`, `usePanelUpdatesFlush.ts`, `PanelGrid.tsx`, and
  `DesktopPanelGrid.tsx` in full (current, pre-fix state, as expected at design
  gate) and confirmed the HEL-304 split and HEL-301 structural guarantee
  described in the design still match: `useLayoutSave` is called only from
  `DesktopPanelGrid` (`DesktopPanelGrid.tsx:106-110`); `usePanelUpdatesFlush`
  owns the width-independent flush and holds a `layoutFlushRef` slot invoked
  only when populated (`usePanelUpdatesFlush.ts:76-99`); `PanelGrid.tsx:49-64`
  branches `isPhone` to conditionally mount `DesktopPanelGrid` vs.
  `MobilePanelStack` — the conditional-render swap is itself a true unmount of
  whichever branch is not selected, independent of the `key`-based dashboard-
  switch unmount, and the design's claim that the unmount effect "covers both
  unmount causes ... with the same mechanism" (D2, line 66) holds for both.
- Re-read hazard §4.1 of `notes/mobile-pwa-handoff.md` (lines 138-164) directly
  — the design's citations of it (structurally-incapable-of-persisting-layout
  requirement, `xs` as a real stored layout) are accurate paraphrases.
- Re-read `PanelGrid.test.tsx` lines 390-660 — confirmed the existing HEL-301
  structural guards (lines 406-550, including the "zero layout PATCH on a pure
  resize across the boundary" test at 524-549) and HEL-304 width-independent
  flush guards (lines 553-660) that D4 requires to keep passing unmodified;
  none of them depend on the corrected/incorrect D2 rationale, so the fix
  described is still test-compatible.
- Worked through the rapid-repeated-crossing race by hand against
  `persistLayout`'s equality guard (`useLayoutSave.ts:64-90`) and the
  `resolvedLayout` re-seed effect (`useLayoutSave.ts:50-62`): on remount, a
  fresh `DesktopPanelGrid`/`useLayoutSave` instance initializes both
  `latestLayoutRef` and `persistedLayoutRef` from the same `resolvedLayout`
  value, so a second unmount with no intervening drag is a guaranteed no-op
  (equal refs) — the design's "Double PATCH on rapid crossings" risk
  entry is not just plausible but demonstrably correct given the current
  equality-guard implementation.
- Confirmed the spec delta's three scenarios (shrink-mid-edit flush,
  browse-only no-op, rapid-crossing exactly-once) map 1:1 onto `design.md`
  D4's test plan and `tasks.md` section 3, with no gaps against the ticket's
  three acceptance criteria.

### Verdict: CONFIRM

Change Request 1 from round 1 is fully and correctly addressed — D2 now states
the accurate remount mechanism (`key`-based wholesale remount on dashboard
switch, verified against `PanelList.tsx:211`) and re-derives its rationale
honestly from that premise instead of a false mid-lifecycle-dep-change claim.
The round-1 non-blocking Impact-list note was also folded in. Re-verification
of the rest of the design (D1 flush-on-unmount choice, D3 dispatch-order
independence from the flush slot, the rapid-crossing equality-guard reasoning,
and the test plan) against current ground truth in `useLayoutSave.ts`,
`usePanelUpdatesFlush.ts`, `PanelGrid.tsx`, `DesktopPanelGrid.tsx`, and
`PanelGrid.test.tsx` turned up no new contradictions, ambiguities, or gaps
against the HEL-301 mobile-never-PATCHes-layout constraint or the ticket's
acceptance criteria. Sound enough to implement.

### Non-blocking notes

- The design implies (but does not spell out in D2's prose) the standard
  "update the ref on every render" companion effect needed to keep
  `persistLayoutRef.current` current (analogous to the existing
  `pendingPanelUpdatesRef` pattern in `usePanelUpdatesFlush.ts:71-74`). This is
  a reasonable level of detail to leave to the executor given the codebase
  already has this exact pattern to copy, but worth the executor double-
  checking the ref is updated unconditionally every render (no dep array),
  not only on `persistLayout` identity change, to actually decouple from
  dependency identity as D2 intends.
