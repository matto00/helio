## Standing Constraints

- [C1] Red first: every new frontend behaviour test is shown failing before the implementation commit (record the red
  run in the executor report); a test that passes before the change is labelled a guard with a mutation that turns it red.
- [C2] Conditional-format rule evaluation (`conditionalFormatting.ts`) is not modified; rules compare raw values.
- [C3] No backend value validator for `format`/`columnFormats`; backend changes are doc text and tests only.

### Backend

- [x] 1.1 Add `OutputFormatVocabulary` (lists + `Doc`) and append `Doc` to `OutputConfigValidation.KeysDoc` (D7/D8);
  update every spec that pins KeysDoc text; verify with the targeted ScalaTest specs.
- [x] 1.2 Add `format`/`columnFormats` vocabulary to the `format`/`columnFormats` property descriptions in the three
  Output request schemas; verify schema-drift/hygiene check passes.

### Frontend

- [x] 2.1 Add the pure `formatDuration` helper (design D1/D2); verify with its unit tests (task 4.1).
- [x] 2.2 Extend `MetricFormat`/`isMetricFormat` with `duration`/`durationMs` and `formatMetricValue` to use the helper;
  verify metric, collection, history-delta and `HistorySummary` render duration text (task 4.2).
- [x] 2.3 Extend `TableColumnFormatType`, `TableColumnFormatSpec.unit`, `readColumnFormats` and `formatColumnValue`;
  right-align duration columns in `TableRenderer`; verify with columnFormatting/reader tests (task 4.3).
- [x] 2.4 Editor: metric/collection Format options; table column options, `TableDisplayFields.isColumnFormatSelection`
  and `useOutputColumnFormats` mapping with explicit unit handling (D4); verify with task 4.4.
- [x] 2.5 helio-mcp: vocabulary arrays + `FORMAT_VOCABULARY_DOC` appended to `OUTPUT_CONFIG_KEYS_DOC`; update its test
  pin; verify with the helio-mcp test suite.

### Tests

- [x] 4.1 `formatDuration` unit tests covering every spec scenario (330, 0, 45, 45.6, 0.25, 3600, 3725, 3755, 90061,
  59.6, 3599.7, -330, 400 days, 3629.5 -> `1h`, 88199.5 -> `1d`, 3629500 ms -> `1h` (single-rounding red cases)).
- [x] 4.2 Metric/collection renderer tests incl. a duration metric with a HEL-1307 rule (value text formatted, tone from
  raw value) and the comparison delta.
- [x] 4.3 Table tests: ms column, null -> `—`, `"n/a"` passthrough, filter matches display text, sort by raw value.
- [x] 4.4 Editor tests: Duration / Duration (ms) for metric, collection and a table column, saved config, reopen state;
  ms -> Duration (s) and ms -> Number -> Duration (s) both save `{ type: "duration" }` (no unit) and reopen as (s).
- [x] 4.5 Seam: `shared-test-fixtures/duration-format-seam.json` with EXACT-equality checks on the frontend (red first),
  backend (lists, Doc, three schema descriptions, create + PATCH round-trip as labelled guard) and helio-mcp (D8).
- [x] 4.6 Run the gates: lint, typecheck, prettier, targeted jest, targeted sbt specs, helio-mcp tests.
