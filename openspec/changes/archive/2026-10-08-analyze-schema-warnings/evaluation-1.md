## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed HEAD `96f05a9aa399ff3668b165614cc35ccf2a1a566c` (executor commit e6c61f3d plus a merge of origin/main; the merge brings in only HEL-1387/V117). Diff base resolved live: `2dd4ed6237817b1feef22d69f8bc8058e58541db`.

### Phase 1: Spec Review — FAIL

- AC1 (warnings on persisted and proposal analyze, schema-only): met. Confirmed live on this worktree's backend (:9574, process cwd checked to be this worktree). A two-root CSV pipeline (string `id` JOIN lane `cast id→integer`, both sides carrying `total`, then `count(amount)`) returned all three codes on `GET /analyze`, on `?concise=true` (per-node messages; key left out on the clean `cast` node) and on `POST /analyze-proposal` (keyed by client ids `j`/`a`). A dry run of the same pipeline showed the warnings are accurate: the join step produced 0 rows (`stepRowCounts`) and the result was `n = 0`.
- AC2 (non-blocking): met. In the live probe, `canRun: true` and every step had `validationError: null`. The only reason was the pre-existing `row-estimate-unavailable`. `stepConfigProblem(op, rawConfig)` and write-time `validateRawConfig` take no schema, so they have no way to read a warning. `PipelineAnalyzeService` changed in visibility only (`laneDependencyOf` is now `private[engine]`).
- AC3 (wording states the evidence): met for missing-field ("not found in this step's inferred input schema") and type-mismatch ("types are from the inferred schemas").
- AC4 (contract ships with the code): mostly met. JSON Schemas, helio-mcp types and frontend types are updated. **Divergence:** the change's own spec (`specs/pipeline-analyze-schema-warnings/spec.md`, "MCP analyze tools expose warnings" → scenario "Tool description") requires both `analyze_pipeline` and `analyze_pipeline_proposal` descriptions to say that warnings "do not affect `canRun`". `helio-mcp/src/tools/pipelineProposal.ts:164-177` does not say this. The test that should catch it, `helio-mcp/src/server.test.ts`, is titled "%s names warnings, the three codes, and that they never block or affect canRun" and runs for both tools, but it only asserts the canRun text for `analyze_pipeline`. → CR1.
- AC5 (red-first test per class): met in substance. See Phase 2 for my own mutation runs.
- Tasks: task 4.1 says "Show each guard failable by a temporary mutation (document, then revert)" and is checked off, but no record of it exists. `files-modified.md` has no mutation notes, and `.concertino/runs/HEL-1235/evidence/` has none either. Meanwhile the header of `backend/src/test/scala/com/helio/services/pipelines/PipelineAnalyzeSchemaWarningsSpec.scala:25-28` says "Each was shown failable by a temporary mutation ... (see the change's verification notes)". Those notes do not exist. → CR3.
- Scope: no scope creep. The non-goals hold: no rendering, no `get_workspace_context` surfacing (`helio-mcp/src/context.ts` still keeps only steps), and no lookup key-type check.
- CONSTRAINTS: the list is empty, so nothing to honor.

### Phase 2: Code Review — FAIL

**Gates (my own fresh runs in WORKTREE_PATH at the reviewed HEAD):**
- `npm run lint`: clean, 0 warnings
- `npm run format:check`: all files pass
- `npm run typecheck` (frontend) and helio-mcp `npm run typecheck`: clean
- Root `jest`: 42 suites / 408 tests pass. Frontend jest: 475 suites / 4970 tests pass.
- `npm --prefix frontend run build`: succeeds
- `node scripts/check-schema-drift.mjs`: in sync (122 checked)
- `npm run check:scala-quality`: clean (soft size warnings only)
- `cd backend && sbt testFull`: **6299 succeeded, 0 failed**, 4 canceled (pre-existing env-gated measurement specs). The log confirms `AnalyzeSchemaWarningsSpec` (64 cases), `PipelineAnalyzeSchemaWarningsSpec`, `PipelineAnalyzeConciseByteBudgetSpec` and `AutoRunTriggerServiceSpec` all ran, so the sbt cache did not skip them.

**My own mutation runs** (in a throwaway detached worktree at the reviewed SHA, which I removed afterwards; the delivery worktree was never touched). These replace the executor's unverified failability claims:
- Round 1 mutations: `join|union` name rule → `in.names`; `pivot` → `in.names`; `typesPreserved` default → `true`; `canRun && warnings.isEmpty` in `PipelineService.analyze`. Results: (a), (b), (g), (h), fillnull, and GUARD D6a all went **red** (6 failures).
- Round 2 mutations: root flags → always complete; validationError node → transparent; lookup → always type-trusted; `compute` added to TYPE-TRUSTED; concise and proposal wiring → empty. Results: "input schema empty", (c), (d), (f), both left-name-incomplete cases, the concise test and the proposal test all went **red** (8 failures).
- So the executor's flagged weak spots hold: the D3a negatives (a)–(h), the concise test, the proposal test and the D6a guard are all failable. **Exception:** the compute test (`AnalyzeSchemaWarningsSpec`, "be suppressed after a compute whose type is only a user-declared fallback") stayed **green** with `compute` trusted, so it is vacuous. → CR2.

**Review findings:**
- CR2 (tests meaningful). `AnalyzeSchemaWarningsSpec.scala` compute case: the config is `{"column":"id","expression":"$a","type":"integer"}` and `a` is a `string`. `ExpressionEvaluator.inferType("$a", …)` returns `Right("string")`, so the projected `id` is `string` and the declared `integer` fallback is never used. The right side is also `string`, so no warning is possible whether `compute` is trusted or not. The test does not exercise the scenario its name describes. Separately, the comment justifying the drop (`AnalyzeSchemaWarnings.scala:51-56`, "falls back to the user-declared `type` when inference yields nothing") looks inaccurate as a runtime rationale. Once `ExpressionEvaluator.validate` passes, `inferType` returns `Right` for every AST arm I read (`ExpressionEvaluator.scala:473-501`), so the `getOrElse(wireType)` fallback in `inferCompute` is effectively unreachable. Dropping `compute` is still a sound conservative choice: the projected `string` for `+` versus the evaluator's runtime coercion is unverified. But the comment should give the real reason.
- The executor's other decisions hold up:
  - Dropping `fillnull`: its mutation test went red, and `constant` writes the raw string.
  - Trusting `cast` only for some targets: `CastStep.castValue` (`CastStep.scala:69-80`) returns `str` for `float`/`timestamp`/other targets while `inferCast` projects the canonicalized target. `date` canonicalizes to `timestamp`, and family `None` means it never warns.
  - Lookup type-complete only when every requested column resolves: correct, because `inferLookup` puts a `string` placeholder on unresolved columns. Test (f) is red under mutation.
  - Join-key families: correct. `JoinStep` indexes by `groupBy(_.getOrElse(joinKey, null))`, which is a `Map[Any,_]` with cooperative numeric equality. The executor's spec probe through the real `JoinStep` confirms Int/Long/Double/BigDecimal match each other and String never matches a number, and my live dry run reproduced the string-vs-Int miss. JSON/REST numbers become `Double` (`PipelineRowJson.scala:57-61`), which is consistent with the numeric family. Timestamp and binary-ref never warn, which is a conservative choice.
- Canonical code-quality ([mechanical]): no inline FQNs (the imports are at the top of the file). `check:scala-quality` is clean. No dead code or TODOs.
- Security: messages list column names from the input or secondary schema. The full analyze response already exposes the same names (and HEL-1236 already projects secondary names into the join output), so nothing new is disclosed.
- DRY: reuses `JoinColumnNaming.resolve`/`resolveWithKey` (the same functions `inferJoin`/`inferLookup` call), `laneDependencyOf`/`sourceDependencyOf`, and the `secondarySchemas` already resolved by each service path. No second resolution.
- Behavior preservation: the per-step response shapes are byte-identical. The new fields are additive, and the case-class defaults keep existing constructions compiling.

### Phase 3: UI Review — PASS (limited; see note)

- No frontend rendering changed. The `frontend/**` diff is TypeScript types (`pipelineStep.ts`) and `warnings: []` added to 7 test fixtures. The other triggers are `schemas/**`, which is contract-only.
- Observable behaviour was verified at the API level against this worktree's servers (above): happy path, concise omission on the clean node, and an unblocked run. The frontend build and all 4970 frontend tests pass with the now-required `warnings` field.
- **Environmental limitation:** Chromium refuses the pinned `DEV_PORT=6667` with `net::ERR_UNSAFE_PORT`, because 6667 is on Chromium's restricted-port list (IRC). So no Playwright check can run against this run's frontend.
  - I tried a second frontend on 6680 via `start-servers.sh`. The backend's CORS is pinned to `http://localhost:6667`, so login was refused ("CORS request rejected: invalid origin"). I stopped that frontend by exact verified PIDs (4168772 vite / 4168757 npm, cwd = this worktree's `frontend`, env `PORT=6680`). The 6667 frontend and the 9574 backend were left running.
  - Side effect: that attempt overwrote `WORKTREE_PATH/.concertino-frontend.log`. It is untracked.
  - Because the diff renders nothing, I am not calling this a BLOCKER. But the orchestrator should know that **any Chromium-based gate (the skeptic included) cannot load DEV_PORT 6667**.

### Overall: FAIL

### Change Requests

1. **Spec divergence, MCP proposal tool description.**
   - Problem: `helio-mcp/src/tools/pipelineProposal.ts:172-176` does not say that analyze warnings do not affect `canRun`, which the spec scenario "Tool description" requires for `analyze_pipeline_proposal`.
   - Description fix: add a phrase such as "they do NOT affect canRun (or applyReady)". The proposal response has no `costVerdict`, so it may be clearer to say they never gate apply or run.
   - Test fix: in `helio-mcp/src/server.test.ts`, move the `"NOT affect canRun"` assertion into the `it.each` so it runs for both tools. As it stands, that `it.each` title says "affect canRun" but asserts nothing about canRun.
   - Alternative: if you decide canRun is meaningless for the proposal tool, amend the spec scenario instead. Do not leave the two disagreeing.
2. **Vacuous test (it passes with `compute` trusted).**
   - Problem: the `AnalyzeSchemaWarningsSpec` case "be suppressed after a compute whose type is only a user-declared fallback" cannot fail.
   - Fix: rewrite it so trusting `compute` would emit a `join-key-type-mismatch`. For example, have the compute's projected key type fall in a different family from the right side's key type (`{"column":"id","expression":"$a * 1","type":"float"}` projects `float` against a `string` right key), then assert no warning. Rename the test to match what it actually exercises.
   - Also correct the rationale comment at `AnalyzeSchemaWarnings.scala:51-56`. After `validate` passes, the declared-type fallback is effectively unreachable, so state the real reason `compute` is untrusted: the projected type is not proven to equal the evaluator's run-time value class.
   - Verify: show the rewritten test red with `"compute"` added to `typeTrusted`, then green after reverting.
3. **Dangling evidence claim.**
   - Problem: `PipelineAnalyzeSchemaWarningsSpec.scala:25-28` cites "the change's verification notes" for guard mutations, and none exist. Task 4.1's "document" step is unmet.
   - Fix: add a short "Mutation evidence" section to `files-modified.md` listing, for each guard (D6a, D6b, D6d), the mutation applied and the red test name. This evaluation's rounds can be cited for D6a and the D3a negatives. For D6b/D6d, either record a real red or label them honestly as invariants that cannot be failed by routing warnings, since `stepConfigProblem`/`validateRawConfig` take no schema. Then make the spec header comment point at that section. Otherwise, remove the claim.

### Non-blocking Suggestions

- Concise mode was documented as "no column lists" (`helio-mcp/src/tools/read.ts` description; HEL-914 D6). Each concise warning now carries an `(available: …)` list of up to 20 column names. `PipelineAnalyzeConciseByteBudgetSpec` stays green only because its fixture has no warnings. Consider dropping the available-list from concise messages, or update the description to say concise warnings may include column names.
- `lookupRenames` requires a resolved secondary, so a `source`-kind lookup (the common case, since `sourceDependencyOf` covers only `join`) never gets a `join-column-renamed` warning. The rename depends only on input names and `config.columns`, so it could be reported there too. The current behaviour is spec-consistent and conservative.
- The `join-column-renamed` wording ("collides with an input column and will appear as …") does not state its evidence base, unlike the other two codes. Consider adding "per the inferred schemas".
- Task 6.3 asked for the executor's dev-DB residue ids to be recorded. They are not in `files-modified.md`.

### Dev-DB residue created by this evaluation (exact ids)

- user `b1e7b89c-b6cd-4938-811a-51ea7f80ba3c` (`eval-hel1235-1791491193@helio.test`)
- data sources `32bac942-6f07-4589-a76b-3e05575bddaf` (eval-left), `ada7c41e-e022-42fe-a425-de1885498e81` (eval-right), plus their CSV upload files `csv/<id>.csv`
- pipeline `0e4ccf3d-f88f-4496-a9c0-f094ee5c1e95`; roots `c214a00b-675e-476a-a37e-17eab639f316`, `26663b23-c93c-41b7-b2d3-e33209509761`; steps `d4209362-9b3d-4923-89a3-f973ae4cfbee`, `a75c3ead-c80a-47f3-b3a9-bab8b6631259`, `0ed6ed7a-0e4e-4e4d-9d54-cbf5586d6764`
- dry run `382c7c5f-683d-47a0-9d7c-9d5cb4b77286`
- Note: the shared Playwright browser was already logged in as another user when I started. My login attempt on 6680 failed (CORS), so that session cookie was not changed.
