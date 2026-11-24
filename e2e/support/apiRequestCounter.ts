import type { BrowserContext, Page } from "@playwright/test";

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
  /** False for a request the limiter never charges (no session cookie, or answered by `page.route`). */
  charged: boolean;
}

export interface ApiCounterReport {
  total: number;
  maxWindow: number;
  count429: number;
  top: [string, number][];
  /** Requests recorded but not charged to the principal (see `Entry.charged`); not part of `total`/`maxWindow`. */
  uncharged: number;
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

  record(method: string, url: string, status: number | null = null, charged = true): Entry | null {
    const { pathname } = new URL(url, "http://localhost");
    if (!pathname.startsWith("/api/")) return null;
    const entry = { at: Date.now(), method, template: pathTemplate(pathname), status, charged };
    this.entries.push(entry);
    return entry;
  }

  report(topN = 8): ApiCounterReport {
    const byKey = new Map<string, number>();
    const charged = this.entries.filter((e) => e.charged);
    for (const e of charged) {
      const key = `${e.method} ${e.template}`;
      byKey.set(key, (byKey.get(key) ?? 0) + 1);
    }
    return {
      total: charged.length,
      maxWindow: maxSlidingWindow(charged.map((e) => e.at).sort((a, b) => a - b)),
      count429: charged.filter((e) => e.status === 429).length,
      uncharged: this.entries.length - charged.length,
      top: [...byKey.entries()].sort((a, b) => b[1] - a[1]).slice(0, topN),
    };
  }

  /** When the first charged request started (ms epoch), or null: a fixed window opens there. */
  firstChargedAt(): number | null {
    return this.entries.find((e) => e.charged)?.at ?? null;
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

/** The routes whose requests carry no session cookie, so the per-principal limiter has no principal to charge. */
const UNCHARGED_PATHS = new Set(["/api/auth/register"]); // e2e-user-cleanup: reviewed — a path name the counter excludes, nothing is posted here

export interface ContextApiCounter {
  counter: ApiRequestCounter;
  /** Marks a request `page.route` answered itself (it never reached the server, so the limiter never saw it). */
  markFulfilled(request: object): void;
  /** One line: `charged-total=<n> max-60s=<n> uncharged=<n> count429=<n>`. */
  line(): string;
}

/**
 * HEL-1830: counts the `/api` requests one BROWSER CONTEXT (one principal) makes. Probed 2026-11-23
 * (`t1-probe-context-request-events.txt`): neither `context.request.*` nor `page.request.*` fires the context's
 * `request` event, so the page's own traffic comes from `context.on("request")` and the setup calls from wrapping
 * `fetch` on the context's `APIRequestContext` (get/post/put/patch/delete all delegate to it): each request is counted
 * exactly once. Attach BEFORE the first call on `context.request`. `POST /api/auth/register` carries no session cookie
 * and is recorded as uncharged.
 */
export function attachContextApiCounter(context: BrowserContext): ContextApiCounter {
  const counter = new ApiRequestCounter();
  const byRequest = new WeakMap<object, Entry | null>();
  context.on("request", (r) => byRequest.set(r, counter.record(r.method(), r.url())));
  context.on("response", (r) => {
    const entry = byRequest.get(r.request());
    if (entry) entry.status = r.status();
  });
  const api = context.request;
  const original = api.fetch.bind(api);
  api.fetch = (async (target: Parameters<typeof original>[0], options?: { method?: string }) => {
    const url = typeof target === "string" ? target : target.url();
    const method = options?.method ?? (typeof target === "string" ? "GET" : target.method());
    const { pathname } = new URL(url, "http://localhost");
    const entry = counter.record(method.toUpperCase(), url, null, !UNCHARGED_PATHS.has(pathname));
    const res = await original(target, options);
    if (entry) entry.status = res.status();
    return res;
  }) as typeof api.fetch;
  return {
    counter,
    markFulfilled(request) {
      const entry = byRequest.get(request);
      if (entry) entry.charged = false;
    },
    line() {
      const r = counter.report();
      return `charged-total=${r.total} max-60s=${r.maxWindow} uncharged=${r.uncharged} count429=${r.count429}`;
    },
  };
}
