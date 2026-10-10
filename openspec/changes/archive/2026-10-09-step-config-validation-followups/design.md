## Context

Grounded on origin/main c804b4296 (premise evidence: `.concertino/runs/HEL-1417/evidence/premise-validation.md`).

- `PatchSetApplyResolvers.resolvePipelineStepCreate` (~l.718): parentId → `authorizeEditorOrOwnerOnPipeline` →
  `decodeCreatePatch[CreatePipelineStepRequest]` → `authorizeSecondSourceForCreate` → `ResolvedEdit`. No strict config
  check; apply (`PatchSetApplyForward` → `pipelineService.addStep`) is the first place it fails, as a 200 `failure`.
- `resolvePipelineStepUpdate` → `validateEmbeddedStepReferences` (~l.188-206) returns
  `UnprocessableEntity(s"edit $index: $msg")` BEFORE decode/ref checks. `resolvePipelineCreate` (~l.573-585) returns
  `UnprocessableEntity(s"edit $index: Step '${clientId}': $msg")` — a create carries many steps, so it names one.
- The six sites: PatchSetApplyResolvers l.205, l.578; PipelineProposalService l.296; PipelineService l.561, l.1857,
  l.2211. A seventh variant, `companion.flatMap(_.validateRawConfig(config))`, is in engine/StepConfigValidation l.49
  (it reuses one `companion` lookup for `requiredConfigProblems`).
- HEL-1416's enum checks are per-kind `validateRawConfig` overrides (FillNull/Window/Pivot), i.e. BEHIND the lookup —
  the helper changes nothing about them.
- `ColumnSchemaInference.inferCompute` (~l.47) reads `json.fields("type")`, which throws on an absent key; the catch-all
  turns that into `"compute config error"` before the expression is looked at. `ComputeConfig.type` is `Option`,
  documented "the engine ignores it". Dev DB read-only query: 2 compute steps, both without `type`, both non-empty
  expressions. The frontend editor always sends `type`; agent/MCP/patch-set callers need not.

## Goals / Non-Goals

Goals: AC1–AC4 of ticket.md. Non-goals: see proposal.md. No migration (next free stays V122).

## Decisions

**D1 — step-create check placement and shape.** In `resolvePipelineStepCreate`, after a successful
`decodeCreatePatch` and BEFORE `authorizeSecondSourceForCreate`, run the shared helper (D2) on
`(request.type, request.config.compactPrint)`; `Some(msg)` → `Left(ServiceError.UnprocessableEntity(s"edit $index: $msg"))`.
Shape = the update edit's (`edit N: <msg>`), not the pipeline-create one: a step-create edit IS one step and has no
`clientId`, and its message already starts with the kind (`Invalid 'cast' config: …`, `compute: invalid expression: …`)
exactly as the REST `addStep` 422 does. Ordering mirrors the update edit (strict check before reference checks) so a
caller gets the specific message rather than a secondary-source 404 for a config that is wrong anyway. Authorization
stays first (no config feedback to a caller without access). Unknown `type`: helper returns `None` (no companion) →
unchanged apply-time 400 `failure`; out of scope.
Alternative rejected: calling `pipelineService.addStep` in a dry-run mode at resolve — no such mode exists; overkill.

**D2 — shared helper.** Add to `object PipelineStep` (domain/model, next to `companionFor`):
`def rawConfigProblem(kind: String, raw: String): Option[String] = companionFor(kind).toOption.flatMap(_.validateRawConfig(raw))`.
All six sites become `PipelineStep.rawConfigProblem(k, cfg.compactPrint)` with surrounding code, messages and statuses
byte-identical. StepConfigValidation l.49 is left as is: it holds one `companion` for two uses and is HEL-1385's freshly
split engine code that concurrent lane HEL-1414 is editing — touching it adds merge friction for zero behaviour.
Alternative rejected: a helper returning `ServiceError` — the six sites wrap it three different ways (bare msg,
`edit N:`, `Step 'id':`); the shared part is only the lookup.

**D3 — compute without `type`: analyze-side, not reject-at-save.** Reject-at-save would refuse to re-save 100% of the
stored dev compute steps and contradicts `ComputeConfig`'s documented-optional `type`; it is not "obviously safe", and
the analyze-side fix needs no product call. In `inferCompute`, read `type` as optional
(`json.fields.get("type").map(_.convertTo[String])`); `column`/`expression` stay required inside the `try`, so a genuinely
malformed config keeps the generic category (HEL-311). Fallback column type when the expression fails and no hint
exists: `"string"` (the run produces a nulls column for a row-dependent failure; an unparseable expression fails the run,
HEL-888). Appending the column (not omitting it) keeps downstream steps referencing it from cascading spurious
`field-not-in-input-schema` warnings — same rationale as today's with-hint fallback. A `type` present but non-string
still falls into the generic branch (and is already 422'd on write by the strict decoder).
Alternative rejected: only a clearer message for the missing key — still flags a valid, documented-optional config.

**D4 — test/spec tightening.** `PipelineCreateStepConfigRoutesSpec` aggregate case asserts `include("Step 'agg':")` and
`include("bogus")`. The capability Purpose (main spec, edited directly per openspec instructions) is widened to cover
configs that parse but are invalid (unparseable compute expressions, unsupported aggregation/enum values) and every write
surface incl. single-call create and patch-set edits.

**D5 — PipelineService split filed as HEL-1463.** A byte-move proof is only meaningful on a diff with no behaviour change;
this PR changes behaviour (D1, D3) and edits three sites inside that file. Splitting here would make both unreviewable.
The ticket explicitly leaves this to the implementer.

## Proof standard

- D1 red-first through the REAL routes (`PatchSetRoutes` apply + `PatchSetPreviewRoutes` preview, as in
  `PatchSetRoutesSpec`/`PatchSetPreviewRoutesSpec`), measured on the WHOLE pre-fix tree: apply returns 200 + `failure`
  and preview 200 before the fix; 422 after. Include a two-edit patch set proving the earlier edit is not applied.
- D2 behaviour-preserving: the existing HEL-860/1402/1416 suites stay green unmodified; mutation check: break the helper
  (return `None`) and show those suites go red, then restore.
- D3 red-first in a `ColumnSchemaInference`-level or analyze-route test; plus guard that a with-`type` config's output is
  unchanged.

## Risks / Trade-offs

- [HEL-1414 concurrently edits analyze engine objects] → this change touches only `inferCompute`; later merger reconciles.
- [A patch-set caller relied on step-create 200+`failure`] → same 422 contract the update/pipeline-create edits already
  have; the executor verifies (grep, not assumption) how frontend/helio-mcp callers of patch-set apply/preview surface
  a 422 and records it in the PR body.
- [`"string"` fallback is a guess] → only on an already-erroring step; the `validationError` is the signal.

## Planner Notes

Self-approved: D1 message shape, D2 helper location and StepConfigValidation exclusion, D3 analyze-side choice (measured,
non-breaking, consistent with the documented contract), D5 split deferral (ticket allowance; driver concurred).
