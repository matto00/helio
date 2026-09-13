## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed HEAD 0cc7aef797be23b6358266daf9a96f3b96f9b7ff (change dir untracked). Artifacts: ticket.md, proposal.md, design.md, tasks.md, specs/pipeline-upsertsource-{config,execution}/spec.md. I checked each round-1 CR against the live code; the planner's claims were not taken on trust.

### What I verified (with evidence)

**CR1 (D7 same-transaction rewrite): addressed, and it is implementable.**
- `cycleCheckForUpsertAction` is a plain `private def ... : DBIO[Unit]` (PipelineStepRepository.scala:53). Making it `private[persistence]` and composing it into another DBIO is mechanically sound.
- Its graph reads (`findUpsertWriteEdges` :105ff, `findReadEdgesVisibleTo`) use an explicit owner-or-grantee filter, not the GUC. On the app pool, RLS adds filtering on top but cannot raise errors.
- The rewrite's target is a dataset created in the same transaction, which no pipeline reads yet, so no cycle is possible. The check is correct-but-vacuous there, and harmless.
- RLS: `pipeline_steps` is FORCE RLS with `pipeline_steps_owner` (V35:60-70), a USING-only EXISTS on `pipelines.owner_id = GUC`. With no WITH CHECK, USING also governs UPDATE. `pipelines_select` (V39:79) lets the owner see their own pipeline. So the owner's SELECT FOR UPDATE and UPDATE on the step row are admitted under the GUC. Test 3.7 must assert this under NOBYPASSRLS, as design says.
- The CAS (lock step row, compare persisted vs evaluated, then create+rewrite / reuse id / fail) and the concurrent-run rule are specified, with spec scenarios and task 3.8. The lock order (step row, then data_sources) is stated.

**CR2 (zero-row contradiction): resolved.** D7: a new-source target with zero rows is a no-op, append with zero rows is a no-op, replace with zero rows clears. Both zero-row scenarios are in the execution spec, and tasks 3.8/3.8a cover them. `replaceRows` (DataSourceRepository.scala:423-452) handles an empty vector with no special case.

**CR3 (D9 names): fixed.**
- `pipelineStepToStep` is at stepNarrowing.ts:247, with `?? OP_TYPES[0]` at :251.
- `persist` is at useStepCardState.ts:207, calling `updatePipelineStep` at :211.
- `proposalLaneGraph.ts:51` calls `pipelineStepToStep`.
- `OpType` stays unchanged and is never added to `OP_TYPES`. Task 2.2 has the no-PATCH test.

**CR4 (grantee pre-flight identity): resolved.**
- `validateTargetOwnership(target, user: AuthenticatedUser, repo)` (UpsertSourceConfig.scala:245) accepts `AuthenticatedUser(pipeline.ownerId)`.
- The cycle-check call sites in PipelineService currently pass `user.id.value` (:1850, :1874, :1880, :1924, :1952, :2057, :2205) and create passes `actingUserId` (:573). D1 switches these to the owner.
- There is a spec scenario plus task 1.7.

**CR5 (Spark rejection site): named.**
- `SparkJobSubmitter extends PipelineExecutionBackend` (SparkJobSubmitter.scala:28), and `InProcessExecutionBackend` is the other implementation (:22).
- Every run entry reaches the private `runPipeline` (:284) through `submit` (:196, :211, :217): the route, the scheduler (PipelineSchedulerService.scala:118), hooks (HookTriggerService.scala:74) and proposal-apply (PipelineProposalService.scala:511).
- A `supportsWriteBack` check there is a single, testable choke point at submit time.

**N1/N3: addressed.** The reader shape is pinned in Risks (single SELECT). `staticMaxRows` becomes a public `DatasetMaxRows` constant (D6).

**Other grounding checked:**
- `SchemaInferenceEngine.inferShallowFromJsObjects` exists (:149).
- `DataSourceRepository.insertDatasetSource` exists (:330), and `AuthenticatedUser` is at model.scala:35.
- The resolved product forks (owner identity with forced RLS on the scheduler path too, undeclared column fails, 500 cap fails, new-source rewrite) are reflected consistently in D5/D6/D7 and the spec.

**New issues:** I found no contradiction, placeholder, or AC left uncovered. AC-to-task mapping:
- append: 3.2
- atomic replace: 3.3
- fault injection: 3.4
- validation: 3.6
- RLS: 3.7
- cycle API: 3.9
- op wiring: 1.1, 1.8, 1.9, 3.1
- editor: 2.1, 2.2

### Verdict: CONFIRM

### Non-blocking notes
- N1: D7's CAS "persisted ExistingSource(id) with the same mode, so reuse" also matches a user who changes a NewSource step to ExistingSource(some other owned dataset, same mode) mid-run. That run would write into the user's newly chosen dataset instead of failing with "configuration changed". The window is narrow and the target is still owner-owned. The executor may tighten this, e.g. require that `id` was created by a write-back or have the data_sources row name match the NewSource name. Either way, note the chosen behavior in the test.
- N2: D1 reads "rejected at write time" for a grantee's own-dataset target. The spec scenario says the step-add request is rejected, which is the correct reading. Treat "write time" as "step write", not "run time".
- N3: When the second concurrent new-source run reuses the created id, its rows are validated against the first run's inferred schema, so a column not in the first run fails as undeclared. This is consistent with the fork answers, but worth one assertion in 3.8.
- N4: D10's audit should seed from round-1 item 7 (helio-mcp/src/tools/write.ts:375, PipelineAnalyzeService.scala:454).
