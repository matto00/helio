import { httpClient } from "../../../services/httpClient";
import type {
  AssertionStatus,
  CreateOutputPayload,
  DeleteOutputResult,
  ExpressionValidationResult,
  NodeCapabilities,
  Output,
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

export interface FetchOutputRowsResult {
  items: Record<string, unknown>[];
  total: number;
  offset: number;
  limit: number;
}

export async function getOutputRows(
  outputId: string,
  offset = 0,
  limit = 50,
): Promise<FetchOutputRowsResult> {
  const response = await httpClient.get<FetchOutputRowsResult>(`/api/outputs/${outputId}/rows`, {
    params: { offset, limit },
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
