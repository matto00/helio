import { API_BASE_URL, CSRF_HEADER } from "./config.mjs";

/** A tiny REST helper over one in-memory credential (a session cookie or a PAT). Nothing is written to disk. */
export function makeRest(auth) {
  return async function rest(method, path, body) {
    const headers = { "Content-Type": "application/json", [CSRF_HEADER]: "1", ...auth };
    const res = await fetch(API_BASE_URL + path, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}: ${text.slice(0, 300)}`);
    return text ? JSON.parse(text) : null;
  };
}

export const list = (x) => (Array.isArray(x) ? x : (x.items ?? x.data ?? []));

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
