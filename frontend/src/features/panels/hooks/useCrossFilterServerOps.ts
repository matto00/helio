import { useMemo } from "react";

import { buildViewerControlFilterOps } from "../state/viewerControlValues";
import { useViewerControls } from "./useViewerControls";

import { useAppSelector } from "../../../hooks/reduxHooks";
import { isPanelFilterableByDimension } from "../../../utils/crossFilterRows";
import type { Output } from "../../pipelines/types/output";
import { isOutputPanel } from "../state/panelNarrowing";
import type { CrossFilterEq, OutputControlSpec, Panel } from "../types/panel";
import { useOutputFilterCapabilities } from "./useOutputFilterCapabilities";

/** How the dashboard's active cross-filter applies to ONE panel (design.md D3/D9b):
 *  - `"server"`: sent to the Output read as an `eq` op (`crossFilterEq`);
 *  - `"client-fallback"`: today's behaviour — narrow the loaded rows client-side, with the
 *    loaded-scope disclosure (timestamp column, contract disallows `eq`, capabilities still
 *    loading / failed);
 *  - `"none"`: the filter does not touch this panel (none active, this is the originating panel,
 *    or the panel's field mapping doesn't reference the dimension). */
export type CrossFilterMode = "server" | "client-fallback" | "none";

export interface CrossFilterServerOps {
  crossFilterEq: CrossFilterEq | null;
  mode: CrossFilterMode;
}

const NO_CONTROLS: OutputControlSpec[] = [];
const NO_CROSS_FILTER: CrossFilterServerOps = { crossFilterEq: null, mode: "none" };

/** HEL-1191 design.md D1/D3 — the ONE eligibility decision for a panel, computed by whoever owns
 *  the panel's Output (`PanelCardBody`, `PanelDetailModal`, `PanelCard` for the fullscreen overlay)
 *  and threaded down, so a panel is never filtered by both the server and the client path.
 *
 *  Candidacy uses the Output's declared schema column names (never the loaded rows' headers): a
 *  server-narrowed result with zero rows has no headers, which would flip a headers-based
 *  criterion and oscillate the request. */
export function useCrossFilterServerOps(
  panel: Panel,
  output: Pick<Output, "id" | "kind" | "config" | "schema"> | null,
): CrossFilterServerOps {
  const crossFilter = useAppSelector((state) => state.panels.crossFilter ?? null);

  // design.md D2a — the panel's viewer-control ops, derived from the SAME URL-held source every
  // host reads (`useViewerControls` is keyed by panel id), so every host reaches the same decision.
  const controls = isOutputPanel(panel) ? panel.config.controls : NO_CONTROLS;
  const { values: controlValues } = useViewerControls(panel.id, controls);
  const controlOps = useMemo(
    () => buildViewerControlFilterOps(controls, controlValues),
    [controls, controlValues],
  );

  const dimension = crossFilter?.dimension ?? null;
  const schemaNames = useMemo(() => (output?.schema ?? []).map((f) => f.name), [output?.schema]);
  const isCandidate =
    crossFilter !== null &&
    crossFilter.panelId !== panel.id &&
    isOutputPanel(panel) &&
    output !== null &&
    dimension !== null &&
    isPanelFilterableByDimension(output.kind, output.config, schemaNames, dimension);

  const capabilities = useOutputFilterCapabilities(output?.id ?? null, isCandidate);

  const columnType =
    dimension === null ? undefined : output?.schema.find((f) => f.name === dimension)?.type;
  const serverEligible =
    isCandidate &&
    dimension !== null &&
    columnType !== undefined &&
    columnType !== "timestamp" &&
    capabilities.status === "ready" &&
    capabilities.columns?.get(dimension)?.has("eq") === true &&
    // design.md D2a — the backend rejects two ops with the same (column, op), so a control `eq`
    // on the dimension can never share a request with the cross `eq`: fall back deterministically
    // (no request that could 400, no cache invalidation); the control stays a server filter.
    !controlOps.some((o) => o.column === dimension && o.op === "eq");

  const value = crossFilter?.value ?? null;
  return useMemo(() => {
    if (!isCandidate || dimension === null || value === null) return NO_CROSS_FILTER;
    if (serverEligible) {
      return { crossFilterEq: { column: dimension, value }, mode: "server" };
    }
    return { crossFilterEq: null, mode: "client-fallback" };
  }, [isCandidate, serverEligible, dimension, value]);
}
