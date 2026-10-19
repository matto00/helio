import { API_BASE_URL } from "../../../config/env";
import { CSRF_HEADER, CSRF_HEADER_VALUE } from "../../../services/csrfHeader";
import type {
  DraftPreviewColumnType,
  DraftPreviewLine,
  DraftPreviewRequest,
  DraftPreviewUnavailableReason,
} from "../types/draftPreview";

// HEL-1630: the client half of `POST /api/pipelines/:id/draft-preview`. The response is NDJSON, one object per line: an
// `unavailable` line per step the server will not evaluate, a `step` or `error` line per evaluated step as it finishes, then
// one final `rows` line. Over HTTP/2 an abort is an RST_STREAM on a live connection; over HTTP/1.1 it closes the connection,
// so a superseded request costs a reconnect (docs/live-draft-preview.md section 6.3) -- correctness is unaffected.

/** The response was not a clean 200 NDJSON stream. `status` is the HTTP status, or 0 for a malformed body. */
export class DraftPreviewError extends Error {
  constructor(
    message: string,
    readonly status: number,
    /** Seconds from a `Retry-After` header, when the server sent one. */
    readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = "DraftPreviewError";
  }
}

const COLUMN_TYPES: ReadonlySet<string> = new Set<DraftPreviewColumnType>([
  "int",
  "long",
  "double",
  "string",
  "boolean",
  "null",
  "mixed",
]);
const REASONS: ReadonlySet<string> = new Set<DraftPreviewUnavailableReason>([
  "aiStep",
  "downstreamOfAiStep",
  "sourceNotSupplied",
  "laneNotSupplied",
  "downstreamOfUnavailable",
  "downstreamOfError",
]);

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const hasExactly = (o: Record<string, unknown>, keys: string[]): boolean =>
  Object.keys(o).length === keys.length && keys.every((k) => k in o);
const isCount = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0;

/** Narrows a parsed NDJSON line to a [[DraftPreviewLine]], exactly as strict as the committed line schema (a missing, extra or
 *  mistyped field is not a line). */
export function isDraftPreviewLine(v: unknown): v is DraftPreviewLine {
  if (!isObject(v)) return false;
  switch (v.type) {
    case "step":
      return (
        hasExactly(v, ["type", "step", "count", "schema"]) &&
        typeof v.step === "string" &&
        isCount(v.count) &&
        Array.isArray(v.schema) &&
        v.schema.every(
          (c) =>
            isObject(c) &&
            hasExactly(c, ["name", "type"]) &&
            typeof c.name === "string" &&
            typeof c.type === "string" &&
            COLUMN_TYPES.has(c.type),
        )
      );
    case "unavailable":
      return (
        hasExactly(v, ["type", "step", "reason"]) &&
        typeof v.step === "string" &&
        typeof v.reason === "string" &&
        REASONS.has(v.reason)
      );
    case "error":
      return (
        hasExactly(v, ["type", "step", "message"]) &&
        typeof v.step === "string" &&
        typeof v.message === "string"
      );
    case "rows":
      return (
        hasExactly(v, ["type", "step", "available", "rows", "count", "truncated"]) &&
        (v.step === null || typeof v.step === "string") &&
        typeof v.available === "boolean" &&
        Array.isArray(v.rows) &&
        v.rows.length <= 1000 &&
        v.rows.every(isObject) &&
        isCount(v.count) &&
        typeof v.truncated === "boolean"
      );
    case "failed":
      return hasExactly(v, ["type", "message"]) && v.message === "Draft preview failed";
    default:
      return false;
  }
}

/** Reads `response` line by line, handing each validated line to `onLine` as it arrives. Rejects with a
 *  [[DraftPreviewError]] on a non-200 response, an invalid line, or a body that ends mid-line; an abort rejects with the
 *  signal's `AbortError` unchanged. */
export async function readDraftPreviewStream(
  response: Response,
  onLine: (line: DraftPreviewLine) => void,
): Promise<void> {
  if (!response.ok) {
    const retry = Number(response.headers.get("Retry-After"));
    throw new DraftPreviewError(
      `Draft preview failed with status ${response.status}`,
      response.status,
      Number.isFinite(retry) && retry > 0 ? retry : undefined,
    );
  }
  const reader = response.body?.getReader();
  if (!reader) throw new DraftPreviewError("Draft preview response has no body", 0);
  const decoder = new TextDecoder();
  let buffer = "";

  const deliver = (text: string) => {
    if (text.trim() === "") return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new DraftPreviewError("Draft preview sent a line that is not JSON", 0);
    }
    if (!isDraftPreviewLine(parsed))
      throw new DraftPreviewError("Draft preview sent a line that is not a known line", 0);
    onLine(parsed);
  };

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) deliver(line);
    }
    buffer += decoder.decode();
    if (buffer.trim() !== "")
      throw new DraftPreviewError("Draft preview ended in the middle of a line", 0);
  } finally {
    reader.releaseLock();
  }
}

/** Posts `request` and resolves with the response, headers only; pair it with [[readDraftPreviewStream]]. Session cookie and
 *  CSRF header as every other state-changing call. */
export function postDraftPreview(
  pipelineId: string,
  request: DraftPreviewRequest,
  signal: AbortSignal,
): Promise<Response> {
  return fetch(`${API_BASE_URL}/api/pipelines/${encodeURIComponent(pipelineId)}/draft-preview`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", [CSRF_HEADER]: CSRF_HEADER_VALUE },
    body: JSON.stringify(request),
    signal,
  });
}
