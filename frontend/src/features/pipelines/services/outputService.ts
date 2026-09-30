import { httpClient } from "../../../services/httpClient";
import type {
  AssertionStatus,
  CreateOutputPayload,
  DeleteOutputResult,
  ExpressionValidationResult,
  NodeCapabilities,
  Output,
  OutputFilterCapabilitiesResponse,
  OutputPanelPlacement,
  PipelinePreviewResult,
  RunResult,
  UpdateOutputPayload,
} from "../types/output";

/** spray-json omits an absent `Option[String]` field rather than sending
 *  `null` — normalize `nodeStepId` at the service boundary so the rest of
 *  the app can treat "absent" and "explicitly missing" identically without
 *  re-deriving this each call site — this is a recurring pattern in this
 *  codebase (see `pipelinesSlice.ts`'s `PipelineSummaryWire` normalization
 *  for another instance). */
function normalizeOutput(output: Output): Output {
  return { ...output, nodeStepId: output.nodeStepId ?? undefined };
}

export async function listOutputs(pipelineId: string, nodeStepId?: string): Promise<Output[]> {
  const response = await httpClient.get<{ items: Output[] }>(
    `/api/pipelines/${pipelineId}/outputs`,
    {
      params: nodeStepId === undefined ? undefined : { nodeStepId },
    },
  );
  return response.data.items.map(normalizeOutput);
}

export async function createOutput(
  pipelineId: string,
  payload: CreateOutputPayload,
): Promise<Output> {
  const response = await httpClient.post<Output>(`/api/pipelines/${pipelineId}/outputs`, payload);
  return normalizeOutput(response.data);
}

export async function getOutputById(outputId: string): Promise<Output> {
  const response = await httpClient.get<Output>(`/api/outputs/${outputId}`);
  return normalizeOutput(response.data);
}

export async function updateOutput(
  outputId: string,
  payload: UpdateOutputPayload,
): Promise<Output> {
  const response = await httpClient.patch<Output>(`/api/outputs/${outputId}`, payload);
  return normalizeOutput(response.data);
}

export async function deleteOutput(outputId: string): Promise<DeleteOutputResult> {
  const response = await httpClient.delete<DeleteOutputResult>(`/api/outputs/${outputId}`);
  return response.data;
}

/** `GET /api/outputs` — every Output the caller owns, across all pipelines
 *  (HEL-909 `OutputPicker`). The backend caps `limit` at `Page.MaxLimit`
 *  server-side, so a caller with more Outputs than one page would silently
 *  see a truncated list — loop until `total` is exhausted rather than
 *  assuming one page suffices. Realistic Output counts are in the tens, so
 *  this is at most a couple of round trips in practice. */
export async function listAllOutputs(): Promise<Output[]> {
  const limit = 200;
  let offset = 0;
  const all: Output[] = [];
  for (;;) {
    const response = await httpClient.get<{
      items: Output[];
      total: number;
      offset: number;
      limit: number;
    }>("/api/outputs", { params: { offset, limit } });
    all.push(...response.data.items.map(normalizeOutput));
    offset += response.data.items.length;
    if (response.data.items.length === 0 || offset >= response.data.total) break;
  }
  return all;
}

export async function listOutputPanels(outputId: string): Promise<OutputPanelPlacement[]> {
  const response = await httpClient.get<OutputPanelPlacement[]>(`/api/outputs/${outputId}/panels`);
  return response.data;
}

export async function getAssertionStatus(outputId: string): Promise<AssertionStatus> {
  const response = await httpClient.get<AssertionStatus>(
    `/api/outputs/${outputId}/assertion-status`,
  );
  return response.data;
}

/** HEL-1189 design.md D6 — `GET /api/outputs/:id/filter-capabilities` (HEL-1188): for every
 *  Structured column in the Output's declared schema, the operators the capability contract
 *  currently allows (already folding in the eq/in cardinality gate). Fetched once per
 *  `OutputControlsEditor` open — same cost model the endpoint's own backend doc states ("called
 *  once per panel load/config-open, not the hot path") — and combined with the Output's own
 *  `schema` (already fetched via `useOutputMeta`) to compute offered kinds/columns client-side via
 *  `outputControlEligibility.ts`'s `kindsFor`. */
export async function getFilterCapabilities(
  outputId: string,
): Promise<OutputFilterCapabilitiesResponse> {
  const response = await httpClient.get<OutputFilterCapabilitiesResponse>(
    `/api/outputs/${outputId}/filter-capabilities`,
  );
  return response.data;
}

export interface FetchOutputRowsResult {
  items: Record<string, unknown>[];
  total: number;
  offset: number;
  limit: number;
  /** HEL-946 Bug C(2): `false` means this node has never had a successful
   *  pipeline run since the Output was added (`node_snapshots` was never
   *  written) — distinct from a genuine empty result set (`materialized:
   *  true`, `items` still empty). Consumers should show a "run the
   *  pipeline" affordance only when this is `false`. */
  materialized: boolean;
}

/** HEL-1027 design.md D1 — `GET /api/outputs/:id/rows`'s `sort` query param shape. */
export interface OutputRowsSort {
  column: string;
  direction: "asc" | "desc";
}

/** HEL-1190 design.md D3 — one `filter.ops[]` entry, mirroring the backend's
 *  `OutputRowsQuery.OpsTerm` wire shape exactly (`{column, op, value?, values?}`). Composed from
 *  viewer-control selections (`buildViewerControlFilterOps`) ANDed with any in-panel `columns`/
 *  `quick` term already active on `OutputRowsFilter`. */
export interface OutputRowsFilterOp {
  column: string;
  op: "eq" | "gte" | "lte" | "in";
  value?: string;
  values?: string[];
}

/** HEL-1027 design.md D1 — mirrors the client's OWN `TableColumnFilters` wire shape
 *  (`outputConfigTypes.ts`), extended by HEL-1190 design.md D3 with `ops[]` for viewer-control
 *  selections — the in-memory filter state serializes straight into the `filter` query param with
 *  no translation layer. */
export interface OutputRowsFilter {
  quick?: string;
  columns?: Record<string, string>;
  ops?: OutputRowsFilterOp[];
}

/** HEL-1027 design.md D1 — an absent/blank `quick` term, no non-blank `columns` entries, AND no
 *  `ops[]` entries (HEL-1190) is, semantically, "no filter" — omitted from the request entirely
 *  rather than sent as `filter={}`, matching the server's own "absent filter" behavior. Exported
 *  (HEL-1190) so `usePublicPanelData`/the public rows service can reuse the SAME "is this filter
 *  worth sending" rule rather than a second, independently-maintained copy. */
export function isFilterActive(filter: OutputRowsFilter | undefined): filter is OutputRowsFilter {
  if (!filter) return false;
  if (filter.quick && filter.quick.trim() !== "") return true;
  if ((filter.ops ?? []).length > 0) return true;
  return Object.values(filter.columns ?? {}).some((term) => term.trim() !== "");
}

/** HEL-1190 design.md D3 — composes a viewer's control selection (`ops[]`, already resolved by
 *  `buildViewerControlFilterOps`) with the panel's own in-panel `quick`/`columns` filter (if any)
 *  into ONE `OutputRowsFilter` request payload — ANDed, never merged/deduped against each other,
 *  as SEPARATE `ops[]` entries alongside whichever `columns`/`quick` term is already active.
 *  `undefined` when neither contributes anything (matches every other "absent filter" convention
 *  in this file). */
export function composeOutputRowsFilter(
  base: { quick?: string; columns?: Record<string, string> } | null | undefined,
  controlOps: OutputRowsFilterOp[] | undefined,
): OutputRowsFilter | undefined {
  const candidate: OutputRowsFilter = {
    quick: base?.quick,
    columns: base?.columns,
    ops: controlOps && controlOps.length > 0 ? controlOps : undefined,
  };
  return isFilterActive(candidate) ? candidate : undefined;
}

/** HEL-1190 design.md D1 (task 4.1) — `GET /api/outputs/:id/distinct-values?column=` (HEL-1188),
 *  the authenticated dropdown-control-options source. Mirrors `getFilterCapabilities`'s own
 *  fetched-once-per-open cost model. */
export interface OutputDistinctValue {
  value: string;
  count: number;
}

export async function getDistinctValues(
  outputId: string,
  column: string,
): Promise<{ column: string; values: OutputDistinctValue[] }> {
  const response = await httpClient.get<{ column: string; values: OutputDistinctValue[] }>(
    `/api/outputs/${outputId}/distinct-values`,
    { params: { column } },
  );
  return response.data;
}

export async function getOutputRows(
  outputId: string,
  offset = 0,
  limit = 50,
  sort?: OutputRowsSort,
  filter?: OutputRowsFilter,
): Promise<FetchOutputRowsResult> {
  const params: Record<string, string | number> = { offset, limit };
  if (sort) params.sort = `${sort.column}:${sort.direction}`;
  if (isFilterActive(filter)) params.filter = JSON.stringify(filter);
  const response = await httpClient.get<FetchOutputRowsResult>(`/api/outputs/${outputId}/rows`, {
    params,
  });
  return response.data;
}

export async function getNodeCapabilities(
  pipelineId: string,
  stepId?: string,
): Promise<NodeCapabilities> {
  const response = await httpClient.get<NodeCapabilities>(
    `/api/pipelines/${pipelineId}/capabilities`,
    {
      params: stepId === undefined ? undefined : { stepId },
    },
  );
  return { ...response.data, stepId: response.data.stepId ?? undefined };
}

/** Previews EVERY Output on the pipeline when `outputId` is omitted, or just
 *  the one Output when it's passed — same response envelope both arms
 *  (design.md decision 6a; see `PipelineRunStatusRoutes.scala`). */
export async function previewOutputs(
  pipelineId: string,
  outputId?: string,
): Promise<PipelinePreviewResult> {
  const response = await httpClient.post<PipelinePreviewResult>(
    `/api/pipelines/${pipelineId}/preview`,
    {},
    { params: outputId === undefined ? undefined : { outputId } },
  );
  return response.data;
}

/** Preview for an Output that hasn't been saved yet — no `outputId` exists,
 *  so this previews the STEP the Output would be attached to instead
 *  (design.md decision 5). */
export async function previewStep(pipelineId: string, stepId: string): Promise<RunResult> {
  const response = await httpClient.get<RunResult>(
    `/api/pipelines/${pipelineId}/steps/${stepId}/preview`,
  );
  return response.data;
}

export async function validateExpression(
  pipelineId: string,
  expression: string,
  stepId?: string,
): Promise<ExpressionValidationResult> {
  const response = await httpClient.post<ExpressionValidationResult>(
    `/api/pipelines/${pipelineId}/validate-expression`,
    { expression },
    { params: stepId === undefined ? undefined : { stepId } },
  );
  return { ...response.data, error: response.data.error ?? undefined };
}
