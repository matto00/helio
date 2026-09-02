/** Wire shapes for `GET/POST /api/pipelines/:id/outputs`, `GET/PATCH/DELETE
 *  /api/outputs/:id`, and the node-capabilities/preview endpoints an Output
 *  depends on (HEL-906, P1.3/P1.4 of the Pipelines & Outputs remodel; mirrors
 *  `backend/.../protocols/pipelines/OutputProtocol.scala` and
 *  `NodeCapabilitiesProtocol.scala`). `config`/`schema` mirror the backend's
 *  raw-`JsValue` config field — kept as `unknown` here, narrowed per-kind by
 *  the Output editor.
 *
 *  spray-json omits `Option[T] = None` fields from the wire rather than
 *  sending `null` — `nodeStepId` on `OutputResponse` is `Option[String]` and
 *  therefore ABSENT (not `null`) for an Output on the pipeline root. Treat it
 *  as possibly missing, never `=== null`. */

export type OutputKind = "chart" | "table" | "metric" | "collection" | "timeline" | "markdown";

export interface OutputSchemaField {
  name: string;
  type: string;
}

export interface Output {
  id: string;
  pipelineId: string;
  nodeStepId?: string;
  ownerId: string;
  name: string;
  kind: string;
  config: Record<string, unknown>;
  schema: OutputSchemaField[];
  createdAt: string;
  updatedAt: string;
}

export interface CreateOutputPayload {
  nodeStepId?: string;
  kind: string;
  name: string;
  config?: Record<string, unknown>;
}

export interface UpdateOutputPayload {
  name?: string;
  config?: Record<string, unknown>;
}

export interface OutputPanelPlacement {
  panelId: string;
  dashboardId: string;
}

export interface DeleteOutputResult {
  removedPanelIds: string[];
}

export interface AssertionStatus {
  outputId: string;
  invalid: boolean;
  failedRuleCount: number;
}

export interface TruncatedRead {
  dataSourceName: string;
  rowsRead: number;
  availableRowCount?: number;
}

/** Mirrors `RunResultResponse` — the shape a preview or run-history entry
 *  returns for one node. */
export interface RunResult {
  rows: Record<string, unknown>[];
  rowCount: number;
  stepRowCounts: Record<string, number>;
  sourceRowCount: number;
  runId?: string;
  blocked: boolean;
  blockedReason?: string;
  sourceTruncated: boolean;
  sourceAvailableRowCount?: number;
  truncationNotice?: string;
  truncatedReads: TruncatedRead[];
}

export interface OutputPreviewEntry {
  outputId: string;
  preview: RunResult;
}

/** `POST /api/pipelines/:id/preview` response envelope — returned both when
 *  `outputId` narrows to one Output and when it's omitted (every Output on
 *  the pipeline). Callers branch on which arm they asked for, not on the
 *  response shape (design.md decision 6a). */
export interface PipelinePreviewResult {
  outputs: OutputPreviewEntry[];
}

export interface CapabilityColumn {
  name: string;
  dataType: string;
  nullable: boolean;
}

export interface Capability {
  bindable: boolean;
  requiredSlots: string[];
  optionalSlots: string[];
  eligibleColumns: Record<string, string[]>;
  reason?: string;
  message?: string;
}

/** `GET /api/pipelines/:id/capabilities?stepId=` response — `stepId` absent
 *  means the pipeline root (no step chosen yet). */
export interface NodeCapabilities {
  stepId?: string;
  columns: CapabilityColumn[];
  capabilities: Record<string, Capability>;
}

export interface ExpressionValidationResult {
  valid: boolean;
  error?: string;
}
