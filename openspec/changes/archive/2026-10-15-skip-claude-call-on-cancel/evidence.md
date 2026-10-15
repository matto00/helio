# Evidence — HEL-1609

Worktree: /home/matt/Development/helio/.claude/worktrees/bug/stream-authoring-cancel-before-call/HEL-1609

## 1.1 Call-path facts re-verified at 10d8626cc
`startStreaming` / `continueStreaming` in DashboardAuthoringService.scala wrap `Source.futureSource(<Future>.map { case Right => streamAttempt(...) })`;
`streamAttempt` calls `claudeClient.stream(...)` while building the Source, so the transport is invoked from the Future callback. No drift from design.md.

## RED (unfixed code, D3 barrier) — `nice -n 19 sbt "testOnly com.helio.services.proposals.DashboardAuthoringServiceSpec"`
```
[info] DashboardAuthoringService.authorStreaming cancellation (HEL-1609)
[info] - should make no transport call when the stream is cancelled before grounding completes (first turn) *** FAILED ***
[info]   1 was not equal to 0 (DashboardAuthoringServiceSpec.scala:836)
[info] - should make no transport call when the stream is cancelled before the conversation loads (continued turn) *** FAILED ***
[info]   1 was not equal to 0 (DashboardAuthoringServiceSpec.scala:861)
[info] - should still deliver the terminal Result ... (first turn, gated)       [pass, unfixed]
[info] - should still deliver the terminal Result ... (continued turn, gated)   [pass, unfixed]
[info] Tests: succeeded 26, failed 2 (28 run)
```

## GREEN after D1 (lazySource in startStreaming/continueStreaming)
`sbt "testOnly com.helio.services.proposals.DashboardAuthoringServiceSpec"`: Tests: succeeded 28, failed 0.
Wider: `testOnly com.helio.api.routes.proposals.* com.helio.services.proposals.*`: 156 run, 156 succeeded, 0 failed.

## D6 mutation proof (temporary, reverted)
- Eager `streamAttempt(Vector(userMessage), ...)` restored in startStreaming only: first-turn cancel test FAILED `1 was not equal to 0` (27 passed, 1 failed).
- Eager `streamAttempt(messages, Vector.empty, ...)` restored in continueStreaming only: continued-turn cancel test FAILED `1 was not equal to 0` (27 passed, 1 failed).
- Restored lazyStreamAttempt: all 28 green.

## D5
ClaudeRoutesChatGateSpec: new test "charge an admitted ?stream=true request at admission, without the body being read" (usage == Some(1) on status-only). Sweep: the existing beta/stream tests already drain the body (HEL-1597); the owner test asserts status only with no transport count, so unchanged. Route/telemetry specs green.

## Full gate
`cd backend && nice -n 19 sbt testFull` (worktree HEL-1609, exit 0): Total number of tests run: 8133; Tests: succeeded 8133, failed 0, canceled 4; [success] elapsed time: 774 s.
