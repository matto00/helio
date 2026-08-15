/** Patch-set types (HEL-403 schema/protocol foundation) + the HEL-408
 *  preview response and the HEL-406 apply response — mirrors
 *  schemas/patch-set.schema.json / patch-set-preview-response.schema.json /
 *  patch-set-apply-response.schema.json field-for-field. */

/** Identifies the resource an `Edit` applies to. `id` is required for
 *  update/delete, absent for create (the resource does not yet exist). */
export interface EditTarget {
  kind: "panel" | "dashboard" | "dataSource" | "dataType" | "pipeline" | "pipelineStep";
  id?: string;
}

/** One targeted edit. `patch`'s real shape reuses the existing per-resource
 *  PATCH/create request shape matching `target.kind` (the same type the
 *  matching PATCH/create endpoint already decodes) — never a new shape
 *  invented for the patch-set wire format. Absent for `op: "delete"`. */
export interface Edit {
  target: EditTarget;
  op: "update" | "delete" | "create";
  patch?: Record<string, unknown>;
}

/** An ordered list of targeted edits — the shared Preview → Accept → Apply
 *  artifact (HEL-403/HEL-406/HEL-408). */
export interface PatchSet {
  summary?: string;
  edits: Edit[];
}

// ── Preview (HEL-408) ────────────────────────────────────────────────────────

/** One edit's before/after diff + impact hints. `before`/`after` reuse each
 *  target kind's EXISTING response shape (PanelResponse/DashboardResponse/
 *  etc.) — rendered as raw JSON, not a bespoke per-kind diff widget
 *  (design.md D7). `before` is absent for a `create` edit; `after` is
 *  absent for a `delete` edit. A `create` edit's `after.id` carries the
 *  literal sentinel string `"(pending)"`, never a real minted id. */
export interface EditPreview {
  index: number;
  kind: string;
  op: string;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  impact: string[];
}

/** Response of `POST /api/patch-sets/preview`. Read-only — computing this
 *  response never writes anything. */
export interface PatchSetPreviewResponse {
  edits: EditPreview[];
}

// ── Apply (HEL-406, reused verbatim — no changes made in this ticket) ──────

/** One edit's outcome from `POST /api/patch-sets/apply`. */
export interface EditOutcome {
  index: number;
  status: "applied" | "rolledBack" | "recreated" | "unrecoverable";
  newId?: string | null;
  priorState?: Record<string, unknown> | null;
  resultingState?: Record<string, unknown> | null;
}

/** Response of `POST /api/patch-sets/apply`. `failure` is present only when
 *  a mid-set edit failed and triggered a rollback. `applicationId` (HEL-413)
 *  is present exactly when `failure` is absent AND the application was
 *  successfully journaled — `POST /api/patch-sets/:id/undo` accepts it
 *  later to restore this apply's pre-apply state. Absent for a
 *  partially-rolled-back apply and for any caller that predates this
 *  field. */
export interface PatchSetApplyResponse {
  edits: EditOutcome[];
  failure?: string | null;
  applicationId?: string | null;
}

// ── Undo (HEL-413) ───────────────────────────────────────────────────────────

/** One edit's undo outcome from `POST /api/patch-sets/:id/undo`. `status` is
 *  one of `restored` (an `update` edit's captured pre-apply state was
 *  reapplied, or a `create` edit's created resource was deleted),
 *  `recreated` (a `delete` edit's resource was recreated under a NEW id —
 *  panel/pipelineStep only), `failed` (a genuine, unforeseeable restore
 *  failure for THIS edit), or `notAttempted` (never reached because an
 *  earlier edit in the same reverse walk failed). */
export interface EditUndoOutcome {
  index: number;
  status: "restored" | "recreated" | "failed" | "notAttempted";
  newId?: string | null;
  resultingState?: Record<string, unknown> | null;
}

/** Response of `POST /api/patch-sets/:id/undo`. */
export interface PatchSetUndoResponse {
  edits: EditUndoOutcome[];
}
