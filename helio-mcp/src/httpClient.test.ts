/**
 * HEL-495 follow-up — client-side handling of the backend's 429 responses.
 *
 * The rate-limiting directive (`RateLimitDirective.scala`) answers 429 with a
 * `Retry-After` delta-seconds header once a PAT exceeds
 * `RATE_LIMIT_REQUESTS_PER_WINDOW` in a window. Long agent-driven runs
 * (helio-news builds hundreds of resources per run) burst well past that, so
 * the client must wait out the window rather than aborting the whole run on
 * the first refusal.
 *
 * `fetch` and the sleep are both injected so these tests assert the retry
 * schedule without real timers or a real socket.
 */

import { DEFAULT_REQUEST_TIMEOUT_MSEC } from "@modelcontextprotocol/sdk/shared/protocol.js";
import {
  HelioApiError,
  HelioAuthError,
  HelioHttpClient,
  HelioRateLimitError,
  RATE_LIMIT_WAIT_BUDGET_MS,
  type HelioRequestInit,
} from "./httpClient.js";
import type { HelioConfig } from "./config.js";

const config: HelioConfig = { baseUrl: "https://helio.test", pat: "pat-abc" } as HelioConfig;

/** A `Response`-shaped stub — only the fields `dispatch` actually reads. */
function reply(status: number, body: unknown, headers: Record<string, string> = {}) {
  return {
    status,
    statusText: String(status),
    ok: status >= 200 && status < 300,
    headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
    json: async () => body,
  } as unknown as Response;
}

/** Queues responses; records every sleep the client asks for. */
function harness(responses: Response[]) {
  const slept: number[] = [];
  const calls: { url: string; init: HelioRequestInit }[] = [];
  const fetchImpl = (url: string, init: HelioRequestInit) => {
    calls.push({ url, init });
    const next = responses.shift();
    if (!next) throw new Error("fetch called more times than the test queued");
    return Promise.resolve(next);
  };
  const sleep = (ms: number) => {
    slept.push(ms);
    return Promise.resolve();
  };
  const warnings: string[] = [];
  const warn = (message: string) => {
    warnings.push(message);
  };
  const client = new HelioHttpClient(config, { fetchImpl, sleep, warn });
  return { client, slept, calls, warnings };
}

describe("HelioHttpClient 429 handling", () => {
  it("retries after the Retry-After delay and returns the eventual success", async () => {
    const { client, slept, calls } = harness([
      reply(429, { message: "Rate limit exceeded" }, { "retry-after": "7" }),
      reply(200, { id: "dash-1" }),
    ]);

    await expect(client.get<{ id: string }>("/api/dashboards")).resolves.toEqual({ id: "dash-1" });
    expect(slept).toEqual([7000]);
    expect(calls).toHaveLength(2);
  });

  it("backs off exponentially when the 429 carries no Retry-After", async () => {
    const { client, slept } = harness([
      reply(429, { message: "Rate limit exceeded" }),
      reply(429, { message: "Rate limit exceeded" }),
      reply(200, { ok: true }),
    ]);

    await client.get("/api/dashboards");
    expect(slept).toEqual([1000, 2000]);
  });

  it("surfaces an absurd Retry-After immediately instead of sleeping into the same refusal", async () => {
    // HEL-1349: was "caps a single wait" (clamped to 60s, then re-sent); the cumulative
    // budget makes a wait longer than the remaining budget fail fast, never sleep.
    const { client, slept, calls } = harness([
      reply(429, { message: "Rate limit exceeded" }, { "retry-after": "86400" }),
      reply(200, { ok: true }),
    ]);

    await expect(client.get("/api/dashboards")).rejects.toMatchObject({
      name: "HelioRateLimitError",
      retryAfterSeconds: 86400,
    });
    expect(slept).toEqual([]);
    expect(calls).toHaveLength(1);
  });

  it("surfaces a near-timeout Retry-After (59s) at once with its retry-after, no wait, no re-send (HEL-1349)", async () => {
    const { client, slept, calls } = harness([
      reply(429, { message: "Rate limit exceeded" }, { "retry-after": "59" }),
      reply(200, { ok: true }),
    ]);

    const error = await client.get("/api/dashboards").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(HelioRateLimitError);
    expect(error).toBeInstanceOf(HelioApiError);
    expect((error as HelioRateLimitError).status).toBe(429);
    expect((error as HelioRateLimitError).retryAfterSeconds).toBe(59);
    expect((error as HelioRateLimitError).message).toMatch(/rate limit/i);
    expect((error as HelioRateLimitError).message).toContain("retry after 59s");
    expect(slept).toEqual([]);
    expect(calls).toHaveLength(1);
  });

  it("never spends more than the wait budget across repeated 429s (HEL-1349)", async () => {
    const { client, slept } = harness(
      Array.from({ length: 6 }, () =>
        reply(429, { message: "Rate limit exceeded" }, { "retry-after": "15" }),
      ),
    );

    await expect(client.get("/api/dashboards")).rejects.toBeInstanceOf(HelioRateLimitError);
    expect(slept.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(RATE_LIMIT_WAIT_BUDGET_MS);
    expect(slept).toEqual([15_000, 15_000]);
  });

  it("with no Retry-After sleeps exactly 1+2+4+8s, then fails with an undefined retry-after (HEL-1349)", async () => {
    const { client, slept } = harness(
      Array.from({ length: 6 }, () => reply(429, { message: "Rate limit exceeded" })),
    );

    const error = await client.get("/api/dashboards").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(HelioRateLimitError);
    expect((error as HelioRateLimitError).retryAfterSeconds).toBeUndefined();
    expect((error as HelioRateLimitError).message).toMatch(/no retry-after/i);
    expect(slept).toEqual([1000, 2000, 4000, 8000]);
  });

  it("keeps the wait budget at most half of the installed MCP SDK default request timeout (HEL-1349)", () => {
    expect(RATE_LIMIT_WAIT_BUDGET_MS).toBeLessThanOrEqual(DEFAULT_REQUEST_TIMEOUT_MSEC / 2);
  });

  it("ignores an unparseable Retry-After and falls back to the backoff schedule", async () => {
    const { client, slept } = harness([
      reply(
        429,
        { message: "Rate limit exceeded" },
        { "retry-after": "Wed, 21 Oct 2026 07:28:00 GMT" },
      ),
      reply(200, { ok: true }),
    ]);

    await client.get("/api/dashboards");
    expect(slept).toEqual([1000]);
  });

  it("gives up after the attempt budget and throws the 429 as a HelioRateLimitError", async () => {
    const { client, calls } = harness([
      reply(429, { message: "Rate limit exceeded" }, { "retry-after": "1" }),
      reply(429, { message: "Rate limit exceeded" }, { "retry-after": "1" }),
      reply(429, { message: "Rate limit exceeded" }, { "retry-after": "1" }),
      reply(429, { message: "Rate limit exceeded" }, { "retry-after": "1" }),
      reply(429, { message: "Rate limit exceeded" }, { "retry-after": "1" }),
      reply(429, { message: "Rate limit exceeded" }, { "retry-after": "1" }),
    ]);

    await expect(client.get("/api/dashboards")).rejects.toMatchObject({
      name: "HelioRateLimitError",
      status: 429,
      retryAfterSeconds: 1,
    });
    // 1 initial attempt + 5 retries, then surface the error.
    expect(calls).toHaveLength(6);
  });

  it("does NOT retry a 429 whose body code is CHAT_LIMIT_REACHED (HEL-1205) and surfaces it with the code", async () => {
    const { client, slept, calls } = harness([
      reply(429, {
        code: "CHAT_LIMIT_REACHED",
        message: "Daily limit of 50 messages reached",
        limit: 50,
      }),
    ]);

    await expect(client.post("/api/refinements", { message: "x" })).rejects.toMatchObject({
      name: "HelioApiError",
      status: 429,
      message: expect.stringContaining("[CHAT_LIMIT_REACHED]"),
    });
    expect(calls).toHaveLength(1);
    expect(slept).toEqual([]);
  });

  it("surfaces a 403 TIER_FORBIDDEN with its code", async () => {
    const { client } = harness([
      reply(403, { code: "TIER_FORBIDDEN", message: "Not available on your plan" }),
    ]);

    await expect(client.post("/api/refinements", {})).rejects.toMatchObject({
      status: 403,
      message: expect.stringContaining("[TIER_FORBIDDEN]"),
    });
  });

  it("still retries a generic rate-limit 429 that has a non-tier code", async () => {
    const { client, slept } = harness([
      reply(429, { code: "RATE_LIMITED", message: "Rate limit exceeded" }, { "retry-after": "1" }),
      reply(200, { ok: true }),
    ]);

    await client.get("/api/dashboards");
    expect(slept).toEqual([1000]);
  });

  it("retries a write, since a rate-limited request was refused before it was processed", async () => {
    const { client, slept, calls } = harness([
      reply(429, { message: "Rate limit exceeded" }, { "retry-after": "2" }),
      reply(200, { id: "src-1" }),
    ]);

    await expect(client.post("/api/data-sources", { name: "news-src" })).resolves.toEqual({
      id: "src-1",
    });
    expect(slept).toEqual([2000]);
    expect(calls[1]?.init.method).toBe("POST");
  });

  it("warns on stderr for every retry, so a throttled run is diagnosable from the log", async () => {
    const { client, warnings } = harness([
      reply(429, { message: "Rate limit exceeded" }, { "retry-after": "3" }),
      reply(429, { message: "Rate limit exceeded" }, { "retry-after": "3" }),
      reply(200, { ok: true }),
    ]);

    await client.post("/api/data-sources", { name: "news-src" });
    expect(warnings).toHaveLength(2);
    expect(warnings[0]).toContain("429 rate limited on POST");
    expect(warnings[0]).toContain("retrying in 3000ms");
    expect(warnings[0]).toContain("attempt 1/5");
    expect(warnings[1]).toContain("attempt 2/5");
  });

  it("stays silent when nothing is throttled", async () => {
    const { client, warnings } = harness([reply(200, { ok: true })]);
    await client.get("/api/dashboards");
    expect(warnings).toEqual([]);
  });

  it("does not retry a 401 — a rejected PAT will not fix itself", async () => {
    const { client, slept, calls } = harness([reply(401, { message: "nope" })]);

    await expect(client.get("/api/dashboards")).rejects.toBeInstanceOf(HelioAuthError);
    expect(slept).toEqual([]);
    expect(calls).toHaveLength(1);
  });

  it("does not retry a 409 — a conflict is a real answer, not a throttle", async () => {
    const { client, slept, calls } = harness([
      reply(409, { message: "Cannot delete DataType: one or more panels are bound to it" }),
    ]);

    await expect(client.delete("/api/types/t-1")).rejects.toBeInstanceOf(HelioApiError);
    expect(slept).toEqual([]);
    expect(calls).toHaveLength(1);
  });

  it("still returns undefined for a 204 that followed a 429", async () => {
    const { client } = harness([
      reply(429, { message: "Rate limit exceeded" }, { "retry-after": "1" }),
      reply(204, undefined),
    ]);

    await expect(client.delete("/api/types/t-1")).resolves.toBeUndefined();
  });
});
