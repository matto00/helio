## Why

`ClaudeRoutesChatGateSpec`'s zero-call guards (HEL-1205's "a denied request never reaches Claude") read the stub
transport's counter immediately after the 403/429 response. A regression that evaluates the service on a denied request
makes its Claude call only after grounding DB work, i.e. after the response, so the guard reads 0 and passes. HEL-1597's
final skeptic showed this: the async-leak mutation passes 12/12 unless the test sleeps ~1.5 s. The guard protects a
billing/abuse guarantee, so it must be able to fail.

## What Changes

- Add a test-only quiescence point to the spec: the Claude-reaching service stack (authoring, refinement, their
  grounding services, repos and `ClaudeClient`) runs on a tracked ExecutionContext over a tracked `DbContext`, so the
  test can wait (latch, bounded timeout, no sleep) until every in-flight hop of that stack has finished.
- Every zero-call / count-unchanged guard awaits quiescence before reading the transport count.
- An in-suite positive control proving the quiescence point waits for an un-awaited async Claude call.
- Red/green proof with the HEL-1597 skeptic's async-leak mutation (temporary, reverted), recorded in `evidence.md`.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

None - test-only change; no spec-level behavior changes (`skip_specs: true`).

## Non-goals

- Any production code change (gate logic, `DashboardAuthoringService`, `ClaudeClient`, transports).
- Leaks that bypass the service stack entirely (e.g. a new, separately constructed client on an untracked executor).
- A leak that materializes a denied response stream (Claude call on Pekko's stream actor, untracked); stated as a
  limitation in the PR body.
- Other specs; the frontend.

## Impact

- `backend/src/test/scala/com/helio/api/routes/proposals/ClaudeRoutesChatGateSpec.scala` (plus, optionally, a small
  test-only helper beside it if it keeps the spec readable).
