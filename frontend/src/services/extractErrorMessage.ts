import { isAxiosError } from "axios";

/**
 * Extracts a human-readable error message from a failed request/thunk (F-059).
 *
 * Checks the backend's parsed JSON error body first — different routes use
 * either `{ error }` or `{ message }` as the field name, so both are checked —
 * then falls back to the caller-supplied `fallback`.
 *
 * Deliberately never surfaces the raw Axios/JS `err.message` (e.g. "Network
 * Error", "Request failed with status code 500"): those are transport-layer
 * strings, not something a user should see. Several existing per-slice copies
 * of this helper fall through to `err.message` before the fallback; this is
 * the policy new call sites should follow, and existing copies should
 * eventually converge on. Not yet adopted by any call site in this batch.
 */
export function extractErrorMessage(err: unknown, fallback: string): string {
  if (isAxiosError(err)) {
    const data = err.response?.data as Record<string, unknown> | undefined;
    if (typeof data?.error === "string" && data.error) return data.error;
    if (typeof data?.message === "string" && data.message) return data.message;
  }
  return fallback;
}
