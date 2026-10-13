## Standing Constraints

- [C1] A blank selection's stored value (Redux selection, cross-filter, `setCrossFilter`) stays `""`; "(blank)" is presentation only.
- [C2] No Flyway migration, no V130; legacy schema fields without `nullable` read `true` for CSV sources and Outputs only; other kinds report exactly what they report today.
- [C3] Do not modify `TimestampParsing.scala`, `CastStep.scala` or `chartTimeAxis.ts` (HEL-1502, PR #985).
- [C4] Tests: jest/playwright at most 3 workers under `nice -n 19`; `sbt testFull` (never bare `sbt test`); Bash timeout 600000; never nohup/background a test run; no pkill/pgrep/killall; stop servers only via `scripts/concertino/stop-servers.sh`.

### Backend

## 1. Stored schema nullability

- [x] 1.1 Add `nullable: Option[Boolean] = None` to `SchemaField`; JSON write emits it only when `Some`, read tolerates absence (verify: format round-trip unit test, absent and present)
- [x] 1.2 `fromCsvLines` streams a nullability fold over every data row, skipping blank/whitespace-only lines; update `SchemaInferenceEngineSpec.scala:724-726` to `Seq(false, false)` (verify: 150-row test, trailing-newline test)
- [x] 1.3 `inferShallowFromJsObjects` computes nullable from JsNull/absent and its stale comment is corrected (verify: unit test)
- [x] 1.4 CSV create, URL create and refresh persist `Some(nullable)` (`upsertSourceDataType` passes `Some` only for CSV, content kinds `None`); Output run and backfill persist `Some(nullable)` (verify: repository round-trip shows the key)
- [x] 1.5 Audit `SchemaField` equality/set comparisons and confirm CSV `Some` values flowing through analyze are harmless; any "same columns" check compares name+type only (verify: list sites in files-modified.md)
- [x] 1.6 `InferredFieldResponse.fromDomain` takes a per-kind legacy default (CSV true, others false); `PanelCapabilityService` and `WorkspaceContextService` read `getOrElse(true)` (verify: route/service tests)

### Frontend

## 2. Blank label

- [x] 2.1 Add `utils/blankLabel.ts` (`BLANK_LABEL`, `selectionValueLabel`, category relabel, shared strict `groupHasNull`) (verify: unit tests)
- [x] 2.2 `buildChartOption` gets a `blankCategory` flag and relabels the category axis (x vertical, y horizontal)/pie names after `applyChartOverlay` (verify: vertical/horizontal/pie + overlay-at-(blank)-index tests)
- [x] 2.3 Click mapper maps `BLANK_LABEL` + `groupHasNull` to `""` for vertical, horizontal and pie (verify: click tests per orientation)
- [x] 2.4 `OutputPreviewPane` uses the same `groupHasNull` + relabel (verify: preview test)
- [x] 2.5 `HistoryChart` relabels stored "null" in BOTH selected rows and the `selectPointOverlay` comparison points for grouped series (verify: HistoryChart vs-comparison test)
- [x] 2.6 `CrossFilterIndicator` and `PanelInspectView` header/button use `selectionValueLabel` (verify: component tests)
- [x] 2.7 DESIGN.md copy rule for "(blank)" near "Nulls sort last" (verify: diff)

### Tests

## 3. Tests and evidence

- [x] 3.1 `CsvBlankCellsNullSnapshotSpec` `eq ""` loop covers `SortCast.AsTimestamp` (verify: testFull)
- [x] 3.2 `CsvBlankCellsNullStepsSpec` lookup test asserts the null-row count (verify: testFull)
- [x] 3.3 Backend tests for every scenario in `specs/stored-schema-nullability`, incl. legacy-absent CSV/Output read true and image source unchanged (verify: testFull)
- [x] 3.4 Frontend tests for every scenario in `specs/blank-category-label`, incl. click (blank) -> Filter dashboard -> sibling rows (verify: jest)
- [x] 3.5 Update tests pinning "null" categories where the record set has a real null; keep literal-"null" cases (verify: jest)
- [x] 3.6 Red-first evidence: revert each fix and record the failing test names in files-modified.md (verify: transcript)
- [x] 3.7 Live probe: upload an all-blank-column CSV as a throwaway @example.test user, read GET list nullable true; delete the user by exact (id, email) via buildUserDeleteSql (verify: transcript)
