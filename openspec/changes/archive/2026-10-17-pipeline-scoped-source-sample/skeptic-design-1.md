## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed at HEAD 544bd79ea5879263fc05808ff15bee6cd7d6c430 (planning artifacts uncommitted in the change dir).
Paths below are under `backend/src/main/scala/com/helio` unless they start with `frontend/` or `openspec/`.

### What I verified (with evidence)

**(a) D3 check order on the NOBYPASSRLS role: sound.**
- `SourceSampleService.sample` today: `findByIdOwned` (RLS, `withUserContext`) and then
  `engine.loadRowsWithStats(ds, dataSourceRepo)`. The engine's dataset read `readDatasetRows` runs in
  `withSystemContext` (DataSourceRepository.scala:928-940), and REST/SQL use `ConnectorResolveContext.Internal`
  (InProcessPipelineEngine.scala:661,673). So a grantee read after the check works on the privileged pool, as D3 assumes.
- `PipelineRepository.findByIdShared` (PipelineRepository.scala:75-99) reads the pipeline row privileged, then checks the
  grant under `withUserContext(caller)`. Both "no row" and "no grant" give `None`. `findGrantRole` (:186) is privileged
  but only runs after step 3 proves the grant. `listRootDataSourceIdsInternal` (:119) and
  `PipelineStepRepository.listByPipelineInternal` (:337) are privileged, and D3 calls them only after steps 3-4.
- S's existence is never looked up before the "uses" check (step 6 is the first read of S on a non-owner path). So an
  editor cannot probe an arbitrary source id's existence, through the body or through an extra query. I found no branch
  that reads anything about S or P's steps before the RLS-scoped grant proof.

**(b) Byte-identical 404s: sound as designed.** Every denial maps to the one `ServiceError.NotFound("Data source not
found")` that the unknown-id branch already uses. The 400 (image), 502 and file-missing 404 bodies are only reachable
after authorization. The limiter (429) runs before any check, the same for every caller. Task 4.2 compares status, body
and content type.

**(c) Secondary enumeration: complete.**
- Only `JoinStep:101`, `UnionStep:96` and `LookupStep:124` call `ctx.dataSourceRepo.findByIdInternal` +
  `ctx.loadSource`. No other step reads a source. The only other source reference is the upsert write target
  (`UpsertSourceStep`), which is correctly a non-goal.
- `PipelineAnalyzeService.secondarySourceIdOf` (:205) decodes with the same `JoinConfig/UnionConfig/LookupConfig.decode`
  that the steps' `decodeConfig` uses, and keeps only `SecondaryInput.Source(id)` with a non-empty `id`.
- Legacy flat fields (`rightDataSourceId` etc.) are a hard decode error (`SecondaryInput.decodeStrict`). They become
  `None` through the `Try`, so such a step is not counted as using a source (fail-closed). The engine also fails such a
  run, so the sample cannot expose more than a run would.

**(d) Limiter and run guard: sound.** `/sample` sits inside `DataSourcePreviewRoutes.rateLimited`, which is the
`sourceFetchRateLimitDirective` passed in at ApiRoutes.scala:942. The bucket is keyed by caller (session user, or PAT
token id). `SourceSampleService` has no `PipelineRunService` dependency. Adding a query parameter on the same `path`
keeps both properties.

**(e) Client signal: DEFECTIVE.** See CR1. `costVerdict.canRun` is not a permission signal:
`PipelineAnalyzeReads.toCostVerdictResponse` (:192-205) sets `canRun = canRun && configReasons.isEmpty`, and
PipelineAnalyzeProtocol.scala:234-240 documents that it is cleared whenever any enabled step has a `validationError`.
The design's Context bullet ("the only editor signal ... owner or editor, PipelineAnalyzeReads.scala:151") cites the
inner `canRunF` and misses that clause. I grepped `frontend/src/features/pipelines/types` and
`api/protocols/pipelines`: no other role or editor field reaches the client.

**(f) "All steps count" and "no same-owner test": correct for editor-only.**
- Every path that writes a step secondary goes through `StepReferenceChecks.secondarySourceOwnershipF` with the CALLER's
  identity: step create, update and duplicate (StepReferenceChecks.scala:61), pipeline create
  (PipelineCreateTransaction:124), draft save (DraftSaveService:137) and patch-set (PatchSetPipelineStepResolvers:259).
- So every foreign source in P's "uses" set was put there by that source's own owner. An editor can enable a disabled
  step and run, so "enabled or not" is not an access boundary for editors.
- A third editor C's source used by P is read by any editor's run today. "P uses S" without a same-owner test matches
  the ticket's rule.
- The viewer-and-editor delta is incomplete; see CR4.

**Other checks**
- Revoke is a hard delete: `PipelinePermissionService.revoke` calls `permissionRepo.delete`.
- The client samples roots only (`usePipelineDetailPage.ts:184`, `useSourceSamples.ts`). This is consistent with the
  store-spec delta ("each root source").

### Verdict: REFUTE

### Change Requests

1. **The client editor signal must not be `costVerdict.canRun`** (design D6, Context bullet 5, tasks 3.2/3.3, store-spec
   delta "when the caller may run that pipeline").
   - `canRun` is false whenever any enabled step has a `validationError`. An editor who opens a shared pipeline with one
     misconfigured step gets no shared samples.
   - Because the per-source `sampleable` flag is derived from it, every shared source's label disappears mid-edit as
     soon as a step becomes invalid. That is exactly the state HEL-1631's live draft preview exists to help with.
   - Replace the signal with a permission-only one. For example, a new analyze or pipeline response field such as
     `callerRole`/`canSample`, with a schema delta and seam test per D7. Or justify another existing signal from code.
   - Correct the Context claim.
   - Add a store-spec scenario and a unit test: an editor on a pipeline with an invalid enabled step still captures,
     and still shows, the shared sample.
2. **The store-spec delta contradicts unmodified requirements.**
   - `openspec/specs/pipeline-source-sample-store/spec.md` "Sample label rules" says each root source shown on the page
     SHALL carry a label and a refresh control.
   - "In-memory sample store with capture-once semantics" says opening the page SHALL capture each root source with
     nothing cached.
   - D6 hides the label and skips the request for non-sampleable (viewer) sources, but the delta only ADDS a
     requirement. The archived spec would then contradict itself.
   - Add MODIFIED blocks for both requirements that carve out sources the caller may not sample.
3. **Refresh must use the current page's pipeline scope, not the scope stored with the entry** (D6: "the store entry
   records the `pipelineId` it was fetched with, and `SourceSampleLabel`'s refresh reuses it"; task 3.1).
   - The store is keyed by source id. An editor who captured S on P1 and later opens P2 (which also uses S) would
     refresh with `pipelineId=P1`.
   - After a P1 revoke or removal, that legitimate refresh on P2 404s.
   - Pass the scope from the rendering page or card to the label's refresh. Add a unit test: capture via P1, refresh
     on P2's page, and the request carries P2.
4. **Complete the stated viewer-and-editor delta (D1), even though D1 is undecided.** The planner must not re-derive
   this after the ruling. The delta lists the role test, the viewer scenario and the client signal. It omits that
   D3.5's "all steps count, enabled or not" rests on "an editor can enable a step", which does not hold for a viewer.
   - A viewer cannot enable a step or run. Under viewer access, a viewer could therefore sample a secondary source that
     only a disabled step references, which nothing the viewer can do would ever read.
   - The delta must state the viewer rule here: enabled steps only for non-editors, or an explicit accepted rationale.
   - It must also list the spec changes that flip: the viewer scenario, the store-spec "Viewer opens a shared pipeline"
     scenario, and the hidden-label decision.

### Non-blocking notes
- The proposal calls the limiter requirement "modified", but the delta ADDs a second limiter requirement beside the
  existing "Sample requests are limited as source fetches, never as runs". Consider one MODIFIED block so that two
  requirements do not cover the same behaviour.
- Add an empty `?pipelineId=` to task 4.2's malformed set.
- Consider pinning the "no same-owner test" ruling with a positive test: an editor samples third-user C's secondary
  used by P. Also consider a fail-closed test: a step whose stored config carries a legacy flat field is not counted.
- The "P uses S" guarantee depends on every step-write path keeping `secondarySourceOwnershipF` with caller identity.
  All five current paths do. Mention that dependency in the service's doc comment.
- `schemas/sources/source-sample-response.schema.json`'s description names the route. Optionally mention
  `?pipelineId=` there, or in the OpenAPI note, per D7.
- `CLAUDE.md`'s Key endpoints entry for `GET /api/data-sources/:id/sample` says "Owner-only (`404` otherwise)". Task 2.4
  should name it explicitly so it is updated to describe the `pipelineId` scope.
