## Skeptic Report — design gate (round 3, skeptic-design-3.md)

Reviewed at HEAD 544bd79ea5879263fc05808ff15bee6cd7d6c430. The planning artifacts are uncommitted in the change dir.
Backend paths are under `backend/src/main/scala/com/helio` unless noted. D1 (viewer vs editor) is an open owner
escalation. I judged the design as editor-only and checked the viewer delta for completeness. I did not decide D1.

### What I verified (with evidence)

**Round-2 change requests: both addressed.**
- **CR1 (sampleability state while it is unknown).** D6b now defines three states per source:
  - `yes`: label as today, request sent.
  - `unknown`: "Loading sample…", no request.
  - `no`: no label, no request.

  It also maps the two failures: a failed sources list stays "Sample unavailable", and a rejected analyze gives
  "Sample unavailable" with no request. The existing label tests (`SourceSampleLabel.test.tsx:54`, `:134`) are kept
  and re-pointed rather than deleted. Tasks 3.3a and 4.5 carry this, and the store spec adds "Role not known yet" and
  "Analyze rejected" scenarios.
- **CR2 (proposal matches D6).** `proposal.md` now covers `callerRole`:
  - it is in What Changes;
  - `pipeline-analyze-api` is under Modified Capabilities;
  - Impact names the analyze schema, `PipelineAnalyzeReads` and the helio-mcp mirror;
  - it says "Sample response schema unchanged", with the analyze schema extended.
- **Round-2 non-blocking notes.** Most were taken up:
  - the D1 delta says "analyze answered", not `!= null`;
  - tasks are grouped `## 1..4`;
  - helio-mcp mirror task 3.3b exists;
  - task 4.2 has the empty `pipelineId` case;
  - 4.1 has the third-user secondary and undecodable-config cases.

**Server design re-checked against code: sound.**
- **Current service.** `services/sources/SourceSampleService.scala`'s `sample` does `findByIdOwned` (RLS) and then
  `engine.loadRowsWithStats(ds, dataSourceRepo)`. The engine read takes no user, so a grantee read after the check
  works on the NOBYPASSRLS role. The unknown-id body is the constant `NotFound("Data source not found")`, so the
  denial branches can be made byte-identical.
- **Step 3: `PipelineRepository.findByIdShared` (:75-99).** It reads the pipeline row privileged, then proves the grant
  under `withUserContext(caller)`. It returns None for both "no row" and "no grant", and owners short-circuit. Every
  privileged read in D3 steps 4-6 comes after this proof:
  - `findGrantRole` (:186);
  - `listRootDataSourceIdsInternal` (:119);
  - `listByPipelineInternal`;
  - `findByIdInternal`.

  S is never read on a non-owner path before the "uses" check, so S has no existence oracle.
- **Step 5: `PipelineAnalyzeService.secondarySourceIdOf(op, config: String)` (domain/engine, :205).** It covers
  join/union/lookup `SecondaryInput.Source` with a non-empty id. Decoding goes through `Try`, so an undecodable config
  counts as no use and the check fails closed. The analyze call site already feeds it
  `PipelineStepConfigCodec.encode(s)`, so the input D3 needs exists.
- **Route and limiter.** `/sample` sits in `DataSourcePreviewRoutes` inside `rateLimited`. That directive is the
  `sourceFetchRateLimitDirective` (`ApiRoutes.scala:942`), so a `parameter("pipelineId".optional)` on the same `path`
  inherits the caller-keyed bucket. The service has no `PipelineRunService` reference.
- **`callerRole` derivation.** `PipelineAnalyzeReads.scala:151-153` computes owner-or-`findGrantRole` before
  `toCostVerdictResponse` ANDs in `configReasons` (:192-205). So a permission-only `callerRole` is derivable there,
  and `PipelineAnalyzeResponse(` is built at exactly one site (:166). Analyze authorizes through `findByIdShared` (any
  grant), so a viewer receives `callerRole: viewer`.
- **D1 claim checked.** `checkPreviewAccessInternal` (PipelineRepository.scala:~205) gives viewers the non-AI
  step-preview arm. That supports "a viewer already sees 10 raw root rows".

**Client design re-checked against code: sound.**
- `usePipelinePageLoad.ts:67` dispatches the full (non-concise) `analyzePipeline` on page open.
  `pipelinesSlice.ts:266-280` keys `analyzeResult` per pipeline id and does not clear it on pending or rejected, so
  `callerRole` is per pipeline and does not flicker.
- `useSourceSamples.ts` requests owned ids only after the list succeeds. `SourceSampleLabel.tsx` has the
  `resolvable` / `waitingForSources` / "Sample unavailable" logic that D6b replaces. It is used in exactly two places,
  `SpineSourceCard.tsx:56` and `PipelineDetailHeader.tsx:239`, both of which tasks 3.4 and 4.7 name.

**Spec deltas.**
- REMOVED "Sample access is owner-only" and MODIFIED "Sample requests are limited as source fetches, never as runs"
  match the baseline headings in `openspec/specs/source-sample-api/spec.md`.
- MODIFIED "In-memory sample store with capture-once semantics" and "Sample label rules" match
  `openspec/specs/pipeline-source-sample-store/spec.md` and restate every existing scenario.
- `openspec validate pipeline-scoped-source-sample` reports valid.

**Test fixture.** `TwoUserRlsApiFixture` runs the app pool as `helio_app_test` (NOBYPASSRLS) and seeds three users
(A, B, `userC`), so task 4.1's third-user case can be built. It builds the real `ApiRoutes`, so the sample service and
limiter are mounted as in production.

**Viewer delta (D1).** It is complete enough that it need not be re-derived after a ruling. It covers:
- the role test becoming "any grant";
- enabled-steps-only secondaries for viewers;
- the client signal;
- the flipped and added scenarios.

The flips it leaves implicit are listed in the notes below.

### Verdict: CONFIRM

The security design is sound against the code: grant proof under the caller's RLS before any privileged read, one
NotFound for every denial, the caller's bucket by construction, and the run guard unreachable. The round-1 and round-2
revisions are genuinely in place. The remaining items are wording ambiguities with no security consequence, and either
reading is safe. They should be settled during implementation and pinned by the 4.5 tests.

### Non-blocking notes

1. **Which D6b state wins when they overlap.**
   - **Failed sources list, but `callerRole` is editor.** D6b's `yes` ("owned, or `callerRole` owner/editor") and
     its "a failed sources list keeps 'Sample unavailable'" conflict for a source the editor does not own. Pick one
     precedence. Recommendation: `callerRole` owner/editor makes every root `yes`, since the scoped path also serves
     owned sources. Say so in D6b and in one 4.5 test.
   - **"Analyze rejected" when an earlier result exists.** Define it as "no `analyzeResult` for this pipeline", not
     `analyzeStatus === "failed"`. A failed debounced re-analyze keeps the earlier result (`pipelinesSlice.ts:277`),
     and editors should not lose their labels on a transient failure.
2. **Stale wording to tidy.**
   - D6a and task 3.3 still say a boolean "per-source `sampleable` flag", while D6b and task 3.3a make it three-state.
     The prop should carry the three states.
   - Risks still says "wait for or miss `canRun`"; it should read `callerRole`.
3. **Use `dataset` sources in the RLS spec (4.1 and 4.2).** The fixture's `stubFileSystem` reports every file as
   missing. An uploaded-CSV source would return the post-authorization 404 "Data file not found…", which a careless
   test could mistake for a denial, or treat as a "200" case that never actually returns 200.
4. **Viewer-ruling flips beyond the listed ones.** If the owner rules `viewer-and-editor`, these also flip:
   - the source-sample-api requirement text "(a `viewer` grant does not qualify)";
   - the store ADDED requirement's "`owner` or `editor`";
   - tasks 4.2 (the viewer negative becomes a positive, and a disabled-step secondary negative is added), 4.3 (the
     role-mutation target) and 4.7 (the viewer sees a label).
5. **"Per-user bucket" wording.** The modified limiter requirement says "the caller's own per-user … bucket". The
   directive keys a non-session PAT caller by token id. "the caller's own bucket" would be exact.
6. **Fixture churn.** A required `callerRole` in the frontend `PipelineAnalyzeResponse` type touches about 28 frontend
   files that construct `costVerdict` fixtures. That is expected churn, not a defect. Keep these edits mechanical.
7. **Auditor note.** The "P uses S, no same-owner test" guarantee depends on every step-write path keeping
   `StepReferenceChecks.secondarySourceOwnershipF` with the caller's identity. Round 1 found five such paths. State
   this dependency in the service doc comment, as round 1 suggested.
