import { parseRateLimitRetryAfterSeconds, retryingOnRateLimit } from "./rateLimitRetry.js";

describe("parseRateLimitRetryAfterSeconds (HEL-1349)", () => {
  it("extracts the seconds from a HelioRateLimitError tool result text", () => {
    const text =
      "HelioRateLimitError (status 429) for https://h.test/api/x: 429 Too Many Requests: " +
      "rate limited by the Helio backend; retry after 42s (Rate limit exceeded)";
    expect(parseRateLimitRetryAfterSeconds(text)).toBe(42);
  });

  it("does not retry an error that is not a rate-limit error", () => {
    expect(
      parseRateLimitRetryAfterSeconds("HelioApiError (status 404) for u: retry after 5s"),
    ).toBeUndefined();
  });

  it("does not retry a rate-limit error that carries no retry-after", () => {
    const text =
      "HelioRateLimitError (status 429) for u: rate limited by the Helio backend; " +
      "the backend sent no retry-after, retry later";
    expect(parseRateLimitRetryAfterSeconds(text)).toBeUndefined();
  });
});

describe("retryingOnRateLimit (HEL-1349)", () => {
  const limited = (s: number) => ({
    isError: true,
    content: [
      { type: "text", text: `HelioRateLimitError (status 429) for u: retry after ${s}s (x)` },
    ],
  });
  const ok = { isError: false, content: [{ type: "text", text: "{}" }] };

  it("sleeps retry-after + 1s and re-calls, returning the eventual success", async () => {
    const results = [limited(42), ok];
    const slept: number[] = [];
    const out = await retryingOnRateLimit(
      async () => results.shift()!,
      async (ms) => {
        slept.push(ms);
      },
    );
    expect(out).toBe(ok);
    expect(slept).toEqual([43_000]);
  });

  it("stops after 3 re-calls and returns the last result unchanged", async () => {
    let calls = 0;
    const out = await retryingOnRateLimit(
      async () => {
        calls += 1;
        return limited(5);
      },
      async () => {},
    );
    expect(calls).toBe(4);
    expect(out.isError).toBe(true);
  });

  it("does not sleep past the per-call-site cap", async () => {
    let calls = 0;
    const slept: number[] = [];
    await retryingOnRateLimit(
      async () => {
        calls += 1;
        return limited(100);
      },
      async (ms) => {
        slept.push(ms);
      },
    );
    expect(slept).toEqual([101_000]);
    expect(calls).toBe(2);
  });

  it("returns a non-rate-limit error without retrying", async () => {
    let calls = 0;
    await retryingOnRateLimit(async () => {
      calls += 1;
      return { isError: true, content: [{ type: "text", text: "HelioApiError (status 404)" }] };
    });
    expect(calls).toBe(1);
  });
});
