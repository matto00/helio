## Standing Constraints

- [C1] Red-first: task 3.1 is written and observed failing (output recorded) BEFORE any task in groups 1-2.
- [C2] Regression assertions run over rows loaded through the real CSV loader, never hand-built null rows.
- [C3] Backend tests via `sbt testFull`/`testOnly` only (never bare `sbt test`); cap 3-4 workers, `nice -n 19`.

## 1. Backend

### Backend

- [x] 1.1 `InProcessPipelineEngine.loadCsvRowsFromBytes`: blank/whitespace-only cell → null; pad missing cells with null; skip blank/whitespace-only lines; never trim non-blank cells (design D1)
- [x] 1.2 `FilterStep`: `= ""`/omitted value and `contains ""` match null, `!= ""` excludes null; all other cases unchanged (D3)
- [x] 1.3 `AnalyzeWithAiStep`, `GenerateTextStep`, `ConvertFormatStep`: `Some(null)` → `""`; absent key still `field-missing` (D4)
- [x] 1.4 `NodeSnapshotFilterSql`: `eq` with value `""` → `(data ->> col IS NULL OR data ->> col = '')` for every cast (D10b)
- [x] 1.5 Update scaladoc/comments that state CSV cells are always `String`/blank is `""` (SchemaInferenceEngine HEL-893/HEL-868 notes, steps README) so they no longer lie

## 2. Frontend

### Frontend

- [x] 2.1 Thread `records` (`filteredPaginationRows`) into `MetricOutputPanel` at PanelContent.tsx:320; aggregate over them so client `count` excludes null (D6)
- [x] 2.2 `ChartOutputPanel` computes `groupHasNull` (`records.some(r => r[groupBy] === null)`, never from rawRows) and carries it on the aggregation spec through ChartRenderer → ChartPanel → useChartClickHandler; `mapAggregateClickToSelection` returns `""` for label `"null"` when true; grouping untouched (D10a)
- [x] 2.3 `filterRecordsForAggregateSelection`: `value === "" ? (raw === null || raw === "") : String(raw) === value`; update HEL-1351 comment in PanelInspectView.tsx (D10a)

## 3. Tests

### Tests

- [x] 3.1 RED FIRST: engine-level spec — CSV source with blank cells run through the real loader → `count`/`count_distinct` exclude blanks; `fillnull` constant fills them
- [x] 3.2 Loader unit cases: empty, quoted-empty, whitespace-only → null; short-row padding null; blank/whitespace lines skipped; `,,,` line stays an all-null row; `" Bo "` preserved; header unchanged
- [x] 3.3 Regression suite over every design D7 and D7b row, each driven from a CSV-loaded frame, asserting the NEW value deliberately (incl. snapshot distinct-values/filter dropdown, rowCount + assert rowCountMin, assert regex, upsert default/optional numeric, server sort NULLS LAST, groupby count, WorkspaceContextComputations nullRate)
- [x] 3.4 FilterStep compat unit tests (`= ""`, `!= ""`, omitted value, `contains ""`, non-empty value unchanged, `is null`)
- [x] 3.5 AI/text step tests: null input → treated as `""`; absent → `field-missing` (generatetext, analyzewithai, convertformat)
- [x] 3.6 Inference/preview unchanged: all-blank column infers nullable `string`; preview returns `""` cells
- [x] 3.7 Jest: MetricOutputPanel count with a null cell; click on `"null"` with null records → `""`, without null records → `"null"`; `"undefined"` group click → Inspect lists its absent-key rows; grouping/fixture unchanged; aggregate Inspect for `""` and `"null"`; sibling filter of `""` keeps null cells
- [x] 3.8 Backend spec: Output rows `eq ""` returns null and `""` cells (D10b)
- [x] 3.9 Mutation proof: revert 1.1 and record 3.1/3.3 red; revert 1.2 → 3.4 red; revert 1.4 → 3.8 red

## 4. Delivery

- [x] 4.1 Write the user release note (PR body): blanks are now null, listing every D7/D7b change, D10 (blank-category cross-filter incl. its scope beyond CSV, `/rows` `eq ""`, and that on non-CSV sources holding both null and `""` each of those bars' Inspect lists both), the Q1-Q8 rulings, `= ""` compat, AI-step null-as-empty, existing snapshots keep `""` until next run, and the `is null`/fillnull guidance
