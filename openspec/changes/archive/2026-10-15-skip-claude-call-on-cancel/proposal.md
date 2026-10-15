## Why

`POST /api/authoring/dashboard?stream=true` returns 200 at once; grounding runs, and when it completes a Future callback
calls `ClaudeClient.stream`, whose production transport (`HttpClaudeTransport.stream`) sends the Anthropic request
eagerly on invocation. Nothing in that callback looks at the response stream, so a client that disconnected before
grounding finished still causes a billed Claude call nobody reads (HEL-1609, found while fixing HEL-1597).

## What Changes

- The streaming authoring paths (first turn and continued turn) start the Claude call only when the response stream is
  still live: the call is deferred to the stream's own materialization/demand, so a stream cancelled before grounding
  (or conversation load) completes never invokes the transport.
- A client that reads the stream gets exactly today's events and terminal result; one transport call.
- Charging is documented: the daily chat counter is charged at admission (before the 200), unchanged; the billed Claude
  call happens only once the live stream demands it.
- The buffered (non-stream) path, the tier/rate/budget gate and its ordering are unchanged.

## Non-goals

- Refunding the daily counter for an abandoned stream (a charging-policy change; not made here).
- Aborting an in-flight Claude call when the client disconnects mid-stream (after the call started).
- Any frontend change.

## Capabilities

### New Capabilities

### Modified Capabilities
- `nl-dashboard-proposal-authoring`: adds a requirement that a streaming request whose response stream was cancelled
  before the model call makes no model call, and states when a streaming request is charged.

## Impact

- `backend/.../services/proposals/DashboardAuthoringService.scala` (streaming paths only).
- Tests: `DashboardAuthoringServiceSpec` (and any route spec that counts transport calls after a stream request).
- No API, schema, migration or dependency change.
