## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed HEAD `7395e0409b2d0f7026946992eade3881aa65b9be` (commits bf481b1fe red, 7395e0409 implementation) against
base `73b32e562` (resolved live with `resolve-review-base.sh`). Scratch output:
`/home/matt/Development/helio/.concertino/scratch/HEL-1625/eval/`.

### Phase 1: Spec Review — FAIL

Passing items:
- Ticket ACs: a constant-in-P bound is pinned (55 vs 200 give the same 31 requests, `contextRequestBudget.test.ts`).
  The 200-pipeline natural fixture is under 120, and over 120 with the batch at 404. The goldens pass in every mode
  (serve, 404, 500, missing-one, malformed, both 404). There are seam schema guards on both sides, and the
  `TwoUserRlsApiFixture` isolation test covers owner, editor and viewer on a non-BYPASSRLS pool.
- The parity case list (question e) matches the spec. `seedRichPipelines` covers multi-root, branched (two children
  of one filter), a disabled mid-chain step, an invalid config (join type `bogus_type`), a join plus a lookup on a
  secondary source, upsert targets that are ok, missing, foreign and csv (not a dataset), warnings (a filter on a
  missing column), a foreign root and zero steps. The test asserts `totalWarnings > 0` and `errored >= 4`, so the
  equality is not vacuous.
- `/analyze` is unchanged and the goldens are untouched (question d). `git diff 73b32e562...HEAD --
  helio-mcp/src/__golden__` is empty. The `PipelineAnalyzeReads` diff is a move-only extraction: the same
  resolvers, the same order of reads, the same `nodeInputs`, `analyzeNodes`, overlay, warnings and `nonOwnerValidity`.
  The upsert path is `findByIdOwned(DataSourceId(id), owner)` then `classify(id, _)`, the same as `checkExisting`.
  No existing analyze spec is modified. I re-ran 9 of them and all 82 tests pass.
- All CONSTRAINTS C1-C15 are honored in the diff. For C12 see Phase 2, point (a).

Issues:
1. **Spec divergence, question (c).** The spec `pipeline-context-analyze-read`, scenario "A pipeline whose analysis
   cannot be produced", says such a pipeline is omitted and the response is still `200`. The implementation only
   isolates failures inside the per-pipeline projection (`PipelineContextAnalyzeReads.scala:444-455`).
   - **Where it breaks.** The shared prefetch `PipelineStepRepository.listByPipelineInternalBatch` decodes every
     step row in one `.map(rowToDomain)` (`PipelineStepRepository.scala:382`). `rowToDomain` throws
     `IllegalStateException` on a config that does not decode (`:1437-1441`). So one undecodable stored step in
     any pipeline fails the whole request through `classifyDbError` (a 500), not only that pipeline.
   - **What the MCP does then.** It handles this correctly. The non-404 failure writes one
     `context-analyze unusable` stderr line, then every pipeline is analyzed per pipeline. The broken pipeline's
     `/analyze` fails in the same way, which gives the same `stepsError` as before. So the payload is identical.
     The cost is the request budget: 8 + 2 + P + Op + D, over 120 at 200 pipelines.
   - **context-details shares it.** `contextStepsForOwner` uses the same batch read
     (`PipelineService.scala:246`). That read fails too, so the details fallback adds another 2P.
   - **Weak test.** The only fault-isolation test (`PipelineContextAnalyzeQueryCountSpec`, "omit a pipeline whose
     analysis fails") injects a fault through a `PoisonedMap.get` that throws. A map lookup cannot throw in
     production. As a result, the realistic per-pipeline fault on this read (an undecodable row) is the one that
     is NOT isolated, and the isolation that is tested is close to unreachable. The only other reachable fault is
     a malformed non-UUID source id.
   - **Not recorded.** measurements.md "Deviations" does not record this.
2. **Planning artifact out of date.** design.md D8 still says the new schema reuses "the analyze step/warning
   definitions ... by `$ref`". The implemented schema defines its own `Step` and `Warning` and only `$ref`s
   `SchemaField`. The deviation is recorded only in measurements.md.

### Phase 2: Code Review — PASS

Gates, run fresh in `WORKTREE_PATH`:
- `npm run lint`: exit 0.
- `npm run format:check`: clean.
- Root `jest` (it includes helio-mcp), 3 workers: 73 suites and 645 tests pass.
- `helio-mcp` `npm run typecheck`: exit 0.
- `npm run check:scala-quality`: clean, soft warnings only.
- sbt with `-J-Xmx3g` and `nice -n 19`, `DATABASE_URL` set to helio_hel1625 and `ANTHROPIC_API_KEY` empty, in two
  shards:
  - new specs (`PipelineContextAnalyzeRoutesSpec`, `PipelineContextAnalyzeQueryCountSpec`,
    `PipelineAnalyzeUpsertGranteeGuardSpec`): 9 tests, all pass. Statements: app=5 and privileged=4 at both 10 and
    200 pipelines.
  - existing analyze specs (`PipelineAnalyzeRoutesSpec`, `StepConfigInvalidRoutesSpec`,
    `PipelineAnalyzeCanRunRoutesSpec`, `Hel1661GranteeAnalyzeVerdictSpec`, `Hel1799GranteeConciseAnalyzeSpec`,
    `PipelineAnalyzeUpsertSourceSpec`, `PipelineAnalyzeJoinCollisionSpec`,
    `PipelineAnalyzeConciseByteBudgetSpec`, `UpsertTargetWritableRoutesSpec`): 82 tests, all pass. Every suite name
    appears in the output.
- frontend `build`: N/A, because no `frontend/**` file changed.

Point-by-point:
- **(a) C12 MCP red evidence is genuine.** I checked it myself. I made a throwaway worktree detached at bf481b1fe
  and overlaid only the HEAD versions of the MCP test files, `contextBudgetFixture.ts`, `context.test.ts` and the
  new schema. The pre-change `context.ts`, `helioApi.ts` and `types.ts` stayed in place. Then I ran jest on the
  four files. Result: 11 tests failed and `helioApi.contextAnalyze.test.ts` failed to compile.
  - Every budget test failed, including constant-in-P, 31, 85, 141, the 200-pipeline test, and the
    absent-only-analyze test. All four D7 stderr-mode tests failed too.
  - The seam test and the golden tests passed there. That is expected: the seam test checks the fake against the
    schema, and the goldens are pre-change output.
  - So the tests fail because the client change is missing, not because the schema file is missing.
  - The throwaway worktree was removed and `git worktree list` is clean.
  - The deviation itself is real: the MCP tests were not committed red. It is acceptable, because the hook runs
    jest and red-mcp.txt was committed in bf481b1fe before the implementation.
- **(b) The D8 seam guard still catches key drift.** The local `Step` has the same `required` set and the same
  `additionalProperties: false` as `pipeline-analyze-response.schema.json#/$defs/AnalyzeStep`, and `Warning`
  matches `AnalyzeWarning` the same way. `SchemaField` is `$ref`'d and closed. The schema loosens only values: the
  warning `code` enum, and a `null` `validationError`. Both loosenings are forced by golden values that C15 forbids
  regenerating. The tests prove key renames fail at the envelope, item, step and warning levels on both the
  backend side (real body) and the MCP side (fake body). The fake items are built from the fake `/analyze` bodies,
  and a test asserts they are equal.
- **(c)** See Phase 1, issue 1. The code handles it correctly; the problem is the artifact and the claim.
- **(d)** Confirmed, see Phase 1.
- **Owner assert (D5)** is present (`PipelineContextAnalyzeReads.scala:421`).
- **Batch reads.** The batch by-id filters are copied from their single counterparts (`findByIdsOwned` uses the
  user context and `owner_id`; `findByIdsInternal` uses the system context). Malformed ids are excluded from the
  `IN` set and fail only their own pipeline.
- **Security.** Only ids that came from `listSummaries` reach the internal batch reads.

### Phase 3: UI Review — PASS (API-only; no UI surface changed)

Triggers matched (`ApiRoutes.scala`, `schemas/**`), but there is no `frontend/**` change. I started the servers with
`start-servers.sh` (`PASS servers`) and ran a live smoke check:
- `GET /api/pipelines/context-analyze` returns `401` with no credential, the same as `/api/pipelines` and
  `/context-details`, directly and through the Vite proxy.
- With a fresh session it returns `200 {"items":[]}`.

The servers were stopped with `stop-servers.sh` (`STOPPED ports=7057,9964`; `/health` no longer answers).

### Overall: FAIL

### Change Requests
1. Fix the spec divergence in Phase 1, issue 1. Pick one option:
   - **(preferred) Amend the artifacts.** Change the scenario in `specs/pipeline-context-analyze-read/spec.md` and
     design.md D6 to say what is built:
     - isolation applies to a pipeline's projection;
     - a stored step that cannot be decoded fails the whole read with an error status, the same as
       `/context-details`;
     - the MCP then analyzes each pipeline separately, with an identical payload and one stderr line.

     Record this under measurements.md "Deviations", and say that isolating it here alone would not restore the
     budget, because `/context-details` fails on the same row.
   - **Or isolate it.** Decode step rows per pipeline with `Try`. For example, add a batch variant that returns rows
     grouped by `pipeline_id` and call `PipelineStepRepository.domainOf` per group inside `Try`. Omit and WARN the
     pipeline whose rows fail. Add a test that inserts one undecodable `pipeline_steps` row through `privilegedDb`
     raw SQL, then asserts `200` with that pipeline absent and the others present.
2. Update design.md D8 to match the implemented schema: its own `Step`/`Warning` definitions with the same keys as
   `AnalyzeStep`/`AnalyzeWarning`, `SchemaField` by `$ref`, and why (the golden values `code: "w"` and
   `validationError: null`, C15).

### Non-blocking Suggestions
- `contextBudgetFixture.ts` changed the fake `outputSchema` types from `number` to `float`. This does not affect the
  goldens, because the MCP projects names only, and `float` is in the real `SchemaField` enum. Mention it in the PR
  body so it does not read as a fixture edited to make a test pass.
- At bf481b1fe the backend test source set does not compile (`red-backend-count.txt`), so that commit is not
  bisectable for the backend.
- `helio-mcp/src/context.ts` is now 794 lines, over the ~400-line "propose a split" threshold. Note it in the PR.
- Phase 3 left a registered lane-DB user `eval-hel1625-*@example.test` (id `112bc1b3-6a8c-43b6-b756-92a829d2c22f`)
  in `helio_hel1625`. It is lane-private; delete it by that exact id if the lane DB outlives the run.
