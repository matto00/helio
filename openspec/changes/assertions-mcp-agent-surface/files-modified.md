- `helio-mcp/src/types.ts` — add `AssertionFailureDetailResponse`, `AssertionSummaryResponse`, and
  `PipelineRunRecordResponse` (mirrors the backend's `PipelineRunRecord`/`AssertionSummary` wire shapes,
  HEL-576).
- `helio-mcp/src/helioApi.ts` — add `getPipelineRunHistory(pipelineId)`, a thin pass-through to
  `GET /api/pipelines/:id/run-history`, mirroring `analyzePipeline`'s existing style.
- `helio-mcp/src/tools/assertSchemas.ts` (new) — `assertRuleSchema` (Zod discriminated union over the
  six v1 rule kinds) + `assertConfigSchema` (`{rules: [...]}`), plus `addPipelineStepHandler` —
  `add_pipeline_step`'s full validate-then-call logic, extracted into its own narrow module (mirrors
  `metricSchemas.ts`/`updateSchemas.ts`/`pipelineProposalHandlers.ts`'s established precedent for
  TS2589-safe modules `write.test.ts` can import directly).
- `helio-mcp/src/tools/write.ts` — `add_pipeline_step`'s description gains the `assert` op's documented
  shape; its callback now delegates to `addPipelineStepHandler` (still wrapped in the existing
  `guarded()`). `inputSchema` is UNCHANGED (design.md Decision 1 — handler-level validation, not
  `inputSchema`-level, to avoid breaking `tools/list`'s JSON-schema generation).
- `helio-mcp/src/tools/write.test.ts` — new `addPipelineStepHandler` tests: one per v1 rule kind
  (well-formed, calls through), plus invalid-kind/invalid-severity/missing-required-field/extra-strict-key
  rejections, each asserting the mocked API was never invoked; a non-assert `type` pass-through case.
- `helio-mcp/src/context.ts` — per-pipeline fan-out now also fetches `getPipelineRunHistory` (its own
  independent try/catch, concurrent with `analyzePipeline` via `Promise.all`) and derives
  `lastRunAssertions` from the most-recent run-history entry's `assertions` field, defaulting to a
  zero-valued summary (`ZERO_ASSERTION_SUMMARY`) when absent/empty/failed. `WorkspaceContext.pipelines[]`
  gains `lastRunAssertions: AssertionSummaryResponse` (always present, never omitted).
- `helio-mcp/src/context.test.ts` — new `buildWorkspaceContext — lastRunAssertions wiring` describe
  block: reflects the most-recent run's assertions, zero-valued for no-assert-step / no-runs-yet, and two
  failure-isolation cases (a run-history failure doesn't affect `steps`/`stepsError` and vice versa).
  Also fixes one pre-existing fixture (`applyBudget` tier-0 test) that now needs the new required
  `lastRunAssertions` field.
- `helio-mcp/src/tools/read.ts` — `get_workspace_context`'s description gains an explanation of
  `lastRunAssertions` as the pipeline data-trustworthiness signal.
