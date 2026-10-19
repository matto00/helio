// HEL-1630: wire shapes for `POST /api/pipelines/:id/draft-preview`, the NDJSON endpoint that evaluates the server-only
// steps of an unsaved draft over frames the client supplies (mirrors `backend/.../protocols/pipelines/DraftPreviewProtocol.scala`;
// contracts `schemas/pipelines/draft-preview-request.schema.json` and `draft-preview-line.schema.json`). The draft editor that
// calls it is HEL-1631. Cells are the lossless encoding of `evaluator/wire.ts` (`{"$int"}`, `{"$long"}`, `{"$double"}`).

/** An encoded cell: a JSON scalar, or one of the three lossless wrappers. */
export type WireCell =
  | null
  | boolean
  | string
  | number
  | { $int: number }
  | { $long: string }
  | { $double: string };
export type WireRow = Record<string, WireCell>;

export interface DraftPreviewRoot {
  id: string;
  rows: WireRow[];
  listFrame?: boolean;
}

export interface DraftPreviewFrame {
  rows: WireRow[];
  listFrame?: boolean;
}

/** `complete: false` marks a partial cache; the server never completes it by reading the source. */
export interface DraftPreviewSource {
  rows: WireRow[];
  complete: boolean;
}

export interface DraftPreviewStep {
  id: string;
  kind: string;
  enabled: boolean;
  /** Absent or null for a parentless step, which then names its input frame by `rootId`. */
  parentStepId?: string | null;
  rootId?: string;
  position: number;
  config: Record<string, unknown>;
}

export interface DraftPreviewRequest {
  roots: DraftPreviewRoot[];
  steps: DraftPreviewStep[];
  lanes?: Record<string, DraftPreviewFrame>;
  sources?: Record<string, DraftPreviewSource>;
  rowsStepId?: string | null;
}

export type DraftPreviewColumnType =
  | "int"
  | "long"
  | "double"
  | "string"
  | "boolean"
  | "null"
  | "mixed";

export interface DraftPreviewColumn {
  name: string;
  type: DraftPreviewColumnType;
}

export type DraftPreviewUnavailableReason =
  | "aiStep"
  | "downstreamOfAiStep"
  | "sourceNotSupplied"
  | "laneNotSupplied"
  | "downstreamOfUnavailable"
  | "downstreamOfError";

export type DraftPreviewLine =
  | { type: "step"; step: string; count: number; schema: DraftPreviewColumn[] }
  | { type: "unavailable"; step: string; reason: DraftPreviewUnavailableReason }
  | { type: "error"; step: string; message: string }
  | {
      type: "rows";
      step: string | null;
      available: boolean;
      rows: WireRow[];
      count: number;
      truncated: boolean;
    }
  | { type: "failed"; message: "Draft preview failed" };
