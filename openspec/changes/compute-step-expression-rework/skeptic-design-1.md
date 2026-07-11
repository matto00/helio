## Skeptic Report — design gate (round 1)

### What I verified (with evidence)

- Read `ticket.md`, `proposal.md`, `design.md`, `specs/compute-expression-language/spec.md`,
  `specs/pipeline-compute-op/spec.md`, `tasks.md` in full.
- Confirmed all file paths design.md cites actually exist and match its descriptions:
  `backend/src/main/scala/com/helio/domain/ExpressionEvaluator.scala` (current bare-identifier-only
  recursive-descent parser, confirmed lines 24-36, 107-110, 165-176),
  `backend/src/main/scala/com/helio/domain/PipelineAnalyzeService.scala` (`inferCompute`, lines
  102-107), `frontend/src/features/pipelines/ui/ComputeFieldConfig.tsx` (no `validationError`
  rendering today, confirmed).
- Confirmed `pipeline_steps.config` is `TEXT` (`backend/src/main/resources/db/migration/V23__pipeline_steps.sql:6`)
  — design.md's rejection of a Flyway SQL migration (opaque JSON in a TEXT column, tokenizer-only
  disambiguation of identifiers vs. string literals) is factually sound.
- Confirmed the MODIFIED `pipeline-compute-op` spec correctly used the delta workflow: diffed
  against the real `openspec/specs/pipeline-compute-op/spec.md` — both existing requirement blocks
  ("Compute op appends...", "Frontend compute op renders...") were copied in full and edited, not
  just diffed.
- Confirmed `frontend/src/shared/chrome/InlineError.tsx` is a real, already-used shared component
  (used by `AggregateConfig.tsx`, a sibling pipeline step config) — design.md's "shared-inline-error"
  reference is grounded, not invented.
- Traced the actual data flow for expression validation: grepped all callers of
  `ExpressionEvaluator.validate`/`evaluate` — found it is **also** used by
  `DataTypeService.validateExpression` and `SourceService.applyComputedFields` (DataType "computed
  fields," a separate live feature with its own frontend form,
  `frontend/src/features/pipelines/ui/ComputedFieldForm.tsx`, placeholder `"e.g. price * quantity"`).
  Neither `proposal.md`'s Impact list nor `design.md`'s Context mentions this consumer.
- Read `PipelineAnalyzeService.scala` end-to-end: `inferCompute` (lines 102-107) today only wraps
  JSON key extraction in a try/catch (`parseConfig`, lines 136-146) — it never calls
  `ExpressionEvaluator.validate` on the `expression` string itself, so a syntactically bad
  expression currently produces no `validationError` at all (confirms proposal.md's own "Why").

### Verdict: REFUTE

### Change Requests

1. **The back-compat fallback is wired into the shared `parse()` entry point that both `validate()`
   and `evaluate()` call (design.md Decision 4, lines 65-71: "validate() and evaluate() both route
   through the same parse entry point"). This makes the strict `$`-required rejection
   unenforceable for *any* caller, not just legacy runtime evaluation.** Since `parse()` decides
   purely from the string content (not from "is this persisted data" vs. "is this a user typing
   right now"), a brand-new expression like `price * qty` typed today will *always* succeed via
   `parseLegacy`, because `parseLegacy` is exactly the parser that already accepts it. This
   directly contradicts `specs/compute-expression-language/spec.md`'s own ADDED requirement
   scenario (lines 13-15): "WHEN the expression `price * qty` is validated THEN validation returns
   an error indicating column references require a `$` prefix" — that scenario is not achievable
   given Decision 4's implementation as written, because `validate()` will silently succeed via the
   legacy fallback for that exact input. `tasks.md` 5.1 ("reject bare col outside legacy fallback")
   tacitly acknowledges the ambiguity without resolving it: there is no described boundary for what
   is "outside legacy fallback" when `parse()` cannot distinguish new input from old. This
   undermines the human-locked decision #1 (bare identifiers become parse errors) for the case that
   decision exists to serve — teaching users the new syntax on new/edited expressions. **Required
   revision:** design.md must specify a mechanism that only engages `parseLegacy` when evaluating a
   previously-persisted expression at execution time (e.g., `evaluate()` only, driven by an
   explicit "this came from stored config" call site) and that `validate()`/live-typing feedback
   paths use the strict grammar only, with no silent fallback — or otherwise resolve this
   contradiction explicitly and update the compute-expression-language spec scenario accordingly if
   the intent changes.

2. **No task wires `inferCompute` to actually surface an expression parse/type error as
   `validationError`, which decision 4 (inline error rendering) depends on entirely.** Confirmed by
   reading `PipelineAnalyzeService.scala`: `inferCompute` (lines 102-107) never calls any expression
   validation today — `validationError` is populated only by `parseConfig`'s JSON-shape try/catch
   (missing/malformed `column`/`type` keys), never by a bad `expression` string. `tasks.md` 2.2 only
   says `inferCompute` should call `inferType` for type derivation, "falling back to the wire type
   only if inference fails" — it never states that an `inferType`/expression-validate failure
   should populate `AnalyzedStep.validationError` with the underlying message. Without that
   explicit step, the entire frontend feature this ticket's decision 4 requires (inline
   `validationError` for a bad expression, `specs/pipeline-compute-op/spec.md` lines 95-98) has no
   backend data source. **Required revision:** add an explicit design decision + task instructing
   `inferCompute` to validate the expression (independent of/prior to type inference) and set
   `validationError` to the resulting message when parsing fails, so the frontend scenario in
   `pipeline-compute-op/spec.md` is actually satisfiable.

3. **`proposal.md` (line 44, Impact) still lists "Flyway migration for existing persisted
   compute-step configs" as a deliverable, but `design.md` explicitly rejects that approach**
   (Decision 4 header: "REJECTED: Flyway SQL migration"; Non-Goals line 30: "Rewriting persisted
   expressions in the database ... rejected in favor of a parse-level fallback"). `proposal.md` was
   not updated after design.md changed course — a direct internal contradiction between the two
   locked artifacts. **Required revision:** update `proposal.md`'s Impact list to drop the Flyway
   migration line and replace it with the `parseLegacy` parse-level fallback, matching design.md.

4. **Scope-completeness gap:** neither `proposal.md`'s Impact section nor `design.md`'s Context
   acknowledges that `ExpressionEvaluator` is also consumed by `DataTypeService.validateExpression`
   / `SourceService.applyComputedFields` (DataType "computed fields," with its own live frontend
   surface `ComputedFieldForm.tsx`, whose placeholder `"e.g. price * quantity"` models the
   soon-superseded bare-identifier style). Given Change Request 1 above, whether this surface
   silently keeps working (today's assumption) is actually in question once the fallback logic is
   fixed to properly separate new-input rejection from legacy-execution tolerance. **Required
   revision:** design.md must explicitly account for this second consumer — either confirm and
   record why it needs no change (once CR1 is resolved) or add tasks to update its placeholder
   text/behavior consistently with the new grammar.

### Non-blocking notes

- Decision on `substring` clamping vs. throwing is reasonable and documented as a self-approved
  judgment call; no objection.
- The `allowedOps` checklist item from `feedback_pipeline_op_wiring` does not apply here (no new op
  is being added, only an existing op's grammar changes) — correctly not addressed, no action
  needed.
