## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD: ffc5e1df78916cd78d3f7a7d6a58707e6644a158. Base resolved live with `resolve-review-base.sh`: 77f46a5df981ea34efa10bae0c1fd8a50f1ceb05 (exit 0).

### What I verified (with evidence)

**Diff (read in full, `git diff 77f46a5df...HEAD -- backend/`).** One new main file, `RunResponseMarshalling.scala`. It walks the response `JsValue` with an explicit stack, so deep nesting cannot overflow it. Every key and scalar goes through spray's `CompactPrinter`. Pieces flush only at value boundaries, and `Source.fromIterator` produces them lazily. Three routes change one line each, from `Status -> value` to `RunResponseMarshalling.chunkedJson(Status, value)`: `PipelineRunSubmitRoutes.scala:29`, `PipelineProposalRoutes.scala:40` and `CombinedProposalRoutes.scala:40`. Error paths, status codes and response fields are unchanged.

**C1 (one shared streaming-marshaller definition): honored.** `RunPathHeapSpec.buildResponse` in `stream` mode calls `RunResponseMarshalling.chunkedJson`, the same object the three routes call. There is no second copy.

**C2 (no cap, drop or rename; body byte-identical to spray compact JSON): honored.**
- The code has no row cap and no field change.
- G1 (`RunResponseMarshallingSpec`) compares streamed output with `compactPrint` over adversarial strings (lone and reversed surrogates, all control characters), big decimals, empty containers and nested shapes, at piece sizes 1, 7, 64 and 65536.
- Live check: I ran a dry run against the running backend (port 10032) and through the Vite proxy (port 7125). Both returned `HTTP/1.1 200`, `Transfer-Encoding: chunked`, `Content-Type: application/json` and no `Content-Length`. The body parsed, and it equals Python's compact re-dump (`compact True`). Its keys were `blocked, rowCount, rows, runId, sourceRowCount, sourceTruncated, stepRowCounts, truncatedReads`.

**AC1 (red-first bounded heap measurement on both reproducers, peak <= 192 MB after).** I re-measured both myself, one probe at a time under the sbt lock. Settings: `taskset -c 0`, `nice -n 19`, `HELIO_TEST_JVM_XMX=768m` (`maxMemory MB: 742`), `HELIO_RUN_HEAP_REPEATS=2`, `HELIO_RUN_HEAP_ONLY=fewrows-utf16-200,rowwidth-at-limit`.

Red (`HELIO_RUN_HEAP_RENDER=spray`, the pre-fix marshalling), exit 1, `*** 1 TEST FAILED ***`:
```
fewrows-utf16-200  real 233.5, 500.9   dry 147.0, 199.9   (body 53 MB)
rowwidth-at-limit  real 134.1, 129.6   dry  85.7,  63.3   (body 16 MB)
max over shapes MB: 500.9 (bound 192.0)
```
Green (`stream`, the shipped definition), exit 0, `Tests: succeeded 1, failed 0`:
```
fewrows-utf16-200  real 105.4, 107.2   dry 95.7, 95.1
rowwidth-at-limit  real 138.1, 143.7   dry 52.9, 99.6
max over shapes MB: 143.7 (bound 192.0)
```
These reproduce `measurements.md` within the run-to-run swing it already discloses.

The AC is met as written. The measurement was taken red-first on both reproducers, and both peak at or under 192 MB after the fix. The fix is proven by `fewrows-utf16-200`: it goes from up to 500.9 MB to 107.2 MB.

**Premise finding (`rowwidth-at-limit` is never over 192 MB red-first).** I confirm it independently: 134.1 and 129.6 MB with spray, close to its own no-render walk peak. The ticket's claim that both reproducers spike was half wrong. This does not invalidate the AC or the fix. The design's stop condition ("escalate if neither exceeds") was correctly not triggered, because one did. It needs a disclosure in the PR body, not an owner ruling.

**AC2 (mutation-checked guard).**
- G3: my own spray run is that mutation (the definition swapped back to spray), and it is red at 500.9 MB.
- G1 and G2: I did not re-mutate them, because the gate is read-only for me. `measurements.md` records the red output for G1 (dropped comma, unescaped keys) and for G2 (each of the three routes reverted, failing with `List() was empty` at the cited line). Those mutations are plausible: Pekko testkit `chunks` is empty for a strict entity.

**AC3 (consumers unchanged).** The body is byte-identical (G1, G2, and my live check), so consumers are unchanged by construction.
- The frontend `runPipeline` (`pipelineService.ts:253`) uses axios, which handles chunked bodies.
- The live check through the Vite proxy succeeded.
- The evaluator ran root jest including helio-mcp handlers: 524 tests. I did not re-run it.

**HEL-1660 and HEL-1679 guards stay green.** I ran this targeted `testOnly`: RunResponseMarshallingSpec, RunResponseChunkedRoutesSpec, PipelineApplyProposalSpec, CombinedApplyProposalSpec, RunLimitsGuardSpec, RunLimitsSpec, JsonTextLengthSpec, NodeSnapshotBatchedWriteSpec, PipelineRunLimitsServiceSpec and InProcessPipelineEngineRunRetentionSpec. Result: `Tests: succeeded 82, failed 0`, exit 0, with every spec name present in the log. The evaluator's full `sbt testFull` (9414 passed) is consistent with this.

**UI.** There is no `frontend/**` change, so the design-judgment step does not apply.

### Judgment: the Cloud Run 32 MiB note

The claim is plausible but I could not verify it here: no network access to Cloud Run docs, and no prod probe. As I recall, Cloud Run documents the 32 MiB limit for non-streamed HTTP/1 responses and exempts streamed (chunked) responses.

If it is true, the effect is this. A manual run (or apply) whose body exceeds 32 MiB now returns 200 with the full body, where before the client got an infrastructure error. That error came after the server had already finished, and for a real run, persisted the run.

I judge this acceptable and not an escalation:
1. The JSON contract is unchanged.
2. The old outcome was a failure report for a run that had succeeded, which is a defect, not a contract.
3. The owner's ticket names "Stream the response" as a sanctioned fix, and streaming removes the buffered-response ceiling by its nature. Approving streaming approves that effect.
4. The client-side cost (for example, the browser parsing a 53 MB body) is the same as in local and dev today.

It belongs in the PR body as a disclosed behavior note. The existing follow-up candidate (a response row cap, which needs an owner ruling because clients would see it) is the right place for any limit on body size.

### Verdict: CONFIRM

### Non-blocking notes
- PR body should state:
  - (a) `rowwidth-at-limit` was not over budget red-first; only `fewrows-utf16-200` was, at up to 500.9 MB.
  - (b) Responses are now chunked, with no `Content-Length`. In prod this likely lifts Cloud Run's 32 MiB non-streamed response ceiling for these three endpoints (unverified).
  - (c) The row-cap follow-up needs an owner ruling.
- The evaluator's optional `CompactPrinter.print(value, sb)` suggestion (one fewer copy per scalar) still stands.
- Process: during this review I printed the worktree `backend/.env` to my own tool output while checking `DATABASE_URL`. It contains live credentials (Google client secret, Anthropic key, a DB password). Nothing was written anywhere, but the owner may want to know that the transcript now holds them.
