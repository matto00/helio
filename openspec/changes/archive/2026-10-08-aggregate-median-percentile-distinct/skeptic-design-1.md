## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed tree: HEAD e8381591fe52ffed36f846db990a274afc938add (planning artifacts untracked in the change dir).

### What I verified (with evidence)

Design.md Context claims, checked against the tree:
- `AggregateStep.SupportedFunctions` at `AggregateStep.scala:74`; two `apply` branches (empty-input/empty-groupBy at :92-106, grouped at :107-134), each throwing `StepConfigError` for an unsupported fn; numeric coercion via `PipelineRowJson.toDouble` (:117). CONFIRMED.
- `validateAggregate` (`PipelineAnalyzeService.scala:433`) is dispatched from `validateStepConfig` (:388); `stepConfigProblem` (:52) is a public wrapper over it and `AutoRunTriggerService.scala:93` calls it. CONFIRMED.
- `inferAggregate` (:597) passes the raw `fn` to `aggResultType` (:637), and `aggResultType` (:1184) falls back to `"string"`, while `inferGroupBy` lowercases (:1168). The case-sensitivity parity bug is real. CONFIRMED.
- Spark: `SparkJobSubmitter.scala:295` puts `AggregateStep` in the "not yet supported on the Spark execution path" arm. The sum/avg list at :255-260 belongs to `GroupByStep` (:248). CONFIRMED, so there is no Spark parity obligation.
- helio-mcp: the only aggregate enumerations in `helio-mcp/src` are the Output `agg` types (`types.ts:737,745`), pivot, and shapes. `write.ts:381` names only the op. No aggregate-step fn list exists. CONFIRMED.
- Agent-doc fn lists are at `RefinementPrompt.scala:55` and `RefinementEditShape.scala:164`. CONFIRMED (the design cites 54-55, close enough).
- `GroupByStep.SupportedFunctions` is a separate `Vector("sum","count")` (`GroupByStep.scala:58`), so the new `aggResultType` cases cannot be reached from groupby. CONFIRMED.
- Contracts: `schemas/pipelines/*step-request*.schema.json` type `config` as an opaque `{"type":"object"}`, so no JSON-Schema delta is needed for `p`. No Flyway change: nothing in `db/migration` enumerates aggregate fns. CONFIRMED.
- Frontend: `AGG_FNS`/`FN_HINTS` live only in `AggregateConfig.tsx:32,39`. `FN_HINTS` is a `Record` keyed by `AGG_FNS`, so adding a fn forces a hint at compile time. `stepNarrowing.ts:533-538` casts the config straight through, so `p` survives. Numeric-input precedent exists (`LimitConfig`, `WindowConfig`). CONFIRMED.
- Spec arithmetic: p90 over 1..10 gives h = 8.1, so 9 + 0.1 = 9.1. Median [4,1,3,2] = 2.5. ["10",null,"abc",30] gives [10,30], median 20. All three CORRECT.

Write-path tracing (the orchestrator's focus question). None of the proposal, MCP or REST write paths calls `validateStepConfig`:
- Transactional create (`PipelineService.scala` `buildStepsAction`, ~:557) only calls `PipelineStepConfigCodec.decode`. Its `analyzeNodes` call (:364) feeds Output building only. A step `validationError` is never turned into a rejection.
- Proposal validate/apply (`PipelineProposalService.scala:295-301`) calls `companion.validateRawConfig` (HEL-814 strict wrong-type check) and then decode.
- `addStepReporting` (`PipelineService.scala:1831`), the path behind MCP `add_pipeline_step` and patch-set apply, calls `validateRawConfig` and then decode.
- Today, therefore, an unsupported aggregate fn is accepted on every write path. It surfaces only as an analyze `validationError`, an auto-run skip (`stepConfigProblem`), or a run-time `StepConfigError`. Under the design as written, a `percentile` with no `p` or with an out-of-range `p` would likewise be accepted and persisted on every write path.
- Precedent for write-time semantic rejection does exist: `ComputeStep.companion.validateRawConfig` (`ComputeStep.scala:98-103`) returns 422 for an unparseable expression.

### Verdict: REFUTE

The semantics (percentile method, value domain, empty/null handling, inference table, parity test) are well specified and correct. The design is not sound enough to hand to an executor, though, because the write-path question is undecided and tasks.md contradicts the design on it.

### Change Requests

1. **Decide the write-path behaviour for invalid `p` and make design, spec and tasks agree.** Task 2.5 asks for a test showing "an invalid `p` is rejected on at least the create path". Under Decision 2, `aggregationProblem` is wired only into `validateAggregate` (analyze, auto-run) and `apply` (run). As traced above, no write path calls either, so the executor would have to write a test that cannot pass, quietly weaken it, or invent unreviewed wiring. Add an explicit Decision choosing one of these:
   - (a) **Write-time rejection.** Override `AggregateStep.companion.validateRawConfig` as `super.validateRawConfig(raw).orElse(<aggregationProblem over decoded aggregations>)`, on the `ComputeStep` precedent. That gives a 422 on REST `addStep`/update, proposal validate/apply and MCP. The Decision must also cover four points:
     - Whether the unsupported-fn check moves to write time too. That changes behaviour for stored drafts: an update to an existing bad config would start returning 422.
     - How to avoid a duplicated message. `validateStepConfig` already runs `validateRawConfig` first as `shapeRejection`, so `validateAggregate` must not report the same problem a second time.
     - That the transactional create (`buildStepsAction`) does not call `validateRawConfig` today. Say whether it is in scope.
     - The resulting status codes.
   - (b) **Write stays tolerant**, matching how unsupported fns behave today. Rewrite task 2.5 to assert that a valid `percentile`+`p` config is accepted on the create, proposal and addStep paths, and that an invalid one is accepted on write but reported by analyze `validationError` and `stepConfigProblem`. Then state in the proposal that "MCP/proposal validation accepts" means acceptance only.

   I lean towards (a) for the `p` rules: an agent-authored `percentile` with no `p` otherwise reaches the run before failing. Either option is acceptable if the choice is written down. The current text says neither.

2. **Modify, rather than only add to, the base spec's stale fn enumerations.** `openspec/specs/pipeline-aggregate-op/spec.md:11` ("a function (sum/avg/min/max/count)" plus a config shape with no `p`) and `:60` ("compute each aggregation (sum/avg/min/max/count)") will contradict the ADDED requirement after archive. Add a `## MODIFIED Requirements` block for those two requirements: widen the fn list and add `p?` to the config-shape line.

### Non-blocking notes
- **Interpolation with infinities.** Decision 3 keeps ±Infinity, so the formula can return NaN. For example, [Inf, Inf] at a fractional h gives Inf + 0.5·(Inf − Inf) = NaN, and [-Inf, Inf] at p = 50 gives NaN. Consider short-circuiting `v[lo] == v[hi]` (return `v[lo]`) and stating what a NaN result becomes. This matches existing `sum` behaviour (Inf + -Inf), so it is not a blocker.
- **Element-shape message.** `AggregateConfig.decode`'s element-shape text `"an array of {alias, fn, field} objects"` (`AggregateStep.scala:38`) is the message a non-numeric `p` will produce. Update it to mention `p?`.
- **Cleared `p` input.** Decision 9 does not say what the editor emits when the user clears the `p` input (delete `p`, keep the last value, or show inline "required"). Pin this down in the 4.2 test.
- **`apply` vs `requiredConfigProblems`.** Decision 2 throws from `apply`. The engine's established run-time preflight is `companion.requiredConfigProblems` (`InProcessPipelineEngine.scala:269`), which `validateStepConfig` also evaluates. Either works, since `apply` already throws `StepConfigError`. If the executor moves the check there, it must not double-report alongside `validateAggregate`.
- **Base-spec Purpose.** Task 5.1 (filling in the base spec Purpose) is housekeeping, not part of the ticket. It is harmless.
