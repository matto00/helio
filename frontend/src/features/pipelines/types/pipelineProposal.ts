import type { PipelineSummary } from "./pipelineStep";

/** `PipelineProposal`/apply-response types (HEL-739 design.md D3-D5). Mirrors
 *  `PipelineProposalProtocol.scala`'s wire shapes for the two live, unmodified
 *  backend routes this ticket wires the web UI up to: `POST
 *  /api/pipelines/apply-proposal` (pipeline-only) and, via `combinedProposal.ts`,
 *  `POST /api/proposals/apply` (combined). Nothing is created until a proposal
 *  built from these types is applied. */

/** One flat object carrying either an existing-source reference (`sourceId`)
 *  or an inline new source's `type`/`name`/`config` — mirrors
 *  `pipelineProposalSourceFormat`'s single shared `"config"` key regardless of
 *  the inline kind (design.md D5). A read-only review surface has no need to
 *  discriminate `config` into 4 typed per-kind shapes; it renders `type` plus
 *  a flattened key/value list. */
export interface PipelineProposalSource {
  sourceId?: string;
  type?: string;
  name?: string;
  config?: Record<string, unknown>;
}

/** One proposed step. Deliberately loose (design.md D4) — the review UI only
 *  ever *displays* a step's kind + a best-effort summary of its config, never
 *  edits or validates it client-side (Accept posts the untouched proposal
 *  payload straight through). Mirrors the backend's own `CreatePipelineStepRequest`
 *  looseness (`config` is an opaque `JsObject` server-side too). A step kind
 *  the frontend's `PipelineStepKind` union doesn't yet recognize must still
 *  render, not crash — a loose type is the only one that guarantees that. */
export interface PipelineProposalStep {
  type: string;
  config: Record<string, unknown>;
  position?: number;
  enabled?: boolean;
}

/** A pipeline proposal — the shared Proposal → Review → Apply artifact for
 *  `propose_pipeline`. Carries no ids: nothing is created until applied. */
export interface PipelineProposal {
  pipelineName: string;
  source: PipelineProposalSource;
  outputDataTypeName: string;
  steps: PipelineProposalStep[];
}

/** Response of `POST /api/pipelines/apply-proposal`. `pipeline` reuses the
 *  existing `PipelineSummary` shape (byte-shape-identical to the backend's
 *  `PipelineSummaryResponse` this endpoint returns) — the review page only
 *  ever reads `pipeline.id` to navigate to the created pipeline's detail page
 *  (design.md D6); `source`/`run` are present on the wire but unused here, so
 *  they're left untyped rather than duplicating shapes this ticket never
 *  renders. `source` is genuinely optional (`Option[DataSourceResponse]` —
 *  absent for the existing-sourceId branch, present for the inline branch);
 *  `run` is NOT (`PipelineProposalProtocol.scala`'s `PipelineProposalApplyResponse.run:
 *  RunResultResponse`, no `Option`) — always present on the wire, so it's typed
 *  required here too (skeptic-final-1.md non-blocking note). */
export interface PipelineProposalApplyResponse {
  source?: Record<string, unknown>;
  pipeline: PipelineSummary;
  outputDataTypeId: string;
  run: Record<string, unknown>;
}
