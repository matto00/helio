import { isAxiosError } from "axios";

import type { AskError } from "./types/ask";

/** Maps a failed ask to an `AskError` from the HTTP status and the body's `code` only, never from message text (so a
 *  reworded server message cannot change behaviour, and no server text is ever shown). Any 422 whose code is not
 *  `ASK_ANSWER_TRUNCATED` is the generic `ungrounded`; any 5xx is `unavailable`. */
export function parseAskError(err: unknown): AskError {
  if (!isAxiosError(err)) return { kind: "unknown" };
  const response = err.response;
  if (response === undefined) return { kind: "network" };
  const data: unknown = response.data;
  const body = typeof data === "object" && data !== null ? (data as Record<string, unknown>) : {};
  const status = response.status;
  if (status === 403) return { kind: "tierForbidden" };
  if (status === 429) {
    return typeof body.limit === "number"
      ? { kind: "limitReached", limit: body.limit }
      : { kind: "limitReached" };
  }
  if (status === 422)
    return body.code === "ASK_ANSWER_TRUNCATED" ? { kind: "truncated" } : { kind: "ungrounded" };
  if (status >= 500) return { kind: "unavailable" };
  if (status === 400) return { kind: "invalid" };
  return { kind: "unknown" };
}
