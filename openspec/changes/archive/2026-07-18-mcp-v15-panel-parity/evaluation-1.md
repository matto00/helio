## Evaluation Report — Cycle 1

### Phase 1: Spec Review — PASS
Issues: none.

Verified against ticket.md DoD + spec.md scenarios:
- `create_panel` type enum = `metric/chart/table/text/markdown/image/collection`, `divider` removed
  (confirmed via live `tools/list` inputSchema); description documents each type's config shape and
  the `helio://uploads/image/<id>` markdown ref scheme.
- `bind_panel` `panelType` extended to `text/markdown/collection`; documented `fieldMapping` keys
  match ground truth (see Phase 2).
- Chart creation can set `chartType` via `appearance.chart.chartType` + per-type `chartOptions`;
  table path documents `density`/`columnOrder` — both live-verified (see Phase 3).
- New `upload_image` tool present, returns `id`/`url`/`markdownRef`, verified end-to-end including
  a served-image byte check.
- `schemas/create-panel-request.schema.json` `type` enum now includes `collection` with a matching
  `allOf` branch to `panel.schema.json#/$defs/CollectionConfig` (absorbs HEL-310 per design D5).
- All 22 tasks.md items are checked and match the diff; no scope creep — only
  `helio-mcp/src/helioApi.ts`, `helio-mcp/src/tools/write.ts`, and
  `schemas/create-panel-request.schema.json` changed (plus openspec change docs).
- Planning artifacts (proposal/design/spec/tasks) accurately reflect the final implementation —
  no drift found.
- No regression: `bindPanel`'s `fieldMapping` going from required to optional is a backward-compatible
  widening (existing callers passing `fieldMapping` are unaffected); confirmed table-bind-with-no-mapping
  live.

Known/accepted scoping judged acceptable (per orchestrator framing):
- `helio-mcp/src/tools/proposal.ts` + `src/types.ts` still list `divider`/omit `collection` for the
  separate `propose_dashboard`/`apply_proposal` flow. The proposal/design Impact section explicitly
  scopes this ticket to `write.ts`/`helioApi.ts`/`httpClient.ts`/schemas; the DoD's "no stale type
  lists remain" reads in context as covering the tools this ticket actually touches
  (`create_panel`/`bind_panel`), which are accurate. The executor flagged this as a spinoff candidate
  in files-modified.md rather than silently leaving it — acceptable, does not undermine the DoD.
- `git commit -n` bypass: `check:openspec` "complete but not archived" (expected pre-archive state)
  and `npm test` failing on a missing `jest-environment-jsdom` dep (environmental gap, and this
  change touches no `frontend/**` files so that gate doesn't apply per its `when` condition) — both
  documented explicitly in the executor's handoff. Acceptable.

### Phase 2: Code Review — PASS
Issues: none blocking.

- Wire-key claims independently re-verified against ground truth (not trusted from the handoff):
  - `fieldMapping.content` for text/markdown bind — confirmed in
    `frontend/.../editors/TextContentEditor.tsx:42` and `MarkdownEditor.tsx:40`.
  - Collection metric slots (`value`/`label`/`unit`) — confirmed in
    `frontend/src/features/panels/state/panelSlots.ts:8-12` (metric) and the collection
    `PANEL_SLOTS[baseType]` derivation comment (`panelSlots.ts:25-28`).
  - `CollectionPanel.applyPatch` merge-preserves `baseType`/`layout` across a patch —
    confirmed at `backend/.../panels/CollectionPanel.scala:180-188`.
  - `ChartAppearance` `jsonFormat5` with only `chartType` optional — confirmed at
    `backend/.../protocols/PanelProtocol.scala:147` and `backend/.../domain/model.scala:101-107`;
    `DEFAULT_CHART_APPEARANCE` in `helioApi.ts` matches `ChartAppearance.Default`
    (`model.scala:116-128`) field-for-field (seriesColors, legend, tooltip, axisLabels).
  - Chart/table/collection config shapes (`ChartOptions`/`LineChartOptions`/`BarChartOptions`/
    `PieChartOptions`/`ScatterChartOptions`/`TableConfig`/`CollectionConfig` `$defs` in
    `schemas/panel.schema.json`) match the tool description in `write.ts` verbatim (option names,
    enums, ranges).
  - `POST /api/uploads/image` single `file` multipart part → `201 {id, url}` — confirmed at
    `backend/.../routes/UploadRoutes.scala:38-69`.
  - All wire-key claims are accurate; no stale/false tool docs found in the touched tools.
- CONTRIBUTING.md: no inline FQNs (N/A — TS, not Scala); `npx eslint` on both changed TS files is
  clean (zero warnings); `npx prettier --check` on all three changed files is clean; no `any` usage
  introduced.
- DRY: `uploadImage` reuses `HelioHttpClient.postMultipart` (no httpClient.ts change), mirroring
  `createCsvDataSource`'s pattern exactly (`helioApi.ts:249-254` vs new `uploadImage`).
- Readable/modular: `withCompleteChartAppearance` is a small, well-documented pure helper; JSDoc on
  every touched public method/tool documents wire shapes with citations to backend source.
- Type safety: `Record<string, unknown>` used appropriately for passthrough payloads; no untyped
  escape hatches.
- Error handling: `guarded()` continues to surface backend errors verbatim (independently confirmed
  the `pyramid` chartType and would apply identically to 413/400 V41 paths already covered by
  existing `guarded` wrapping — unchanged).
- Tests: no unit-test harness exists in `helio-mcp` (pre-existing gap, not introduced by this
  change); live smoke-test evidence is a reasonable substitute per tasks.md 6.1's explicit fallback
  clause, and I independently reproduced it (Phase 3).
- No dead code, no over-engineering (single additive param + one small merge helper, no premature
  abstraction).

Non-blocking observation: `helio-mcp/src/helioApi.ts` was already 416 lines pre-change (over
CONTRIBUTING.md's ~400-line "propose a split in the PR description" soft threshold) and is now 518
lines after this change — the handoff doesn't call out a split proposal. CONTRIBUTING.md marks
file-size warnings as informational (the mechanically-enforced budget applies to
`check:scala-quality`, which is Scala-only), so this is not a blocking issue, but worth a mention
for a future pass (e.g. extracting `uploadImage`/`ChartAppearance` helpers into a small
`panelAppearance.ts` module).

### Phase 3: UI Review (MCP behavioral evidence) — PASS
Issues: none. Frontend/backend app code is untouched by this ticket; per the orchestrator's scoping
note, browser/Playwright verification does not apply. Instead ran the mandated MCP-specific
behavioral gates directly, independent of the executor's own run:

Gates re-run fresh:
- `helio-mcp`: `npm run build` (tsc) — exit 0, no errors.
- `npx eslint helio-mcp/src/helioApi.ts helio-mcp/src/tools/write.ts` — clean (no `lint` script
  exists in `helio-mcp/package.json`; confirmed no eslint/prettier scripts there, matching the
  handoff's claim; ran via the root project's shared eslint config instead).
- `npx prettier --check` on both TS files + the schema file — all pass.
- `npx openspec validate mcp-v15-panel-parity --strict` — valid, exit 0.
- `npm run check:schemas` — "schemas in sync with JsonProtocols".
- `npm run check:openspec` — only the expected pre-archive hygiene notice (complete 22/22, not
  archived).

Live MCP smoke test (independent re-run, backend already healthy on `localhost:8395`):
- Minted a fresh PAT via dev login (`matt@helio.dev`) + `POST /api/tokens`.
- Drove the **built** `dist/index.js` over real MCP stdio (SDK `Client` + `StdioClientTransport`),
  not source directly.
- `tools/list` confirms `upload_image` present and `create_panel`/`bind_panel` input schemas exactly
  match the diff's enums.
- Created a **collection** panel (`{baseType: metric, layout: list}`), then `bind_panel` with metric
  slots (`{value: amount, label: name}`) against a real pipeline-output DataType — resulting config
  shows `baseType`/`layout` preserved across the merge-patch, matching design D3.
- Called `upload_image` with a real 1x1 PNG — returned `id`/`url`/`markdownRef`; `GET` on the served
  `url` independently returned HTTP 200 with `image/png` content-type and valid PNG bytes.
- Created a **markdown** panel with `config.content` embedding the `helio://uploads/image/<id>` ref,
  then bound it (`fieldMapping: {content: name}`) — both the literal ref and the bound field key
  persisted correctly.
- Created a **bar chart** with `appearance.chart.chartType: bar` and
  `config.chartOptions.bar: {orientation, stacking, barGapPct}` — the returned panel carries a
  COMPLETE `ChartAppearance` (all required fields present) with `chartType: bar`, and the
  `chartOptions.bar` values persisted verbatim.
- Created a **table** panel with `config.density`/`config.columnOrder`, then bound it with
  `bind_panel` passing no `fieldMapping` — confirmed the tool now accepts an omitted mapping and the
  density/columnOrder values are preserved.
- Passed an invalid `chartType: "pyramid"` — got the backend's 400 surfaced verbatim: `"Invalid
  chartType value: 'pyramid'. Valid values: bar, line, pie, scatter"`.
- `get_dashboard` (export path) confirms all 4 created panels persist with the above configs.
- No unhandled exceptions from any tool call; every non-2xx backend response surfaced as a typed,
  readable error via `guarded()`, not a silent failure or opaque crash.
- Cleaned up all temporary driver scripts from the worktree after use (none committed, none left
  behind — hygiene requirement honored).

This independently reproduces every claim in the executor's `files-modified.md` smoke-test evidence
section, using a fresh dashboard/PAT (not reusing the executor's artifacts, though the same
pipeline-output DataType from the executor's earlier pipeline run was reused as the binding target).

Accessible-name/keyboard-support and breakpoint checks are N/A — there is no UI surface in this
change (MCP stdio tool server only).

### Overall: PASS

### Change Requests
None.

### Non-blocking Suggestions
- `helio-mcp/src/helioApi.ts` is now 518 lines (was 416 pre-change), over CONTRIBUTING.md's
  ~400-line "propose a split" soft threshold. Consider extracting the `ChartAppearance`
  default/overlay logic (`DEFAULT_CHART_APPEARANCE` + `withCompleteChartAppearance`) into a small
  dedicated module (e.g. `panelAppearance.ts`) in a future pass to keep the file within budget.
- Consider adding a lightweight test harness to `helio-mcp` (even a few unit tests around
  `withCompleteChartAppearance`'s merge behavior) so future changes to this file don't rely solely
  on live smoke tests for regression coverage.
