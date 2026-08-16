# HEL-409: Authoring UX: surface per-step validation errors on the offending StepCard

## Description

The analyze endpoint already returns a per-step `validationError` (e.g. "Unknown field 'x'", "compute config error"; see `PipelineAnalyzeService`). Today only the `compute` op's editor (`ComputeFieldConfig`) renders it — every other op silently swallows its analyze error until a full run fails. Authors should see the error on the offending StepCard as they edit. The plumbing already carries it: `StepCard.tsx` receives a `validationError` prop.

## Scope

Frontend:

* Render the step's `validationError` on the StepCard for ALL ops (a consistent inline error affordance on the card header/body), not just compute.
* Ensure `PipelineDetailPage.tsx` passes each step's analyze `validationError` into its `StepCard` (verify the prop is wired for every op, not only compute).
* Visually mark a step card as errored (e.g. an error accent + message) so the offending step is obvious in the list.

## Acceptance criteria

- [ ] Any step with an analyze `validationError` shows that error inline on its own card, for every op kind.
- [ ] The errored step is visually distinguishable in the step list.
- [ ] No false errors on valid steps; the error clears when the config is fixed (analyze refresh).
- [ ] Follows `DESIGN.md`; frontend tests cover an errored non-compute step rendering its message.
- [ ] Backward compatible: reads the existing analyze response; no wire change.

## Out of scope

* New backend validation rules — this surfaces existing analyze errors only.

## Dependencies

* None. Reads the existing `analyze_pipeline` per-step `validationError`.

## Delivery notes (orchestrator) — scope narrowing, verified against ground truth

This ticket predates HEL-407's final-gate fix (commit `ea726167`, merged to main in `e2fa88b1` — this branch's base), which already delivered part of this scope:

* **Already shipped (verify + codify + test only, do not re-implement):** the generic inline
  message — `StepCard.tsx:339` renders `InlineError` for every non-compute op in the expanded
  body (compute keeps its own editor-inline rendering, no double render), and the
  `validationError` prop has been wired for every op via `getAnalyzeValidationError` since the
  HEL-404-era plumbing. Ticket bullets 1–2 are therefore verification/test work, not new code.
* **Genuinely remaining (this change's new code):** the errored card is NOT yet visually
  distinguishable in the step list — a collapsed errored card shows nothing today. AC2 is the
  real scope: an error accent on the card plus a compact header indicator visible when
  collapsed, with an accessible name, clearing when analyze refresh removes the error.
* Ports for any live check: dev 5841 / backend 8748 via `start-servers.sh`; never leave servers
  running. Frontend-only; no migration (shared-DB hazard moot). `StepCard.tsx` is 513 lines
  (HEL-682 owns the split) — keep growth minimal and record it in files-modified.md.
