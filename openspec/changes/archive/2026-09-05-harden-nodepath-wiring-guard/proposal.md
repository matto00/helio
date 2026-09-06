## Why

HEL-985's `nodePath()` wiring guard resolves a step's rendered path via `labelEl.closest("[title]")`. That query is
correct only because no ancestor of a step card currently carries a `title` — an ambient property of today's DOM, not a
declared invariant. The moment a lane, root-column, or wrapper `div` gains a tooltip, the walk silently resolves to that
ancestor instead of the step's own wrapper.

**Correcting the ticket's own framing (found at the round-2 design gate).** The ticket says the **deletion-form**
mutation "starts passing". That is true only in the limiting case where the ancestor's `title` happens to equal the
step's exact expected path. For an arbitrary ancestor tooltip the assertions still fail — but as a *string mismatch*,
identical in shape to the value-mismatch mutation. So the real loss is twofold: the deletion form can be made to pass
outright, and short of that the two mutation axes collapse into one indistinguishable message. Either way the guard
keeps reporting on less than it claims, and nothing announces the loss. The fix direction the ticket prescribes is
unchanged; only the severity story is corrected.

## What Changes

- Replace `titleFor()`'s ambient `closest("[title]")` walk with a query scoped to the two known step-wrapper classes,
  `.pipeline-detail-page__step-section` and `.pipeline-detail-page__tail-chain-step`, covering both the standard and the
  compact tail-chain render sites. The file's existing `sectionFor()` helper is not reusable here: it queries only the
  former and cannot reach the latter.
- Read the `title` only after an explicit `hasAttribute("title")` check on that scoped wrapper, so an absent attribute
  fails loudly as an absent attribute rather than silently escalating to an ancestor.
- Add a regression assertion proving the hardening itself: with a `title` deliberately placed on an ancestor container,
  the helper must still resolve the step's own wrapper (and still fail when that wrapper's `title` is absent).
- Record a mutation transcript demonstrating both forms — ancestor-title + deletion, and value-mismatch — going red
  independently.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

None. This change alters test-harness robustness only; no product behavior, API, or requirement changes. `.openspec.yaml`
sets `skip_specs: true`.

## Impact

- `frontend/src/features/pipelines/ui/PipelineRiverView.test.tsx` — the only source file touched.
- No product-code diff: HEL-985's zero-product-diff property is preserved deliberately.
- Verification is frontend-Jest-only (a sibling ticket holds the dev database exclusively): no backend spec, no dev
  server, no database connection, no Playwright.

## Non-goals

- Adding a `data-testid` to the step wrapper. That is the ticket's other suggested option, but it requires a product-code
  change and would forfeit the zero-product-diff acceptance criterion.
- Broadening the guard to render sites beyond the four `nodePath()` prop-threading edges HEL-985 already pins.
- Refactoring or re-scoping `sectionFor()`, which serves unrelated pre-existing tests in the same file.
