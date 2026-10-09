// HEL-1392 design.md D2 — pure predicates deciding whether a card that is mounting can use the rows
// window `state.panels.paginationState` already holds instead of requesting it again.

import { isFilterActive } from "../../pipelines/services/outputService";
import type { PanelLastQuery, PanelPaginationState } from "../types/panel";
import { currentGeneration, isRetained } from "./outputFreshness";
import { getOutputMetaCached } from "./outputMetaCache";
import { hasRunBaseline } from "../services/pipelineRunFanout";

/** The query a rows request is made under; `outputId` is part of it. */
export type RowsQuery = PanelLastQuery;

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const v = (value as Record<string, unknown>)[key];
      if (v !== undefined) out[key] = stable(v);
    }
    return out;
  }
  return value;
}

/** Canonical form of a query: absent and `undefined` keys are equal, key order is irrelevant, and a
 *  filter that would not be sent (`isFilterActive` false) equals no filter. */
export function normalizeQuery(query: RowsQuery | undefined): string {
  if (!query) return "";
  return JSON.stringify(
    stable({
      outputId: query.outputId,
      sort: query.sort ?? null,
      filter: isFilterActive(query.filter) ? query.filter : null,
      crossFilterEq: query.crossFilterEq ?? null,
    }),
  );
}

/** True when the entry's latest page-0 request is still in flight for exactly `query`. */
export function isPendingFor(entry: PanelPaginationState | undefined, query: RowsQuery): boolean {
  return (
    entry !== undefined &&
    entry.isLoadingMore === true &&
    normalizeQuery(entry.lastQuery) === normalizeQuery(query)
  );
}

/** True when the entry is a settled, successfully fetched window for exactly `query` that nothing
 *  the client observed has invalidated, for an Output that is still on screen or left it recently
 *  (`REMOUNT_GRACE_MS`), bound to a pipeline whose latest completed run the client knows. */
export function isReusable(entry: PanelPaginationState | undefined, query: RowsQuery): boolean {
  if (!entry || entry.isLoadingMore || entry.lastFetchOk !== true) return false;
  if (normalizeQuery(entry.lastQuery) !== normalizeQuery(query)) return false;
  const { outputId } = query;
  if (!isRetained(outputId) || entry.generation !== currentGeneration(outputId)) return false;
  const pipelineId = getOutputMetaCached(outputId)?.pipelineId;
  return pipelineId !== undefined && hasRunBaseline(pipelineId);
}
