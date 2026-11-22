# HEL-1807: Client draft regex: keep anchored patterns (^(.*)$) client-side via a measured ^-anchor refinement of the cost model

## Description

Follow-up of HEL-1697 (PR #1204, merged as 98b8c40e9). The owner chose to file this.

HEL-1697's regex cost model (decline reason `regexInputCost`, `REGEX_WORK_BUDGET` 4.00e6) charges a pattern as if it could start matching at every position. An anchored pattern like `^(.*)$` can only start once, but it is still sent to the server draft preview from about 45-60 characters per cell, the same point as `(.*)x`.

## Do

- Measure the real cost of `^`-anchored patterns. Include multiline mode and alternatives that are only partly anchored.
- If the measurements support it, charge anchored patterns less, so they stay client-side.
- Keep HEL-1697's rules: every case is backed by a recorded calibration, the e2e long-task check stays under 100 ms, and the parity corpus is unchanged.

## Acceptance criteria

- [ ] Calibration tables for anchored shapes are committed.
- [ ] A test fails first: `^(.*)$` on a 1,000-row frame of 500-character cells is evaluated client-side.
- [ ] Every adversarial shape that HEL-1697 listed still stays within the budget.

## Driver context (binding rules carried from HEL-1697)

- Every change backed by recorded calibration tables; the e2e no-main-thread-task-over-100 ms check holds; the HEL-1683 parity corpus (`shared-test-fixtures/pipeline-step-parity/`) is unchanged.
- Owner ruling C2 from HEL-1697: a constant-factor V8 slowdown under 50 ms per draft is accepted risk; over 50 ms blocks.
- Frontend only; no migration. Avoid HEL-1803 (backend ClaudeClient) and HEL-1806 (e2e contrast guard) files.
