## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed: worktree HEAD 069afd36d5c69d245c0f3c779b9a4fc6d160b52b (= origin/main), untracked change dir
`openspec/changes/bound-run-path-memory/` (ticket.md, proposal.md, design.md, tasks.md, specs/pipeline-run-memory-bounds/spec.md).
Spawn-cwd guard: `READY ambient=/home/matt/Development/helio branch=bug/run-path-memory-bounds/HEL-1660`.

### What I verified (with evidence)

**Code citations, checked against the tree:**
- `InProcessPipelineEngine.scala:297` is `} catch { case ex: Throwable => Future.failed(ex) }`. Confirmed.
- `InProcessExecutionBackend.scala:61` is the only `engine.executeTree` call outside `DraftPreviewService.scala:188`.
  `grep engine\.\w*(` over main finds only `executeTree` (1) and `loadRowsWithStats` (1). Confirmed.
- `Dockerfile:46` has `-XX:MaxRAMPercentage=75.0`, and there is no ExitOnOutOfMemoryError flag. Confirmed.
- `PipelineRunSucceededWrites.scala:104-110` (snapshots) and `:208-226` (alert evaluation) read `nodeOutcomes` by Output node key.
  The design cites :96-109 and :208-217, which is close enough. Confirmed.

**Q1: is `InProcessExecutionBackend.execute` the single production run entry? Yes.**
- `PipelineRunService.scala:129-130`: `backend = if (executionBackend != null) executionBackend else new InProcessExecutionBackend(...)`.
  `ApiRoutes.scala:493` passes `executionBackend = null`.
- `SparkJobSubmitter` implements the trait (`spark/SparkJobSubmitter.scala:30`). `Main.scala:191` builds it, but it is never
  passed as `executionBackend`.
- The `.execute(` call sites are `PipelineRunExecutor.scala:245`, `PipelineRunBackfill.scala:121,138` and
  `PipelineRunPreview.scala:198,280`, all on the injected `backend`.
- `SourceSampleService` builds its own engine but only loads rows. Caveat: the trait signature change also reaches
  `SparkJobSubmitter`.

**Q2: is the retain set complete? It is complete for readers. It is not sound for the accounting (CR3).**
- After the walk, `nodeOutcomes` is read by: Output keys (both `StepKey` and the root-bound `RootKey`,
  `PipelineRunSucceededWrites.scala:96-102`), the trunk terminal or the lowest-root fallback (`InProcessPipelineEngine.scala:604-611`),
  and the preview/backfill target (`PipelineRunPreview.scala:288`, `PipelineRunBackfill.scala:141`).
- During the walk, `resolveLane` reads lane dependents, which `releaseConsumed` already keeps (`:532-540`).
- `UnionStep`/`LookupStep` resolve through the same lane mechanism.
- No other reader exists (`grep -rln nodeOutcomes`).

**Q3: does decoupling leaf-first from `maxLiveCells` keep the draft byte-identical? Yes, if `DraftPreviewService` passes `leafFirst = true`.**
- The draft always sets `maxLiveCells` through `DraftPreviewStandIns.scala:43`, so it is always leaf-first today.
- However, `InProcessPipelineEngineDraftSeamSpec.scala:103-108` asserts the old coupling: it sets `maxLiveCells` and expects
  leaf-first. `DraftPreviewHeapSpec.scala:83-92` overrides `executeTree` positionally. Both must change (see note N1).

**Q4: is the label-threading plan sound? Mostly.**
- The draft literals live only in `RowBudget.scala:16,21`, `StringBudget.scala:44,48` and `InProcessPipelineEngine.scala:133`.
  They use both "Draft preview" (sentence start) and "draft preview" (mid-sentence), so the label needs both cases.
- `ExpressionInterpreter.scala:271` calls `StringBudget.tooLong(maxChars)` with only an `Int` threaded through every `evalExpr`
  recursion. D2 does not name this site (note N2). The compiler will catch it once the signature changes.

**Q5: is the NonFatal/fatal-Future consequence correct? Only for OutOfMemoryError. It is wrong for StackOverflowError (CR1).**
- Probe (`.concertino/scratch/HEL-1660/skeptic/Soe.java`, JDK default thread stack):
  `Pattern.compile("(a|b)*c").matcher("a"*20000).find()` gives `caught java.lang.StackOverflowError`.
- `StringOpsStep.scala:179-180` (`extractRegex`) and `AssertStep.scala:250-254` (`regex`) run a user-supplied pattern over
  user cell text, synchronously inside `evaluate`.
- `NonFatal` treats `StackOverflowError` (a `VirtualMachineError`) as fatal.
- Pekko 1.1.3 `reference.conf:90` sets `jvm-exit-on-fatal-error = on`, and `src/main/resources` does not override it.
- Runs use the Pekko dispatcher (`Main.scala:85`, `implicit val ec = context.executionContext`).
- Scala 2.13.15 Future transformations rethrow a fatal throwable on the executing thread instead of completing the promise.
- Today such a regex becomes an ordinary step error. After D7 it escapes `evalOneStep` inside a Future callback. It then
  either reaches Pekko's uncaught handler (System.exit) or leaves the run's Future pending forever.
- In the second case the run is never reaped: `RunHeartbeatActor` keeps stamping it while `liveRunTracker` holds it. It also
  keeps holding one of the owner's 3 concurrency slots.
- D7 analyses only the OOM case, and the owner was asked only about OOM (escalation sub-question 7).

**AC6 against the live source limits: not representable (CR2).**
- `CsvLimits.scala:17-19`: `maxRows=50000`, `maxCells=300000`.
- `InProcessPipelineEngine.csvRowsWithinLimits` (:907-913) enforces both on every run-path CSV load.
- AC6/D6 calls for a "50,000-row, 20-column CSV", which is 1,000,000 cells, more than 3x the cell cap. On the real run path
  that shape fails at source load with "CSV is too large", before any step runs.
- The owner's ruling-3 question was framed as "CSV inputs reach 50k rows". They do in rows, but the widest real CSV is
  about 300k cells.

**Q6: is the D6 measurement plan adequate? No, as scoped (CR3, CR4).**
- D6 measures heap only inside `InProcessExecutionBackend.execute`.
- After the walk, the success path allocates per-row JSON copies:
  - `PipelineRunExecutor.scala:285-287`: `jsRows` of the whole trunk frame, also for dry runs.
  - `PipelineRunSucceededWrites.scala:110-112`: `nodeJsRows` per materialised node.
- So the run's real peak is retained frames plus JSON copies, which D6 never observes.
- The spec's own AC6 scenario requires "writes both Outputs' snapshots", which is a service-level outcome. D6 and task 3.4
  only exercise `execute`.
- Red-first plus a mutation per guard (tasks 1.1, 1.2, 3.1) is otherwise adequate.

**Other checks:**
- Coverage of AC1-AC9 by tasks:
  - AC1 → 1.1
  - AC2 → 2.5/3.1
  - AC3 → 2.4-2.6/3.3
  - AC4 → 2.2/3.1
  - AC5 → 3.2
  - AC6 → 3.4
  - AC7 → 1.2/2.7
  - AC8 → 2.1/2.3
  - AC9 → 3.1
  - No AC is uncovered. Apart from the items below, no placeholders or contradictions.
- Row fan-out kinds: `LookupStep` uses the first match only (`LookupStep.scala:54-55,103`). `UnionStep` is bounded at 2x by the
  backstop. The design's list of up-front and emit-time kinds is complete.

### Verdict: REFUTE

### Change Requests

1. **D7 must cover non-OOM fatal errors, and this needs an owner decision.**
   - A user-supplied regex in `stringops.extractRegex` (`StringOpsStep.scala:179`) or `assert.regex` (`AssertStep.scala:254`)
     throws `StackOverflowError` on about 20k characters of text (probe above). That is far under the 1,048,576-character cap
     this change sets.
   - Today that is a step error. Under a literal `case NonFatal(ex)` it becomes a fatal error rethrown on a Pekko dispatcher
     thread (`jvm-exit-on-fatal-error = on`): either an instance exit any user can trigger, or a run hung forever and never
     reaped, still holding a concurrency slot.
   - The design must:
     - (a) state the actual behaviour for `StackOverflowError`, with a probe on the real run path;
     - (b) raise it to the owner, since ruling 7 was asked only about OOM. Options: `NonFatal` plus an explicit
       `StackOverflowError` arm, or accept the exit;
     - (c) add a spec for whichever behaviour is ruled.
   - D7's spec should also pin how the OOM assertion is observed. A fatal error thrown after the first node is rethrown inside
     a Future callback, so the walk's Future never completes. Drive it from a single-step walk, where the first node is
     evaluated synchronously, or document the timeout-based observation.

2. **AC6 / D6's ordinary shape conflicts with `CsvLimits` (300,000 cells).**
   - A 50,000 x 20 CSV is 1,000,000 cells and is rejected by `csvRowsWithinLimits` (`InProcessPipelineEngine.scala:907-913`) on
     every run.
   - Rewrite the shape against the real limits: for example, the largest CSV the caps allow (50,000 x 6 = 300,000 cells), plus
     separately a dataset or static root if a wider frame is a deliberate stress case. Say which source kind the spec uses and why.
   - If the AC's wording must change, record it as an AC amendment with the CsvLimits citation, and escalate if it changes
     what the owner was told when ruling 3 was answered ("CSV inputs reach 50k rows").

3. **The live-cell accounting must match what is actually reachable, and the run path pins its root frames.**
   - `executeTree` closes over `rootFrames` (`rootFrames.head._2` fallback in `loop`, `:546`).
   - `InProcessExecutionBackend.execute` closes over `loaded`/`primaryRows` until its `yield` (`:53-62`).
   - So a root frame stays strongly reachable for the whole walk, even after `releaseConsumed` removes it from `nodeOutcomes`
     and `tally.remove`s it.
   - On runs, roots are real sources (up to 300k-cell CSVs, uncapped datasets), so the tally under-counts the live heap by up
     to a full root.
   - Fix one of two ways:
     - keep root frames charged, never tally-released, on the run path; or
     - drop the pinning references.
   - Add a big root then fan-out/chain shape to D6 so the measurement would catch the gap.

4. **D6 must measure the run's real peak, not only `execute`.**
   - Each shape, AC6's included, must go through the service run path (`PipelineRunService` → `PipelineRunExecutor` →
     `PipelineRunSucceededWrites`). The `jsRows` (`PipelineRunExecutor.scala:285`) and per-node `nodeJsRows`
     (`PipelineRunSucceededWrites.scala:110`) JSON copies are allocated there, after the walk and outside the budget.
   - Either size `MaxLiveCells` so the end-to-end peak stays at or under 192 MB, or state explicitly that the budget bounds only
     the walk and record the measured post-walk overhead next to it.
   - Task 3.4 must assert the spec's "writes both Outputs' snapshots" at that level. Today it reads as an `execute`-only check.

5. **Make `retain` a required parameter (no default) on `PipelineExecutionBackend.execute`/`InProcessExecutionBackend.execute`.**
   - An empty default with frame release on silently drops an Output's frame. `materializedWrites` then skips it without error
     (`outputsByNodeKey.keySet.intersect(nodeOutcomes.keySet)`, `PipelineRunSucceededWrites.scala:104`), and the run reports
     success with a stale snapshot.
   - State that `PipelineRunExecutor` needs `outputRepo` injected (it has none today: constructor at `PipelineRunExecutor.scala:23-36`).
   - State that root-bound Outputs map to `RootKey`, matching `PipelineRunSucceededWrites.scala:96-101`.

### Non-blocking notes

- N1: task 2.3 should name the specs that encode the old coupling. `InProcessPipelineEngineDraftSeamSpec.scala:103-108` must
  switch from `maxLiveCells` to `leafFirst`, and the override in `DraftPreviewHeapSpec.scala:83-92` must forward the new
  parameter. Record this so it is not mistaken for a fixture edited just to make tests pass.
- N2: D2/task 2.2 should list `ExpressionInterpreter.scala:271` (`checkLength(length, maxChars)` → `StringBudget.tooLong`) as a
  label-threading site. It receives only an `Int`, so the label, or the budget object, must be threaded through `evalExpr`.
- N3: `StringBudget.exceeded`'s text says "which is what this request has left". With the run label, check that the wording
  still reads correctly for a run.
- N4: D3's mid-run-Output trade-off also makes alert evaluation emit `log.error` "never evaluated by the tree walk"
  (`PipelineRunSucceededWrites.scala:218-222`) for an Output created mid-run. Downgrade the message or note it in the PR.
- N5: the `PipelineExecutionBackend` trait change also reaches `SparkJobSubmitter`. Mention it in the proposal's Impact.
