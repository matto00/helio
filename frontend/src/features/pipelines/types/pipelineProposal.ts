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
  /** HEL-914: request-scoped id a parentless step's `rootClientId` binds to
   *  when the proposal has more than one root. Not persisted. */
  clientId?: string;
}

/** One proposed step. Deliberately loose (design.md D4) — the review UI only
 *  ever *displays* a step's kind + a best-effort summary of its config, never
 *  edits or validates it client-side (Accept posts the untouched proposal
 *  payload straight through). Mirrors the backend's own
 *  `CreatePipelineTransactionalStepRequest` looseness (`config` is an opaque
 *  `JsObject` server-side too). A step kind the frontend's `PipelineStepKind`
 *  union doesn't yet recognize must still render, not crash — a loose type is
 *  the only one that guarantees that. `clientId`/`parentStepId` (HEL-907 task
 *  1.1) let a proposal describe branching tree shape before anything has a
 *  real persisted id — display-only here, never edited client-side, same as
 *  every other field. */
export interface PipelineProposalStep {
  clientId: string;
  type: string;
  config: Record<string, unknown>;
  parentStepId?: string;
  enabled?: boolean;
  /** HEL-914 (R13): names WHICH root a parentless step attaches to --
   *  required (and validated) only when the proposal has more than one root. */
  rootClientId?: string;
}

/** One proposed Output (HEL-907 task 1.1) — a proposal may create zero, one,
 *  or many Outputs; `nodeStepClientId` absent means the Output attaches
 *  directly to the pipeline's source, present means it attaches to that
 *  step (matched by `PipelineProposalStep.clientId`). Mirrors the backend's
 *  `CreatePipelineTransactionalOutputRequest` verbatim. */
export interface PipelineProposalOutput {
  nodeStepClientId?: string;
  kind: string;
  name: string;
  config?: Record<string, unknown>;
}

/** A pipeline proposal — the shared Proposal → Review → Apply artifact for
 *  `propose_pipeline`. Carries no ids: nothing is created until applied.
 *  `outputs` is OPTIONAL (HEL-907 task 1.1 design.md decision 2) — a
 *  proposal may create a pipeline with zero Outputs, to be added later.
 *  `outputDataTypeName` is REMOVED outright (no alias, HEL-904): the
 *  DataType/Metric output contract it named no longer exists. */
export interface PipelineProposal {
  pipelineName: string;
  /** HEL-914: replaces the old singular `source` outright -- no alias.
   *  Non-empty. */
  roots: PipelineProposalSource[];
  steps: PipelineProposalStep[];
  outputs?: PipelineProposalOutput[];
}

/** One applied Output, reported back so a caller can address a specific
 *  created Output by id/name (HEL-907 task 1.1/1.3) — replaces the old
 *  single `outputDataTypeId: String` (at most one implicit output) now that
 *  a proposal can create zero, one, or many. Mirrors the backend's
 *  `ProposalOutputSummary` verbatim. */
export interface ProposalOutputSummary {
  id: string;
  name: string;
  kind: string;
  nodeStepId?: string;
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
 *  required here too (skeptic-final-1.md non-blocking note). `outputs`
 *  (HEL-907 task 1.1/1.3) replaces the old single `outputDataTypeId`. */
export interface PipelineProposalApplyResponse {
  /** HEL-914: one element per newly-created inline root, in root order. */
  sources: Record<string, unknown>[];
  pipeline: PipelineSummary;
  outputs: ProposalOutputSummary[];
  run: Record<string, unknown>;
}
