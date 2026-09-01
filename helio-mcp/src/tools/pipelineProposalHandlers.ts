/**
 * `propose_pipeline`/`analyze_pipeline_proposal`/`apply_pipeline_proposal`'s
 * actual call-routing logic (HEL-385 design.md D4b — round-1 skeptic
 * finding). This file imports NEITHER `zod` NOR
 * `@modelcontextprotocol/sdk`'s `McpServer` — each export below is a plain
 * async function taking `api: HelioApi` (a zod-free interface, confirmed by
 * reading `helioApi.ts`: no zod import anywhere in that file) plus plain
 * TS-typed arguments, so a test can import this module directly and exercise
 * the real `api.*` call-routing + `HelioApiError` propagation without
 * pulling `pipelineProposal.ts`'s `server.registerTool(...)` calls —
 * combined with a large zod object type — into the compile graph. That
 * combination is TS2589 ("Type instantiation is excessively deep and
 * possibly infinite") under this repo's root `tsconfig.json`/ts-jest
 * configuration (see `metricSchemas.ts`'s docstring for the precedent this
 * mirrors, and `write.test.ts`'s for the sibling TS2589 case).
 *
 * `pipelineProposal.ts` itself is a thin shell: zod `inputSchema`
 * declarations + `guarded(() => xHandler(api, ...))` one-liners, with no
 * business logic of its own — everything below is that logic.
 */

import type { HelioApi } from "../helioApi.js";
import type {
  PipelineAnalyzeProposalResponse,
  PipelineProposal,
  PipelineProposalApplyResponse,
  PipelineProposalOutput,
  PipelineProposalSource,
  PipelineProposalStep,
} from "../types.js";
import { computePipelineProposalWarnings } from "./pipelineProposalValidation.js";

/** `propose_pipeline`'s handler: assembles the typed `PipelineProposal` from
 *  plain input, resolves the caller's data source ids ONCE (read-only), and
 *  computes warnings via `computePipelineProposalWarnings` — writes nothing. */
export async function proposePipelineHandler(
  api: HelioApi,
  input: {
    pipelineName: string;
    source: PipelineProposalSource;
    steps: PipelineProposalStep[];
    outputs?: PipelineProposalOutput[];
  },
): Promise<{ proposal: PipelineProposal; warnings: string[]; applyReady: boolean }> {
  const proposal: PipelineProposal = {
    pipelineName: input.pipelineName,
    source: input.source,
    steps: input.steps,
    outputs: input.outputs ?? [],
  };

  const sourcesPage = await api.listDataSources();
  const sourceIds = new Set(sourcesPage.items.map((s) => s.id));
  const warnings = computePipelineProposalWarnings(input.source, sourceIds);

  return { proposal, warnings, applyReady: warnings.length === 0 };
}

/** `analyze_pipeline_proposal`'s handler: dry-analyze via
 *  `POST /api/pipelines/analyze-proposal` — no writes, thin pass-through. */
export function analyzePipelineProposalHandler(
  api: HelioApi,
  proposal: PipelineProposal,
): Promise<PipelineAnalyzeProposalResponse> {
  return api.analyzePipelineProposal(proposal);
}

/** `apply_pipeline_proposal`'s handler: applies atomically via
 *  `POST /api/pipelines/apply-proposal` — no pre-validation, no retry
 *  (design.md D6). Every guardrail is enforced server-side; a rejection
 *  propagates as a rejected promise (a `HelioApiError`), formatted verbatim
 *  by the tool shell's `guarded` handler. */
export function applyPipelineProposalHandler(
  api: HelioApi,
  proposal: PipelineProposal,
): Promise<PipelineProposalApplyResponse> {
  return api.applyPipelineProposal(proposal);
}
