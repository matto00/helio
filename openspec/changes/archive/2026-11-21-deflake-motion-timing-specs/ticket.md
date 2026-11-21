# HEL-1814: Flake: HEL-1573 motion timing specs (motion-primitives:275 segmented indicator, motion-grid-chart:104 chart entrance) fail on main

## Description

Two HEL-1573 motion specs that measure timing fail intermittently on main:

* `e2e/support/hel1573-motion-primitives.ts:275` > "HEL-1573 primitives under Motion = full, dark theme":
  `Error: segmented indicator transform transition` (Expected >= 1, Received 0, at line 209). Main run 44876631920
  (0fac82ce3), job 136762650040.
* `e2e/hel1573-motion-grid-chart.spec.ts:104` > "chart: the entrance runs about the standard token (not 1000ms) once
  per mount, and a refresh does not replay it": a `toBeLessThan` timing assertion (Received 616.2, Expected < 600, at
  line 257 -- the post-refresh `later` span check). Main run 44854332613 (3fa325155), job 136692847230.

Both have been on the lane briefs' flake lists for a while. With the 8-leg e2e (HEL-1793), each failure turns a main
run red.

## Do

* For each spec, find what the timing assertion measures and why it varies on CI hosts (HEL-1789's runner record
  gives each leg's CPU model).
* Rewrite each assertion to check the right thing without depending on wall-clock time where possible: the computed
  transition or animation properties, or a single completed transition. Keep any wall-clock bound generous and
  justified.
* Each spec must still fail on the pre-HEL-1573 behaviour (mutation).

## Acceptance criteria

- [ ] The root cause is stated for each spec.
- [ ] Each passes 20 times in a row locally (2 workers, `nice -n 19`).
- [ ] Each still fails under its mutation.

## Driver constraints (binding for this run)

- e2e only; no app code unless the root cause is in the app (escalate if that is a product change).
- Avoid sibling lanes' files: HEL-1796 (backend patch-set undo), HEL-1808 (hel1683 regex long-task probe e2e).
- No live model call: any lane backend starts with ANTHROPIC_API_KEY exported empty.
