## Why

Two e2e specs go red only when the CI runner's CPU is contended (HEL-1288, runs 37387266551 and 37384908643). A spec
that passes only on an idle machine hides either a timing assumption in the test or a real product race, and blocks
any future increase in e2e parallelism.

## What Changes

- `e2e/hel519-recent-navigation.spec.ts` ("visiting a source from its list records it under Recent"): fix the
  probe-confirmed root cause of the palette's Recent group being absent after a source visit under contention.
  Leading hypothesis (from the CI page snapshot): the test leaves `/sources/:id` (on `waitForURL`) before the detail
  route has committed, so no arrival was ever rendered and none was recorded. If the probe instead shows the route
  committed and the entry was still lost, the fix is in the product (recording/prune) with a red-without-fix unit test.
- `e2e/hel910-pipeline-to-dashboard-flow.spec.ts`: fix the probe-confirmed root cause of the 30s test-timeout.
  CI traces show no stalled step — every action progresses, and cumulative wall-clock crosses 30s on the final
  placement. The fix removes avoidable, unmeasured overhead (or a product slowness the probe identifies), not by
  simply raising the timeout.
- Evidence: contended failure rates before, ≥20 consecutive contended greens after, per spec.

## Capabilities

### New Capabilities

### Modified Capabilities

None expected. If the hel519 probe proves a product race in visit recording, `palette-recent-navigation` gains a
delta for the corrected behavior (see design.md D2).

## Non-goals

- Changing `playwright.config.ts`, `ci.yml`, worker counts, or sharding (HEL-1288).
- Auditing the seed-while-`/`-is-live class across other specs (HEL-1300).
- Quarantining either spec, loosening assertions, or raising the interaction ceiling in hel910.

## Impact

Two e2e spec files; possibly `frontend/src/features/commandPalette/**` (hel519) or the dashboard/pipeline UI (hel910)
if a product cause is confirmed, with a unit/RTL test.
