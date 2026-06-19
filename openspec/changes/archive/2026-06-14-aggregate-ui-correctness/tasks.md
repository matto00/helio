## 1. Backend

- [x] 1.1 Create `backend/src/test/scala/com/helio/domain/AggregateStepSpec.scala` with direct unit tests for `AggregateStep.apply`
- [x] 1.2 Add test: empty rows input → output is empty Seq (not a row with 0.0)
- [x] 1.3 Add test: empty groupBy collapses all non-empty rows to one output row
- [x] 1.4 Add test: sum of all-null field → 0.0; avg/min/max of all-null field → null
- [x] 1.5 Add test: count of all-null field → 0L (Long)
- [x] 1.6 Add test: multi-group sum — correct sum per group
- [x] 1.7 Add test: count returns Long (apply/infer parity)
- [x] 1.8 Add test: min/max on a string-typed field → null (toDouble yields no numerics for strings)
- [x] 1.9 Run `sbt test` in the worktree to confirm all backend tests pass

## 2. Frontend

- [x] 2.1 Add `FN_HINTS` constant in `AggregateConfig.tsx` mapping each AGG_FN to its hint string
- [x] 2.2 Render hint `<span className="pipeline-detail-page__aggregate-fn-hint">` below each aggregation row's fn Select using `FN_HINTS[agg.fn]`
- [x] 2.3 Add `blurredAliasRows` state (`useState<Set<number>>`) to track which aggregation row indices have had the alias input blurred; add `onBlur` handler on alias TextField that adds the index to the set; render alias-empty `InlineError` only when index is in set AND `agg.alias === ""`; import `InlineError` from `"../../../shared/chrome/InlineError"`
- [x] 2.4 Add relationship description paragraph below the "Group by" section label with text "Group-by fields define the partition keys. Each unique combination becomes one output row."
- [x] 2.5 Run `npm run lint` and `npm run format` in the worktree frontend directory to confirm clean output

## 3. Tests

- [x] 3.1 Extend `AggregateConfig.test.tsx`: for each AGG_FN, render a row with that fn and assert `screen.getByText(<hint>)` where hint texts are: sum="Sums numeric values; ignores nulls", avg="Averages numeric values; ignores nulls", min="Minimum numeric value; ignores nulls and non-numeric", max="Maximum numeric value; ignores nulls and non-numeric", count="Counts non-null values in the field"
- [x] 3.2 Extend `AggregateConfig.test.tsx`: add a row with alias="" without firing blur; assert `screen.queryByText("Output name required")` returns null (error not shown before user interaction)
- [x] 3.3 Extend `AggregateConfig.test.tsx`: after rendering a row with alias="", fire `fireEvent.blur` on the alias textbox; assert `screen.getByText("Output name required")` is present (InlineError renders as `<p>`, use getByText not getByRole)
- [x] 3.4 Extend `AggregateConfig.test.tsx`: fire blur on alias input after typing a non-empty alias; assert `screen.queryByText("Output name required")` returns null
- [x] 3.5 Extend `AggregateConfig.test.tsx`: test relationship description text "Group-by fields define the partition keys" is present
- [x] 3.6 Run `npm test -- --testPathPattern=AggregateConfig` to confirm all frontend tests pass
- [x] 3.7 Commit all changes with message prefix "HEL-263"
