// Pipeline shape catalog + expand wire types (HEL-391 catalog, HEL-402 expand).
// Mirrors the backend's `com.helio.domain.shapes` / `PipelineShapeProtocol`
// shapes directly — see `backend/src/main/scala/com/helio/api/protocols/PipelineShapeProtocol.scala`.

import type { PipelineStepConfig, PipelineStepKind } from "./pipelineStep";

/** Descriptive metadata for one `expand` param — NOT a validating JSON Schema.
 *  Real validation of caller-supplied params happens server-side inside the
 *  shape's own `expand` (design.md Decision 5).
 *
 *  `enum`/`fieldRef` (HEL-908 design.md Decision 13, forward-compatible
 *  only): the shipped `ShapeParamDescriptor` (`domain/shapes/
 *  ShapeParamDescriptor.scala`) has exactly five fields — neither exists on
 *  the wire today, so both are optional here and every registered shape's
 *  catalog entry omits them (spray-json omits `None`, never sends `null`).
 *  `ShapeParamsFields` honors them when present so a future backend
 *  descriptor extension (tracked as a follow-up ticket, named in the PR)
 *  lights up a real widget with no client change; today this is exercised
 *  only by fixtures. */
export interface ShapeParamDescriptor {
  name: string;
  label: string;
  dataType: string;
  required: boolean;
  description: string;
  /** A fixed set of allowed values — renders as a `<select>` instead of a
   *  free-text field when present. */
  enum?: string[];
  /** Marks this param as referencing a column/field name on the node being
   *  expanded against, rather than an arbitrary string — renders with a
   *  distinct hint; a real column-picker sourced from capabilities-at-node
   *  is out of scope until the backend descriptor actually declares this
   *  (see the class doc comment above). */
  fieldRef?: boolean;
}

export type RowCountContract =
  | { kind: "exactly-one" }
  | { kind: "at-most-param"; paramName: string }
  | { kind: "unbounded" };

/** There is no statically-declared field list (`OutputFieldContract`/`fields`
 *  was removed as YAGNI in HEL-623 — zero producers, zero consumers). */
export interface OutputContract {
  rowCount: RowCountContract;
  description: string;
}

/** One `GET /api/pipeline-shapes` catalog entry. */
export interface PipelineShapeCatalogEntry {
  id: string;
  label: string;
  description: string;
  paramsSchema: ShapeParamDescriptor[];
  outputContract: OutputContract;
}

/** One entry in a `POST /api/pipeline-shapes/:id/expand` response's `steps`
 *  array (HEL-908 design.md Decision 11 — the response is `{steps,
 *  outputs?}`, not a bare array; verified against
 *  `PipelineShapeProtocol.ShapeStepExpansionResponse`). `clientId` is a
 *  synthetic intra-response id (e.g. `"step-0"`); `parentStepId`, when
 *  present, references another entry's `clientId` — NOT a real persisted
 *  step id — chaining entries to each other within this one expand
 *  response. `kind`/`config` are cast to the typed
 *  `PipelineStepKind`/`PipelineStepConfig` at the call site (the backend's
 *  `expand` is the single source of truth for producing a valid pairing; the
 *  frontend does not re-validate the shape). */
export interface ShapeStepExpansion {
  clientId: string;
  kind: PipelineStepKind;
  config: PipelineStepConfig;
  parentStepId?: string;
}

/** One entry in a `POST /api/pipeline-shapes/:id/expand` response's
 *  (dormant — see design.md Decision 14) `outputs` array. `nodeStepId`
 *  references a `ShapeStepExpansion.clientId`, resolved through the same
 *  clientId->real-id map used for the steps themselves. */
export interface ShapeOutputExpansion {
  nodeStepId: string;
  kind: string;
  config?: Record<string, unknown>;
  name?: string;
}

/** `POST /api/pipeline-shapes/:id/expand`'s full response shape (design.md
 *  Decision 11/14). `outputs` is optional/absent on the wire for every
 *  registered shape today (spray-json omits `None`). */
export interface ExpandPipelineShapeResponse {
  steps: ShapeStepExpansion[];
  outputs?: ShapeOutputExpansion[];
}
