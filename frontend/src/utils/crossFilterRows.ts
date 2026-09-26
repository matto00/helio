// HEL-588 — dashboard-scoped cross-filtering: row filtering and the
// per-output-kind filterable-panel check. The MAIN content path applies
// these inside `OutputPanelContent` (`PanelContent.tsx`), where the Output
// it needs is already resolved for kind-dispatch; `PanelCard`'s own
// `useCrossFilteredPanelData` call applies `filterRowsByDimension` a second
// time, ONLY for what it threads to `PanelInspectView` (see that hook's own
// comment for why). Kept separate from `chartClickSelection.ts` (which
// resolves a CHART's own click→row mapping) — this module has no chart-type
// branching at all, since a cross-filter narrows by column name alone,
// uniformly across every Output kind.

import {
  readChartConfig,
  readCollectionConfig,
  readMarkdownConfig,
  readMetricConfig,
  readTableConfig,
  readTimelineConfig,
} from "../features/pipelines/ui/outputEditor/outputConfigTypes";

/** design.md D4 (design-gate round 1, CR1) — matches by exact string
 *  equality OR, when both sides parse as finite numbers, numeric equality —
 *  mirrors `chartClickSelection.ts`'s `filterRowsForSelection` scatter-branch
 *  precedent, which exists specifically so a scatter-originated selection
 *  (`value` stringified from a parsed float) doesn't mismatch a
 *  differently-formatted numeric sibling column (e.g. "3" vs "3.0").
 *  Exported (evaluation-1.md CR1) so `filterRecordRowsByDimension` below can
 *  apply the IDENTICAL match semantics to a keyed-record row shape — the two
 *  functions must never diverge on what counts as a match. */
export function cellMatchesValue(cell: string, value: string): boolean {
  if (cell === value) return true;
  const cellNumber = parseFloat(cell);
  const valueNumber = parseFloat(value);
  return Number.isFinite(cellNumber) && Number.isFinite(valueNumber) && cellNumber === valueNumber;
}

/** design.md D4 / tasks.md 3.1 — no-op (returns `rawRows` UNCHANGED, same
 *  reference) when `dimension` isn't a column in `headers`: this is what
 *  lets a caller apply this unconditionally once its OWN filterable-panel
 *  check (`isPanelFilterableByDimension` below) has already passed, without
 *  a second headers-drift guard at the call site. */
export function filterRowsByDimension(
  rawRows: string[][],
  headers: string[],
  dimension: string,
  value: string,
): string[][] {
  const col = headers.indexOf(dimension);
  if (col === -1) return rawRows;
  return rawRows.filter((row) => cellMatchesValue(row[col] ?? "", value));
}

/** evaluation-1.md CR1 — `TableRenderer` prefers `paginationRows` (a
 *  `Record<string,unknown>[]`, from `PanelCardBody`'s own
 *  `paginationState[panel.id]` selector) over `rawRows`/`headers` whenever
 *  `paginationRows` is non-empty, which is essentially always (`usePanelData`
 *  unconditionally fetches page 0 on mount). `filterRowsByDimension` above
 *  operates on the OTHER shape (`usePanelData`'s positional `rawRows`), so a
 *  Table-kind sibling panel's `rawRows` could be filtered correctly while its
 *  actually-rendered `paginationRows` stayed the full, unfiltered set — the
 *  live defect this function closes. Stringifies each cell exactly like
 *  `usePanelData.ts`'s own `rawRows` derivation (`v !== null && v !==
 *  undefined ? String(v) : ""`) before reusing the SAME `cellMatchesValue`
 *  semantics, so the two row shapes can never disagree about what matches. */
export function filterRecordRowsByDimension(
  rows: Record<string, unknown>[],
  dimension: string,
  value: string,
): Record<string, unknown>[] {
  return rows.filter((row) => {
    const raw = row[dimension];
    const cell = raw !== null && raw !== undefined ? String(raw) : "";
    return cellMatchesValue(cell, value);
  });
}

/** design.md "Filterable-panel criterion" (design-gate round 1, CR2) — reads
 *  the field-mapping vocabulary each `*OutputConfig` interface already
 *  declares (`outputConfigTypes.ts`), one reader per kind. An output kind
 *  this module doesn't recognize (defensive-only — `OutputKind` is a closed
 *  union) yields an empty mapping, which never matches any dimension. */
function fieldMappingForKind(
  outputKind: string,
  outputConfig: Record<string, unknown>,
): Record<string, string> {
  switch (outputKind) {
    case "chart":
      return readChartConfig(outputConfig).fieldMapping;
    case "metric":
      return readMetricConfig(outputConfig).fieldMapping;
    case "markdown":
      return readMarkdownConfig(outputConfig).fieldMapping;
    case "collection":
      return readCollectionConfig(outputConfig).fieldMapping;
    case "timeline":
      return readTimelineConfig(outputConfig).fieldMapping;
    default:
      return {};
  }
}

/** design.md "Filterable-panel criterion" / tasks.md 3.2 — per-output-kind
 *  match against the ticket's literal "field mapping references a column"
 *  wording (not a broader header-presence check, per the design-gate's
 *  required revision): a **table** panel matches via its effective
 *  displayed-column set (`columnOrder` when present/non-empty, per
 *  `TableRenderer`'s own precedent of using `columnOrder` over
 *  `fieldMapping` for column selection; every natural/loaded column when
 *  absent); every OTHER kind matches only when one of its `fieldMapping`
 *  VALUES (a column name) equals `dimension` exactly. A panel whose
 *  underlying data happens to contain a same-named, unmapped column is
 *  correctly excluded here (spec.md "a panel with an unmapped, same-named
 *  column is unaffected"). */
export function isPanelFilterableByDimension(
  outputKind: string,
  outputConfig: Record<string, unknown>,
  headers: string[] | null,
  dimension: string,
): boolean {
  if (outputKind === "table") {
    const { columnOrder } = readTableConfig(outputConfig);
    if (columnOrder && columnOrder.length > 0) return columnOrder.includes(dimension);
    return (headers ?? []).includes(dimension);
  }
  return Object.values(fieldMappingForKind(outputKind, outputConfig)).includes(dimension);
}
