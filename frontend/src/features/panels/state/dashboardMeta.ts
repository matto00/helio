// Pure derivation of the dashboard meta row's facts (HEL-1576 design D2): panel count, the most
// recent refresh among the pipelines feeding the dashboard, and the sources behind them. No React,
// no I/O: `useDashboardMeta` owns fetching and hands the held values in.

import type { Output } from "../../pipelines/types/output";
import type { PipelineSummary } from "../../pipelines/types/pipelineStep";
import type { Panel } from "../types/panel";

/** At most this many source names are shown; the rest collapse into "+N". */
export const MAX_SHOWN_SOURCES = 2;

export type RefreshState =
  /** No feeding pipeline is known (no output panels, or no access to the pipelines): show nothing. */
  | "unknown"
  /** Feeding pipelines are known and none has run: "not refreshed yet". */
  | "never"
  /** At least one feeding pipeline has run: `refreshedAt` and `refreshIntent` are set. */
  | "ran";

export interface DashboardMeta {
  panelCount: number;
  refreshState: RefreshState;
  /** ISO timestamp of the most recent `lastRunAt` among known feeding pipelines, else `null`. */
  refreshedAt: string | null;
  /** `success` / `danger` from that most recent run's status; `null` when there is no run. */
  refreshIntent: "success" | "danger" | null;
  /** Distinct source names in first-seen panel order, capped at `MAX_SHOWN_SOURCES`. */
  sources: string[];
  /** How many further distinct sources the cap hid ("+N"). */
  moreSources: number;
}

/** Distinct, non-empty `outputId`s of the dashboard's output panels, in panel order. Form panels bind
 *  a dataset directly and an empty `outputId` is the unbound default: neither contributes. */
export function feedingOutputIds(panels: readonly Panel[]): string[] {
  const ids = new Set<string>();
  for (const panel of panels) {
    if (panel.type === "output" && panel.config.outputId !== "") ids.add(panel.config.outputId);
  }
  return [...ids];
}

/** Distinct `pipelineId`s of the Outputs known so far, in first-seen panel order. */
export function feedingPipelineIds(
  panels: readonly Panel[],
  outputs: Readonly<Record<string, Output | undefined>>,
): string[] {
  const ids = new Set<string>();
  for (const outputId of feedingOutputIds(panels)) {
    const pipelineId = outputs[outputId]?.pipelineId;
    if (pipelineId) ids.add(pipelineId);
  }
  return [...ids];
}

export function deriveDashboardMeta(
  panels: readonly Panel[],
  outputs: Readonly<Record<string, Output | undefined>>,
  summaries: Readonly<Record<string, PipelineSummary | undefined>>,
): DashboardMeta {
  const known: PipelineSummary[] = [];
  for (const pipelineId of feedingPipelineIds(panels, outputs)) {
    const summary = summaries[pipelineId];
    if (summary) known.push(summary);
  }

  const names: string[] = [];
  for (const summary of known) {
    for (const root of summary.roots) {
      if (root.dataSourceName && !names.includes(root.dataSourceName)) {
        names.push(root.dataSourceName);
      }
    }
  }

  let latest: PipelineSummary | null = null;
  let latestMs = -Infinity;
  for (const summary of known) {
    const ms = summary.lastRunAt === null ? NaN : Date.parse(summary.lastRunAt);
    if (!Number.isNaN(ms) && ms > latestMs) {
      latest = summary;
      latestMs = ms;
    }
  }

  const refreshState: RefreshState = latest ? "ran" : known.length > 0 ? "never" : "unknown";
  let refreshIntent: DashboardMeta["refreshIntent"] = null;
  if (latest?.lastRunStatus === "succeeded") refreshIntent = "success";
  else if (latest?.lastRunStatus === "failed") refreshIntent = "danger";

  return {
    panelCount: panels.length,
    refreshState,
    refreshedAt: latest?.lastRunAt ?? null,
    refreshIntent,
    sources: names.slice(0, MAX_SHOWN_SOURCES),
    moreSources: Math.max(0, names.length - MAX_SHOWN_SOURCES),
  };
}
