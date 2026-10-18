## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed tree: `4429d46fd66efd2f40ad18adea6bc9e1bdfd07ec` (branch `feature/ndjson-draft-preview-endpoint/HEL-1630`; the change dir is untracked planning output). I did not re-open rulings A, F, C1 or C2.

### What I verified (with evidence)

- **Spawn-cwd guard:** `assert-cwd.sh` returned `READY ambient=/home/matt/Development/helio branch=feature/ndjson-draft-preview-endpoint/HEL-1630`.
- **CR1 (step failure): resolved.** I re-read `executeTree`'s `loop` (`InProcessPipelineEngine.scala:458-475`).
  - The new `onNodeError` hook (prune descendants and lane-dependents from `remaining`, then continue) can be built on that loop. Pruning keeps the "no ready node" `LaneReferenceError` from firing, because pruned nodes leave `remaining`.
  - D1's line order now emits `downstreamOfError` lines after their `error` line.
  - The spec scenario covers an independent sibling branch, and 5.3 names `onNodeError` unset as its red mutation, which reaches.
  - One new gap is in CR3 below.
- **CR2 (rows target): resolved.** Rows come from `nodeOutcomes(StepKey(rowsStepId))`, resolved over the full draft. `available:false` is in the schema, and a spec scenario puts the terminal below an AI step (5.2). `trunkTerminalId` (`:487-494`) confirms why this was needed.
- **CR3a/b/c (caps): resolved in principle.** The plan adds an in-flight gate (8 per instance, 2 per principal), a 4 MiB body cap, a rule that heap x in-flight must stay at or below 192 MB, 10,000 rows per frame, and client pre-checks for every cap. CR4 below covers the measurement definition.
- **CR4 of round 1 (upsertsource): mechanism now specified.** `PipelineStep` is an unsealed trait (`PipelineStep.scala:39`), so an identity step with the same id can be built. `UpsertSourceStep.evaluate` (`:30-37`) shows the identity swap removes both the `checkTarget` read and the `writeBackSink.record`. But 5.7's named mutation no longer reaches (CR2 below).
- **CR5 proofs, one by one:**
  - **5.6 (revoke): resolved.** `checkPreviewAccessInternal` (`PipelineRepository.scala:205-222`) reads the grant table directly under system context and never calls `findGrantRole` (`:186`). A subclass whose `findGrantRole` revokes after answering therefore makes the re-check `NotAuthorized`. Removing the re-check gives 200, which is red. `TwoUserRlsApiFixture` runs as `helio_app_test NOBYPASSRLS` (`:115`).
  - **5.1 (never-read): resolved.** The draft transform replaces `dataSourceRepo` and `loadSource`. So the mutation "`resolveSecondarySource` delegates to the default" makes the `complete:true` join fail, because the default goes through the refusing stand-in, and the content assertion goes red. The mutation "planner ignores `complete:false`" yields a `step` line instead of `sourceNotSupplied`, which is red. Both reach. (The spy alone would stay green under both, because the stand-ins shadow it. Red comes from the content and line assertions, which is acceptable.)
  - **5.4 (limiter): resolved.** `ApiRoutes` gets an injectable `rateLimitConfig` (today it is a private `fromEnv()`, `ApiRoutes.scala:297`). The 429 messages are distinct (`RateLimitDirective.scala` today says `Rate limit exceeded`). Removing the exemption under a low general limit is red, and widening the matcher is red through the near-miss case.
  - **5.5, 5.8 (log), 5.11: mutations named and reaching.**
  - **5.9 (abort):** now uses a deterministic `afterNode` hold, but has a hole (CR3).
  - **5.12 (drag):** `maxWait` was added and a lower bound set, but one of the two named mutations does not reach (CR1).
- **Exemption predicate: sound.** `rateLimit()` runs inside `pathPrefix("api")` (`ApiRoutes.scala:808-821`), so `RequestContext.unmatchedPath` is the post-`/api` path. A `RequestContext => Boolean` exempt parameter can apply the shared `PathMatcher` plus path-end there, and that matches the route mounted directly inside `authenticate`'s `concat` with no extra `pathPrefix`. `resolveKey`'s `None => pass` (no credential) is unchanged. The "counted by no limiter" property is stated.
- **Scheduler arithmetic (D8), worked by hand.** Edits at 16 ms multiples. The first send is at 600 ms (maxWait from the edit at 0). The next unsent edit is at 608, so the next send is at 1208, and the period is 608 ms. Sends from 0 to 60 s: `600 + 608k <= 60000` gives 98. The final state goes out at about 60184. **[90, 100] is consistent.** The same arithmetic gives 98 sends with `floorMs: 0` (see CR1).

### Verdict: REFUTE

The round-1 CRs are substantively addressed against the live tree, not just reworded. But under C3, two of the named group-5 mutations cannot turn their proofs red. And the new `onNodeError` hook leaves cancellation able to be swallowed as a node error, in a way 5.9's shape would not catch. The remaining items are small one-sentence decisions the executor would otherwise have to guess.

### Change Requests

1. **5.12 / D8: the `floorMs: 0` mutation cannot reach (C3).** With `maxWaitMs = floorMs = 600`, maxWait is measured from the first unsent change, which always comes after the previous send. So every gap in a continuous drag is already at least 600 ms because of maxWait alone. With `floorMs: 0` the drag still produces 98 sends with 608 ms gaps, and the proof stays green. The floor only binds when the 350 ms debounce fires within 600 ms of the previous send. Add a second fake-timer scenario where the floor is the binding constraint, for example short bursts separated by quiet gaps of about 360 ms (each gap longer than the debounce, so each burst is debounce-sent). Assert every gap is at least 600 ms. `floorMs: 0` must turn that scenario red. Keep `maxWaitMs` removed -> red on the continuous drag.

2. **5.7 / D2: the "apply writeBackSink" mutation cannot reach under identity replacement (C3).** The identity step records nothing into `writeBackSink` (the real `UpsertSourceStep.evaluate:33-34` is what records). So applying the sink in the endpoint is a no-op, and the side-effect proof stays green. Name a mutation that actually produces a write or run record, and show it red. For example:
   - drop the identity replacement (with a `NewSource` target the real step's `checkTarget` passes without a read and records a `PendingWrite`) and apply the pending writes through the run executor's write-back path -> target/new source changes -> red; and/or
   - route the endpoint through `PipelineRunService.submit(dry = true)` -> `pipeline_run_rate_window` changes -> red.

   Also have the spec assert that a `NewSource`-target upsertsource gets a `step` line and creates no source.

3. **D2/D4: cancellation must never pass through `onNodeError`.** `onNodeFrame` "fails the walk with `DraftPreviewCancelled`" by throwing inside the `evalNode(...).flatMap { ... loop(rest) }` continuation (`:466-473`). The design does not say what `onNodeError` wraps. If the recovery is attached anywhere other than `evalNode`'s own Future, it catches the cancel, and also every later iteration's failure through the recursive `loop(rest)`. The walk then continues as if node N had merely errored. State that:
   - `onNodeError` recovers only the failed node's own `evalNode` Future (`StepExecutionException`);
   - exceptions from `onNodeFrame`, `onNodeProgress` or `afterNode`, and `DraftPreviewCancelled` in particular, always fail the walk;
   - the cancel flag is also checked before each node starts, so a run of erroring nodes after an abort does not keep evaluating.

   Make 5.9 able to tell these apart. Hold after node 1 of a draft with an independent sibling branch, because in a linear draft node 1's subtree is every node, so swallowing would look like stopping. Assert the `aborted` outcome and that the sibling never evaluated. Add a mutation: routing `onNodeFrame`'s exception through `onNodeError` -> red.

4. **D7 / 5.10: define the heap measurement, and tie the spec's "8" to its result.** `nodeOutcomes` keeps every node's frame for the whole walk (`:438-439`, `:468`). So peak retention depends on the draft shape, not only on body size: 50 `convertformat` steps over a 10,000-row frame keep 50 frames. Specify:
   - **the measured shape:** a 4 MiB body at the 10,000-row cap, 50 server steps that each produce a new frame, and 8 supplied secondaries;
   - **the method:** for example, force a GC and read the `MemoryMXBean` used-heap delta while the walk is held at the last node by the `afterNode` hook, with the parsed request still referenced;
   - **the default:** the "8 per instance" in `specs/pipeline-draft-preview-api/spec.md` and task 3.3 is the default the measurement yields. If the measurement lowers it, the spec, the task and CLAUDE.md change with it.

   As written, a measurement of a one-step draft would "pass" the 192 MB rule without bounding the real worst case.

5. **D1 vs D5/D8: multiple input frames vs a single-flight client, 2 in flight and 120 per minute.** D1 requires one request per distinct input frame. But the scheduler is single-flight, the gate allows 2 in flight per principal, and pacing assumes one request per send at about 98 per minute against a budget of 120. A draft whose server steps sit under two or three different upstream frames would, on each send, either abort its own sibling request, hit the 2-per-principal 429, or exceed 120 per minute in a drag. The schema is committed in this change and (e) inherits it, so decide it here. Recommended: let one request carry an input frame per parentless step (for example `inputs: {stepId: frame}`, with the byte and row caps unchanged), so one edit is one request. Otherwise, specify how the scheduler sequences multiple frames within one send slot, and how that stays under both caps.

6. **D1 vs D3: the planner's treatment of disabled steps is ambiguous.** D1 says disabled steps pass through with no line, and the engine treats them as transparent (`evalNode`, `:441-442`). D3 marks "AI kinds" and "a source secondary absent" as unavailable without mentioning `enabled`. Is a disabled `generatetext`, or a disabled join with no supplied secondary, `aiStep`/`sourceNotSupplied` with its subtree pruned, or transparent? State the rule, cover it with a planner unit case (3.1), and note how it applies ruling F.

### Non-blocking notes

- **D4:** pekko-stream is 1.1.3 (`build.sbt:274`). Size the `Source.queue` buffer at or above the maximum line count (50 steps + rows + failed). Treat a `QueueOfferResult` other than `Enqueued` as a failure, never a silent drop, because `onNodeFrame` is synchronous and cannot await an offer.
- **D5:** release the in-flight slot from the response stream's termination (`watchTermination`), not from route completion. The stream outlives the route's `complete`. Also release it on the 413 and strict-timeout paths.
- **D8:** measure the byte pre-check as UTF-8 bytes (`TextEncoder`), not `string.length`. Also state what the client does on a gate or limiter 429 (honour `Retry-After` before the next send, or surface it).
- **D1:** say what happens when `rowsStepId` names a step that is not in the request (presumably 400).

### Gate-defect check (CON-160)

No evaluator report exists yet. The round-1 skeptic report relied on no mtime-ordering evidence, and neither does this one. No gate defect to record.
