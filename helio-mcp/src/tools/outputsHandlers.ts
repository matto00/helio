/**
 * Output tools' actual call-routing logic (HEL-907 task 3.5), mirroring
 * `pipelineProposalHandlers.ts`'s design.md D4b split: this file imports
 * NEITHER `zod` NOR `@modelcontextprotocol/sdk`'s `McpServer` — each export
 * below is a plain async function taking `api: HelioApi` plus plain
 * TS-typed arguments, so a test can import this module directly without
 * pulling `outputs.ts`'s `server.registerTool(...)` + zod surface into the
 * compile graph (the TS2589 "excessively deep" risk `write.test.ts`/
 * `pipelineProposalHandlers.test.ts` already guard against).
 *
 * `outputs.ts` itself is a thin shell: zod `inputSchema` declarations +
 * `guarded(() => xHandler(api, ...))` one-liners, with no business logic of
 * its own — everything below is that logic. Every function here is a thin
 * pass-through to one `HelioApi` method — no reshaping, no business logic.
 */

import type { HelioApi } from "../helioApi.js";
import type {
  AssertionStatusResponse,
  CreateOutputRequest,
  DeleteOutputResponse,
  NodeCapabilitiesResponse,
  OutputPanelPlacementResponse,
  OutputResponse,
  OutputsResponse,
  Paged,
  PipelinePreviewResponse,
  UpdateOutputRequest,
} from "../types.js";

export function addOutputHandler(
  api: HelioApi,
  input: {
    pipelineId: string;
    nodeStepId?: string;
    kind: string;
    name: string;
    config?: Record<string, unknown>;
    rootId?: string;
  },
): Promise<OutputResponse> {
  const req: CreateOutputRequest = {
    nodeStepId: input.nodeStepId,
    kind: input.kind,
    name: input.name,
    config: input.config,
    rootId: input.rootId,
  };
  return api.createOutput(input.pipelineId, req);
}

export function updateOutputHandler(
  api: HelioApi,
  input: { outputId: string; name?: string; config?: Record<string, unknown> },
): Promise<OutputResponse> {
  const req: UpdateOutputRequest = { name: input.name, config: input.config };
  return api.updateOutput(input.outputId, req);
}

export function deleteOutputHandler(
  api: HelioApi,
  outputId: string,
): Promise<DeleteOutputResponse> {
  return api.deleteOutput(outputId);
}

export function listOutputsHandler(
  api: HelioApi,
  input: { pipelineId?: string; nodeStepId?: string; limit?: number; offset?: number },
): Promise<OutputsResponse | Paged<OutputResponse>> {
  return input.pipelineId
    ? api.listOutputsByPipeline(input.pipelineId, input.nodeStepId)
    : api.listAllOutputs(input.limit, input.offset);
}

export function getOutputHandler(api: HelioApi, outputId: string): Promise<OutputResponse> {
  return api.getOutput(outputId);
}

export function getOutputRowsHandler(
  api: HelioApi,
  input: { outputId: string; limit?: number; offset?: number },
): Promise<Paged<Record<string, unknown>>> {
  return api.getOutputRows(input.outputId, input.limit, input.offset);
}

export function getOutputPanelsHandler(
  api: HelioApi,
  outputId: string,
): Promise<OutputPanelPlacementResponse[]> {
  return api.listOutputPanels(outputId);
}

export function getOutputAssertionStatusHandler(
  api: HelioApi,
  outputId: string,
): Promise<AssertionStatusResponse> {
  return api.getOutputAssertionStatus(outputId);
}

export function previewOutputsHandler(
  api: HelioApi,
  input: { pipelineId: string; outputId?: string },
): Promise<PipelinePreviewResponse> {
  return api.previewOutputs(input.pipelineId, input.outputId);
}

export function getOutputCapabilitiesHandler(
  api: HelioApi,
  input: { pipelineId: string; stepId?: string },
): Promise<NodeCapabilitiesResponse> {
  return api.getOutputCapabilities(input.pipelineId, input.stepId);
}
