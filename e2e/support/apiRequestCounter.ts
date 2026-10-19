import type { Page } from "@playwright/test";

// HEL-1620: counts every `/api` request one test user makes, the same traffic the backend's per-user
// rate limiter (RATE_LIMIT_REQUESTS_PER_WINDOW, default 120 per 60 s, keyed by session user id) charges.
// Two sources are needed, because Playwright's `page.on("request")` does NOT fire for `page.request.*`
// calls (probed 2026-10-18): the page's own traffic via the page events, and the seeding calls by
// wrapping the `page.request` methods. Attach BEFORE registerAndLogin so the post-login page's requests
// are captured too. Requests are counted when they START (an in-flight or aborted one is still charged).

/** The limiter's configured budget and the guard's margin target (a quarter of the limit is headroom). */
export const RATE_LIMIT = 120;
export const MAX_WINDOW_TARGET = 90;
const WINDOW_MS = 60_000;

interface Entry {
  at: number;
  method: string;
  template: string;
  status: number | null;
}

export interface ApiCounterReport {
  total: number;
  maxWindow: number;
  count429: number;
  top: [string, number][];
}

/** Collapses ids so equal routes group: UUIDs, numbers and long hex ids become `:id`, query strings drop. */
export function pathTemplate(pathname: string): string {
  return pathname
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, ":id")
    .replace(/\/\d+(?=\/|$)/g, "/:id");
}

/** The most requests inside any sliding 60 s window over sorted timestamps. */
export function maxSlidingWindow(times: number[], windowMs = WINDOW_MS): number {
  let best = 0;
  let lo = 0;
  for (let hi = 0; hi < times.length; hi++) {
    while (times[hi] - times[lo] >= windowMs) lo++;
    best = Math.max(best, hi - lo + 1);
  }
  return best;
}

export class ApiRequestCounter {
  private readonly entries: Entry[] = [];

  record(method: string, url: string, status: number | null = null): Entry | null {
    const { pathname } = new URL(url, "http://localhost");
    if (!pathname.startsWith("/api/")) return null;
    const entry = { at: Date.now(), method, template: pathTemplate(pathname), status };
    this.entries.push(entry);
    return entry;
  }

  report(topN = 8): ApiCounterReport {
    const byKey = new Map<string, number>();
    for (const e of this.entries) {
      const key = `${e.method} ${e.template}`;
      byKey.set(key, (byKey.get(key) ?? 0) + 1);
    }
    return {
      total: this.entries.length,
      maxWindow: maxSlidingWindow(this.entries.map((e) => e.at).sort((a, b) => a - b)),
      count429: this.entries.filter((e) => e.status === 429).length,
      top: [...byKey.entries()].sort((a, b) => b[1] - a[1]).slice(0, topN),
    };
  }

  /** One line for logs and assertion messages, with the breakdown. */
  describe(): string {
    const r = this.report();
    return `${r.total} /api requests, max 60s window ${r.maxWindow} (limit ${RATE_LIMIT}, target <= ${MAX_WINDOW_TARGET}), ${r.count429} x 429; top: ${r.top
      .map(([k, n]) => `${n} ${k}`)
      .join("; ")}`;
  }
}

/** Starts counting for `page`: its own traffic, plus every `page.request.*` call. */
export function attachApiRequestCounter(page: Page): ApiRequestCounter {
  const counter = new ApiRequestCounter();
  const byRequest = new WeakMap<object, Entry | null>();
  page.on("request", (r) => byRequest.set(r, counter.record(r.method(), r.url())));
  page.on("response", (r) => {
    const entry = byRequest.get(r.request());
    if (entry) entry.status = r.status();
  });
  // get/post/put/patch/delete/head all delegate to `fetch` (which carries the method in its options), so
  // wrapping `fetch` alone counts each call exactly once.
  const api = page.request;
  const original = api.fetch.bind(api);
  api.fetch = (async (target: Parameters<typeof original>[0], options?: { method?: string }) => {
    const url = typeof target === "string" ? target : target.url();
    const method = options?.method ?? (typeof target === "string" ? "GET" : target.method());
    const entry = counter.record(method.toUpperCase(), url);
    const res = await original(target, options);
    if (entry) entry.status = res.status();
    return res;
  }) as typeof api.fetch;
  return counter;
}
