import { isAxiosError } from "axios";

import { extractErrorMessage } from "./extractErrorMessage";

/** UI-facing classification of a failed request (HEL-539). `"forbidden"`/
 *  `"not-found"` map to a 403/404 response respectively; every other case
 *  (including no response at all, e.g. a network error) is `"error"`. */
export type RequestErrorKind = "error" | "forbidden" | "not-found";

export interface ClassifiedRequestError {
  message: string;
  kind: RequestErrorKind;
}

/**
 * Derives `{ message, kind }` from a failed request/thunk, for thunks/call
 * sites that need to distinguish a permission-denied/not-found failure from
 * a generic one (design.md D1).
 *
 * `message` is delegated entirely to `extractErrorMessage` — this function
 * never reimplements message extraction and never falls through to a raw
 * `err.message`. The per-slice local `extractErrorMessage` helpers
 * (`sourcesSlice.ts`, `pipelinesSlice.ts`) are separate, untouched
 * implementations that continue to serve their own existing call sites.
 *
 * Call this inside the thunk's own `catch` (or each rejection site within
 * it), while the original Axios error — and its response status — is still
 * in scope; a call site that only receives the thunk's already-rejected
 * string payload can't classify anything, because the status is gone by
 * then.
 */
export function classifyRequestError(err: unknown, fallback: string): ClassifiedRequestError {
  const message = extractErrorMessage(err, fallback);
  if (isAxiosError(err)) {
    if (err.response?.status === 403) return { message, kind: "forbidden" };
    if (err.response?.status === 404) return { message, kind: "not-found" };
  }
  return { message, kind: "error" };
}
