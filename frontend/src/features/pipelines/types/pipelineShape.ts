// Pipeline shape catalog + expand wire types (HEL-391 catalog, HEL-402 expand).
// Mirrors the backend's `com.helio.domain.shapes` / `PipelineShapeProtocol`
// shapes directly — see `backend/src/main/scala/com/helio/api/protocols/PipelineShapeProtocol.scala`.

import type { PipelineStepConfig, PipelineStepKind } from "./pipelineStep";

/** Descriptive metadata for one `expand` param — NOT a validating JSON Schema.
 *  Real validation of caller-supplied params happens server-side inside the
 *  shape's own `expand` (design.md Decision 5). */
export interface ShapeParamDescriptor {
  name: string;
  label: string;
  dataType: string;
  required: boolean;
  description: string;
}

export type RowCountContract =
  | { kind: "exactly-one" }
  | { kind: "at-most-param"; paramName: string }
  | { kind: "unbounded" };

export interface OutputFieldContract {
  name: string;
  dataType: string;
  nullable: boolean;
}

/** `fields` is currently `Vector.empty` for every shape — do not build UI
 *  that depends on it being populated (orchestrator pre-brief). */
export interface OutputContract {
  rowCount: RowCountContract;
  fields: OutputFieldContract[];
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

/** One entry in a `POST /api/pipeline-shapes/:id/expand` response array — a
 *  standard step create-payload. `kind`/`config` are cast to the typed
 *  `PipelineStepKind`/`PipelineStepConfig` at the call site (the backend's
 *  `expand` is the single source of truth for producing a valid pairing; the
 *  frontend does not re-validate the shape). */
export interface ShapeStepExpansion {
  kind: PipelineStepKind;
  config: PipelineStepConfig;
}
