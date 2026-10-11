## Standing Constraints

- [C1] Chart colours reach ECharts only as hex/rgb resolved from theme tokens (`parseableOr`); never `-surface`,
  `color-mix()` or a free colour.
- [C2] Seam tests are red first; guards are labelled and mutation-proven, red output saved in the run evidence dir.
- [C3] Record every e2e fixture id in evidence as created; delete by exact id (also after timeouts); never touch the
  owner's account; Playwright output stays in the worktree/evidence dir.
- [C4] Any ECharts behaviour claim (axis extent, bar layout, legend, tooltip) is proven by a probe or the running app.

### Backend

## 1. Backend validation

- [x] 1.1 `ChartReferenceMarks` (domain/panels): constants + `validate(written, stored)` per D1/D2; verify
  `ChartReferenceMarksSpec` (every rejection, tolerance rule, constants == fixture `limits`)
- [x] 1.2 Add both keys to `KnownKeys(Chart)`, call the validator from `validate`, extend `KeysDoc` from the
  constants; verify `OutputConfigValidationSpec`
- [x] 1.3 Backend seam route spec (D9): POST/PATCH/single-call create of `validConfig` round-trips; each invalid case
  400 with its message fragment; red on main saved to evidence before 1.1-1.2

### Schemas and MCP

## 2. Schemas and docs

- [x] 2.1 Three Output request schemas: both properties per D1/D3 (`pattern "\\S"` on label) + description text;
  verify the schema-drift hook passes
- [x] 2.2 helio-mcp `tools/outputs.ts` doc text; verify helio-mcp tests pass

### Frontend

## 3. Rendering

- [x] 3.1 Register MarkLine/MarkArea in `echartsCore.ts`; record `npm run build` chunk sizes before/after in evidence
- [x] 3.2 `utils/referenceMarks.ts` (types, constants, `sanitizeReferenceMarks`) + `readChartConfig`; verify tests
- [x] 3.3 Tone tokens in `ChartThemeTokens`/`resolveChartTheme` (C1); verify `chartAppearance` tests
- [x] 3.4 `referenceMarksOption.ts` per D5 (line carrier, pass order after overlay/tooltip/emphasis, dataMin/
  dataMax), threaded `ChartOutputPanel` -> `ChartRenderer` -> `ChartPanel` -> `useChartOption` and the editor
  preview; verify unit tests
- [x] 3.5 Test-only: a mark click makes no selection (D6); verify a `useChartClickHandler` test

## 4. Editor

- [x] 4.1 `ReferenceMarksField.tsx` + `useOutputKindState`/`buildOutputConfig`/`configPatch` wiring; label trimmed,
  non-finite blocked, invalid drafts block Save, hidden for pie/heatmap, normalized hint (D8); verify sheet tests

### Tests

## 5. Tests and verification

- [x] 5.1 Frontend seam test + shared fixture `shared-test-fixtures/chart-reference-marks.json` (D9); red first
- [x] 5.2 GUARD: TS constants and the three schemas (exactly 3 found) agree with fixture `limits`; mutation red saved
- [x] 5.3 D5 unit tests: in-range mark leaves extent identical; above-data mark widens with zero kept; bar width
  unchanged with marks (bar + histogram); overlay still drawn with marks; single-series tooltip trigger unchanged;
  marks carry `blur` opacities (line 1, band 0.12) and the carrier is excluded from the legend; horizontal bar uses xAxis; normalized/pie/heatmap unchanged; tone colours
- [x] 5.4 e2e `e2e/hel1306-chart-reference-lines.spec.ts`: line + bar with a threshold above the data and a band;
  asserts the live ECharts option/marks and bar width; fixture ids recorded and cleaned up (C3)
- [x] 5.5 Running-app check, light + dark at 1440 and 375, incl. a neutral line beside the "vs" overlay, a legend
  toggle and hovering a data series (marks must not fade); screenshots in evidence
- [x] 5.6 Pre-PR re-sync with origin/main (HEL-1307): resolve merges, add the MODIFIED known-key delta per design
  Risks, rerun seam tests; verify `openspec validate` passes (origin/main has no HEL-1307 yet: MODIFIED delta added from
  current main text, no merge needed; 1307 must re-base its delta)
- [x] 5.7 Full gates: lint, typecheck, jest, `sbt testFull` (MemAvailable >= 15 GB, `nice -n 19`), touched e2e
