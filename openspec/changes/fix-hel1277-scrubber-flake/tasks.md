## Standing Constraints

- [C1] Call the D0.3 red a forced repro of the mechanism, never a reproduction of the CI failure, unless the CI trace shows a 4th auto-run point

## 1. Probe

- [x] 1.1 Fetch PR #1129's failing Playwright artifact/trace (or record that it expired); note point trigger sources
- [x] 1.2 Read the history thinning/retention code; state whether it can add a point (UTC-boundary theory)
- [x] 1.3 Forced repro (uncommitted): poll <=50 s for a 4th point after run 3, log its triggerSource, show the slider red

## 2. Tests

- [x] 2.1 Add `cancelPendingAutoRun(pipelineId, userId)` to historySeed.ts: SET LOCAL user, DELETE ... RETURNING, assert one
- [x] 2.2 Call it after every putRows in both tests of hel1277-output-history-scrubber.spec.ts
- [x] 2.3 Re-run the 50 s forced-wait variant: green (no 4th point); then revert the variant
- [x] 2.4 Run the spec --repeat-each=20 --workers=2, no retries: 40/40 per test; record evidence
- [x] 2.5 Delete any dev-DB residue this lane created, by exact id
