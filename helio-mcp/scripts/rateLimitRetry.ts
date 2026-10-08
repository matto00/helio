/**
 * HEL-1349 — lets `verify.ts` wait out a rate limit the helio-mcp HTTP client has
 * (correctly) refused to sleep through. The client fails fast with a
 * `HelioRateLimitError` once the wait would exceed its budget; the tool shell turns
 * that into an `isError` result whose text starts with `HelioRateLimitError` and
 * contains `retry after <N>s` (the contract set by `HelioHttpClient.rateLimitError`).
 *
 * Kept out of `verify.ts` because that module runs `main()` on import.
 */

/** Max re-calls of one tool call after a rate-limit result. */
export const MAX_RATE_LIMIT_RECALLS = 3;
/** Max total time spent sleeping for one call site. */
export const MAX_RATE_LIMIT_SLEEP_MS = 180_000;

/** Seconds to wait if `text` is a `HelioRateLimitError` result carrying a retry-after;
 *  `undefined` for anything else (other errors, or a rate limit with no retry-after). */
export function parseRateLimitRetryAfterSeconds(text: string): number | undefined {
  if (!text.includes("HelioRateLimitError")) return undefined;
  const match = /retry after (\d+(?:\.\d+)?)s/.exec(text);
  return match?.[1] === undefined ? undefined : Math.ceil(Number(match[1]));
}

interface ResultLike {
  isError?: unknown;
  content?: unknown;
}

function textOfResult(result: ResultLike): string {
  if (!Array.isArray(result.content)) return "";
  const block = (result.content as Array<{ type?: string; text?: string }>).find(
    (c) => c.type === "text",
  );
  return block?.text ?? "";
}

/** Run `call`; while it returns a rate-limit `isError` with a retry-after, sleep
 *  N s + 1 s and re-call, bounded by `MAX_RATE_LIMIT_RECALLS` and
 *  `MAX_RATE_LIMIT_SLEEP_MS`. Anything else, or the last result once a bound is hit,
 *  is returned unchanged. */
export async function retryingOnRateLimit<R extends object>(
  call: () => Promise<R>,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
): Promise<R> {
  let slept = 0;
  let result = await call();
  for (let recalls = 0; recalls < MAX_RATE_LIMIT_RECALLS; recalls++) {
    const seconds = (result as ResultLike).isError
      ? parseRateLimitRetryAfterSeconds(textOfResult(result as ResultLike))
      : undefined;
    if (seconds === undefined) break;
    const waitMs = (seconds + 1) * 1_000;
    if (slept + waitMs > MAX_RATE_LIMIT_SLEEP_MS) break;
    slept += waitMs;
    await sleep(waitMs);
    result = await call();
  }
  return result;
}
