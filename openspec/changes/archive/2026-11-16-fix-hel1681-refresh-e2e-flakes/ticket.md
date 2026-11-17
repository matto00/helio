# HEL-1731: Flaky e2e: hel1681-refresh-control reads the first phone stack card before the loading skeleton is gone

## Description

origin_kind: followup
origin_ticket: HEL-1692

`e2e/hel1681-refresh-control.spec.ts:288` ("Full motion: after a pull-started round the settling indicator reads Refreshed, never Pull to refresh") failed on HEL-1692's PR #1132 CI (e2e shard 3) with `TypeError: Cannot read properties of null (reading 'x')`. The test reads `page.locator(".mobile-panel-stack__item").first().boundingBox()` without waiting for the stack, so it can run while the loading skeleton is still there. The HEL-1692 diff cannot affect this.

This is the same skeleton race HEL-1633 and HEL-1724 fixed in other specs. The HEL-1723 lane recorded these reads independently as out of scope (see its `sweep.md`, PR #1131).

## Scope

- Convert the bare first-card reads at hel1681-refresh-control.spec.ts:288/289 and :307 to wait with `waitForPanelStack` (`e2e/support/panelGridReady.ts`) before measuring.
- Fix the count-0 check at :330-331, which passes without testing anything, the same way.
- Fix the flake in :163 ("a second activation while a round is busy sends nothing"): after `refreshButton.tap()`, `aria-disabled` sometimes never becomes `"true"`. Find the root cause first; see the comment for the CI occurrences.

## Acceptance Criteria

- No bare `.mobile-panel-stack__item` measurement in that spec before `waitForPanelStack`.
- The count check can fail. Show this with a mutation.
- The spec is green in repeat runs at Playwright workers 2.

## Driver additions (owner's driver, binding for this run)

- Each fixed failure is shown red first under a forced repro (e.g. a delayed panels fetch or a stretched skeleton fade, as HEL-1633/HEL-1724 did; for :163/:128 a delayed refresh response), then `--repeat-each 20` green.
- Also in scope: the :128 flake ("keyboard: Enter on the focused button ...") expected 3 refresh requests and got 0 within 5 s (:154), seen on #1133. :163 seen on #1100 and #1132. Main CI failure: run 44014164481 on f3e1ec09c, e2e (3), at :288 (TypeError at :308).
- Driver hypothesis (UNVERIFIED): axios 1.20.0 -> 1.21.1 reads the XSRF cookie asynchronously via `window.cookieStore`, delaying every XHR; that may amplify a race in the busy-state/request-count polls. Find the actual root cause with a probe or trace. A real product race (e.g. the button not entering busy synchronously on tap) is a product fix: escalate if beyond a small, obvious change.
- Line numbers above are pre-HEL-1723 (merged 1d2fa5ab1); re-locate against current main.
