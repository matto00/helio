### Backend

(none — no backend changes; every field/endpoint this ticket reads already exists from HEL-454/509/570/576)

### helio-mcp: types + API client

- [x] 1.1 `helio-mcp/src/types.ts`: add `AssertionFailureDetailResponse` (`kind`, `field`, `severity`,
      `message`) and `AssertionSummaryResponse` (`passed`, `warnFailed`, `errorFailed`, `failures`)
      mirroring the backend's `PipelineRunRecord.assertions` shape (HEL-576); add `assertions:
      AssertionSummaryResponse` to whatever `PipelineRunRecord`-equivalent response type this file needs
      for run-history (add one if none exists yet).
- [x] 1.2 `helio-mcp/src/helioApi.ts`: add `getPipelineRunHistory(pipelineId: string):
      Promise<PipelineRunRecordResponse[]>` calling `GET /api/pipelines/:id/run-history`, mirroring
      `analyzePipeline`'s existing thin-pass-through style.

### helio-mcp: assert-step authoring (add_pipeline_step)

- [x] 2.1 `helio-mcp/src/tools/write.ts` (or a new shared schema module, matching where
      `boundPipelineStepSchema`/`computedFieldSchema` already live — NOT `restAuthSchema`, which is
      function-local and cannot be exported, per that variable's own comment at `write.ts:30-38`): add
      `assertRuleSchema = z.discriminatedUnion("kind", [...six variants...])` (design.md Decision 2 —
      exact per-kind field/params shape; `notNull`/`unique`'s `params` is `z.object({}).strict()` —
      explicitly rejecting extra keys, not merely omitted from the variant — for the same "reject a
      malformed shape" reason the rest of this schema exists) and `assertConfigSchema = z.object({ rules:
      z.array(assertRuleSchema) })`.
      Implemented in a new `helio-mcp/src/tools/assertSchemas.ts` module (mirrors
      `metricSchemas.ts`/`updateSchemas.ts`'s existing precedent for narrow, TS2589-safe modules), which
      also exports `addPipelineStepHandler` — `add_pipeline_step`'s full validate-then-call logic — so
      tests can exercise it directly without pulling `write.ts`'s ~20-tool Zod-schema surface into the
      compile graph.
- [x] 2.2 `add_pipeline_step`'s description: append the `assert` op's documented shape, matching the
      existing per-op documentation depth/style (see the `lookup`/`stringops`/`union` entries for the
      established prose pattern).
- [x] 2.3 `add_pipeline_step`'s registered `inputSchema` stays the current flat raw shape, UNCHANGED
      (design.md Decision 1 — an intermediate `inputSchema`-level `superRefine` draft was tried and
      reverted at the design gate's second round: it silently breaks `tools/list`'s JSON-schema
      generation for the whole tool in zod v3, since `.superRefine()` returns a `ZodEffects` wrapper with
      no `.shape`). Instead, inside `addPipelineStepHandler` (`assertSchemas.ts`): `const parsed =
      type === "assert" ? assertConfigSchema.safeParse(config) : undefined; if (parsed &&
      !parsed.success) throw new Error(...)` before calling `api.addPipelineStep(...)` — `write.ts`'s
      existing `guarded()` wrapper (already used by every tool's callback) catches the thrown error and
      formats it into the same `{content, isError: true}` shape design.md's pseudocode describes,
      matching AC1's literal wording ("rejected... before the server call"), with zero risk to
      `tools/list`'s existing field visibility.

### helio-mcp: assertion-results grounding (get_workspace_context)

- [x] 3.1 `helio-mcp/src/context.ts`: extend the per-pipeline fan-out (`pipelines.map(async (summary) =>
      {...})`) to also call `api.getPipelineRunHistory(summary.id)` inside the same `Promise.all` as the
      existing `analyzePipeline` call, in its OWN independent try/catch (design.md Decision 3 — do not
      share `analyzePipeline`'s try/catch, or a run-history-specific failure would also blank out `steps`
      and produce a misleading `stepsError`).
- [x] 3.2 Same fan-out: compute `lastRunAssertions` from the run-history result's first (most-recent)
      entry's `assertions` field, defaulting to the zero-valued summary when the array is empty
      (design.md Decision 4 — always present, never omitted).
- [x] 3.3 `WorkspaceContext.pipelines[]`'s TypeScript interface: add `lastRunAssertions:
      AssertionSummaryResponse`.
- [x] 3.4 `helio-mcp/src/tools/read.ts`: update `get_workspace_context`'s description to add an
      explanation of `lastRunAssertions` as the trustworthiness signal for a pipeline's most recent run
      (the description does not currently explain `lastRunStatus` either — this adds the first such
      explanation, not a second one alongside an existing one).

### Tests

- [x] 4.1 `write.test.ts`: `add_pipeline_step` with a well-formed assert config for each of the six rule
      kinds succeeds; an invalid kind, an invalid severity, and a `range`/`regex`/`notNull`/`unique` rule
      missing its required `field` are each rejected before any API call (assert the mocked API client
      was never invoked).
- [x] 4.2 `context.test.ts`: `lastRunAssertions` reflects a pipeline's most-recent run's assertions
      correctly; is zero-valued (not omitted) for a pipeline with no assert steps and for a pipeline with
      no runs.
- [x] 4.3 helio-mcp build (`tsc`) + `npm test` pass.
