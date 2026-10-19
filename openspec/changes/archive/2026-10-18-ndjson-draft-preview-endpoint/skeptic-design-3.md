## Skeptic Report — design gate (round 3, skeptic-design-3.md)

Reviewed tree: `4429d46fd66efd2f40ad18adea6bc9e1bdfd07ec` (branch `feature/ndjson-draft-preview-endpoint/HEL-1630`; the change dir is untracked planning output). Rulings A, F, C1 and C2 were not re-opened.

### What I verified (with evidence)

- **Spawn-cwd guard:** `assert-cwd.sh` printed `READY ambient=/home/matt/Development/helio branch=feature/ndjson-draft-preview-endpoint/HEL-1630`.
- **Round-2 CR1 (floor mutation reach): resolved.** D8 and 5.12 add a burst scenario with quiet gaps of about 360 ms. That is longer than the 350 ms debounce, so every burst is debounce-sent. With `floorMs: 0` the gaps are about 360-400 ms, which is under 600, so the proof goes red. With the floor, every gap is 600 ms. The continuous-drag scenario keeps `maxWaitMs` removed as its red mutation (0 sends during the drag).
- **Round-2 CR2 (upsertsource mutation reach): resolved.** `UpsertSourceStep.evaluate` (`UpsertSourceStep.scala:30-37`): with a `NewSource` target, `checkTarget` is `Future.unit` (`:47-61`) and a `PendingWrite` is recorded. `DataSourceRepository.applyWriteBacks` exists (`DataSourceRepository.scala:503`). So the 5.7 mutation "drop the identity swap and apply the sink's pending writes (NewSource)" creates a source, which changes `data_sources` and turns the proof red. 5.7 now covers both targets.
- **Round-2 CR3 (cancel vs `onNodeError`): wording resolved.** D2 limits `onNodeError` to the node's own `evalNode` Future. Exceptions from `onNodeFrame` and `shouldContinue` always fail the walk. `shouldContinue` is checked before each node. `evalOneStep` turns synchronous throws into failed Futures (`InProcessPipelineEngine.scala:256-275`), so "own Future" covers every step failure. 5.9 uses a sibling branch. **However, the named mutations can still stay green; see CR3 below.**
- **Round-2 CR4 (heap measurement): method resolved, shape not worst case.** D7 now fixes the shape (4 MiB, a 10,000-row root, 8 secondaries, 50 `compute` steps), the method (`System.gc` then the `MemoryMXBean` delta at the `afterNode` hold, 3 runs) and the default rule (`min(8, floor(192 MB / peak))`). The spec now says "default derived from a recorded heap measurement, never above 8". But the shape preserves row counts, and the premise behind it is false (CR1 below).
- **Round-2 CR5 (multi-frame): resolved.** `roots: [{id, rows, listFrame?}]` plus a per-step `rootId` maps directly onto `executeTree(rootFrames, ..., rootIdOfStep)` (`:360-366`). `parentKey` resolves a parentless step via `rootIdOfStepStr` and falls back to `rootIds.head` (`:448-451`). D1's 400 on a dangling `rootId` closes that fallback. `RootKey` and `StepKey` are separate key spaces, so a synthetic root id cannot collide with a step id. One edit is now one request.
- **Round-2 CR6 (disabled steps): resolved.** D1 and the spec requirement "Disabled steps are transparent", with the disabled-`generatetext` scenario, match `evalNode` (`:441-442`). Planner task 3.1 includes disabled cases. Ruling F holds, because a disabled AI step is never evaluated.
- **Non-blocking notes from round 2:** all adopted.
  - Queue buffer of 52, with any non-`Enqueued` result a failure.
  - The in-flight slot is released from `watchTermination` and on every pre-stream exit.
  - The UTF-8 byte pre-check uses `TextEncoder`.
  - `429` honours `Retry-After`.
  - A `rowsStepId` not in the request is a 400.
- **`rowsStepId` default against `trunkOfRoot`.** `trunkOfRoot` follows only children at `position == 0`, starting from `childrenOfRoot` (`PipelineStepRepository.scala:1303-1320`). D1 says "trunk terminal of the full step set" in one place and "trunk terminal of `roots[0]`" in another. The spec says "the trunk terminal of the full draft". These agree once read as `trunkOfRoot(fullSteps, roots[0])`, but see the notes.
- **Join fan-out is unbounded, so memory is not bounded by the byte cap.** `JoinStep.evaluate` (`JoinStep.scala:55-110`) builds `rows.flatMap(left => matches.map(merge))` with no output cap. Nothing in the engine caps rows (`TruncationSink` only records source reads). An inner join of a 10,000-row root against a 10,000-row lane, with one shared key, materialises 10^8 rows inside one node.

### Verdict: REFUTE

Round 2's six CRs are genuinely addressed against the live tree. But the revision leaves three defects the executor would otherwise hit or have to guess:

- The memory bound rests on a premise the code contradicts.
- The planner's unavailable closure omits lane edges for non-AI reasons. That turns an ordinary draft into a whole-walk `failed`.
- 5.9's two named mutations can both stay green under a natural implementation (C3).

Each fix is a sentence or two.

### Change Requests

1. **D7: the claim "the byte cap is the real memory bound" is false, and the heap shape is not the worst case.** Server-evaluated steps can multiply rows:
   - `join`, `lookup` and `union` over a supplied lane or secondary (`JoinStep.scala:85-100`);
   - `chunkbytokencount`, `splittext` and `unpivot`.

   So a 4 MiB body can make one request materialise around 10^8 rows. The measured 50-step `compute` chain never reaches that, so `min(8, floor(192 MB / peak))` does not bound anything real. Pick one and state it:
   - (a) Add a per-node output cap. Any node whose frame exceeds 10,000 rows gets an `error` line, for example "frame exceeds 10,000 rows", and its subtree is pruned. Join, lookup and union are guarded before materialising, for example by summing match counts from the right index before `flatMap`. Then the heap shape is genuinely the worst case. Add a 5.8 case: a fan-out join gets an `error` line, with the mutation "cap removed" turning it red, bounded by test time.
   - (b) Record the exposure in Risks as an accepted risk the existing preview and run paths already carry (the same `JoinStep`, a 120/min general bucket), with the reasoning. Reword D7 so the measurement is described as bounding row-preserving drafts only.

   Either way, delete the false sentence.

2. **D3 / D1: the unavailable closure must follow lane edges for every reason, not only for AI.** D3 prunes "AI kinds, their subtrees and lane-dependents", but only "their subtrees" for `sourceNotSupplied` and `laneNotSupplied`. Take a step L whose lane input is a join J marked `sourceNotSupplied`. J is removed from the walk, so `executeTree`'s lane check sees `!byId.contains(dep)` (`InProcessPipelineEngine.scala:404-406`). It returns `LaneReferenceError` before any node runs, and the whole request ends `failed` instead of L getting `downstreamOfUnavailable`. State the rule:
   - the unavailable set is the fixpoint over child edges and lane edges, from every planner reason;
   - the same closure is used by `onNodeError`'s pruning (D2 already says "transitive lane-dependents").

   Add a planner unit case to 3.1, and a spec scenario: a lane-dependent of a `sourceNotSupplied` join gets `downstreamOfUnavailable`, and the stream still ends with `rows`.

3. **D4 / 5.9: neither named mutation reliably turns 5.9 red (C3).** 5.9 asserts "fewer nodes evaluated than the draft holds" plus an `aborted` outcome. Neither assertion reliably catches its mutation:
   - **Removing the `shouldContinue` check:** after the hold is released, node 2 evaluates. Its `onNodeFrame` offer then gets `QueueClosed`, because the stream was cancelled, and D4 makes that fail the walk. So the count is still "fewer" (2 of N). Only the outcome could catch it.
   - **Routing cancel through `onNodeError`:** every later node is pruned at its pre-node check without being evaluated. The count stays 1, and the sibling does not run, so D4's parenthetical "(the sibling still runs)" is wrong. Again, only the outcome could catch it.

   If the outcome is derived from the cancel flag, which is the obvious way to write `aborted-after-N-of-M`, both mutations stay green. Specify:
   - the outcome is `aborted` if and only if the walk ended with `DraftPreviewCancelled`, never read from the flag; an offer failure is `failed`;
   - 5.9 asserts exactly 1 node evaluated (the held node), not "fewer";
   - the parenthetical is corrected.

   Then "remove `shouldContinue`" gives count 2 and `failed` (red), and "route through `onNodeError`" gives `completed` (red).

### Non-blocking notes

- **D1 / spec:** use one phrase for the default `rowsStepId`, "trunk terminal of `roots[0]` over the full draft", in both D1 sentences and in the spec requirement.
- **D1:** define the empty-trunk case. The client sends steps "from the first server step downward", so that step's request-local `position` may be non-zero. Then `trunkOfRoot` (`position == 0` only) returns nothing. Either require the client to send `rowsStepId`, or define the default as the root frame or `available: false`.
- **D1:** a disabled `rowsStepId` inside an unavailable subtree is neither "unavailable" (disabled steps are never marked) nor present in `nodeOutcomes`. Say that it is `available: false`, so no one calls `nodeOutcomes(...)` on a missing key.
- **D1:** say whether `rootId` on a parented step is a 400 or is ignored. The engine ignores it.
- **5.12:** state the burst length, for example 32 ms or less. Bursts long enough to trip `maxWaitMs` would make maxWait, not the floor, the binding constraint.

### Gate-defect check (CON-160)

No evaluator report exists yet. Neither prior skeptic report relied on mtime-ordering evidence, and this one does not. No gate defect to record.
