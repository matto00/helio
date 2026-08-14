## 1. MCP

- [x] 1.1 Add `UpdatePanelRequest` client-side interface to `helio-mcp/src/types.ts` (mirroring
      the backend's `UpdatePanelRequest`: optional `title`/`type`/`config`/`appearance`),
      documenting the config partial-merge vs. `update_data_type`'s wholesale-replace distinction.
- [x] 1.2 Add `buildUpdatePanelBody` to `helio-mcp/src/tools/updateSchemas.ts`, including a key
      only when the caller actually supplied that argument (mirrors
      `buildUpdateDataTypeBody`/`buildUpdatePipelineStepBody`); update the module's header comment
      to name this third builder.
- [x] 1.3 Add `HelioApi.updatePanel(panelId, patch)` to `helio-mcp/src/helioApi.ts` — thin
      `PATCH /api/panels/:id` pass-through, alongside `updatePanelAppearance`.
- [x] 1.4 Register the `update_panel` tool in `helio-mcp/src/tools/write.ts` immediately after
      `update_panel_appearance`, with a description stating:
      - which top-level fields are patchable (`title`/`type`/`config`/`appearance`);
      - that `type` is validated against the stored kind (no-op on match, backend-rejected on
        mismatch, never silently dropped);
      - that `config` is a per-field partial merge (omit = unchanged, `null` = clear) mirroring
        `appearance`'s existing semantics — NOT a wholesale replace like `update_data_type`'s
        `fields`/`computedFields`;
      - that `config.dataTypeId`/`config.fieldMapping` are technically patchable here too, but
        `bind_panel` is the preferred tool for binding changes (it also validates V41 + `panelType`
        consistency) — the design.md D6 cross-reference;
      - each of the **nine** patchable panel kinds' config field names and merge exceptions,
        dispatched by the panel's STORED kind (`PanelConfigCodec.applyConfigPatch`), not only the
        five the ticket's own motivating example covers:
        - metric: `unit`/`label`/`dataTypeId`/`fieldMapping`/`aggregation`/`metricId` (standard).
        - chart: `dataTypeId`/`fieldMapping`/`aggregation`/`metricId` (standard); `annotation`
          clears on `null` OR a blank/whitespace string, not only `null`; `chartOptions` clears on
          `null` OR a non-null object that, after per-type (line/bar/pie/scatter) validation,
          carries no populated sub-field — including a bare `{}` — so an agent sending
          `chartOptions: {}` "just to be safe" silently wipes existing display options rather than
          leaving them unchanged.
        - table: `dataTypeId`/`fieldMapping`/`columnWidths`/`metricId` (standard); `density`
          (standard, but enum-validated — an invalid value 400s, not silently dropped);
          `columnOrder` (standard).
        - text/markdown: `dataTypeId`/`fieldMapping` (standard); `content` has no null/absent
          distinction the same way the others do — omitting it leaves it unchanged, but an
          explicit `null` clears it to `""` (not "removed").
        - image: `caption` clears on `null` OR a blank/whitespace string (same exception shape as
          chart `annotation`); `imageUrl` clears to `""` on `null` (same shape as `content`);
          `imageFit` resets to the default `"contain"` on `null` (NOT a clear-to-empty) and is
          enum-validated on a non-null value.
        - collection: `dataTypeId`/`fieldMapping` (standard); `baseType` resets to the default
          `"metric"` on `null` (NOT a clear); `layout` resets to the default `"grid"` on `null`
          (NOT a clear) and is enum-validated on a non-null value; `itemOptions` clears on `null`
          OR an empty object.
        - timeline: `dataTypeId`/`fieldMapping` (standard); `timelineOptions.sort` resets to the
          default `"asc"` on `null` OR an empty object (NOT a clear).
        - divider: `orientation` resets to the default `"horizontal"` on `null` (NOT a clear,
          enum-validated on a non-null value); `weight`/`color` (standard).

## 2. Tests

- [x] 2.1 Add `buildUpdatePanelBody` unit tests to `helio-mcp/src/tools/updateSchemas.test.ts`,
      mirroring the existing `buildUpdateDataTypeBody`/`buildUpdatePipelineStepBody` coverage
      style: empty patch, single-field patch, all-fields patch, and confirming an omitted
      argument never appears as a key in the built body.
- [x] 2.2 Run `npm test` in `helio-mcp/` and confirm the new suite passes alongside the existing
      one.

## 3. Docs / Build

- [x] 3.1 Add the `update_panel` row to `helio-mcp/README.md`'s write/composition tool table,
      matching the existing HEL-328 rows' style (endpoint + purpose, noting the config
      partial-merge distinction from `update_data_type`).
- [x] 3.2 Rebuild `helio-mcp/dist/` (`npm run build` in `helio-mcp/`) and commit the rebuilt output.
      Done: rebuilt clean (`tsc` exit 0). NOT committed — `dist/` is gitignored
      (`helio-mcp/.gitignore`) and has never been tracked; the sibling HEL-328
      ticket's identical task ("Rebuild `dist/`") also did not commit it. Flagged
      to the orchestrator rather than force-adding a gitignored directory
      against repo convention — see executor's final report.
