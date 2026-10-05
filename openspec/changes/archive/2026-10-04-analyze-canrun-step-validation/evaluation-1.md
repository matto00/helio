## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed commit f50766bd5fb0c425bb8f4ea104b07411b5670fa8.

### Phase 1: Spec Review — PASS
Issues: none.
- AC1: PipelineService.toCostVerdictResponse adds one `step-config-invalid` reason per enabled step with a validationError and clears autoRunnable and canRun. Verified live: GET /analyze on a pipeline with a `bogus_fn` aggregate returned canRun=false, autoRunnable=false and the named reason.
- AC2 (consumer enumeration, re-grepped independently over backend/src, frontend/src, helio-mcp/src, e2e/, frontend/e2e): consumers are the PipelineDetailFooter and usePipelineDetailPage "Run to update" gating, deniedPipelinesToast (auto-run Denied entries, a separate path with canRun hard-wired to permission), AutoRunTriggerService (own canRun, unaffected) and helio-mcp types/read.ts. None relies on the old behaviour; the e2e hel1096 spec uses a denial mechanism without a validationError. The proposal-mode analyze has no costVerdict (the AC is vacuous there, as the ticket premise findings say).
- AC3: red evidence (red-backend-unfixed.txt, 4 failures from unfixed code) and green. I reproduced a mutation myself (below).
- Scope: PipelineRunService, Main, ApiRoutes, NodeSnapshotRepository are absent from the diff; no migration.
- Schema: the stale `AnalyzeStep` ($defs op/string-config) was corrected to `type` + object `config`, matching AnalyzeStepResponse (`type` discriminator, typed config object). The sibling proposal-response schema already documents this same stale-definition divergence and does not $ref it, and the concise schema does not reference it. The route spec validates the real response against the schema. Only consumer of the changed def is the analyze route validation, which passes. Acceptable and justified.

### Phase 2: Code Review — PASS
Issues: none blocking.
Gates (my own fresh runs, nice -n 19):
- `sbt testFull`: 5709 succeeded, 0 failed, all passed (no FirstRunRoutesSpec timeout, no flake).
- Frontend: lint clean (0 warnings), format:check clean, typecheck clean, jest 422 suites / 4386 tests pass, `npm --prefix frontend run build` OK.
- helio-mcp tests (37 suites / 361 tests) pass.
Mutations reproduced:
1. Backend: reverted only `canRun && configReasons.isEmpty` to `canRun`: 3 tests red (PipelineAnalyzeCanRunRoutesSpec seam, PipelineServiceCanRunSpec x2). Restored; git clean.
2. Frontend: removed the `step-config-invalid` DENY_REASON_COPY entry: 5 tests red, asserting the specific misconfigured-step wording vs the fallback. Restored; git clean.
New route spec `PipelineAnalyzeCanRunRoutesSpec` mixes in `com.helio.testkit.HelioRouteTest`. Code is small, uses a named constant, a doc comment records the decision, and the footer dedupe (Set) is a sensible reaction to repeated identical sentences.

### Phase 3: UI Review — PASS
Issues: none.
Seam (design D5): the frontend test reads `backend/src/test/resources/analyze/step-config-invalid-cost-verdict.json` via readFileSync, the same file the backend route spec compares (parseJson equality) after schema validation. The frontend asserts `reasons[].code == ["step-config-invalid"]` and the specific copy, so renaming the code in the fixture turns the frontend test red (and the backend equality red).
Live check on this worktree (servers verified via readlink /proc/<pid>/cwd = HEL-1266 worktree for both 6698 and 9605): pipeline with a bogus_fn aggregate step shows the denial block "A step in this pipeline is misconfigured, so it can't run until that step is fixed." with NO "Run to update" button; step card shows the error indicator. Verified in dark (default) and light (theme attribute toggled; block bg/text colours resolved to the amber tokens in light). Only console error: a 404 for /schedule on a pipeline with no schedule (pre-existing, expected). Screenshots: evidence/eval1-denial-dark.png, evidence/eval1-denial-light.png. Always-visible Run pipeline button unchanged, as the ticket states.
Created ids (shared dev DB): pipeline 8ff5b82e-c7ed-41c8-aee3-cf00eb569399 (step 161a5cd9-0f94-45b0-bf12-d55f067f6442, root 86d3d476-0ebe-417c-8737-41643b2adb3b cascaded); deleted by exact id (DELETE 204, GET 404). Servers stopped by exact pid; sbt client shutdown run separately.

### Overall: PASS

### Non-blocking Suggestions
- Executor's evidence file mutation names/outputs are claims I re-ran rather than trusted; consider archiving only the persisted-evidence copies.
