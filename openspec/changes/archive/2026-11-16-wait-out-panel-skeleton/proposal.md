## Why

e2e specs that count or measure `.react-grid-item` right after a dashboard load can match the loading skeleton's own
grid items, which also carry `.react-grid-item` and keep rendering (fading out) for a moment after the real grid
appears (HEL-1584 Crossfade). hel1572's Compact-gutter test flaked about 1 in 17 on this (HEL-1633). The sweep stops
the same race recurring in other specs.

## What Changes

- Add one shared e2e helper that waits until a dashboard's real panel grid is on screen and the loading skeleton has
  unmounted (positive real-content anchor first, then `getByLabel("Loading panels")` count 0).
- Use it in hel1572's density test after both `/dashboards` loads, in `hel1575-reload-after-edit.spec.ts` before its
  final count, and in every other spec the sweep finds where the skeleton can satisfy a `.react-grid-item` count or
  measurement right after a load.
- Record the sweep (grep command, full hit list, and a fixed-or-justified verdict per hit) as durable evidence.
- Prove hel1572 with `--repeat-each 30` under load (2 Playwright workers, `nice -n 19`), zero failures.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

None. Test-only change (e2e specs and an e2e support helper); no product behavior changes, so `skip_specs: true`.

## Non-goals

- HEL-1644 (hel1575 dashboard-tabs flakes at :593 and :627) is a separate ticket and is not fixed here. If the sweep
  happens to touch it, that is reported with evidence, not claimed.
- `hel1681-refresh-control.spec.ts:288` (mobile pull-to-refresh flake) is out of scope.
- No change to the skeleton, `Crossfade`, or any product code.
- `.panel-grid-card` counts (every skeleton stub renders that class, desktop and phone) are recorded by a secondary
  grep but only fixed in specs this change already touches; others are listed as a follow-up candidate.

## Impact

`e2e/` specs and one new file under `e2e/support/`. No backend, frontend, schema, or migration change.
