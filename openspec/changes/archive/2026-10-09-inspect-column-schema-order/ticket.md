# HEL-1394: Inspect grid column order follows the server's row key order (alphabetical) — should it follow the Output schema or columnOrder?

## Description

origin_kind: followup
origin_ticket: HEL-1365

Both Inspect grids build their columns from `Object.keys(rows[0])` (`usePanelData.ts` ~:215), so they follow the
server's row key order. In practice that's alphabetical, because jsonb and spray-json reorder keys (see HEL-1182's
finding). Example: `amount_usd, category, date, merchant`, where the source's own order is
`date, category, merchant, amount_usd`. HEL-1365 investigated a "by headers" reorder and found it would change nothing.
The real question is which order is canonical.

Options:

1. The Output's declared `schema` order.
2. The table Output's `columnOrder` config when set, falling back to schema order.
3. Leave as is (alphabetical).

Note: the table panel itself may already honour `columnOrder`, so options 1–2 would also make Inspect consistent with
the panel.

## Owner Ruling

**Ruled 2026-10-08 (owner, morning form, relayed via the driver chat): option 2** — use the Output's `columnOrder`
config when set, falling back to the Output's declared schema order. The ticket title's "needs owner ruling" is
therefore resolved.

## Acceptance Criteria

1. Both Inspect mounts (grid-context `PanelCard` and `PanelFullscreenOverlay`) render their columns in the Output's
   `columnOrder` order when the Output config carries a non-empty `columnOrder`, otherwise in the Output's declared
   `schema` order — never in alphabetical/natural-sort order.
2. Applies to both Inspect row paths: raw-row selection and aggregate-group (records) selection.
3. Inspect never hides data: every column present in the loaded rows still appears (keys not covered by
   `columnOrder`/schema are appended after the ordered ones, in today's natural order). `columnOrder` only orders.
4. No new network fetch: the Output (schema + config) comes from the `useOutputMeta` result Inspect already uses.
5. Unit tests prove the ordering (red against the pre-change behavior) for: schema order, columnOrder precedence,
   stale columnOrder/schema keys skipped, extra row keys appended.

## Premise-check findings (orchestrator, 2026-10-09)

- The alphabetical order actually comes from `DataGrid.deriveColumns` (natural-sort over the union of row keys):
  `PanelInspectView` passes no `columns` prop, so server key order is irrelevant on the client.
- Inspect exists only for `kind: "chart"` Outputs (`usePanelCardInspect`). `columnOrder` is a table-config field, so
  for real chart Outputs the ruling resolves to schema order; `columnOrder` is honoured if present.
- The table panel's own no-`columnOrder` fallback (`TableRenderer.deriveKeys`) is natural-sorted too, but is a separate
  code path — out of scope here (follow-up candidate).

## Owner Ruling 2 (2026-10-09, escalation `HEL-1394-1791544000160-b74b22`)

The evaluator's live check found the server stores every Output's `schema` alphabetically
(`SchemaInferenceEngine.inferShallowFromJsObjects` sorts keys; `PipelineRunSucceededWrites` writes it after every run), so
this frontend change is invisible today. Owner answered (chat, recorded via `concertino answer`):
**ship-frontend-and-file-backend-followup**. The backend fix (store Output schemas in source/pipeline order, plus
`TableRenderer.deriveKeys`) is **HEL-1443**. AC1's visible effect is therefore deferred to HEL-1443; this ticket ships the
frontend ordering contract (proved by unit tests) and must state plainly in the PR that it is invisible until HEL-1443
lands.
