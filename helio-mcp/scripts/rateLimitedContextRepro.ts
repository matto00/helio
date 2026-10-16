/**
 * HEL-1617 subprocess reproduction: builds the workspace context against a backend that answers
 * 429 (Retry-After far past the wait budget) for data sources AND outputs, with NO
 * `unhandledRejection` guard installed. On unfixed code the orphaned Outputs rejection kills this
 * process (Node >= 15 default `--unhandled-rejections=throw`, exit 1); on the fix the build rejects
 * with the data-sources rate-limit error and the process survives and exits 0.
 *
 * Run by `rateLimitedContextProcess.test.ts`; prints a one-line verdict on stdout.
 */
import { buildWorkspaceContext } from "../src/context.js";
import { HelioApi } from "../src/helioApi.js";
import { HelioHttpClient, HelioRateLimitError } from "../src/httpClient.js";
import type { HelioConfig } from "../src/config.js";

function reply(status: number, body: unknown, retryAfter?: string): Response {
  return {
    status,
    statusText: String(status),
    ok: status >= 200 && status < 300,
    headers: {
      get: (name: string) =>
        name.toLowerCase() === "retry-after" && retryAfter !== undefined ? retryAfter : null,
    },
    json: async () => body,
  } as unknown as Response;
}

async function main(): Promise<void> {
  const http = new HelioHttpClient({ baseUrl: "https://helio.test", pat: "pat" } as HelioConfig, {
    fetchImpl: async (url: string) => {
      const path = new URL(url).pathname;
      if (path === "/api/data-sources" || path === "/api/outputs") {
        return reply(429, { message: "Rate limit exceeded" }, "3600");
      }
      if (path === "/api/dashboards") return reply(200, { items: [], total: 0 });
      return reply(200, []);
    },
    sleep: () => Promise.resolve(),
    warn: () => {},
  });
  let outcome = "resolved";
  try {
    await buildWorkspaceContext(new HelioApi(http));
  } catch (err) {
    outcome = err instanceof HelioRateLimitError ? "rate-limit-error" : `other:${String(err)}`;
  }
  // Let the event loop turn so Node flags any orphaned rejection before we declare survival.
  await new Promise((resolve) => setTimeout(resolve, 100));
  process.stdout.write(`survived outcome=${outcome}\n`);
}

void main();
