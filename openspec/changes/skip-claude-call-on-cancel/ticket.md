# HEL-1609: Streamed authoring makes a billed Claude call even if the client disconnects before reading the body

## Description

Origin: HEL-1597 (PR matto00/helio#1033), lane-reported. This predates that change.

`POST /api/authoring/dashboard?stream=true` answers 200 immediately. `DashboardAuthoringService.startStreaming` then
runs grounding and calls `HttpClaudeTransport.stream` in a later callback, so the Claude request is sent even if the
client has already disconnected and will never read the stream. Each abandoned request is still charged.

Do:

* Confirm against the code: the call path and whether pekko-http exposes client-disconnect or stream cancellation to
  that callback.
* Decide the fix: cancel or skip the transport call when the response stream is cancelled, or defer the call until the
  first downstream demand.
* Prove it with a test where the client cancels before grounding finishes and the transport sees 0 calls. It must fail
  first on the current code.
* Keep the existing tier and rate gates intact.

Verify all claims against the code first.

## Acceptance Criteria

- AC1: The Claude transport call MUST NOT happen when the response stream was cancelled before the call.
- AC2: A deterministic test (no sleeps) where the client cancels before grounding completes asserts the transport saw
  0 calls. Red on the current code (recorded), green after.
- AC3: A test proves a client that DOES read the stream still gets the terminal result (and the transport is called
  exactly once).
- AC4: The existing tier, rate and daily-budget gates (`ChatAccessService.guardAndCount`) and their charging semantics
  stay intact; document exactly when a request is charged (daily counter) and when a billed Claude call is made.
- AC5: The non-stream (buffered) path is unchanged.
- Backend only, no UI. No real Anthropic API calls in tests.
