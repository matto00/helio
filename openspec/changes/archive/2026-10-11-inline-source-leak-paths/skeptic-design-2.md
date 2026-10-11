## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed tree: `bcb0e891923094c1a1e85ecc053f30a73ee6d70f` (origin/main; the change dir is untracked). I re-read ticket.md, proposal.md, design.md, tasks.md and specs/inline-source-create-atomicity/spec.md. I treated them as claims and checked them against the live code.

### Round-1 change requests: was each one actually addressed?

1. **CR1 (createStatic is not a leak): ADDRESSED.**
   - ticket.md AC3 now says "`DataSourceService.createStatic` was verified to be one transaction: not a leak".
   - design.md has a new Context bullet giving the reason (`insertDatasetSource` -> `insertDatasetSourceAction`, followed by a fire-and-forget audit), plus a Non-Goals entry.
   - Decision 3 and Decision 5 item 3 no longer mention static. Task 1.1 records createStatic as "does NOT leak", with evidence, and no red test is planned for it.
   - The spec requirement now names only `createSql`/`createRest`, and proposal.md "What Changes" lists only SourceService.
   - Residue: proposal.md "Why" still reads "`SourceService`/`DataSourceService` creates that fail after their own insert". This is wording only (see notes).
2. **CR2 (flag cannot reach the public `rollback(response, user)`): ADDRESSED via option (b).**
   - Decision 1 explicitly descopes `rollback`. The reason given is that the API response cannot carry the flag without an API-protocol change.
   - It is a Non-Goal, and task 4.5 files the follow-up. ticket.md AC2 lists it as a follow-up.
   - The moot "cannot express a bare url" hedge is gone, replaced by "(`validateRestConfig` accepts `url`)".
   - The internal paths keep the flag. `rollbackSourceOnly`, `cleanupSource` and `ResolvedSource` exist at PipelineProposalService.scala:566/71/585, and `ResolvedSource` is `private[services]`, so adding a field does not touch any API type.
   - I checked the claim "FirstRunDashboardService uses caller-owned CSV sources" only as far as its own `cleanupSource` (FirstRunDashboardService.scala:45). It does not affect the descope decision.
3. **CR3 (no positional deletes on a count mismatch): ADDRESSED.**
   - Decision 4: a count mismatch logs a warning, deletes NOTHING and reports `unrecoverable`, with the data-loss rationale stated.
   - A missing `dataSourceId` when the counts match: warn, skip that entry, delete the others, report `unrecoverable`.
   - The spec requirement "Patch-set rollback reports roots it cannot line up" now says "delete no source" on a mismatch. Its scenario asserts "no data source is deleted". Decision 5 item 4 tests all three cases.
4. **CR4 (non-code ACs have no task): ADDRESSED.**
   - New tasks.md section 4: 4.1 path-4 undo question to the owner, 4.2 HEL-1441 comment, 4.3 the other DataSourceService create paths, 4.4 prod orphan cleanup, 4.5 public `rollback`.
   - Task 3.3 covers the read-only count queries.

The round-1 non-blocking notes were also taken up:
- The guarded delete is named explicitly (never a bare `connectorRepo.delete(id, user)`).
- The `"Auto: " + name` second safeguard was added.
- The order is stated: source first, then Connector.

### Fresh review against live code (with evidence)

- **Implicit Connector name.** `SourceService.createRest` (SourceService.scala:139) builds the name as `s"Auto: ${request.name}"`, and `ImplicitConnectorConfig.forLegacySource` returns `name` unchanged (ImplicitConnectorConfig.scala:41). The source row gets the same `request.name` (`createRestWithConfig`, line 216). Every inline caller trims the name before the call: `PipelineRootWrites.resolveInlineRootSourceId` (`req.name.map(_.trim)`) and `PipelineProposalService.inlineName` (`.trim`). So the Decision 1 safeguard compares equal strings. A rename later in the same patch set would make the check fail safe (the Connector is kept as an orphan), never unsafe.
- **Bare-url is the only branch that creates a Connector.** In `createRest` (SourceService.scala:91-172), `(Some, Some)`, `(None, None)` and a defined `auth` each return Left before any write. `(Some(_), None)` creates nothing. Only `(None, Some(url))` calls `connectorRepo.create`. Deciding the flag from the request shape (`restConfig.url` defined, `connectorId` None) is therefore sound. `CreatePipelineRootRequest.restConfig: Option[RestApiConfigPayload]` (PipelineProtocol.scala:64-72) carries both fields.
- **Proposal `newConnector`** (PipelineProposalProtocol.scala:53). `toRestApiConfigPayload` never maps it, so a `newConnector`-only config reaches `createRest` as `(None, None)` and gets a 400 with no write. That is not a Connector-creating path this change would miss.
- **Guarded delete.**
  - `ConnectorRepository.delete(id, user, dependentCount)` returns `Left(ConnectorHasDependents)` when the count is greater than 0, and deletes the credential row after the connector row (ConnectorRepository.scala:283-310).
  - `countRestSourcesReferencing` (DataSourceRepository.scala:274) counts across all owners under the system context.
  - The design requires this real count.
- **Gap after the insert** (SourceService.scala:81-86, 222-227). `insert`, then `CreateSourceEnvelope.build`, which calls `dataSourceRepo.upsertInferredSchema` (CreateSourceEnvelope.scala:57). Both `DataSourceRepository.upsertInferredSchema` (line 306) and `delete` (line 252) are non-final members of a non-final class (line 23), so the planned fault injection and the repository-level cleanup are both available.
- **addRoot** (PipelineRootWrites.scala:108-133). The inline source is created after the pipeline lookup and the editor check, and nothing compensates afterwards. `.recover` maps only `PipelineCycleRejected` to a Left. Decision 2's "Left or failed Future -> helper -> original error" covers both. `compensatingInlineSources` is `private` in PipelineCreateWrites (line 213), and PipelineCreateWrites already depends on `rootWrites`. "Reuse (or generalize)" therefore in practice means moving it into the shared helper rather than calling across. That works either way.
- **Patch-set rollback** (PatchSetApplyRollback.scala:136-145, 201-224). The pipeline-delete-fails branch already returns `unrecoverable` with no source delete, so the planned test is valid. The forward outcome always writes `pipelineSummaryResponseFormat` with `roots` (PatchSetApplyForward.scala:86-89). `CreatePipelineRequest.roots` is required (no legacy scalar), and create does not dedupe roots. Counts therefore match in normal operation, and the mismatch rule changes no normal outcome.
- **Spec/AC trace.**
  - AC1: spec requirement 1 plus tasks 1.1/2.2.
  - AC2: requirement 2 plus tasks 2.1/2.2/2.4/2.5.
  - AC3: requirement 3 plus task 2.3.
  - AC4: Non-Goal plus task 4.1.
  - AC5: requirement 4 plus task 2.4.
  - AC6: Decision 1's doc comment plus task 2.1.
  - Red-first: C3 plus task 1.1.
  - Prod query: task 3.3.
  - HEL-1441: task 4.2.
  - Every AC has a task.
- **No placeholders.** No TODO, TBD or deferred blocking decisions remain. The helper's name is left to the executor, which is fine.

### Verdict: CONFIRM

The plan is sound enough to implement. All four round-1 change requests were genuinely fixed in substance, not just reworded, and no new blocking defect was found.

### Non-blocking notes

- proposal.md "Why" still says "`SourceService`/`DataSourceService` creates that fail after their own insert". Change it to `SourceService` only, to match What Changes, AC3 and the design.
- Decision 4: apply the count-mismatch `unrecoverable` rule only when the request has at least one inline root. A create with only `sourceId` roots has nothing to delete, so a (theoretical) mismatch should not turn a correct `rolledBack` into `unrecoverable`.
- Wiring (task 2.6): if the helper or `connectorRepo` is added as a nullable optional constructor dependency (this codebase's usual DI pattern), a harness or `Main`/`ApiRoutes` path that forgets to wire it would silently skip the Connector cleanup while the specs still pass. Prefer making it required in `PipelineService`/`PatchSetApplyServices`/`PipelineProposalService`. Otherwise, make sure at least one route-level red test runs through the production `ApiRoutes` wiring rather than a hand-built service.
- Decision 5 guard cases: besides "an explicit `connectorId` survives", add the case round 1 suggested, where a second source references the Auto Connector. It is the only test that exercises the dependents count rather than the flag.
- Keep the "upper bound" label on prod query (b) in the PR body.
