## Why

The panel-grid loading skeleton renders `.panel-grid-card` at desktop (`PanelCardSkeleton`) and phone
(`MobilePanelStackSkeleton`) widths, and since HEL-1584 it stays mounted (aria-hidden, inert) while it fades out next
to the real cards. A bare `.panel-grid-card` count, `.first()` or box read made right after a dashboard load can
therefore be satisfied by a skeleton stub instead of a real card. HEL-1633 fixed the same race for `.react-grid-item`
and left the `.panel-grid-card` reads as a follow-up (its sweep.md secondary grep). Separately,
`hel1028-layout-undo-redo-visual-revert.spec.ts:310` asserts a `.panel-grid-card__handle` count of 0 straight after
`goto`, which passes before anything has mounted, so it proves nothing.

## What Changes

- Re-run HEL-1633's secondary grep (`git grep -n "panel-grid-card" HEAD -- e2e`) on current main and give every hit a
  fixed-or-justified verdict with a line reference in a sweep record (`sweep.md` in this change).
- Convert each hit the skeleton can satisfy to wait for the real grid first, reusing `waitForPanelGrid` /
  `LIVE_GRID_ITEMS` (desktop) and `waitForPanelStack` / `LIVE_STACK_ITEMS` (phone) from `e2e/support/panelGridReady.ts`.
  No new duplicate helper.
- Make hel1028:310 wait for the mounted phone stack (`waitForPanelStack`) before asserting 0 handles / 0 grid items,
  and prove with a recorded red mutation that the assertion can now fail.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

None. Test-only change (e2e specs, possibly the e2e support helper); no product behavior changes, so `skip_specs: true`.

## Non-goals

- No product code, skeleton or `Crossfade` change.
- `e2e/hel1685-draft-polish.spec.ts` is owned by lane HEL-1711 and is not edited (it has no `.panel-grid-card` hit).
- `e2e/hel1681-refresh-control.spec.ts` is edited only at its two known hits (:332, :343), minimally, because lane
  HEL-1692 may be editing nearby phone specs.
- Not a general flake hunt: only `.panel-grid-card` hits and hel1028:310.

## Impact

`e2e/` specs only (plus `e2e/support/panelGridReady.ts` only if a doc-comment touch is needed). No backend, frontend,
schema or migration change.
