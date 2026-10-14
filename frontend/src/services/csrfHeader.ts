/**
 * The CSRF defense header the API requires on state-changing requests once the session cookie
 * can be sent cross-site (HEL-287). Dependency-free so the static landing page can share it
 * without pulling in axios via `httpClient.ts`.
 */
export const CSRF_HEADER = "X-Helio-Requested-With";
export const CSRF_HEADER_VALUE = "1";
