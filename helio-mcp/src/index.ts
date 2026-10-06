#!/usr/bin/env node
/**
 * helio-mcp — Model Context Protocol server exposing Helio's REST API as agent
 * tools. Phase 2: read tools + the workspace-context resource. Authenticates
 * with a Personal Access Token (HEL-148 Phase 1) over the existing API; adds no
 * backend logic of its own.
 *
 * Transport: stdio (the standard MCP launch shape — an MCP client spawns this
 * process and speaks JSON-RPC over stdin/stdout). All human-facing logging goes
 * to stderr so it never corrupts the protocol stream on stdout.
 *
 * Tool/resource registration itself lives in `server.ts`'s `createServer` —
 * split out (HEL-907 task 3.9/5.3) so a unit test can import it without
 * tripping this file's top-level `import.meta.url` direct-invocation guard.
 */

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "./config.js";
import { HelioHttpClient } from "./httpClient.js";
import { HelioApi } from "./helioApi.js";
import { createServer } from "./server.js";

export { createServer } from "./server.js";

/**
 * Per-line stdin cap for the stdio transport. sdk >= 1.31 defaults to 10 MiB and, on overflow,
 * closes the whole session — but helio-mcp legitimately forwards large inbound requests, chiefly
 * create_csv_data_source.content (backend CsvLimits.maxBytes 15 MiB). JSON escaping at most
 * doubles it (all quotes/newlines; ~1.03x for typical CSV) and 4 x 15 MiB = 60 MiB is covered.
 * upload_image.content (IMAGE_UPLOAD_MAX_FILE_SIZE_BYTES, default 10 MiB, ~13.3 MiB as base64;
 * pekko's per-part toStrict may cap it lower, unverified) fits easily. Row-array tools are bound
 * by pekko's 8 MiB JSON entity default. 64 MiB = 60 MiB + headroom. Not covered: > ~9.8 MiB of C0
 * control bytes inside a <= 15 MiB CSV (6x \uXXXX escaping), which CsvLimits/UTF-8 validation do
 * not reject; such a request closes the session with a stderr log.
 */
const MAX_STDIO_BUFFER_BYTES = 64 * 1024 * 1024;

async function main(): Promise<void> {
  let api: HelioApi;
  try {
    const config = loadConfig();
    api = new HelioApi(new HelioHttpClient(config));
    process.stderr.write(`helio-mcp: targeting ${config.baseUrl}\n`);
  } catch (err) {
    process.stderr.write(`helio-mcp: ${(err as Error).message}\n`);
    process.exit(1);
  }

  const server = createServer(api);
  // The Protocol layer chains transport errors (incl. a ReadBuffer overflow) into server.server.onerror.
  server.server.onerror = (err) => {
    // sdk messages can echo whole inbound payloads; keep host logs bounded.
    const msg =
      err.message.length > 500 ? `${err.message.slice(0, 500)}... [truncated]` : err.message;
    process.stderr.write(`helio-mcp: transport error: ${msg}\n`);
  };
  await server.connect(
    new StdioServerTransport(undefined, undefined, { maxBufferSize: MAX_STDIO_BUFFER_BYTES }),
  );
  process.stderr.write("helio-mcp: ready (stdio)\n");
}

// Only run when invoked directly (not when imported by the verify harness).
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    process.stderr.write(`helio-mcp: fatal: ${(err as Error).message}\n`);
    process.exit(1);
  });
}
