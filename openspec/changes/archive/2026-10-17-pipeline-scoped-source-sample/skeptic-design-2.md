## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed at HEAD 544bd79ea5879263fc05808ff15bee6cd7d6c430. The planning artifacts are uncommitted in the change dir.
Backend paths are under `backend/src/main/scala/com/helio`. Frontend paths are under `frontend/src/features`.

### What I verified (with evidence)

**Round-1 change requests: all four were genuinely addressed.**
- **CR1.** D6 now uses a new permission-only `callerRole`. It is not `canRun`. The `pipeline-analyze-api` ADDED delta
  has an "invalid step → editor while canRun false" scenario, and tasks 2.3a/4.5a cover it.
  - Verified: `PipelineAnalyzeReads.scala:151-153` computes the owner/`findGrantRole` test before
    `toCostVerdictResponse` (:197-205) ANDs in `configReasons`. So `callerRole` can be derived permission-only, as
    claimed.
  - Verified: analyze authorizes through `findByIdShared` (any grant), and the existing spec has a viewer-analyze
    scenario. A viewer therefore reaches analyze and can see `callerRole: viewer`.
- **CR2.** MODIFIED blocks exist for "In-memory sample store with capture-once semantics" and "Sample label rules".
  - The names match `openspec/specs/pipeline-source-sample-store/spec.md` exactly.
  - Each block restates every existing scenario.
- **CR3.** D6a and task 3.1 send the CURRENT page's `pipelineId` (as a prop), never a stored one. Test 4.5 covers
  P1→P2.
- **CR4.** The D1 viewer delta now states the "enabled steps only for a viewer" rule and lists the flipped scenarios.

**Server design re-checked against code (sound):**
- **`findByIdShared`** (PipelineRepository.scala:75-99) reads the pipeline row privileged and proves the grant under
  `withUserContext(caller)`. It returns None for no row and for no grant. Owners short-circuit.
- **`findGrantRole`** (:186) is privileged, but D3 calls it only after step 3.
- **Privileged reads after the grant proof.** `listRootDataSourceIdsInternal` (:119),
  `PipelineStepRepository.listByPipelineInternal` (:337) and `DataSourceRepository.findByIdInternal` (:156) all exist.
  D3 reads them only after the grant proof. S is never looked up before the "uses" check, so there is no existence
  oracle for S.
- **Source readers.** Only `JoinStep:101`, `UnionStep:96` and `LookupStep:124` read a source by id.
  `SecondaryInput` has only `Source` and `Lane` (SecondaryInput.scala:19-20).
  - `secondarySourceIdOf` (domain/engine/PipelineAnalyzeService.scala:205-211) is public.
  - It decodes through `Try`, so an undecodable config counts as no use, which fails closed.
- **Engine read is caller-independent.** `SourceSampleService.sample` (services/sources/SourceSampleService.scala)
  reads with `engine.loadRowsWithStats(ds, dataSourceRepo)`, which takes no user.
  - The connector driver resolves `ConnectorResolveContext.Internal` with `findByIdInternal`
    (RestApiConnectorDriver.scala:78).
  - The grantee read therefore works after the check on the NOBYPASSRLS role.
- **Unknown-id 404.** The body is the constant `NotFound("Data source not found")`, with no id in it. So
  byte-identical 404s across denial branches are achievable.
- **Route and limiter.** `/sample` sits in `DataSourcePreviewRoutes` (`path(DataSourceIdSegment / "sample")`) inside
  `rateLimited`. Adding a `parameter("pipelineId".optional)` keeps the same bucket by construction. The service has no
  `PipelineRunService` dependency.
- **PAT scoping.** I checked whether `scopedPipelineIds` tokens could reach the widened route. They cannot:
  `authDirectives.confineScopedToken` (ApiRoutes.scala:831) confines them to `/api/hooks/*`.
- **Schema change is required and planned.** `schemas/pipelines/pipeline-analyze-response.schema.json` has top-level
  `additionalProperties: false`. Its `required` is `[id,name,sourceSchemas,steps,costVerdict,warnings]`. It has only
  internal `$ref`s, so a client Ajv validation (pattern: `sources/sourceSampleWire.contract.test.ts`) is
  straightforward. The proposal schema only `$ref`s `$defs`, so it is unaffected by a top-level field.
- **analyzeResult survives re-analyze.** `pipelinesSlice.ts:266-280`'s `analyzePipeline.pending` does not clear it.
  So `callerRole` does not flicker during debounced re-analyze, only before the first answer.
- **Spec deltas.** REMOVED / ADDED / MODIFIED names are consistent with the baseline specs.
  - `openspec validate pipeline-scoped-source-sample` reports valid.
  - `--strict` fails only on task-group numbering warnings (see notes). `check:openspec` (the hook) is not strict.

### Verdict: REFUTE

The security design is sound and I have no objection to it. Two artifact defects remain. Both are cheap to fix, and
both would otherwise surface as arguments at the final gate.

### Change Requests

1. **Define the label/request state while sampleability is still unknown or unknowable.** The current D6a/D6
   ambiguity is in D6a, in Risks ("label shows loading/absent", which can be read two ways), and in tasks 3.3/3.4/4.5.
   - D6a makes `sampleable` a boolean, and "a non-sampleable card renders no `SourceSampleLabel`".
   - Today's label always renders, and existing tests pin two pending states:
     - `sources/ui/SourceSampleLabel.test.tsx:54`: "Loading sample…" while the sources list is loading.
     - `:134`: "Sample unavailable" when the sources list failed.
   - Under a boolean flag computed as `owned || canSampleShared`, two regressions follow:
     - An OWNER's own label disappears while `state.sources` loads, and on a failed sources list, instead of showing
       loading or unavailable.
     - An editor's shared label is absent (not loading) until analyze answers, and absent forever if analyze rejects.
   - Specify a tri-state per root:
     - **sampleable** (owned, or `callerRole` owner/editor) → label as today.
     - **pending** (sources list or analyze not yet answered) → the existing "Loading sample…" label, no request.
     - **not sampleable** (sources loaded, not owned, and analyze answered with `viewer`) → no label, no request.
   - Also state what a failed sources list and a rejected analyze map to. Recommendation: keep today's
     "Sample unavailable", with no refresh.
   - Add matching unit-test bullets to 4.5, and keep or adjust the existing `SourceSampleLabel` tests explicitly.
     Do not delete them silently.
2. **Bring `proposal.md` in line with D6.** Today it contradicts the design:
   - "What Changes" never mentions the new analyze `callerRole` field.
   - "Modified Capabilities" omits `pipeline-analyze-api`, although `specs/pipeline-analyze-api/spec.md` ADDs a
     requirement to it.
   - "Impact" omits `PipelineAnalyzeReads` / `PipelineAnalyzeProtocol` / `JsonProtocols`,
     `schemas/pipelines/pipeline-analyze-response.schema.json`, and the frontend analyze type.
   - "Response schema unchanged" should say "sample response schema unchanged; analyze response schema extended",
     so the archived record matches the ticket AC ("schema unchanged, or extended in the same change").

### Non-blocking notes

- **D1 viewer delta, client signal.** "`callerRole != null`" is trivially true once analyze answers, because the field
  is required. Say "any `callerRole` (analyze has answered)" instead. Also note the prose flips this delta implies:
  - The source-sample-api requirement's "(a viewer grant does not qualify)".
  - The store ADDED requirement's "`owner` or `editor`" and its viewer example.
  - Tasks 4.2 (viewer negative becomes positive, plus the disabled-secondary negative), 4.3 (the role-check mutation
    now targets the enabled-only rule for viewers) and 4.7 (the viewer sees a label).
- **`tasks.md` structure.** `### Backend` / `### Frontend` / `### Tests` sit under `## 1. Repro`, so `openspec validate
  --strict` files every task under group 1. `## Standing Constraints` is empty. Consider `## 2. Backend`,
  `## 3. Frontend` and `## 4. Tests`.
- **helio-mcp mirror.** `helio-mcp/src/types.ts:603` mirrors the analyze response. Optionally add `callerRole` there,
  or note why it is omitted.
- **Capture-once and a stale scoped failure.** Capture-once is keyed by source id. A scoped capture that 404'd on P1
  (for example after a source was removed) leaves an `error` entry, and opening P2 that legitimately uses S will not
  retry it automatically. Only the refresh button retries, and it now scopes to P2. This is acceptable, but worth one
  unit test or a sentence in D6a.
- **Duplicate query parameters.** Consider whether `?pipelineId=a&pipelineId=b` needs a test. Pekko's `parameter`
  takes one value, so it is harmless either way.
