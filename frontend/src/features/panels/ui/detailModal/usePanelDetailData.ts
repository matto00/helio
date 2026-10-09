import { useCallback, useMemo } from "react";

import { isOutputPanel } from "../../state/panelNarrowing";
import { useAppSelector } from "../../../../hooks/reduxHooks";
import { usePanelData } from "../../hooks/usePanelData";
import { useOutputMeta } from "../../hooks/useOutputMeta";
import { useCrossFilterServerOps } from "../../hooks/useCrossFilterServerOps";
import { useViewerControls } from "../../hooks/useViewerControls";
import { buildViewerControlFilterOps } from "../../state/viewerControlValues";
import { getDistinctValues } from "../../../pipelines/services/outputService";
import type { OutputControlSpec, Panel } from "../../types/panel";

// HEL-1190 — module-level stable empty array, same rationale as `PanelCardBody.tsx`'s
// `EMPTY_CONTROLS`: a fresh `[]` literal per-render for a non-output panel would defeat every
// `useMemo` below that lists `controls` as a dependency.
const EMPTY_CONTROLS: OutputControlSpec[] = [];

export function usePanelDetailData(panel: Panel) {
  // HEL-1190 design.md D1-D4 (task 5.3) — the SAME URL-held control selection the desktop
  // grid/mobile stack already read (`useViewerControls` is keyed by `panel.id`, so every render
  // path sharing that id shares the same source of truth). No sibling `usePanelSortFilter` layer
  // exists on this path (see `usePanelData`'s own doc comment for why composition happens
  // directly here instead), so `controlFilterOps` is threaded straight into `usePanelData`.
  const controls: OutputControlSpec[] = isOutputPanel(panel)
    ? panel.config.controls
    : EMPTY_CONTROLS;
  const {
    values: controlValues,
    setValue: setControlValue,
    clearValue: clearControlValue,
  } = useViewerControls(panel.id, controls);
  const controlFilterOps = useMemo(
    () => buildViewerControlFilterOps(controls, controlValues),
    [controls, controlValues],
  );
  const hasVisibleControls = useMemo(() => controls.some((c) => !c.orphaned), [controls]);
  const outputIdForControls = isOutputPanel(panel) ? panel.config.outputId : null;
  const fetchDistinctValues = useCallback(
    (column: string) =>
      outputIdForControls
        ? getDistinctValues(outputIdForControls, column).then((r) => r.values)
        : Promise.resolve([]),
    [outputIdForControls],
  );

  // HEL-946 Bug C(2) — the never-materialized empty state's "Run pipeline"
  // link needs the bound Output's pipelineId, which the panel itself
  // doesn't carry (only `config.outputId`) — same lookup `OutputPanelSection`
  // (`OutputPanelSection.tsx`) already makes for its own "Output" link.
  const viewOutputId = isOutputPanel(panel) ? panel.config.outputId : null;
  const { output: viewOutput } = useOutputMeta(viewOutputId);
  // HEL-1191 design.md D9/D9b — this modal owns its own `usePanelData` AND resolves the Output, so
  // it computes the cross-filter decision itself: `crossFilterEq` joins the fetch as its own
  // argument (C4), `crossFilterMode` gates the client-side fallback in `PanelContent`.
  const { crossFilterEq, mode: crossFilterMode } = useCrossFilterServerOps(panel, viewOutput);
  const {
    data,
    rawRows,
    headers,
    isLoading,
    error,
    errorKind,
    noData,
    neverMaterialized,
    paginationRows,
    rowsTruncated,
    refresh,
  } = usePanelData(panel, controlFilterOps, crossFilterEq);
  // HEL-1358 design D5 — `usePanelData` above writes this same entry the grid card reads.
  const totalRowCount = useAppSelector((state) => state.panels.paginationState[panel.id]?.total);
  return {
    controls,
    controlValues,
    setControlValue,
    clearControlValue,
    controlFilterOps,
    hasVisibleControls,
    fetchDistinctValues,
    viewOutputId,
    viewOutput,
    crossFilterMode,
    data,
    rawRows,
    headers,
    isLoading,
    error,
    errorKind,
    noData,
    neverMaterialized,
    paginationRows,
    rowsTruncated,
    refresh,
    totalRowCount,
  };
}
