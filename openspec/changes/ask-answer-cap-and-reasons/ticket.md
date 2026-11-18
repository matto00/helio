# HEL-1761: Ask-your-data: answer max_tokens shares its 1024 cap with adaptive thinking (502 risk), 422 reasons echo uncited numerals, pin rootId fallback untested

## Description

origin_kind: followup
origin_ticket: HEL-1745 (PR matto00/helio#1159, merged as c03fc0a4a)

The final skeptic on HEL-1745 found three gaps. None blocked the merge.

1. **Token cap shared with thinking.** The answer hop's `max_tokens` is 1024, and adaptive thinking spends from the same cap. With real traffic, a long reasoning hop can stop at `max_tokens` before it writes an answer, and that surfaces as a 502. Measure how often it happens. Then size the cap or handle `stop_reason: max_tokens` cleanly, with one bounded retry or a clear 422/503. Show a `max_tokens` stop on a fake transport failing first.
2. **422 reasons echo numerals.** `422 ASK_UNGROUNDED` reasons can repeat numerals that were not cited. Strip numbers from the reasons, or drop the reasons from the response body. Show it failing first.
3. **Untested pin fallback.** The pin `rootId` fallback for rows written before V98 has no test. Add one that fails first.

There is no live check unless (1) needs one to measure. If it does, use Haiku only and ask the owner for a cap first.

## Acceptance Criteria

- AC1: A fake-transport test where an ask hop returns `stop_reason: max_tokens` with only a thinking block is recorded red against the current code (502 / BadGateway), then green with a clean outcome (not 502).
- AC2: A max_tokens stop with partial visible text is never returned as an answer.
- AC3: The answer hop cap is sized for adaptive thinking (no longer 1024), with the sizing rationale and the measurement position stated (no live call made).
- AC4: The `422 ASK_UNGROUNDED` response body carries no digit from the rejected answer; a test is recorded red first.
- AC5: A test for the pin `rootId` fallback (Output with no step and no root id) exists, distinguishable from the real `node.rootId` path, recorded red under a mutation.

## Driver context (claims, verified in premise-validation.md)

- No live model calls are pre-approved. Use fakes.
- No Flyway migration expected.
