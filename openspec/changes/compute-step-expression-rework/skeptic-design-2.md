## Skeptic Report — design gate (round 2)

### What I verified (with evidence)

- Read `ticket.md`, `proposal.md`, `design.md`, `specs/compute-expression-language/spec.md`,
  `specs/pipeline-compute-op/spec.md`, `tasks.md`, `workflow-state.md`, and round 1's
  `skeptic-design-1.md` in full, fresh (not trusting the orchestrator's summary).

**CR1 (permanent parse() fallback defeating $-required for all input) — resolved, verified sound.**
- `design.md` Decision 4 (lines 65-95) now states explicitly: "A first draft wired the legacy
  fallback into the shared `parse()` used by both `validate()` and `evaluate()` — **rejected**"
  and "**Chosen approach:** keep `parse()` strict-only ... the only parser `validate()` calls ...
  Add the legacy fallback **only** inside `evaluate()`." This is the correct fix. Confirmed by
  reading the actual current `ExpressionEvaluator.scala` (`parse()` at line 181, `validate()` at
  line 194 calling `parse()` directly, `evaluate()` at line 220 also currently calling `parse()`
  directly) — the design's plan to keep `parse()`/`validate()` untouched-strict and add the
  fallback only at the `evaluate()` (and new `validateTolerant()`) call sites is implementable
  without re-introducing the shared-entry-point defect. `tasks.md` 1.5 states this precisely
  ("do NOT wire the fallback into shared `parse()`"), and 5.1/5.4 add tests that specifically
  prove the split (`validate()` unconditionally rejects bare identifiers; `evaluate()`'s fallback
  still works on the same input) — this is the exact test round 1 asked for.

**CR2 (`inferCompute` never wired to validate) — resolved, verified sound.**
- Design.md Decision 5 (lines 97-110) and `tasks.md` 2.2 now specify `inferCompute` calls
  `ExpressionEvaluator.validate(expression, inputSchema field names)` first, setting
  `AnalyzedStep.validationError` on `Left`, and calling new `inferType` on `Right`. Confirmed by
  reading `PipelineAnalyzeService.scala` end-to-end (`inferCompute` at lines 102-107,
  `AnalyzedStep.validationError` field at line 29, `parseConfig`'s try/catch fallback pattern at
  lines 137-147) — the described change is a real, implementable modification to a function that
  today does nothing but JSON-key extraction. The new ADDED requirement in
  `specs/pipeline-compute-op/spec.md` ("Compute op schema inference validates the expression...")
  correctly states `validate` is "the strict, `$`-required grammar — no legacy fallback," matching
  Decision 5/the strict `parse()`.

**CR3 (proposal.md's stray Flyway-migration mention) — resolved.**
- `proposal.md`'s Impact section (line 47) now reads "No Flyway migration — no persisted data is
  rewritten (see design.md Decision 4)" — no contradiction remains. `design.md`'s Migration Plan
  section (lines 130-136) is consistent ("No schema/data migration").

**CR4 (DataTypeService/SourceService scope gap) — resolved, verified sound.**
- Confirmed by grepping the real backend: `DataTypeService.scala` has exactly the two call sites
  design.md's Context describes — `validateExpression` (line 46: `ExpressionEvaluator.validate`)
  and `applyUpdate`'s `exprError` fold (line 83: `ExpressionEvaluator.validate`), and `applyUpdate`
  does hard-block the whole `PATCH` on `exprError` (lines 89-91: `Left(ServiceError.BadRequest(msg))`
  short-circuits before any DB write) — matching design.md's claim precisely. `SourceService.scala`
  line 297 confirms `applyComputedFields` calls `ExpressionEvaluator.evaluate` (legacy-tolerant per
  the new design, unaffected). `design.md` Decision 4's "DataTypeService boundary" paragraph
  (lines 87-95) and `proposal.md`'s Impact section (lines 44-46, 55) now both name this consumer
  explicitly and record the new `validateTolerant()` fix + the "no `$`-tightening" non-goal.
  `tasks.md` has concrete, correctly-targeted tasks: 1.6 (`validateTolerant` impl), 2.4 (switch
  both `DataTypeService` call sites to it), 5.5 (`validateTolerant` accepts bare identifiers,
  matching today's behavior) and 5.9 (regression test: DataType with existing bare-identifier
  computed field still passes `PATCH` and still evaluates).

**Spec-delta mechanics.**
- Diffed the new `specs/pipeline-compute-op/spec.md` against the real, currently-published
  `openspec/specs/pipeline-compute-op/spec.md`: both existing requirement blocks ("Compute op
  appends a derived field...", "Frontend compute op renders...") were copied in full as MODIFIED
  and edited (not just diffed/truncated) — correct delta format. The new ADDED requirement
  ("Compute op schema inference validates...") is genuinely new, not a duplicate.
- `compute-expression-language` has no existing entry under `openspec/specs/` (confirmed via
  `ls openspec/specs/`), so its ADDED-only spec file is correctly a brand-new capability, matching
  design.md's Planner Notes self-approval for keeping it separate from `pipeline-compute-op`.
- Ran `npx openspec validate compute-step-expression-rework --strict` → `Change
  'compute-step-expression-rework' is valid` (fresh run, not reused from a prior claim).

**General re-check for new contradictions introduced by the round-2 fix.**
- No new contradiction found: `design.md`'s Non-Goals (line 38-39) and `proposal.md`'s Non-goals
  (line 55) both consistently state DataType-computed-field `$`-tightening is out of scope, and
  Decision 4 / Planner Notes explain why (asymmetric hard-block vs. informational
  `validationError`) without hand-waving — this is a real, traceable technical reason, not a
  deferred decision that blocks implementation.
- `ExpressionEvaluator.applyOp`'s existing default case (confirmed at
  `ExpressionEvaluator.scala:269-272`, `TypeError` for any non-numeric-arithmetic combination)
  already matches design.md Decision 3's claim that "numeric ops strict" matches "today's `applyOp`
  semantics" — grounded, not asserted.
- Verified `AnalyzedStep`/`inferOutputSchema`'s tuple-return shape (`(Vector[SchemaField],
  Option[String])`) can host Decision 5's new logic without an incompatible signature change —
  no hidden architectural blocker.
- Confirmed all four referenced frontend files exist: `ComputeFieldConfig.tsx`,
  `AggregateConfig.tsx`, `ComputedFieldForm.tsx`, `shared/chrome/InlineError.tsx`.
- Re-read `tasks.md` end-to-end (43 tasks across 5 sections): no `TODO`/`TBD`/placeholder text;
  every task is concrete and traceable to a design.md decision or spec requirement. No scope drift
  detected — all tasks map to DoD items in `ticket.md` or the four escalated/human-approved
  decisions in `proposal.md`'s Recommendation.

### Verdict: CONFIRM

### Non-blocking notes

- `inferCompute`'s current implementation goes through the generic `parseConfig` try/catch
  wrapper (JSON-shape errors only); wiring in expression validation per Decision 5 will require
  either extending `parseConfig` or bypassing it for the `compute` case. This is an implementation
  decision (not a design gap — Decision 5 already specifies the intended behavior precisely enough
  for a competent implementer to make that call), but the executor should be aware the two error
  sources (JSON-shape vs. expression-validity) need to compose correctly (e.g., a malformed JSON
  config should still short-circuit before expression validation runs).
- The `substring` clamping judgment call and the vestigial frontend `type` field are both
  self-approved with clear reasoning in Planner Notes; no objection, as in round 1.
