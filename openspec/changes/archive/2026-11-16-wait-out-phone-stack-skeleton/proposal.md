## Why

`hel1583-mobile-dashboard.spec.ts:156` (dark, 375px) failed on main (run 43925410610) with a card gap of -379.76.
The CI trace shows the cause: the geometry read returned SIX `.mobile-panel-stack__item` rects for a dashboard with
three panels - the three stub cards of the fading loading skeleton (`MobilePanelStackSkeleton`, inside
`.crossfade__skeleton--leaving`) plus the three real cards. The two Crossfade layers share one grid cell, so the
first real card sits on top of the first stub and the gap from stub 3 to real card 1 is negative. The spec's
readiness wait (first markdown body visible) is satisfied by the real stack while the skeleton is still fading.
HEL-1633 fixed the same race for desktop `.react-grid-item` reads only; the phone stack has no equivalent.

## What Changes

- Extend `e2e/support/panelGridReady.ts` with a phone-stack sibling of `waitForPanelGrid` (live-layer
  `.mobile-panel-stack__item` count reaches N, then `getByLabel("Loading panels")` reaches 0) and export the
  live-layer phone selector. `waitForPanelGrid` itself is unchanged.
- Use it in `hel1583-mobile-dashboard.spec.ts`'s `open()` helper so every test there measures only real cards.
- Sweep the other e2e specs that read `.mobile-panel-stack__item` right after a load; fix the ones the skeleton can
  satisfy, justify the rest with a line reference.
- Add a deterministic guard (stretched skeleton fade + delayed panels fetch) that is red against the old wait and
  green with the new one, and prove the HEL-1583 test 40/40 with `--repeat-each`.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

None. Test-only change (e2e specs and an e2e support helper); no product behavior changes, so `skip_specs: true`.

## Non-goals

- No change to `Crossfade`, `MobilePanelStackSkeleton`, or any product code: two layers coexisting during the fade is
  the HEL-1584 design, not a defect.
- `e2e/hel1575-dashboard-tabs.spec.ts` belongs to lane HEL-1644 and is not touched.
- No retries and no larger timeouts.

## Impact

`e2e/support/panelGridReady.ts` (additive), `e2e/hel1583-mobile-dashboard.spec.ts`, any sweep-confirmed specs, and
one new guard spec. No backend, frontend, schema or migration change.
