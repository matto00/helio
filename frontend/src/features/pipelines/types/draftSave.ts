import type { Output } from "./output";
import type { PipelineStep, PipelineStepKind } from "./pipelineStep";

// HEL-1629: wire shapes for `POST /api/pipelines/:id/draft/save`, the atomic bulk save of a client-side pipeline
// draft (mirrors `backend/.../protocols/pipelines/DraftSaveProtocol.scala`; contract
// `schemas/pipelines/draft-save-request.schema.json`, `draft-save-response.schema.json` and
// `draft-cascade-required-response.schema.json`). No UI consumes these yet: the draft editor is HEL-1631.
//
// `steps` and `outputs` are the FINAL tree, diffed server-side against the stored definition. An item with an `id`
// already exists in THIS pipeline (any other id is a 400 -- explicit ids are accepted only when the server restores a
// journaled definition on undo); an item with a `clientId` is new. A stored step the draft omits is deleted.

/** A step of the final tree. Exactly one of `id`/`clientId`; exactly one of `parentStepId` (an existing step of the draft),
 *  `parentClientId` (a new one) or `rootId` (a parentless step names its root). */
export interface DraftStep {
  id?: string;
  clientId?: string;
  type: PipelineStepKind;
  config: Record<string, unknown>;
  enabled?: boolean;
  parentStepId?: string;
  parentClientId?: string;
  rootId?: string;
  position: number;
}

/** An Output of the final tree. Exactly one of `id`/`clientId`; exactly one of `nodeStepId`, `nodeStepClientId` or `rootId`. */
export interface DraftOutput {
  id?: string;
  clientId?: string;
  name: string;
  kind: string;
  nodeStepId?: string;
  nodeStepClientId?: string;
  rootId?: string;
  config?: Record<string, unknown>;
}

/** What the user has seen and accepts being removed with the save; a removal not listed here answers 422. */
export interface DraftCascadeConfirmation {
  stepIds?: string[];
  outputIds?: string[];
  panelIds?: string[];
  alertRuleIds?: string[];
}

export interface DraftSaveRequest {
  /** The `fingerprint` of the `GET /api/pipelines/:id` the draft was based on. A stale base is a 409 and there is NO
   *  overwrite path of any kind: the only way forward is to reload the saved pipeline. */
  baseFingerprint: string;
  steps: DraftStep[];
  outputs: DraftOutput[];
  /** Submit a run through the unchanged HEL-505 guard AFTER the save has committed. */
  runAfterSave?: "run" | "dryRun" | null;
  confirmCascade?: DraftCascadeConfirmation;
}

/** `started: true`: the run was admitted. `started: false`: it was refused AFTER the save committed (`code` 429 is the
 *  HEL-505 guard, with `retryAfterSeconds`); the save is never rolled back. */
export type DraftRunOutcome =
  | { started: true; runId?: string; status: "succeeded" | "blocked" }
  | { started: false; code: number; retryAfterSeconds?: number; reason: string };

export interface DraftSaveResponse {
  saved: {
    fingerprint: string;
    definition: { steps: PipelineStep[]; outputs: Output[] };
    /** The journal row `POST /api/patch-sets/:id/undo` restores. */
    applicationId: string;
  };
  /** Always present: `null` when no run was requested. */
  run: DraftRunOutcome | null;
}

/** 409 `PATCH_SET_STALE`: another writer changed fingerprinted state since the base. Nothing was written. */
export interface DraftSaveStale {
  kind: "stale";
  currentFingerprint: string | null;
  staleTargets: { index: number; kind: string; id: string }[];
}

/** 422 `CASCADE_CONFIRMATION_REQUIRED`: the draft removes more than `confirmCascade` covers. Nothing was written. */
export interface DraftSaveCascadeRequired {
  kind: "cascadeRequired";
  impact: {
    stepIds: string[];
    outputIds: string[];
    panelIds: string[];
    alertRuleIds: string[];
    hints: string[];
  };
}

export type DraftSaveConflict = DraftSaveStale | DraftSaveCascadeRequired;
