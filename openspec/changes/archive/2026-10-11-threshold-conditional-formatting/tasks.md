## Standing Constraints

- [C1] Red first: every behaviour test in group 4 is written and run RED against the pre-change code (failure output
  kept in the run evidence dir) before the implementation that turns it green; guards are labelled as guards and
  proven failable by a mutation.
- [C2] Seam test: client and server agree on `conditionalFormats` via one shared fixture
  (`shared-test-fixtures/conditional-formats-config.json`) consumed by both a backend spec (incl. real routes) and a
  frontend test driving the real editor (design D8).
- [C3] Rendering with no rules is unchanged: existing renderer/builder tests and snapshots stay green unedited; any
  edited existing test or fixture is called out and justified.
- [C4] UI verified on the RUNNING app (this worktree's dev 6739 / backend 9646) in light and dark, desktop and 375px,
  including a pinned table column under a row rule; screenshots kept in the run evidence dir, never the repo root.
- [C5] CSS-dependent claims (colour, wash) are proven only by Playwright computed styles on the running app; Jest
  proves classes/DOM only (jest maps `.css` to `styleMock.js`).

## 1. Backend

- [x] 1.1 Add `conditionalFormats` to `OutputConfigValidation.KnownKeys` for Metric, Table, Collection; append the
  rule-shape sentence to `KeysDoc`; verify `OutputConfigValidationSpec` and `AssistantProposalToolSchemasSpec` pass.
- [x] 1.2 Create `domain/outputs/ConditionalFormats.scala` (pure validator, design D2) returning
  `conditionalFormats[<i>]: <reason>`; verify with its unit spec (4.1).
- [x] 1.3 Chain it into `OutputConfigValidation.validateConfig` (ValidateWrite only) and
  `PipelineCreatePreflight.validateOutputConfig`; verify create/update/single-call/patch-set preview reject (4.2).

## 2. Contract docs

- [x] 2.1 Add a `conditionalFormats` property stub and update the per-kind key sentence in the three Output-config
  request schemas; verify `npm run check:schemas` passes.
- [x] 2.2 Add `conditionalFormats` to helio-mcp `OUTPUT_CONFIG_KEYS_DOC` plus a `CONDITIONAL_FORMATS_CONFIG_DOC`
  appended to `add_output`/`update_output`; verify helio-mcp tests (4.6).

## 3. Frontend

- [x] 3.1 Create `panels/ui/renderers/conditionalFormatting.ts` (types, `matchRule`, `resolveTone`, cell/row resolvers;
  design D3); verify unit tests (4.3).
- [x] 3.2 Add `readConditionalFormats` and the optional field to Metric/Collection/Table config types and readers in
  `outputConfigTypes.ts`; verify reader tests.
- [x] 3.3 Add `ToneGlyph` and metric value tone styling in `MetricRenderer` + `PanelContent.css` (tokens only);
  thread the prop through `MetricOutputPanel`, `CollectionRenderer` and `OutputPanelContent`; verify renderer tests.
- [x] 3.4 Add additive `ColumnDef.cellClassName` to `DataGrid`; verify `DataGrid*.test.tsx` green unedited.
- [x] 3.5 Apply cell and row rules in `TableRenderer` (compose with caller `rowClassName`; pinned-cell wash; design
  D6) and pass `cfg.conditionalFormats` from `OutputPanelContent`; verify table tests.
- [x] 3.6 Build `ConditionalFormatsField` + hook (design D7) and wire it through `OutputKindConfigCard`/
  `OutputKindFields`, `useOutputKindState`, `configPatch.ts` and BOTH `buildOutputConfig` paths; verify editor tests.

## 4. Tests

- [x] 4.1 `ConditionalFormatsSpec` (unit): every valid shape accepted; every malformation in the spec rejected with
  index + reason.
- [x] 4.2 Route-level: Output create/PATCH, single-call pipeline create, proposal grounding, patch-set preview and apply reject an invalid list
  with 400 and persist nothing; chart/timeline/markdown reject the key; a valid list round-trips.
- [x] 4.3 Evaluator unit tests: first match wins, inclusive `between`, numeric vs text `eq`/`neq`, case/trim, empty
  never matches, raw-not-formatted.
- [x] 4.4 Jest renderer tests (CLASSES/DOM only: jest maps `.css` to `styleMock.js`, so it cannot measure colour):
  metric tone class + glyph + sr text (label and tone-word); collection per-item tones; table cell vs row class
  independence, a cell-rule cell carries the cell class and not the row-wash cell class; row glyph in first visible cell
  with the rule column hidden; labelled STRUCTURAL guard that the unit is outside the toned element and has no tone
  class; delta classes unchanged; no-rules DOM identical.
- [x] 4.5 Seam: `shared-test-fixtures/conditional-formats-config.json` (valid cases incl. JSON-null optional keys;
  invalid cases checked by backend AND the editor validation helper) + backend `ConditionalFormatsSeamSpec` + frontend
  seam test driving the real editor (C2).
- [x] 4.6 helio-mcp `server.test.ts` pin includes `conditionalFormats`; add/update descriptions name ops and tones.
- [x] 4.7 Playwright e2e on the running app (computed styles), light AND dark: (a) metric value colour equals the
  resolved `--app-<tone>`; (b) metric unit colour equals the no-rules render on a panel with a non-default
  `--panel-text-override`; (c) one wash per cell: an unpinned and a PINNED cell inside a washed row, and a cell-rule
  cell in that row, each have exactly the expected single `-surface` composite.
- [x] 4.8 Prove 4.7 failable: run (b) RED with the tone class moved onto the outer value span, and (c) RED with the
  row wash painted on the `<tr>` (mutations reverted; red output in the run evidence dir).
- [x] 4.9 Running-app screenshots light/dark, desktop/375px incl. compact metric card glyph size and a long toned cell
  still ellipsising (C4).
- [x] 4.10 Full gates: frontend lint/typecheck/format:check/jest, `npm run check:schemas`, helio-mcp tests, backend
  `sbt testFull` (memory-checked, `nice -n 19`), all green on the final head.
