# Evidence - HEL-1597

Worktree: /home/matt/Development/helio/.claude/worktrees/bug/chat-gate-stream-race/HEL-1597 (every sbt log below printed this path under .../HEL-1597/backend).
Common env for local runs: HELIO_TEST_JVM_XMX=2g HEL924_TEST_GROUP_CONCURRENCY=2 HEL924_TEST_GROUP_COUNT=4, all under nice -n 19; CI unset (local caps on). Stress runs add two 'nice -n 19 timeout 580 sh -c "while :; do :; done"' CPU burners (max 3-4 busy workers total).

## 1.1 CI failure (PR #1026, commit 7c3e29867, backend (3), job 115966051928, run 38596961437)
```
2026-10-14T16:23:06.1338095Z [info] - should be counted on the shared counter and get 429 with limit on the (limit+1)th call, across both routes *** FAILED ***
2026-10-14T16:23:06.1363668Z [info]   2 was not equal to 1 (ClaudeRoutesChatGateSpec.scala:254)
2026-10-14T16:28:09.3581998Z [info] Tests: succeeded 2216, failed 1, canceled 0, ignored 0, pending 0
2026-10-14T16:28:09.3657691Z [info] *** 1 TEST FAILED ***
2026-10-14T16:28:09.3748919Z [error] Failed tests:
2026-10-14T16:28:09.3806538Z [error] 	com.helio.api.routes.proposals.ClaudeRoutesChatGateSpec
```
Only that one test failed (2216 passed, 1 failed). Note the failing message is 'got 2, expected 1': before=1, final read=2.

## 1.2 Baseline (unfixed spec)
Single-spec: one sbt invocation with 40x 'testOnly com.helio.api.routes.proposals.ClaudeRoutesChatGateSpec' (testOnly is not cached across repeats; verified 12 tests executed each), with two CPU burners:
```
runs with 'Total number of tests run: 12': 40
'FAILED' lines: 0
'Tests: succeeded 12, failed 0': 40
```
Baseline natural failure rate: 0/40 single-spec (480 tests executed) - NOT reproduced naturally on this desktop.
CI-shaped shard runs (HELIO_TEST_SHARD_INDEX=3 HELIO_TEST_SHARD_COUNT=4 testFull; shard 3 contains the spec, 'ClaudeRoutesChatGateSpec:' appears in each log):
```
run a: [info] Tests: succeeded 2119, failed 0, canceled 0, ignored 0, pending 0 | [info] Suites: completed 156, aborted 0
run b: [info] Tests: succeeded 2119, failed 0, canceled 0, ignored 0, pending 0 | [info] Suites: completed 156, aborted 0
run c: [info] Tests: succeeded 2119, failed 0, canceled 0, ignored 0, pending 0 | [info] Suites: completed 156, aborted 0
```
Baseline shard rate: 0/3.

## 1.3 Latch probe (temporary, uncommitted; diff saved at /tmp/claude-1000/ev/latch_probe.diff, reproduced below)
Probe: LatchTransport extends CountingTransport; stream() blocks on a CountDownLatch BEFORE incrementing calls; the unfixed test releases the latch immediately after 'val before = t.calls.get' and waits on a 'done' latch (counted down right after the increment) just before the line-254 assertion.
Command: sbt -batch -J-Xmx3g "testOnly com.helio.api.routes.proposals.ClaudeRoutesChatGateSpec"
```
234:PROBE stream() entered on thread com-helio-api-routes-proposals-ClaudeRoutesChatGateSpec-pekko.actor.default-dispatcher-6, calls=1
235:PROBE stream() incremented on thread com-helio-api-routes-proposals-ClaudeRoutesChatGateSpec-pekko.actor.default-dispatcher-6, calls=2
236:[info] - should be counted on the shared counter and get 429 with limit on the (limit+1)th call, across both routes *** FAILED ***
237:[info]   2 was not equal to 1 (ClaudeRoutesChatGateSpec.scala:269)
262:[info] Total number of tests run: 12
264:[info] Tests: succeeded 11, failed 1, canceled 0, ignored 0, pending 0
265:[info] *** 1 TEST FAILED ***
```
RED, deterministic: '2 was not equal to 1' at the (shifted by probe lines) assertion t.calls.get shouldBe before - the exact CI message. The increment ran on the pekko default-dispatcher thread (the grounding Future callback), entered with calls=1 and incremented to calls=2 after 'before' was read. H1 CONFIRMED.
```diff
diff --git a/backend/src/test/scala/com/helio/api/routes/proposals/ClaudeRoutesChatGateSpec.scala b/backend/src/test/scala/com/helio/api/routes/proposals/ClaudeRoutesChatGateSpec.scala
index 599d15ec6..76cf762f9 100644
--- a/backend/src/test/scala/com/helio/api/routes/proposals/ClaudeRoutesChatGateSpec.scala
+++ b/backend/src/test/scala/com/helio/api/routes/proposals/ClaudeRoutesChatGateSpec.scala
@@ -152,6 +152,19 @@ class ClaudeRoutesChatGateSpec
     }
   }
 
+  private class LatchTransport(sendText: String, delayMs: Long = 0) extends CountingTransport(sendText) {
+    val gate = new java.util.concurrent.CountDownLatch(1)
+    val done = new java.util.concurrent.CountDownLatch(1)
+    override def stream(request: ClaudeApiRequest): Source[ClaudeStreamEvent, NotUsed] = {
+      println(s"PROBE stream() entered on thread ${Thread.currentThread.getName}, calls=${calls.get}")
+      gate.await()
+      if (delayMs > 0) Thread.sleep(delayMs)
+      val r = super.stream(request)
+      println(s"PROBE stream() incremented on thread ${Thread.currentThread.getName}, calls=${calls.get}")
+      done.countDown(); r
+    }
+  }
+
   private def client(t: ClaudeTransport): ClaudeClient =
     new ClaudeClient(ClaudeConfig("sk-ant-stub-never-used", "claude-test", 1.0, 4096, 100000), t)(routeEc)
 
@@ -241,7 +254,7 @@ class ClaudeRoutesChatGateSpec
 
   "beta tier" should {
     "be counted on the shared counter and get 429 with limit on the (limit+1)th call, across both routes" in {
-      val f = newUser("beta"); val t = new CountingTransport(authoringJson); val c = chat(2)
+      val f = newUser("beta"); val t = new LatchTransport(authoringJson); val c = chat(2)
       Post("/authoring/dashboard", jsonEntity(goal)) ~> routes(f, t, Some(c), c) ~> check { status shouldBe StatusCodes.OK }
       Post("/authoring/dashboard?stream=true", jsonEntity(goal)) ~> routes(f, t, Some(c), c) ~> check { status shouldBe StatusCodes.OK }
       usage(f) shouldBe Some(2)
@@ -249,8 +262,10 @@ class ClaudeRoutesChatGateSpec
       // day but 2026-01-01, so dropping the pin from the repo is caught immediately.
       await(db.run(sql"""SELECT usage_date::text FROM assistant_daily_usage WHERE user_id = ${f.user.id.value}::uuid""".as[String])) shouldBe Vector(pinnedDate.toString)
       val before = t.calls.get
+      t.gate.countDown()
       Post("/authoring/dashboard", jsonEntity(goal)) ~> routes(f, t, Some(c), c) ~> check { expectTier("CHAT_LIMIT_REACHED", StatusCodes.TooManyRequests, Some(2)) }
       Post("/refinements", jsonEntity(refineBody(f))) ~> routes(f, t, Some(c), c) ~> check { expectTier("CHAT_LIMIT_REACHED", StatusCodes.TooManyRequests, Some(2)) }
+      t.done.await(10, java.util.concurrent.TimeUnit.SECONDS)
       t.calls.get shouldBe before
       usage(f) shouldBe Some(2)
     }
```

## 1.4 Root-cause verdict
Root cause (test race, layer = test; NOT a production defect): the '?stream=true' request returns its 200 + SSE headers before its own permitted, charged Claude transport call (made on the grounding Future callback in DashboardAuthoringService.startStreaming); the test checked only 'status' and never drained the body, so on a slow runner the call lands after 'before' is read and is mis-attributed to the 429'd requests. No transport call occurs on a 429'd request (D5 iii proves the line-254 guard would detect one).

## 2. Fix (backend/src/test/scala/com/helio/api/routes/proposals/ClaudeRoutesChatGateSpec.scala)
```diff
diff --git a/backend/src/test/scala/com/helio/api/routes/proposals/ClaudeRoutesChatGateSpec.scala b/backend/src/test/scala/com/helio/api/routes/proposals/ClaudeRoutesChatGateSpec.scala
index 599d15ec6..3c2c414c0 100644
--- a/backend/src/test/scala/com/helio/api/routes/proposals/ClaudeRoutesChatGateSpec.scala
+++ b/backend/src/test/scala/com/helio/api/routes/proposals/ClaudeRoutesChatGateSpec.scala
@@ -243,12 +243,18 @@ class ClaudeRoutesChatGateSpec
     "be counted on the shared counter and get 429 with limit on the (limit+1)th call, across both routes" in {
       val f = newUser("beta"); val t = new CountingTransport(authoringJson); val c = chat(2)
       Post("/authoring/dashboard", jsonEntity(goal)) ~> routes(f, t, Some(c), c) ~> check { status shouldBe StatusCodes.OK }
-      Post("/authoring/dashboard?stream=true", jsonEntity(goal)) ~> routes(f, t, Some(c), c) ~> check { status shouldBe StatusCodes.OK }
+      // HEL-1597: `status` alone is read from the response headers, which complete BEFORE the stream's own
+      // (permitted, charged) transport call runs. Drain the body so that call has happened-before `before`.
+      Post("/authoring/dashboard?stream=true", jsonEntity(goal)) ~> routes(f, t, Some(c), c) ~> check {
+        status shouldBe StatusCodes.OK
+        responseAs[String] should include("event: authoring-result")
+      }
       usage(f) shouldBe Some(2)
       // Wiring guard (HEL-1473): the stored usage_date IS the pinned day. Fails on SystemClock on any
       // day but 2026-01-01, so dropping the pin from the repo is caught immediately.
       await(db.run(sql"""SELECT usage_date::text FROM assistant_daily_usage WHERE user_id = ${f.user.id.value}::uuid""".as[String])) shouldBe Vector(pinnedDate.toString)
       val before = t.calls.get
+      before shouldBe 2 // one buffered send + one stream, both permitted and now both observed
       Post("/authoring/dashboard", jsonEntity(goal)) ~> routes(f, t, Some(c), c) ~> check { expectTier("CHAT_LIMIT_REACHED", StatusCodes.TooManyRequests, Some(2)) }
       Post("/refinements", jsonEntity(refineBody(f))) ~> routes(f, t, Some(c), c) ~> check { expectTier("CHAT_LIMIT_REACHED", StatusCodes.TooManyRequests, Some(2)) }
       t.calls.get shouldBe before
```
D3 sweep: owner-tier test asserts no counts; free-tier stream test expects 0 calls on a 403 (no transport call can be in flight); the other beta tests do not use ?stream=true. No other change needed.

## 3. Verification (temporary mutations, all restored; git diff shows only the spec fix)
### D5(i) fix + 2000 ms delay before the stream increment (DelayTransport), drain in place -> GREEN
```
234:PROBE delayed stream() on com-helio-api-routes-proposals-ClaudeRoutesChatGateSpec-pekko.actor.default-dispatcher-6
261:[info] Total number of tests run: 12
263:[info] Tests: succeeded 12, failed 0, canceled 0, ignored 0, pending 0
```
### D5(ii) same delay, drain assertion removed (status only) -> RED at 'before shouldBe 2'
```
234:[info] - should be counted on the shared counter and get 429 with limit on the (limit+1)th call, across both routes *** FAILED ***
235:[info]   1 was not equal to 2 (ClaudeRoutesChatGateSpec.scala:262)
260:[info] Total number of tests run: 12
262:[info] Tests: succeeded 11, failed 1, canceled 0, ignored 0, pending 0
263:[info] *** 1 TEST FAILED ***
```
(Reported line 262 is 'before shouldBe 2' in the mutated file: grep confirmed 'before shouldBe 2' at 262.)
### D5(iii) production mutation in DashboardAuthoringRoutes.scala gated(): on Left, run service.author(...) synchronously, then still complete 429. Fix in place -> RED AT the line-254 assertion
```
232:[info] - should get 403 TIER_FORBIDDEN on buffered authoring, with zero transport calls *** FAILED ***
233:[info]   1 was not equal to 0 (ClaudeRoutesChatGateSpec.scala:228)
235:[info] - should get 403 on streaming authoring, with zero transport calls *** FAILED ***
236:[info]   1 was not equal to 0 (ClaudeRoutesChatGateSpec.scala:233)
242:[info] - should be counted on the shared counter and get 429 with limit on the (limit+1)th call, across both routes *** FAILED ***
243:[info]   3 was not equal to 2 (ClaudeRoutesChatGateSpec.scala:260)
269:[info] Total number of tests run: 12
271:[info] Tests: succeeded 9, failed 3, canceled 0, ignored 0, pending 0
272:[info] *** 3 TESTS FAILED ***
```
Line 260 in the fixed file is 't.calls.get shouldBe before' (unchanged assertion; was 254 before the +6 lines of fix): '3 was not equal to 2'. The free-tier zero-call tests also went red (1 was not equal to 0), a second witness. Mutation reverted (git status shows only the spec modified), then the green runs below.

### 3.4 After the fix, same conditions as 1.2
```
single-spec x40 w/ burners: runs with 12 tests: 40; FAILED lines: 0; 'succeeded 12, failed 0': 40
shard run a: [info] Tests: succeeded 2119, failed 0, canceled 0, ignored 0, pending 0 | [info] Suites: completed 156, aborted 0 | spec ran at log line 15599
shard run b: [info] Tests: succeeded 2119, failed 0, canceled 0, ignored 0, pending 0 | [info] Suites: completed 156, aborted 0 | spec ran at log line 15319
shard run c: [info] Tests: succeeded 2119, failed 0, canceled 0, ignored 0, pending 0 | [info] Suites: completed 156, aborted 0 | spec ran at log line 2217
```
After rate: 0/40 single-spec (480 tests), 0/3 shard runs. Baseline was also 0/N because the race does not occur naturally on this machine; the discriminating evidence is the deterministic latch/delay probes (red before, green after), see 1.3 and 3.1/3.2.
