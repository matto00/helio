/** HEL-1746 -- the ask wire (HEL-1745 / HEL-1761), as the client holds it. The shapes declare NO model, token or cost field. */

export type AskScope = { kind: "dashboard"; id: string } | { kind: "output"; id: string };

export interface AskCitation {
  id: string;
  outputId: string;
  field: string;
  number?: number;
  date?: string;
  capturedAt?: string;
  isPct: boolean;
}

export interface AskCitedOutput {
  id: string;
  name: string;
}

/** The server-built, ready-to-POST create body for the insight Output (never holds answer text). */
export interface AskPin {
  pipelineId: string;
  request: Record<string, unknown>;
}

export interface AskResponse {
  answer: string;
  citations: AskCitation[];
  citedOutputs: AskCitedOutput[];
  /** `null` unless the server decided the caller may pin (an owner or editor of the one cited pipeline). */
  pin: AskPin | null;
}

/** Why an ask failed, from HTTP status and `code` only (never message text). `limit` is kept but never shown. */
export type AskError =
  | { kind: "tierForbidden" }
  | { kind: "limitReached"; limit?: number }
  | { kind: "truncated" }
  | { kind: "ungrounded" }
  | { kind: "unavailable" }
  | { kind: "invalid" }
  | { kind: "network" }
  | { kind: "unknown" };

export type AskState =
  | { status: "idle" }
  | { status: "pending"; question: string }
  | { status: "answered"; question: string; response: AskResponse }
  | { status: "error"; question: string; error: AskError };
