## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed: ticket.md, proposal.md, design.md, tasks.md, plus round 1's skeptic-design-1.md, which I treated as claims. I checked
them against `backend/src/main/scala/com/helio/services/pipelines/PipelineRunService.scala` at HEAD
`4db9730fd0907a4d769b7a0b80082ac260d499d6`. No code has changed yet. The only untracked path is the change dir.

### What I verified (with evidence)

- **Spawn guard:** `assert-cwd.sh` returned `READY ambient=/home/matt/Development/helio branch=task/split-pipeline-run-service/hel-1371`.
- **Member inventory and D2 ranges.** A grep of class-body members gives 45 `def`/`val` members, which matches round 1. I
  printed the first and last lines of every D2 range.
  - Each range starts at the member's doc comment and ends at its closing line. Examples:
    - `executeRunFailure` 1120-1168
    - `onDryRunSuccess` 1245-1276
    - `onUnblockedRunSuccess` 1421-1643
    - `extractBinaryRefs`/`isBinaryRefShape` 1658-1693
  - The class closes at 1695.
- **Cross-class call graph, re-derived.** I grepped every member name and inspected each hit. Many hits are only comment
  mentions, at 496, 527, 680-736, 913, 1150, 1203-1205, 1606 and 1611. The real calls are:
  - **Entry point → Executor:** `submit` calls `runPipeline` (270, 276).
  - **Entry point → Support:** `previewAtNode` calls `logExecutionFailure`/`executionFailureError` (560-561, 655-656),
    `truncationFields` (553, 644) and `resolveAllRootDataSourcesInternal` (505).
  - **Executor:** calls Terminal (`publish` 1086-1087/1099, `onDryRunSuccess` 1211, `onBlockedRun` 1313, `onWriteBackFailure`
    1320/1325). It calls Succeeded (`onUnblockedRunSuccess` 1327) and Support (`truncationFields` 1209,
    `resolveAllRootDataSourcesInternal` 355).
  - **Succeeded:** calls Terminal (`publishTerminalAfter` 1642, `persistAssertions` 1607) and Support (`truncatedReadsToJson` 1598).
  - **Backfill:** calls Support (742, 761, 784).
  - **Queries:** calls only the companion (954).
  - **Moved code never calls back into the entry point.** It uses no `engine` (only comment mentions), `urlFetchSeam`,
    `auditSubmit` or `previewAtNode`. Only `backend` is passed in.
  - So the graph is acyclic, D4's construction order works, and no entry-point member needs widening.
  - Companion references in moved code are already qualified (`PipelineRunService.EmptyTruncationJson`/`composeTruncationNotice`,
    at 194, 301, 954, 1157, 1366 and 1401), so they compile unchanged from other classes in the package.
- **Round 1 CR1 (impossible javap gate): resolved, and I checked the filter empirically.**
  - D6b/C5 now filter `$anonfun$`, `$deserializeLambda$` and any name containing `$$`.
  - I applied exactly that filter (`grep -v -e '\$anonfun\$' -e '\$deserializeLambda\$' -e '\$\$'`) to round 1's base-build
    dump, `scratchpad/javap-prs-hel1283.txt`.
  - What remains is precisely the API surface:
    - the 25-arg constructor (24 params plus `ExecutionContext`);
    - `$lessinit$greater$default$8..24` (16 entries; 16 is the required `outputRepo`, so it has none);
    - `submit` plus `submit$default$4/5`;
    - the 10 other public methods;
    - the static forwarders `composeTruncationNotice`, `EmptyTruncationJson` and `SparkUnsupportedKinds`.
  - No real API member contains `$$`, so the filter hides nothing it should keep.
  - New collaborator `private val`s that lambdas read would surface as `...$$executor` accessors, which the filter correctly drops.
  - A red run is now required.
- **Round 1 CR2 (unstated AC1 deviation): resolved.** D2a names the deviation and gives its size rationale. It maps every
  terminal publish to its file, and I confirmed the line numbers with grep:
  - `publishTerminalAfter` at 1166, 1275, 1375 and 1411 stays in Terminal.
  - 1642 moves to Succeeded.
  - The primitive (990-1003) stays in Terminal.
  - D2a commits the PR body to naming the deviation. The Planner Notes no longer claim the ticket seam is kept unchanged.
- **Round 1 CR3 (one-directional move check): resolved in intent.** D6a now requires a forward byte-compare and a reverse
  check over all seven resulting files. Each non-move line must be allow-listed with its D3 category. There are two red runs:
  a changed token in a moved body, and a stray statement added outside any member. See note 1 about how strong the reverse
  check needs to be.
- **Round 1 non-blocking notes were taken up.**
  - The D6c logger grep now covers every new file.
  - The stale doc links at :214/:285 are recorded as follow-ups.
  - D1 now spells out that delegations are receiver-qualified.
- **Guards re-checked.**
  - `ExistenceNotLeakedRoutesSpec`:
    - `forbiddenProducerCounts` (codeLines only) pins `"PipelineRunService.scala" -> 2`, and grep finds exactly 271 and 615.
      Both stay in the entry point under D1.
    - The `Row(... Set("PipelineRunService.scala"))` sites (455-457) feed only the one-directional
      `filesCallingAccessHelpers() -- covered` check (spec 314-320).
    - This file calls no access helper, so moving `runStatus` to Queries cannot break it.
  - `check-scala-quality.mjs`: the only hard rule is inline FQNs. File size is a soft warning, and there is no method-length
    rule, so the 223-line `onUnblockedRunSuccess` moving to a new file cannot trip it.
  - No other test or script references this file name in a way the split affects.
- **D5 logger:** the base uses `getLogger(getClass)` (:118) on a `final` class. Pinning `classOf[PipelineRunService]` in the
  new classes keeps the logger name identical.

### Verdict: CONFIRM

### Non-blocking notes

1. **D6a reverse check must work by position, not by set membership.** "Part of a moved/kept member's original text" could be
   implemented as "this line appears somewhere in the base file". That would pass a stray duplicate of an existing line, such
   as an extra `}`, `Future.successful(())` or `else Future.successful(())`.
   - Implement it as a partition: every line of each new file belongs to exactly one extracted member span, by position, or
     to an allow-listed line.
   - Make the stray-statement red run use a copy of an existing base line, not novel text, so the red proves positional
     coverage.
   - The final gate should check this.
2. **One stale link is missing from the follow-up list.** `recordUnrunnable`'s doc (:283) links `[[runPipeline]]`, and
   `runPipeline` moves to Executor. Add it to task 3.6 next to :214/:285. Do not edit it.
3. **D6b red run must still compile `main`.** Changing a public method's parameter type will usually break main-side callers
   such as `ApiRoutes` and the schedulers, so no class files and no javap result. Pick a red that still compiles, for example:
   - add a trailing defaulted parameter to `pipelineExists`; or
   - narrow `guardClock`'s declared type.
4. **D3 positional-word edits are optional.** Make them only where the move actually makes the word false. For example, 1150
   "see onDryRunSuccess below" stays true if Terminal keeps the original member order. Each such edit is still an allow-list
   entry.
