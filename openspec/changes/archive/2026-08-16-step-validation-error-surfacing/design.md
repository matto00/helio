# Design: step-validation-error-surfacing

## Context

Post-HEL-407 ground truth (this branch's base, `e2fa88b1`): `StepCard.tsx` (513 lines) receives
`validationError?: string` (wired for every op via `PipelineDetailPage.getAnalyzeValidationError`
since HEL-404-era plumbing) and renders it generically — `StepCard.tsx:339`,
`{step.opType.id !== "compute" && <InlineError error={validationError ?? null} />}` in the
expanded body; `ComputeFieldConfig` keeps its own editor-inline render (no double render, verified
by HEL-407's final-gate round 2). The card root is `pipeline-detail-page__step-card`
(`PipelineDetailPage.css:347`) with an `--expanded` modifier precedent; the header (post-HEL-407
restructure) is a wrapper div holding the expand-toggle `<button>` (icon + label + row-count chip
+ chevron) and a sibling actions cluster. Analyze refresh already re-fetches on config edits
(300ms-debounced fingerprint), so `validationError` appears/clears without manual action. The
backend's identity fallback means an errored step still has schemas — nothing else changes.

## Goals / Non-Goals

Goals: make an errored card obvious in the list (collapsed included) with an accessible
indicator; codify the display behavior in a capability spec; test the full surface.
Non-goals: re-implementing the inline message/prop wiring; backend changes; pipeline-list-page
indication; error badges outside the editor.

## Decisions

1. **Card-level marking: an `--errored` modifier on the card root**
   (`pipeline-detail-page__step-card--errored`), applied whenever `validationError` is truthy —
   error-tinted border (`--app-error` family tokens, mirroring how `--expanded` modifies the same
   rule; follow `InlineError.css`'s token choices for the error family). Applies in both
   collapsed and expanded states; removed automatically when the prop clears (pure render from
   props — no state).
2. **Header indicator: an error icon chip inside the expand-toggle button**, rendered between the
   label and the row-count chip: a `FontAwesomeIcon` triangle-exclamation wrapped in a `<span
   role="img" aria-label="Step has a validation error">` with an `--error` chip style. Inside the
   toggle button is correct here (unlike HEL-407's Move buttons) because it is **non-interactive**
   — purely informational content of the button, exactly like the existing row-count chip sibling;
   no nested-interactive problem, no bubbling concern. `role="img"` + `aria-label` gives screen
   readers the same signal sighted users get from the icon.
3. **No new components, no prop changes**: everything renders from the existing `validationError`
   prop inside `StepCard.tsx`. Estimated growth ≤ ~12 lines (513 → ~525; HEL-682 owns the split —
   record actuals in `files-modified.md`).
4. **Codify, don't re-implement**: the new `pipeline-step-validation-display` spec captures both
   the (already-shipped) inline-message requirement and the (new) list-marking requirement; tasks
   for the shipped half are test-coverage verification only. Existing coverage to build on:
   `StepCard.test.tsx` already asserts a non-compute step renders its error text (HEL-407) — add
   what's missing (collapsed-state marking, clears-when-prop-clears, compute-no-double-render if
   not already covered).

## Planner Notes (self-approved)

- Indicator inside the toggle button (Decision 2) is a deliberate, justified divergence from
  HEL-407's sibling-controls rule: that rule exists for *interactive* elements; this chip is
  static content. The skeptic should treat "non-interactive content inside the toggle" as the
  claim to verify, not a contradiction of HEL-407.
- Marking keys off the same `validationError` prop as the message — no second source of truth,
  so "no false errors on valid steps" (AC3) holds by construction; tests still assert it.
- No live-check hard requirement: jsdom fully exercises class application/removal and aria
  attributes; a live pass is still worthwhile for the visual accent in both themes (evaluator's
  judgment), ports 5841/8748.

## Risks

- Header crowding at narrow widths (icon + label + count + chevron + actions cluster): the chip
  is icon-only (no text), and the label already truncates; verify at 430px in the live pass.
- Token drift: use only existing `--app-error*` tokens already consumed by `InlineError.css` —
  no new tokens, no literals.
