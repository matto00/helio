# Tasks: step-validation-error-surfacing

## 1. Frontend — errored-card marking (the new code)

- [x] 1.1 `StepCard.tsx`: apply `pipeline-detail-page__step-card--errored` on the card root when `validationError` is truthy; add the header error-icon chip (`role="img"`, `aria-label="Step has a validation error"`, triangle-exclamation) between the label and row-count chip inside the expand-toggle button (non-interactive content — design Decision 2); growth ≤ ~12 lines
- [x] 1.2 `PipelineDetailPage.css`: `--errored` card modifier (error-tinted border) + header error-chip rule, token-only using the existing `--app-error*` family per `InlineError.css`

## 2. Frontend — verify the already-shipped half (no re-implementation)

- [x] 2.1 Confirm (read-only) the generic `InlineError` render at `StepCard.tsx:339` and the per-op `validationError` wiring via `getAnalyzeValidationError` — record confirmation in `files-modified.md`; write code ONLY if a gap is actually found

## 3. Tests

- [x] 3.1 `StepCard.test.tsx`: collapsed errored card shows the `--errored` class + header indicator with accessible name; valid step shows neither
- [x] 3.2 Clears-on-fix: re-render with `validationError` removed → accent, indicator, and inline message all gone
- [x] 3.3 Verify/extend existing coverage: errored non-compute step renders its message (HEL-407 test — extend only if thin); compute op renders exactly one error instance
- [x] 3.4 Record file growth + notes in `files-modified.md` (StepCard.tsx 513 pre-change; HEL-682 owns the split)
- [x] 3.5 Run gates: `npm run lint`, `npm run format:check`, `npm test` (frontend) — all clean
