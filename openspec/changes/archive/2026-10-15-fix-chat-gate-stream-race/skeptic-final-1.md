## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD `e7e9e72726fd1f2ab864611497c99094180adc36`. The diff base was resolved live with `resolve-review-base.sh`: `60086f02bb5b1ee48f2246bc09e3e66349199585`. Spawn-cwd guard: `READY ambient=/home/matt/Development/helio branch=bug/chat-gate-stream-race/HEL-1597`.

### What I verified (with evidence)

- **Diff scope.** `git diff 60086f02b...HEAD` touches one backend file, `backend/src/test/.../ClaudeRoutesChatGateSpec.scala` (+7/-1), plus OpenSpec artifacts. There are no production or frontend changes. The streaming `check` now also drains the body (`responseAs[String] should include("event: authoring-result")`), and `before shouldBe 2` was added. The line-254 assertion `t.calls.get shouldBe before` is byte-identical (now at line 260).
- **Mechanism, from code.**
  - `DashboardAuthoringRoutes.gated` completes `TierErrorCompletion.completeTierError(err)` on `Left` and never evaluates `inner`.
  - The stream branch completes immediately with `HttpEntity.Chunked.fromData(sse, byteSource)`.
  - `DashboardAuthoringService.startStreaming` reaches `claudeClient.stream` → `transport.stream` only inside `Source.futureSource(assembleGroundedContext(...).map{...})`.
  - So the 200 status is available before the stream's own permitted transport call. Reading `status` alone does not order that call before `before`. `HelioRouteTest` sets a 15 s `RouteTestTimeout`, so the drain has a generous bound.
- **My own probe (unfixed base spec plus nanoTime instrumentation, no delay and 3 ms delay, 3 runs each, 6/6).** Every run printed `TSPROBE before=1 fin=1` with `streamEnter` still unset when the test finished. The stream request's transport call never lands within the unfixed test locally. It always lands after `before` is read. The test passes only because the call also lands after the final read (about 25–56 ms later).
  - The CI signature `2 was not equal to 1` is exactly before=1 with the late call landing inside that window.
  - It cannot come from a call on a 429'd request: before would have been 1 and the final value 2 only via the late stream call, and a leaked 429 call with the stream call already counted would give 2→3.
  - This independently confirms the root cause. It also confirms that 0/40 and 0/3 natural rates are expected on this desktop.
- **Executor's latch probe (evidence.md 1.3).** Read as a claim. It is consistent with my probe, and its forced interleaving reproduces the exact CI message. I did not re-run it, because my timing probe already grounds the same conclusion.
- **Fix forces happens-before.**
  - Fixed spec plus a 1500 ms sleep before the stream increment: 12/12 green, and the probe print came before the beta test result. This confirms the drain waits for the call.
  - Fixed spec without mutation: 2 consecutive `testOnly` runs, 12/12 each (`Tests: succeeded 12, failed 0`). `before shouldBe 2` held, so the drain deterministically orders the call.
- **Line-254 assertion is still failable.** I mutated production `gated` so that `Left(err) => { val _ = inner; completeTierError(err) }`, which makes a real Claude call on a 429'd request, and added `Thread.sleep(1500)` before the final read. Result: RED with `3 was not equal to 2 (ClaudeRoutesChatGateSpec.scala:261)`. Reverted.
- **Production-vs-test verdict.** It is a test race, not a production bug. That is supported by the `gated` code (no `inner` on `Left`) and by the before=1/fin=1 probe data.
- **Rates.** evidence.md records before 0/40 (single spec, 480 tests) and 0/3 (CI-shaped shard 3, 2119 tests each), and after 0/40 and 0/3, with executed-test counts. It honestly states that the natural race never reproduced, and that the discriminating evidence is the deterministic probes. The ticket's "if cannot be reproduced" clause is satisfied better than required, because the race was reproduced deterministically by forced interleaving.
- **Worktree left clean.** After every probe, `git status --short` showed only the evaluator's untracked `evaluation-1.md`.

### Verdict: CONFIRM

### Non-blocking notes

- **Pre-existing guard weakness, not caused by this change; follow-up recommended.**
  - With the same production mutation but WITHOUT the sleep, the spec went 12/12 GREEN. The leaked call is asynchronous (`service.author` returns a Future, and the transport call follows grounding DB work), so it lands after the final read.
  - The executor's D5(iii) made the leaked call synchronous (an Await) and so showed only the synchronous case. A realistic async regression in `gated` evades both the line-254 guard and the free-tier "zero transport calls" guards (spec:228/233/238), except by chance.
  - This is identical at base 60086f02b. The fix does not weaken it and in fact strengthens the guard (`before` is now a fixed 2). It is still worth a follow-up ticket: for example, a transport whose call on a denied request fails loudly, or a bounded quiescence wait before the zero/unchanged-count reads.
- evidence.md 1.4 says the call lands after `before` "on a slow runner". Locally it lands after `before` on every run. On a slow runner it lands after `before` but before the final read. The conclusion is unaffected.
