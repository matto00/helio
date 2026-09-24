import { isAxiosError } from "axios";

/**
 * HEL-1169 design.md D1 — classifies a failed immediate-submit request (the compact counter's
 * `+`/`-` path) as `"definite"` (`true`) or `"indeterminate"` (`false`), keyed on whether an HTTP
 * response was received at all — never on the numeric status value. A **definite** rejection is
 * any Axios error carrying `err.response`, including a 4xx/5xx relayed by an intermediate proxy
 * (axios still populates `err.response` with whatever status/body the proxy returned, so there is
 * no reliable client-side signal to distinguish "the origin rejected it" from "a proxy rejected
 * it"). An **indeterminate** failure is everything else — a genuine network error, a timeout, a
 * CORS block, or an aborted request — where no HTTP exchange completed at all. Mirrors the
 * codebase's existing idiom for this exact check (`panelService.ts`'s `parseFieldErrors`,
 * `classifyRequestError.ts`, `httpClient.ts`'s 401 interceptor).
 */
export function isDefiniteRejection(err: unknown): boolean {
  return isAxiosError(err) && err.response !== undefined;
}
