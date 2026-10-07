## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed tree: HEAD 575a58b1f537cc4e79013b196afaf1d1ade020fd (no executor commits yet). Spawn-cwd guard: `READY ambient=/home/matt/Development/helio branch=task/hel1341-spec-leftovers/HEL-1357`.

### What I verified (with evidence)

**Item 1: helper rename (D1)**
- `backend/src/test/scala/com/helio/testsupport/AcceptRecordingListener.scala:42-49`: `assertNothingAcceptedBeforeSentinel()` opens a sentinel `Socket`, runs `awaitCondition(5 s)(accepted.contains(sentinelPort))`, discards the Boolean, and returns `(acceptedPorts, sentinelPort)`. It asserts nothing. The scaladoc at :41 says "true iff ...", which is wrong for a tuple return. The second reference is at :13 ("Negative observation" bullet). D1 names both.
- Callers (grep across the repo): there are exactly 4, at SqlEgressSocketFactoriesSpec:30, SqlConnectorConfigShapeSpec:63, and SqlConnectorRebindingSpec:49 and :84. Each one is immediately followed by `accepted shouldBe List(sentinelPort)`. The design's description of the call shape is accurate.
- Rename vs. assert: I agree with the rename. The callers already make the exact assertion, and ScalaTest `shouldBe` gives a better failure diff at the call site. The helper is not a Suite, so an assert inside it would need a hand-rolled throw. The "discarded Boolean is not a hole" argument holds: if the sentinel is not accepted within 5 s, the returned list lacks `sentinelPort`, and `List(...) shouldBe List(sentinelPort)` fails. That includes the empty list. The rename is behaviour-preserving by construction because the body and signature are unchanged.
- Guard-is-failable mutation: this is meaningful. `new Socket(addr, port)` connects synchronously, so a stray opened before the barrier is in the kernel backlog ahead of the sentinel. The single acceptor drains in order, so the returned list is `[stray, sentinel]` and the caller's `shouldBe List(sentinelPort)` goes red. That directly tests the load-bearing claim: the caller's assertion, not the helper, is what catches a stray. The design labels it correctly as a guard check, not a fix. The AC's "red run" requirement only applies to the assert option, so this check is extra rigor rather than a requirement.

**Item 2: test rename (D2)**
- `DatasetWriteAutoRunEndToEndSpec.scala:279-311`: the test polls `pollUntil(scheduler, 10.seconds)(runCount >= 1)` on the real `SystemClock`, then asserts `runCount(pid) shouldBe 1`. It prints elapsed time only when `HELIO_MEASURE=1`. The orchestrator's premise note is accurate. The proposed name "fire a debounced auto-run through the real system clock, creating exactly one run" renders as "... should fire a debounced auto-run ...", which is grammatical and matches what the test asserts.
- Grep for the old name: it appears only in the test itself, in archived evaluation/skeptic reports, and in the archived evidence log `row1-auto-run-latency.txt`, which is a historical record. No CI filter or script references it. The design's claim holds.

**Item 3: inventory (D3)**
- `PipelineShapeService.scala:51-57`: `expand` returns `Future.successful { ... }` (eager), so the future is already complete when `whenReady` reads it and the 150 ms default patience never comes into play. `PipelineShapeServiceSpec.scala:29, :35, :45` are the three `whenReady` sites, the class mixes in `ScalaFutures` with no patience override, and the lines match D3. Classifying it as harmless (effect `-`, Leave) is correct.
- `SparkJobSubmitterSpec.scala:343-352`: `awaitRunPersisted` is `eventually(timeout(Span(30000, Millis)), interval(Span(50, Millis)))`, polling for a terminal run row AND a defined `lastRunStatus`. It checks that the value is defined, not what it is, so the test's own assertions still catch a wrong value. It is a bounded state wait, so "F only past 30 s, Leave (rows 12-15 class)" is correct. The line number 345 matches.
- Completeness of the whenReady claim: `grep -rn whenReady backend/src/test` hits only PipelineShapeServiceSpec, and `grep -rln ScalaFutures` returns only that file. That also rules out any `futureValue` default-patience waits. The "only whenReady on the default" sentence is true on the live tree.
- On the live tree, no `eventually` remains on default patience. OutputRoutesSpec:769 now passes an explicit timeout, and the other `eventually` users either override `patienceConfig` to 2 s (AssistantTelemetrySpec, AuthoringTelemetrySpec) or pass a timeout.
- Editing the archived design.md: `scripts/check-openspec-hygiene.mjs` only flags stray files and leftover `files-modified.md` in archive dirs, not content edits. Labelling the additions as HEL-1357 is the right approach.

**Coverage and scope**
- AC1 is covered by tasks 1.1 and 3.2, AC2 by 1.2, and AC3 by 2.1. Each task has a concrete acceptance signal: a zero-hit grep, a name-only diff, or saved transcripts. No production code is touched, and nothing goes beyond the ticket. There are no API or schema changes, so no contract delta is needed.
- I found no placeholders, TODOs, or contradictions between the proposal, design, and tasks.

### Verdict: CONFIRM

### Non-blocking notes
- D3 sentence correction: the archive's header pins the tree at 469f4ea93, where row 8a was still on default patience. On the live tree (575a58b1f) row 8a has been fixed and zero default-patience `eventually` calls remain. When rewriting line 38, state which snapshot each half refers to (e.g. "at 469f4ea93 the only `eventually` ... was row 8a; at 575a58b1f (HEL-1357) the only default-patience `whenReady`/ScalaFutures use is PipelineShapeServiceSpec, which never waits"). That way the archive does not mix two trees in one unlabelled sentence.
- Task 3.2: run the mutation against the post-rename code, in the cheapest caller (SqlEgressSocketFactoriesSpec, which needs no embedded Postgres). Make sure the stray socket is fully constructed (connected) before the helper call. Save the red and green transcripts under the change dir.
- Optional: SparkJobSubmitterSpec also has `Await.result(..., 30.seconds)` (:165, :337). The ticket doesn't require it, but a one-word mention in the new row ("plus 30 s bounded Awaits, same class") would make that file's classification complete.
