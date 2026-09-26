import { useMemo } from "react";

import { useAppSelector } from "../../../hooks/reduxHooks";
import {
  filterRowsByDimension,
  isPanelFilterableByDimension,
} from "../../../utils/crossFilterRows";
import type { Output } from "../../pipelines/types/output";
import type { Panel } from "../types/panel";

export interface CrossFilteredPanelData {
  rawRows: string[][] | null;
  headers: string[] | null;
  /** True when `rawRows` above was actually narrowed by the dashboard's
   *  active cross-filter — always `false` for the originating panel, a panel
   *  whose kind-appropriate field mapping doesn't reference the filter's
   *  dimension, or while no cross-filter is active. Drives the D7 truncation
   *  disclosure (`OutputPanelContent`), which must only render for a panel
   *  actually being narrowed. */
  isCrossFiltered: boolean;
  /** The panel's own total loaded row count BEFORE cross-filtering —
   *  meaningful only when `isCrossFiltered` is true (`LoadedScopeDisclosure`'s
   *  `loadedCount`). */
  loadedRowCount: number;
}

/** design.md D4 (evaluation-1.md CR1/CR2, cycle 2 revision) — used ONLY by
 *  `PanelCard` to derive the filtered `rawRows`/`headers` it threads to
 *  `PanelInspectView` (both the grid-context and fullscreen-context mounts),
 *  which render their own `DataGrid` directly from these props rather than
 *  going through `PanelContent`/`OutputPanelContent`. Every OTHER consumer
 *  (`PanelCardBody`'s main content, `MobileStackPanelBody`, `PanelContent`
 *  passed to `PanelFullscreenOverlay`) gets the filter applied INSIDE
 *  `OutputPanelContent` instead — see that component's own comment for why:
 *  it already resolves the Output it needs for kind-dispatch, so filtering
 *  there needs no separate `output` fetch at all, closing a live,
 *  probe-confirmed race a first version of this hook introduced by requiring
 *  `MobileStackPanelBody` to add ITS OWN new `useOutputMeta` call (mobile had
 *  none before this ticket). `output` here is the SAME `useOutputMeta` result
 *  `PanelCard` already resolves for `chartInspectConfig` — never a second
 *  fetch on the desktop path, matching HEL-572 D1/D5's established "second,
 *  independent fetch is fine; a THIRD is not" precedent. */
export function useCrossFilteredPanelData(
  panel: Panel,
  rawRows: string[][] | null,
  headers: string[] | null,
  output: Pick<Output, "kind" | "config"> | null,
): CrossFilteredPanelData {
  const crossFilter = useAppSelector((state) => state.panels.crossFilter);

  return useMemo(() => {
    const notFiltered: CrossFilteredPanelData = {
      rawRows,
      headers,
      isCrossFiltered: false,
      loadedRowCount: rawRows?.length ?? 0,
    };

    // design.md D4 — "no-op ... if panel.id equals the filter's originating
    // panel id (origin always renders full data)".
    if (!crossFilter || crossFilter.panelId === panel.id) return notFiltered;
    if (!rawRows || !headers) return notFiltered;
    if (!output) return notFiltered;
    if (!isPanelFilterableByDimension(output.kind, output.config, headers, crossFilter.dimension)) {
      return notFiltered;
    }

    const filtered = filterRowsByDimension(
      rawRows,
      headers,
      crossFilter.dimension,
      crossFilter.value,
    );
    return {
      rawRows: filtered,
      headers,
      // `filterRowsByDimension` returns the SAME reference (a safe no-op)
      // when `dimension` isn't actually present in `headers` — a headers/
      // fieldMapping drift case `isPanelFilterableByDimension` alone can't
      // rule out. Reference inequality is what tells "actually narrowed"
      // apart from that safe fallback.
      isCrossFiltered: filtered !== rawRows,
      loadedRowCount: rawRows.length,
    };
  }, [panel.id, rawRows, headers, output, crossFilter]);
}
