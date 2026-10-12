## Standing Constraints

- [C1] Red first: every new/changed test is shown failing on the base behavior before the fix (transcript in evidence).
- [C2] No new `eslint-disable`, no `--no-verify`/`HUSKY=0`/hooksPath override.
- [C3] E2E identity: a throwaway registered `@example.test` user; never matt@helio.dev; headless Playwright only.
- [C4] AC3's spec must be proven red with HEL-1464's TableDisplayFields.css hunk reverse-applied, green restored.
- [C5] Evaluator and final skeptic run the new e2e spec themselves.

### Frontend

- [x] 1.1 Write the Output-editor scatter-picker test (one "— None —" per picker, no duplicate-key console.error); confirm red
- [x] 1.2 Stop prepending the clear option in `ChartDisplayFields.tsx`, fix its prop doc and its test fixtures; 1.1 green
- [x] 1.3 Remove the `as unknown as` cast in `RestApiForm.test.tsx`; confirm typecheck red on missing `reset`
- [x] 1.4 Add `reset: jest.fn()`; typecheck and the RestApiForm test green

### Tests

- [x] 2.1 Add `e2e/hel1510-output-editor-table-overflow.spec.ts` (1100px, 86-char column, rendered-geometry asserts); green
- [x] 2.2 Reverse-apply HEL-1464's `TableDisplayFields.css` hunk, run the spec red, restore, run green; save transcripts
- [x] 2.3 Delete `TableDisplayFields.css.test.ts`; confirm the e2e spec is scheduled by CI's shard tooling
- [x] 2.4 Full gates: lint, typecheck, format:check, check:e2e-types, check:e2e-user-cleanup, check:e2e-evidence-paths, affected jest; `files-modified.md` repo-relative bullets
