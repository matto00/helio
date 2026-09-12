import { isAxiosError } from "axios";

import type { SchemaFieldRejection } from "../types/dataSource";

/**
 * HEL-1079 design.md Decision 3/tasks.md 2.5: distinguishes a `409` `SchemaUpdateConflictResponse`
 * body (per-field `rejectedFields`) from a structural `400` (no `rejectedFields` -- e.g. a
 * rename/drop name collision) so the schema-edit editor can render each shape correctly: the
 * former attaches a reason next to its field and keeps the in-progress edit; the latter shows a
 * single non-field-specific inline banner. Any other shape (network error, 500, etc.) falls back
 * to `"unknown"` with a generic message -- never silently swallowed.
 */
export type ParsedSchemaUpdateError =
  | { kind: "conflict"; rejectedFields: SchemaFieldRejection[]; message: string }
  | { kind: "structural"; message: string }
  | { kind: "unknown"; message: string };

function isRejectedFieldsArray(value: unknown): value is SchemaFieldRejection[] {
  return (
    Array.isArray(value) &&
    value.every(
      (v) =>
        typeof v === "object" &&
        v !== null &&
        typeof (v as Record<string, unknown>).name === "string" &&
        typeof (v as Record<string, unknown>).reason === "string",
    )
  );
}

export function parseSchemaUpdateError(err: unknown): ParsedSchemaUpdateError {
  if (isAxiosError(err) && err.response) {
    const { status, data } = err.response;
    const body = data as Record<string, unknown> | undefined;
    if (status === 409 && body && isRejectedFieldsArray(body.rejectedFields)) {
      return {
        kind: "conflict",
        rejectedFields: body.rejectedFields,
        message: typeof body.message === "string" ? body.message : "Schema edit rejected.",
      };
    }
    if (status === 400) {
      const message =
        typeof body?.message === "string"
          ? body.message
          : typeof body?.error === "string"
            ? body.error
            : "Schema edit failed.";
      return { kind: "structural", message };
    }
  }
  return { kind: "unknown", message: "Failed to update schema." };
}
