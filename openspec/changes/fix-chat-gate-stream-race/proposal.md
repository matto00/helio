## Why

`ClaudeRoutesChatGateSpec` "beta tier ... across both routes" failed once in CI (backend shard 3, 7c3e29867) with
`t.calls.get shouldBe before` = 2 vs 1. A flaky gate test erodes trust in the HEL-1205 chat-cap guarantee ("a 429'd
request never reaches Claude") and costs reruns on unrelated PRs.

Leading hypothesis (to be probe-confirmed before any fix): the `?stream=true` request completes with SSE headers before its
own Claude transport call is made. `DashboardAuthoringService.startStreaming` calls `streamAttempt` (and so
`transport.stream`) inside an eager `Future.map` on grounding assembly, while the test checks only `status` and never drains
the body. On a slow runner the permitted streaming request's transport call lands after `before` is read, so a call that
belongs to an allowed, charged request is mis-attributed to the 429'd ones.

## What Changes

- Probe-confirm the root cause; measure the failure rate before the fix under CI-like conditions.
- Fix the test so the streaming request's transport call happens-before `before` is read (drain the SSE body and assert
  its content), and make the expected pre-429 count explicit. The line-254 assertion stays exactly as strict.
- Measure the failure rate after the fix.
- If the probe instead shows a production defect (a transport call on a denied request), fix that as a bug instead.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

None - test-reliability fix only; no spec-level behavior changes (`skip_specs: true`), unless the probe finds a production
defect, in which case the plan is revised.

## Non-goals

- Changing when the real `HttpClaudeTransport.stream` fires its request (eager on grounding completion). Noted, not changed.
- Relaxing or removing any assertion; retry/rerun-on-failure mechanisms.
- Other specs or the frontend.

## Impact

- `backend/src/test/scala/com/helio/api/routes/proposals/ClaudeRoutesChatGateSpec.scala` only (expected).
