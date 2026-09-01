## Skeptic Report — design gate (round 2, skeptic-design-2.md)

### What I verified (with evidence)

Re-checked every cited line from round 1 against the code in this worktree, then read the revised
proposal.md, design.md, tasks.md and all five spec deltas.

- `PipelineRunService.scala:242` — `allSteps.filter(_.enabled)` still present exactly as round 1 described.
  Decision 7's premise is **true**; tasks 3.1-3.4 now own the splice. CR1 addressed.
- `PipelineRunService.previewStep:279` — `sortedSteps.take(k + 1).filter(_.enabled)` confirmed; Decision 5 +
  tasks 5.4/5.5 + `pipeline-run-execution`'s MODIFIED "Partial pipeline execution" requirement now own it.
  CR8 addressed (but see CR4 below for a residue).
- `NodeSnapshotRepository.overwriteRows` (lines 37-55) — single `ctx.withSystemContext(DBIO.seq(...).transactionally)`
  per `(pipelineId, nodeStepId)`; `onUnblockedRunSuccess` is still a `Future` fan-out. Decision 3's restatement
  (per-node atomicity only; cross-node explicitly a non-goal; `withSystemContext`/RLS note) is accurate, and the
  spec scenario "A successful run atomically replaces a node's prior snapshot" is now worded per-node. CR2 addressed.
- `AggregateStep.scala:76-105` — `rows.groupBy(...)` then `grouped.map`; zero input rows ⇒ empty map ⇒ zero rows for
  both empty and non-empty `groupBy`; `case "sum" => nums.sum` returns `0.0` on an empty numeric set. Decision 10's
  corrected reading, its single-new-branch scoping, and task 7.5's "prove the non-empty-group `sum = 0.0` path is
  untouched" guard are all correct. CR4(r1) addressed.
- `PipelineExecutionBackend.scala` — `PipelineExecutionOutcome(rows, stepCounts, sourceRowCount, primaryStats)`;
  Decision 1 now keeps `rows` and appends a defaulted `nodeOutcomes`. Genuinely additive. CR5 addressed.
- `PipelineStepRepository.scala:519-596` — `childrenOf(steps, parent: Option[PipelineStepId])` is parent-keyed and
  exists; `tailsOf` is flat; `executionOrder` emits tails before continuing the trunk (583-596) and appends root-level
  tails at the end. Decision 2 correctly drives the walk from `childrenOf` and correctly rules root-level tails
  ordinary tails of the root rather than `InvalidGraph`. CR6 addressed.
- `PipelineRunRegistry.scala:15-24` — `RunStatusEvent(status, rowCount, errorLog)`, `TerminalStatuses = Set("succeeded","failed","dry_run")`.
  Decision 6 correctly concedes round 1's point and names the new non-terminal `node-progress` kind + `onNodeProgress`
  callback. `V84__pipeline_run_assertions.sql:19-31` `step_id TEXT NOT NULL` confirmed ⇒ the "task 5.2 is a no-op"
  ruling is right. CR3 partially addressed — see CR1 below for the part that is still false.
- Spec deltas: `npx openspec validate engine-tree-walk-outputs --strict` → `Change 'engine-tree-walk-outputs' is valid`.
  Scenario-preservation checked requirement by requirement against `openspec/specs/`:
  `pipeline-run-execution` req 1 (7 existing → 7 + 1 new), schema-snapshot req (5 → 5), partial-execution req (1 → 1 + 2);
  `pipeline-aggregate-op` backend req (6 → 6 + 2); `pipeline-analyze-api` per-step req (13 → 13 + 1);
  `pipeline-run-sse` publish req (6 → 6 + 1). No MODIFIED block drops a pre-existing scenario.
- Cross-checked the new `InvalidGraph` requirement against the unmodified `pipeline-step-tree/spec.md:54`
  ("At most one trunk child per node") — complementary (write-side vs. engine-side), not contradictory.
- `outputs-model`, `SchemaInferenceEngine.inferShallowFromJsObjects`, `OutputRepository.listByPipelineInternal:73` /
  `updateSchemaInternal:151` all exist as the design assumes.

### Verdict: REFUTE

Seven of round 1's nine change requests are properly and accurately addressed — the corrections are
real, not cosmetic, and I re-derived each from the code rather than the prose. Four items remain, one
of which is a fresh false-against-code assertion introduced by this round's Decision 6.

### Change Requests

1. **Decision 6's frontend claim is false, and it produces a visible regression.** The design says an
   unrecognized non-terminal status "flows through to `setState` harmlessly without a frontend change
   being strictly required for correctness." It does not. `PipelineDetailFooter.tsx:165-186` renders the
   run-status pill from `const displayStatus = sseData.status ?? runStatus` with five literal equality
   branches (`queued`/`running`/`succeeded`/`dry_run`/`failed`). A `node-progress` event matches none, so
   the pill **goes blank mid-run** (the user loses "Running…" for the rest of the run, since the last
   status wins until a terminal event), with `aria-label="Run status: node-progress"` and an unstyled
   `pipeline-detail-page__run-status--node-progress` class. Worse, `:169`
   `displayRowCount = sseData.rowCount !== null ? sseData.rowCount : ...` — and the same preference at
   `PipelineDetailPage.tsx:749-752` feeding `PipelinePreviewModal`'s `rowCount` — will show a **per-node**
   count as though it were the run's row count. Also `usePipelineRunEvents.ts:3` declares
   `SseRunStatus` as a closed union and `RunEventsState.status` is typed to it, so the new value needs the
   type widened, not merely `nodeId` added. Rewrite Decision 6's frontend paragraph and expand task 6.5 to
   specify how the footer treats `node-progress` (e.g. keep displaying "Running…", and do not let a
   node-progress `rowCount` overwrite the run-level count — or carry the per-node count in a separate
   state field), and widen `SseRunStatus`. Note this also makes "UI gate: N/A (backend-only)" (task 10.7)
   wrong as written — there is now a visible surface to check.

2. **`pipeline-run-execution`'s dry-run requirement is left unmodified and now directly contradicts the
   delta.** The delta's MODIFIED "Successful non-dry run writes schema snapshot" states "no `version`
   counter exists to increment — the retired Type Registry `version` field ... no longer exists (removed by
   HEL-904)". But the unmodified sibling requirement at `openspec/specs/pipeline-run-execution/spec.md:69-82`
   ("POST /api/pipelines/:id/run?dry=true returns preview rows without side effects") still says the backend
   "SHALL NOT write results to the Type Registry", with scenario ":79 Dry run does not write to the Type
   Registry" → "the Output's `fields` and `version` are unchanged after the call". One capability now both
   asserts `version` does not exist and requires it to be unchanged. Add a MODIFIED delta for that
   requirement restating it in `node_snapshots`/`outputs.schema` terms.

3. **"A dry run returns per-Output preview rows" is ambiguous about the wire contract.** The new
   `pipeline-execution` requirement says a dry run "SHALL ... return per-Output preview rows", and task 5.1
   repeats it, but the design's Non-Goals exclude new API routes (P1.3/HEL-906) and the unmodified
   `pipeline-run-execution:69` requirement pins the dry-run response to `{ rows: [...], rowCount: N }`. An
   implementer can read this two ways: (a) engine-level only — `nodeOutcomes` carries per-node rows, HTTP
   response shape unchanged; or (b) the dry-run HTTP response gains a per-Output structure. State which,
   explicitly. If (b), name the `schemas/` + OpenAPI delta it requires (per CLAUDE.md those are the contract
   source of truth) and reconcile with `pipeline-run-execution:69`; if (a), say so in Decision 5 and reword
   the spec requirement so "return" is unambiguously engine-level.

4. **The disabled-step splice fix is applied to only one of the two call sites.** Decision 7 and task 3.1
   name `PipelineRunService.scala:242`'s `allSteps.filter(_.enabled)`, but `previewStep` at
   `PipelineRunService.scala:279` does its own `.filter(_.enabled)` on the sliced prefix. Once task 5.4
   replaces the slice with a `parentStepId`-derived root-to-target path and the engine walks by parent
   pointers, filtering a disabled ancestor **out of that vector** breaks the chain exactly as CR1 of round 1
   described for the run path (`childrenOf` finds nothing ⇒ silent truncation). Add to Decision 7 / task 5.4
   that `previewStep` also stops pre-filtering and relies on the engine's in-place skip, and add a test for
   previewing a step whose ancestor chain contains a disabled step (distinct from task 3.5, which only
   covers previewing a disabled step *itself*).

### Non-blocking notes

- Task 2.5's "verify first" hedge is legitimate here (unlike round 1's) — I confirmed `SparkJobSubmitter`'s
  construction site does keep compiling with a defaulted trailing field, so the task will resolve to a no-op.
- Decision 6's `onNodeProgress` default-argument-on-a-trait-method approach is fine in Scala, but the
  implementing classes must not restate the default; worth a one-line note so it isn't rediscovered mid-edit.
- Decision 2 step 4 says "evaluate every tail root ... as its own independent short `foldLeft`"; tails are
  chains, not single steps. Saying "every tail root and its descendant chain" would remove a small ambiguity.
