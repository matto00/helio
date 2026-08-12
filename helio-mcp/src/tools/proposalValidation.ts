/**
 * `propose_dashboard`'s read-only binding-warning computation (`proposal.ts`,
 * HEL-223/HEL-549), split into its own small module for the same reason
 * `metricSchemas.ts` documents for `write.ts` (HEL-541): a unit test can
 * import just this narrow, zod-free surface without pulling `proposal.ts`'s
 * `server.registerTool(...)` calls — combined with `panelSchema`'s full Zod
 * object type — into the compile graph. That combination is TS2589
 * ("Type instantiation is excessively deep and possibly infinite") under
 * this repo's root `tsconfig.json`/ts-jest configuration (probe: importing
 * `proposal.ts` directly from `proposal.test.ts` fails the jest run with
 * TS2589 at both `server.registerTool(...)` call sites) — see
 * `write.test.ts`'s docstring for the sibling case this mirrors.
 */

import type { DataTypeResponse, MetricResponse, ProposalPanel } from "../types.js";

/** Panel types whose binding is a `dataTypeId` (flat field, checked here).
 *  Mirrors the backend's `DashboardProposalService.DataPanelKinds`. */
export const DATA_PANEL_TYPES = new Set(["metric", "chart", "table", "collection", "timeline"]);

/** HEL-549: the exact panel-type set the backend's `metricId` slot supports
 *  (MetricPanelConfig/ChartPanelConfig/TablePanelConfig only) — mirrors
 *  `DashboardProposalService.MetricIdSupportedKinds`. */
export const METRIC_ID_SUPPORTED_TYPES = new Set(["metric", "chart", "table"]);

/** Read-only validation against an already-fetched workspace snapshot:
 *  flags a data panel whose `dataTypeId` binding is missing or not a
 *  pipeline output, and (HEL-549) independently flags a panel whose
 *  `metricId` is missing/not-owned/deprecated/set on an unsupported panel
 *  type. Both checks can fire for the same panel — `metricId` is additive to
 *  `dataTypeId`, never a substitute for it. Pure — no I/O; the caller
 *  (`propose_dashboard`) owns the `api.listDataTypes()`/`api.listMetrics()`
 *  fetch and the `Map` construction. */
export function computeProposalWarnings(
  panels: ProposalPanel[],
  dataTypesById: Map<string, DataTypeResponse>,
  metricsById: Map<string, MetricResponse>,
): string[] {
  const warnings: string[] = [];

  panels.forEach((panel, i) => {
    const where = `panel ${i + 1} ('${panel.title}')`;

    if (DATA_PANEL_TYPES.has(panel.type)) {
      if (!panel.dataTypeId) {
        warnings.push(`${where}: a ${panel.type} panel needs a dataTypeId`);
      } else {
        const dt = dataTypesById.get(panel.dataTypeId);
        if (!dt) {
          warnings.push(`${where}: dataTypeId ${panel.dataTypeId} not found in this workspace`);
        } else if ((dt.sourceId ?? null) !== null) {
          warnings.push(
            `${where}: dataType '${dt.name}' is a source companion, not a pipeline output — it cannot be bound`,
          );
        }
      }
    }

    // HEL-549: metricId is additive to dataTypeId (checked above), never a
    // substitute for it — validated independently so both warnings can
    // surface for the same panel.
    if (panel.metricId) {
      if (!METRIC_ID_SUPPORTED_TYPES.has(panel.type)) {
        warnings.push(`${where}: metricId is not supported on a ${panel.type} panel`);
      } else {
        const metric = metricsById.get(panel.metricId);
        if (!metric) {
          warnings.push(`${where}: metricId ${panel.metricId} not found among your metrics`);
        } else if (metric.deprecated) {
          warnings.push(`${where}: metric '${metric.name}' is deprecated`);
        }
      }
    }
  });

  return warnings;
}
