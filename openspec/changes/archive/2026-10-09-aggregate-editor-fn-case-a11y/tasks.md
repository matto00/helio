## Standing Constraints

- [C1] The p-input "visible label" assertion must check for a real `<label>` element associated with the input (getByLabelText alone also matches aria-label and passes on old code); the p input's accessible name keeps the row number; useId is called once per component and suffixed per row.
- [C2] Chip keys are index-qualified for all four diff categories (added/dropped/retyped/renamed), not just added.

## 1. Item 3 — min/max inference (backend)

- [x] 1.1 Extend the HEL-1310 parity test in `PipelineAnalyzeServiceSpec` to run every `SupportedFunctions` fn over an `integer`-declared and a `float`-declared field; run it on unchanged code and record the red failure for min/max (verify: red output captured)
- [x] 1.2 Type aggregate-op `min`/`max` as `float` in `inferAggregate` without changing `aggResultType`'s groupby behaviour (verify: parity test green; groupby inference tests unchanged and green)
- [x] 1.3 Update any existing aggregate test/fixture asserting declared-type min/max inference (verify: `sbt testFull` scoped to the analyze/aggregate specs green)

## 2. Item 1 — case-insensitive fn match (frontend)

- [x] 2.1 Red-first test in `AggregateConfig.test.tsx`: stored `"SUM"` shows sum hint + picker value; stored `"PERCENTILE"` (p 90) shows hint and `p` input (verify: red on old code)
- [x] 2.2 Implement D1 (`fnKey` normalization) (verify: test green)

## 3. Item 2 — p input a11y (frontend)

- [x] 3.1 Test: out-of-range `p` → input `aria-invalid="true"`, accessible description equals the error text; input has a visible label with and without a value (verify: fails on old code)
- [x] 3.2 Implement D2 with `FormField` (`errorId`) + `aria-invalid`/`aria-describedby` threading (verify: test green, existing percentile tests updated and green)
- [x] 3.3 Verify the aggregation row in the RUNNING app (dev server on this worktree's ports), both themes, with and without the p error; screenshots under the worktree or run evidence dir only

## 4. Item 4 — duplicate key (frontend)

- [x] 4.1 Red-first test for `StepSchemaDiffChips`: two added fields named `""` → no duplicate-key console.error, two chips (verify: red on old code)
- [x] 4.2 Index-qualify chip keys (verify: test green)

## 5. Gates

- [x] 5.1 `npm run lint`, `npm run typecheck`, `npm run format:check`, `npm test` for touched files, `sbt testFull` (nice -n 19, capped workers) all green
