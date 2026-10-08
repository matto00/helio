## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed HEAD `420524f8a6248d78dc346442ddccb1989e3b9629` against the live-resolved base `55b7c4269d90eea7f3c71f3a2e3857a4018ee47b` (resolve-review-base.sh, origin/main).
Spawn-cwd guard: `READY ambient=/home/matt/Development/helio branch=bug/output-config-key-validation/hel-1313`.

### Gates (my own fresh runs, in WORKTREE_PATH)

| Gate | Result |
|---|---|
| `cd backend && sbt testFull` (nice 19) | exit 0 — `Tests: succeeded 6150, failed 0, canceled 4`; "All tests passed." The run covers the full suite after the executor's last fix. |
| The 4 canceled tests | All four are opt-in `HELIO_MEASURE=1` measurement tests that are always skipped: 3x `DatasetWriteSubmitLatencySpec` "reports p50/p95…" and 1x `OutputFilteredMetricMeasurementSpec`. They predate this change and are unrelated to it. |
| Changed specs present in that run | OutputConfigValidationSpec, OutputConfigKeyValidationSpec, OutputHistoryPayloadsAvailableSpec, OutputCompareWriteValidationSpec, RefinementEditShapeSpec, AssistantProposalToolSchemasSpec, PatchSetApplyServiceSpec and OutputRoutesSpec each appear once. |
| `npm run lint` | clean |
| `npm run format:check` | "All matched files use Prettier code style!" |
| `npm run typecheck` (frontend) | clean |
| `npm --prefix helio-mcp run typecheck` | clean. This covers the separate helio-mcp tsc check the executor skipped. |
| root jest (helio-mcp + scripts), maxWorkers=3 | 42 suites / 401 tests passed. All 5 cases of the new `server.test.ts` "documents the Output config key set" `it.each` ran and passed. |
| `npm --prefix frontend test`, maxWorkers=3 | 465 suites / 4903 tests passed |
| `npm --prefix frontend run build` | success |
| `check-scala-quality.mjs` | clean (soft warnings only) |
| `check-schema-drift.mjs` | in sync (122 schemas, 14 AssistantProposalToolSchemas surfaces) |
| `check-openspec-hygiene.mjs` / `openspec validate … --type change` | clean / valid |

**Mutation evidence (task 4.6).** No mutation artifact exists in the worktree or in `.concertino/runs/HEL-1313/evidence`, so I ran the mutations myself. I used a throwaway detached worktree at the reviewed SHA and removed it afterwards (`git worktree list` shows no leftover). Every mutation turned its tests red:
- `OutputService.validateConfig` ValidateWrite branch set to `Right(())`. This turns red the route POST/PATCH, preview, legacy-key, malformed-aggregation and HEL-877-superseded tests: 8 in OutputConfigKeyValidationSpec plus 1 in OutputRoutesSpec.
- Only the `PipelineService.validateOutputFieldMapping` call to `OutputConfigValidation.validate` removed. This turns red "400 an unknown key and persist no pipeline" and "report an unknown key as the proposed Output's validationError". Both the single-call and grounding paths are therefore guarded by the PipelineService call itself.
- `PatchSetApplyRollback` changed to pass `ValidateWrite` instead of `RestorePriorStored`, run in isolation. This turns red "roll back an output config edit restoring a scatter chart … (HEL-1313)", which proves D9.
- `KeysDoc` removed from the `propose_patch_set` patch description. This turns red "document them on propose_patch_set's edit patch description".
- `KeysDoc` removed from the RefinementEditShape Output-edit text. This turns red the RefinementEditShapeSpec HEL-1313 test.

(An earlier combined run that also mutated the rollback policy masked the rollback test, because ValidateWrite was neutered as well. I re-ran that mutation in isolation; the result above is from the isolated run.)

### Phase 1: Spec Review — FAIL

- AC1 (unknown key → 400 naming it, every kind): PASS. Covered by the unit tests, the route tests (POST and PATCH for each of the 6 kinds) and a live probe on the dev server: `chartTyp` returns "did you mean `chartType`?", `legend` returns the appearance.chart hint, `metricLabel` returns "renamed: use `label`", and table `aggregation` returns "not a table config key".
- AC2 (aggregation is applied or rejected): PASS. A well-formed chart aggregation renders grouped. Live check: a bar Output with `{groupBy: region, agg: sum, yField: amount}` over the rows east 10, east 5, west 7, north 3 renders east=15, north=3, west=7. Evidence: `/home/matt/Development/helio/.concertino/runs/HEL-1313/evidence/e2e-evidence/HEL-1313/eval-c1-agg-bar-1440.png`. Malformed, scatter and non-aggregating-kind cases return 400 (tested, and probed live).
- AC3 (legacy keys do not break reads): PASS. A V94-keyed Output survives GET, an unrelated PATCH, a full round-trip PATCH and a null clear (OutputConfigKeyValidationSpec). Rollback restores a legacy key plus a scatter aggregation (PatchSetApplyServiceSpec).
- **Issue (spec divergence, `mcp-output-tools`):** the requirement says the doc text SHALL appear on "any pipeline-proposal tool that carries Output config". Three helio-mcp tools accept `outputs[].config` through `pipelineProposalInputSchema` but do not carry `OUTPUT_CONFIG_KEYS_DOC`:
  - `analyze_pipeline_proposal` (`helio-mcp/src/tools/pipelineProposal.ts` ~L159-173)
  - `apply_pipeline_proposal` (~L186-202)
  - `apply_combined_proposal` (`helio-mcp/src/tools/combinedProposal.ts` L51-96, `pipeline: z.object(pipelineProposalInputSchema)`)

  `apply_pipeline_proposal` and `apply_combined_proposal` are the tools that actually persist that config, and they now return 400 on an unknown key. Today an agent calling either tool directly sees nothing that tells it which keys are allowed.
- Scatter rule implemented as "changed from stored" (`OutputConfigValidation.scala` L107/L112): **accepted, not a divergence.** design.md D3 explicitly applies the tolerance rule to `aggregation`/`chartType` value checks ("validated only when the written value differs from the stored one"). The requirement's own opening clause also reads "when the written `aggregation` differs from the stored one". Under a literal "sets either key" reading, a GET→PATCH round trip of a stored editor-made scatter+aggregation Output would return 400, which breaks AC3. The phrase "when the write sets either key" in the spec delta is looser than the code and could say "changes"; see the suggestions.
- Fixture changes beyond task 1.6: **both are legitimate contract changes, not tests edited to pass.**
  - `OutputCompareWriteValidationSpec` L95 changes `legend` to `label`. With `legend` the test would now return 400 because of the unknown key, so it would pass vacuously. Using a known metric key keeps the 400 attributable to the stored invalid `compare`, which preserves the test's intent.
  - `OutputHistoryPayloadsAvailableSpec`: `historyPayloadsAvailable`/`historyPayloadLimits` sent as config keys are now unknown keys, so 400 is the new contract. The executor added a follow-up `{"name":"renamed"}` PATCH (L155) and a GET (L252), so the original anti-spoof assertion that the top-level field stays server-computed is still checked.
- Tasks: every box is checked and matches the diff. The exception is 4.6, whose mutation evidence was never produced; I supplied it (see Gates).
- No regressions in other specs: the full suite is green.
- Schemas updated (D8): yes. `additionalProperties` is correctly not set to false on `config`, and schema-drift is in sync.
- Planning artifacts reflect the implementation, apart from the skeptic's carried cosmetic "both prompts" wording in design.md Risks.
- CONSTRAINTS: `[]`, nothing to honor.

### Phase 2: Code Review — PASS

- Imports/qualifiers: no inline FQNs, and check-scala-quality is clean. File sizes: `OutputConfigValidation.scala` is 157 lines. OutputService (503) and PipelineService (2628) were already over budget and grew by a few lines; that is informational only.
- DRY: one validator, one `KeysDoc` shared by all three backend prompt surfaces, and one `OUTPUT_CONFIG_KEYS_DOC` for helio-mcp. `mergeConfig` is shared with the preview projection.
- Design: there is a sealed `OutputConfigWritePolicy` ADT. Its default `ValidateWrite` is never reachable as `RestorePriorStored` from a route; the only call site is `PatchSetApplyRollback.scala` L183. The raw-restore comment in `PatchSetUndoService` is present.
- Error handling: all failures are `ServiceError.BadRequest` with actionable messages that list every offending key, sorted. `OutputEditorSheet.tsx` L358-361 now shows the thunk's rejected string, and falls back to the generic text otherwise.
- Tests are meaningful, as the mutations above prove.
- No dead code, TODOs or `any`.
- Security: JSON shape checks happen only at the boundary, and no value is reflected unsafely; React escapes the message text.

### Phase 3: UI Review — PASS

Servers started with `start-servers.sh` and asserted with `assert-phase.sh servers` (frontend 6745, backend 9652): PASS.
- Happy path:
  - A single-call pipeline create with a chart aggregation Output and a metric `{agg}` Output returns 201.
  - The Output editor on the chart: switching Bar → Scatter → Save closes the sheet and stores `aggregation: null, chartType: "scatter"` (D7, live).
  - The metric editor Save stores `{aggregation: {value, agg}, fieldMapping: {}}` without a 400.
  - Switching the chart back to bar with the aggregation and placing it on a dashboard renders the grouped bars (screenshot above).
- Unhappy paths: a live 400 occurs for scatter+aggregation, `legend`, a `metricLabel` change and table `aggregation`, each with a clear message. The editor's rejected-save message is covered by `OutputEditorSheet.saveError.test.tsx`. The editor builds only known keys, so I could not trigger a server 400 through the live editor.
- Console: the only errors were the pre-existing `GET /api/pipelines/:id/schedule` 404 (no schedule set) and the 400s I triggered on purpose. The 4 ECharts "Can't get DOM width" warnings come from the editor preview inside the dialog and predate this change.
- Breakpoints: the only visual change in this diff is the editor's error text, which reuses the existing saveError slot. There is no layout change, so I did not do a breakpoint sweep beyond the 1440 render.
- Dev-DB residue, recorded by exact id: user `2f3804bb-d6c4-4b4d-a45a-1759f9932ddd` (eval-hel1313-c1-1791457430962@example.test), data source `0c30e083-db28-4e7f-ae56-f3f0f9170ae1`, pipeline `90937e4f-8b39-4fab-8d4a-754cd05d7c9b`, outputs `5f12d58c-3e0e-4b42-9999-3c3373bbac1b` and `bf8149e0-6e6d-43b4-8412-4a6d2e8ea49b`, dashboard `93bf9879-76b8-4bca-8450-0a7f0a302172`, panel `d53d8b8f-8240-44c5-b99e-367e2096929a`. Also note: the shared Playwright browser was already signed in as another lane's user (dashboard "HEL-1189 Skeptic Verify") before my register call replaced the session cookie.

### Overall: FAIL

### Change Requests
1. **helio-mcp: document the Output config keys on every tool that carries Output config** (spec `mcp-output-tools`: "any pipeline-proposal tool that carries Output config").
   - Append `" " + OUTPUT_CONFIG_KEYS_DOC` to the `description` of:
     - `analyze_pipeline_proposal` (`helio-mcp/src/tools/pipelineProposal.ts`, description ending "…nothing is persisted).")
     - `apply_pipeline_proposal` (same file)
     - `apply_combined_proposal` (`helio-mcp/src/tools/combinedProposal.ts`, before `CONTROLS_COPY`, importing `OUTPUT_CONFIG_KEYS_DOC` from `./outputs.js`)
   - Then add `"analyze_pipeline_proposal"`, `"apply_pipeline_proposal"` and `"apply_combined_proposal"` to the `it.each` list in `helio-mcp/src/server.test.ts` (the HEL-1313 block at ~L290), so the test fails if any of them drops the doc.
   - Alternative, if the owner/orchestrator prefers documenting only propose-time surfaces: narrow the spec delta's tool list to name exactly the tools that carry it, so spec and code agree. Do not leave the "any … tool that carries Output config" wording unmet.

### Non-blocking Suggestions
- `specs/output-routes-api/spec.md`: rephrase "when the write sets either key" to "when the write changes either key from its stored value", so the scatter rule's wording matches D3 and the implementation.
- `AssistantProposalToolSchemasSpec.scala` `assertListsEveryKindAndShape`: `doc shouldBe a[String]` is a no-op assertion; drop it.
- `PipelineService.scala` L681: the chained one-liner (`OutputConfigValidation.validate(...).flatMap(...).flatMap(...).left.map(...).flatMap {`) is long. Splitting it across lines would read better.
- `PatchSetPreviewProjection.scala` L125: the edited doc-comment line is now much longer than its neighbours; re-wrap it.
- design.md Risks bullet 4, "both prompts", should read "three surfaces" (carried from skeptic-design-5).
