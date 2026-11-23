# HEL-1826: Flakes seen during HEL-1820: hel1791-compact-counter-stack-height:290, hel1582-mobile-pipeline-motion-and-states:244, hel1572-appearance-preferences:126

## Description

During HEL-1820 (2026-11-22), three e2e tests failed on runs whose code they don't depend on. None of them is on the
lanes' flake list:

* `e2e/hel1791-compact-counter-stack-height.spec.ts:290`: main run 44998353027 on f1ceb2f3c, job `e2e (4)`. HEL-1804
  (787a283e9) later changed the compact counter's live regions, so check whether it still reproduces.
  (Premise check: 787a283e9 is an ANCESTOR of f1ceb2f3c, so the failing run already contained HEL-1804; line 290 is
  HEL-1804's own test "owner: a status message and an alert message render in flow in the same live regions".)
* `e2e/hel1582-mobile-pipeline-motion-and-states.spec.ts:244`: the same run's `e2e (7)` rerun. (Line 244 is the
  `for (const size of SIZES.slice(0, 2))` loop around the test 'the "N fields" panel opens fully on screen, above the
  sheet, with a real filter hit area, on a 3-step pipeline with a 17-column source at <w>x<h>'.)
* `e2e/hel1572-appearance-preferences.spec.ts:126`: an earlier head of PR #1222, and also an older head of PR #1223.
  (Line 126 is "HEL-1572 type style > re-renders headings with no reload and survives a fresh browser context
  (another device)".)

The tree of f1ceb2f3c is identical to PR #1223's head, which passed all 8 e2e legs. The next three main runs were
green.

## Do

* For each test, pull the failing job's log and trace, and find the root cause by probe (systematic-debugging law).
  CPU throttling and injected main-thread stalls reproduced earlier timing flakes (HEL-1813, HEL-1814).
* Fix each test without weakening its assertion. If a cause turns out to be in the app, file it separately.
* Any test not fixed here goes on the lane flake list, with its title.

## Acceptance criteria

- [ ] Each test's root cause is stated with evidence.
- [ ] Each passes 20 times in a row locally (2 Playwright workers, `nice -n 19`), including under the stress that
  reproduced it.
- [ ] Each still fails under a mutation of the behaviour it guards.
