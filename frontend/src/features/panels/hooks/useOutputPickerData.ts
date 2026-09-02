import { useEffect, useMemo, useState } from "react";

import { listAllOutputs } from "../../pipelines/services/outputService";
import { fetchPipelines } from "../../pipelines/state/pipelinesSlice";
import type { Output } from "../../pipelines/types/output";
import { useAppDispatch, useAppSelector } from "../../../hooks/reduxHooks";
import type { Panel } from "../types/panel";

export interface OutputPickerEntry {
  output: Output;
  /** Number of panels (across all dashboards) currently bound to this Output. */
  placementCount: number;
  /** True when this Output already backs a panel on the CURRENT dashboard. */
  onThisBoard: boolean;
}

export interface OutputPickerGroup {
  pipelineId: string;
  pipelineName: string;
  entries: OutputPickerEntry[];
}

export interface UseOutputPickerDataResult {
  groups: OutputPickerGroup[];
  isLoading: boolean;
  error: string | null;
  /** Always `false` since HEL-909 CR2 (kept on the result shape for
   *  backward compatibility with existing consumers): placement counts now
   *  arrive as a field on the `GET /api/outputs` list response itself, so
   *  there is no longer a per-Output fetch that can fail independently of
   *  the list fetch as a whole. */
  hasPlacementCountError: boolean;
}

/** Fetches every Output the caller can place (`GET /api/outputs`), groups
 *  them by pipeline, and cross-references the CURRENT dashboard's own
 *  panels so each entry can be marked "already on this board" (HEL-909
 *  `OutputPicker`).
 *
 *  Placement counts: HEL-909 CR2 (evaluation-2 finding 2) — the list
 *  response now carries `panelCount` per Output directly
 *  (`OutputResponse.panelCount`, batched server-side via
 *  `PanelRepository.countByOutputIdsInternal`), so this reads it straight
 *  off each item instead of doing a `GET /api/outputs/:id/panels` fetch per
 *  Output. The prior N+1 loop self-rate-limited (429s) once the Output
 *  count reached realistic dev-DB sizes (~85). */
export function useOutputPickerData(currentDashboardPanels: Panel[]): UseOutputPickerDataResult {
  const [outputs, setOutputs] = useState<Output[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const dispatch = useAppDispatch();
  const pipelines = useAppSelector((state) => state.pipelines.items);

  // The dashboard route never loads `state.pipelines` on its own — without
  // this, `pipelineNameById` below is always empty and every group heading
  // falls back to the literal "Pipeline" placeholder (HEL-909 evaluator
  // cycle-1 finding 4). `fetchPipelines`'s own dedup `condition` makes this
  // a no-op once the list is already loaded/loading, so it's safe to
  // dispatch unconditionally on every picker mount.
  useEffect(() => {
    void dispatch(fetchPipelines());
  }, [dispatch]);

  useEffect(() => {
    let cancelled = false;
    void listAllOutputs()
      .then((items) => {
        if (!cancelled) setOutputs(items);
      })
      .catch(() => {
        if (!cancelled) setError("Failed to load outputs.");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const onThisBoardOutputIds = useMemo(() => {
    const ids = new Set<string>();
    for (const panel of currentDashboardPanels) {
      if (panel.type === "output") ids.add(panel.config.outputId);
    }
    return ids;
  }, [currentDashboardPanels]);

  const groups = useMemo<OutputPickerGroup[]>(() => {
    if (outputs === null) return [];
    const pipelineNameById = new Map(pipelines.map((p) => [p.id, p.name]));
    const byPipeline = new Map<string, OutputPickerEntry[]>();
    for (const output of outputs) {
      const entry: OutputPickerEntry = {
        output,
        placementCount: output.panelCount ?? 0,
        onThisBoard: onThisBoardOutputIds.has(output.id),
      };
      const existing = byPipeline.get(output.pipelineId);
      if (existing) existing.push(entry);
      else byPipeline.set(output.pipelineId, [entry]);
    }
    return Array.from(byPipeline.entries()).map(([pipelineId, entries]) => ({
      pipelineId,
      pipelineName: pipelineNameById.get(pipelineId) ?? "Pipeline",
      entries,
    }));
  }, [outputs, pipelines, onThisBoardOutputIds]);

  return {
    groups,
    isLoading: outputs === null && error === null,
    error,
    hasPlacementCountError: false,
  };
}
