## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD `9fe908931da741aa29afbc9fb76f01523bc1fa83`. The diff base was resolved live with `resolve-review-base.sh` (main/origin) and is `2dd4ed6237817b1feef22d69f8bc8058e58541db`. The spawn-cwd guard returned READY.

### What I verified (with evidence)

**Diff (`git diff 2dd4ed62...HEAD`, 35 files).** I read the full code diff myself:
- `AnalyzeSchemaWarnings.scala`: new, pure post-pass.
- `PipelineService.scala`: three call sites (`analyze`, `analyzeConcise`, `analyzeProposal`).
- Both protocol files.
- All three `schemas/pipelines/*analyze*` JSON Schemas.
- helio-mcp `types.ts`, `read.ts` and `pipelineProposal.ts`.
- Frontend `pipelineStep.ts`.

**AC1: three shapes, schema-only, on both endpoints.**
- `compute(nodeInputs, projections, secondarySchemas)` takes only the projections and the already-resolved secondary schemas. It does no I/O and reads no rows.
- It is wired into `analyze` (PipelineService.scala:997), concise (:1136) and the proposal (:1458).
- Coverage of the three shapes:
  - Missing field: `referencedFields` plus the `in.names` gate.
  - Join-key type mismatch: `family` grouping over the canonical `DataFieldType.asString` values string/integer/float/boolean/timestamp/string-body/binary-ref, which I checked in `model.scala:677-699`.
  - Collision: shown as a rename via `JoinColumnNaming.resolve`/`resolveWithKey`, the same functions `inferJoin`/`inferLookup` use.
- `PipelineAnalyzeSchemaWarningsSpec` checks all three codes on the persisted route and on the proposal route (by client step id), against embedded Postgres.

**AC2: non-blocking.**
- `grep AnalyzeSchemaWarnings` over `backend/src/main` finds no consumer apart from the three response constructions. Nothing reaches `validationError`, `toCostVerdictResponse`, `stepConfigProblem`, `validateRawConfig` or `AutoRunTriggerService`.
- `PipelineAnalyzeService.scala` only widens the visibility of `laneDependencyOf`; there is no logic change.
- The spec's GUARD tests assert that a warned pipeline has `canRun == true`, has no `step-config-invalid` reason, has no `validationError` on any step, passes `stepConfigProblem == None`, and still accepts `updateStep`.

**AC3: evidence-based wording (HEL-1280 staleness).** Each message names its evidence base:
- "not found in this step's inferred input schema" / "...inferred secondary input schema"
- "(types are from the inferred schemas)"
- "(per the inferred schemas)"

The MCP description also says "treat each as a hint to check, not proof".

**AC4: contract ships with the code.**
- The full and proposal schemas both make `warnings` required and define `$defs.AnalyzeWarning` with the code enum.
- In the concise schema, `warnings` is optional with `minItems 1`, which matches the Option omission.
- helio-mcp `AnalyzeWarning` and the frontend types are updated.
- `node scripts/check-schema-drift.mjs` → "schemas in sync with JsonProtocols (122 checked across 54 protocol files)", exit 0.

**AC5: red-first per class.** `AnalyzeSchemaWarningsSpec` has positive cases for each class. `files-modified.md` §1.4 records that all 30 positive cases were red against a stub. The evaluator (cycle 2) independently reproduced a mutation going red. The spec's tests are not vacuous: for example, the compute-suppression test also asserts that the projected key type is `float`.

**Gates (fresh runs, mine):**
- `sbt "testOnly com.helio.domain.engine.AnalyzeSchemaWarningsSpec com.helio.services.pipelines.PipelineAnalyzeSchemaWarningsSpec"` → 64 succeeded, 0 failed. The per-test lines were printed, including the runtime JoinStep equality probes.
- `npm run typecheck` (frontend): clean.
- helio-mcp `tsc --noEmit`: exit 0.
- jest on the helio-mcp server, proposal-handler and context tests: 3 suites, 66 passed.
- Frontend jest on `src/features/pipelines`: 91 suites, 1226 passed.
- I relied on the evaluator's pasted full `sbt testFull` result (6299/0) and did not re-run it.

**False-positive review (adversarial):**
- An empty secondary source schema cannot read as "complete". `resolveSecondarySourceSchemas` filters `_.nonEmpty` (PipelineService.scala:1094), so such a secondary is unresolved and produces no warning.
- An empty root schema is not name-complete (`Flags(a.inputSchema.nonEmpty, ...)`).
- `count` with a field counts non-null values (AggregateStep.scala:156), so referencing that field is meaningful. An empty field is filtered out.
- Steps that already carry a blocking unknown-field error are skipped (`validationError.isEmpty`), so nothing is reported twice.

**UI judgment:** not applicable. The frontend diff is types and `warnings: []` fixtures only; nothing is rendered, and the comment marks rendering as a follow-up. No servers were started, no browser was used, and I created no dev-DB rows.

### Verdict: CONFIRM

### Non-blocking notes
- `helio-mcp/src/tools/read.ts` still describes the concise shape as having "no column lists", but a concise warning message can embed "(available: ...)" with up to 20 names. The size per warning stays bounded. Consider either dropping the available-list from concise messages or correcting the description. `PipelineAnalyzeConciseResponse.ByteBudget` (8192) is enforced only by a fixture test on a clean graph.
- A source-kind `lookup` never gets a `join-column-renamed` warning, because `sourceDependencyOf` covers only `join`. This is consistent with the spec ("whose secondary schema is resolved"), but the rename depends only on the input names and `config.columns`, so it could be reported. Candidate follow-up.
- Join type families trust a root's stored types. A non-CSV source whose stored type disagrees with its run-time values could produce a misleading hint. The wording already discloses this.
- Documentation nits carried from evaluation-2: the header comment in `PipelineAnalyzeSchemaWarningsSpec.scala:25-28` points to "verification notes", and note 1.3 in `files-modified.md` gives a stale reason for `compute`.
