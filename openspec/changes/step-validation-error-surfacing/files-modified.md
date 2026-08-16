# Files modified — step-validation-error-surfacing (HEL-409)

- `frontend/src/features/pipelines/ui/StepCard.tsx` — (task 1.1) new code: applies the
  `pipeline-detail-page__step-card--errored` modifier on the card root when `validationError` is
  truthy; adds a non-interactive header error-icon chip (`role="img"`,
  `aria-label="Step has a validation error"`, `faTriangleExclamation`) between the label and the
  row-count chip inside the expand-toggle button, per design.md Decisions 1–2. 513 → 529 lines
  (+16 net). Of that, +5 lines are Prettier's mandatory multi-line wrap of the now-4-icon
  `free-solid-svg-icons` import (formatting artifact, not authored growth); the functional
  addition (className ternary + the 9-line chip block/comment) is ~11 lines, in line with the
  ≤~12-line target. HEL-682 still owns the eventual file split.
- `frontend/src/features/pipelines/ui/PipelineDetailPage.css` — (task 1.2) new
  `.pipeline-detail-page__step-card--errored` rule (error-tinted `border-color`, placed after
  `--expanded` in source order so it wins the tie when a card is both expanded and errored) and
  `.pipeline-detail-page__step-card-error-chip` (icon-only, `--app-error` colored). Token-only —
  no new tokens, no literal colors; follows the `color-mix(in srgb, var(--app-error) …%,
  transparent)` recipe already used by `.pipeline-detail-page__step-card-diff-chip--removed` in
  the same file and by `InlineError`'s error-intent siblings (`PanelGrid.css`,
  `RunHistoryModal.css`).
- `frontend/src/features/pipelines/ui/StepCard.test.tsx` — (tasks 3.1–3.3) new `describe("StepCard
  — errored card marking (HEL-409)")` block: collapsed errored card shows the `--errored` class +
  accessible header indicator; collapsed valid card shows neither; re-render with
  `validationError` cleared removes the accent, indicator, and inline message together (spec's
  three new-marking scenarios). Also widened the shared `click()` test helper from
  `(name: string)` to `(name: string | RegExp)` and switched three existing/new assertions that
  click the toggle button on an **errored** step (`"Limit rows"` / `"Compute column"`) to a
  `RegExp` matcher — see "Regression note" below. Existing HEL-407 coverage
  (`describe("StepCard validationError surfacing …")`) already exercised the non-compute
  message-render and the compute no-double-render scenarios (task 3.3's "extend only if thin");
  no extension was needed beyond the RegExp fix.

## Task 2.1 — verification (no code change)

Confirmed read-only, no gap found:

- `StepCard.tsx` (now line ~349, was 339 pre-change): `{step.opType.id !== "compute" && <InlineError
  error={validationError ?? null} />}` in the expanded body — renders the generic inline message
  for every non-compute op; `compute` keeps its own editor-inline render via `ComputeFieldConfig`
  (no double render — test-covered).
- `PipelineDetailPage.tsx:235-241` (`getAnalyzeValidationError`) is called unconditionally per
  step in `PipelineRiverView.tsx:180` (`validationError={getAnalyzeValidationError(step.id)}`),
  inside the unconditional `steps.map(...)` — not gated by op type, so every op kind receives the
  prop. Ticket bullets 1–2 were already fully shipped; no code written for task 2.1.

## Regression note (found while implementing task 1.1, fixed as part of it)

Nesting a `role="img"` element with a non-empty `aria-label` inside the (unlabeled) toggle
`<button>` changes the button's own computed accessible name per the standard accname algorithm —
focusing/querying the toggle on an errored step now yields `"Limit rows Step has a validation
error"` instead of `"Limit rows"` alone. This is the direct, intended consequence of design.md
Decision 2 (the chip is deliberately non-`aria-hidden` content of the button, giving keyboard/
screen-reader users the same in-line signal sighted users get), not a bug — but it broke three
`getByRole("button", { name: "…" })` exact-match test queries against **errored** steps (two
pre-existing HEL-407 tests, one new HEL-409 test). Fixed by widening the `click()` helper to
accept a `RegExp` and using `/Limit rows/` / `/Compute column/` for those three call sites only;
every other exact-string call site (valid/non-errored steps) is untouched and still exact-matches.

## Verification note for the evaluator

No dev servers were started (unit tests only, per instructions). The error accent
(`--app-error`-family border + header chip) should get a quick visual pass in both themes on ports
5841 (frontend) / 8748 (backend) via `start-servers.sh` — narrow-width crowding (design.md Risks)
is also worth a glance at 430px.
