# Proposal: step-validation-error-surfacing

## Why

An author whose step has an analyze `validationError` gets an inline message only after expanding
the card — HEL-407's final-gate fix (`ea726167`) made that message generic across all ~20 op kinds,
but a **collapsed** errored card still looks identical to a healthy one, so the offending step is
not obvious in the step list (HEL-409 AC2). This change closes that gap and codifies the whole
StepCard validation-display behavior in a spec (none covers it today — HEL-407's inline fix
shipped as a review fix without its own capability spec).

## What Changes

- **New (code):** an errored StepCard is visually marked in the list — an error accent on the card
  (token-only, `--app-error` family) plus a compact header indicator with an accessible name,
  visible while collapsed and expanded, clearing automatically when the analyze refresh removes
  the `validationError`.
- **Codified (spec + tests only, already shipped by HEL-407/HEL-404):** the generic `InlineError`
  message in the expanded body for every non-compute op (compute keeps its editor-inline render,
  no double render), and the per-op `validationError` prop wiring from `PipelineDetailPage`.

## Capabilities

### New Capabilities

- `pipeline-step-validation-display`: how a step's analyze `validationError` is surfaced on its
  StepCard (inline message + errored-card list marking).

### Modified Capabilities

(none)

## Impact

- Frontend only: `StepCard.tsx` (card modifier + header indicator, minimal growth — file is 513
  lines, HEL-682 owns the split), `PipelineDetailPage.css`, `StepCard.test.tsx`. No backend, no
  service/state changes, no wire change, no migration.

## Non-goals

- New backend validation rules (surfaces existing analyze errors only).
- Re-implementing the inline message or prop wiring HEL-407/HEL-404 already shipped.
- Pipeline-list-page (outside the editor) error indication.
