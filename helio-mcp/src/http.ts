#!/usr/bin/env node
/**
 * helio-mcp over Streamable HTTP (HEL-1709): a public MCP endpoint at `/mcp` with OAuth sign-in,
 * so Helio can be added as a claude.ai custom connector. The stdio entry point (`index.ts`) is
 * untouched. Configuration is `loadHttpConfig`'s; see helio-mcp/README.md.
 */

import { loadHttpConfig } from "./httpConfig.js";
import { createHttpApp } from "./httpApp.js";
import { installUnhandledRejectionGuard } from "./unhandledRejectionGuard.js";

function main(): void {
  installUnhandledRejectionGuard(process, (line) => process.stderr.write(line), true);
  let config;
  try {
    config = loadHttpConfig();
  } catch (err) {
    process.stderr.write(`helio-mcp: ${(err as Error).message}\n`);
    process.exit(1);
  }
  const app = createHttpApp(config, { log: (line) => process.stderr.write(`${line}\n`) });
  app.listen(config.port, () => {
    process.stderr.write(
      `helio-mcp: ready (http) on :${config.port}, resource ${config.resourceUrl.href}\n`,
    );
  });
}

// Only run when invoked directly (not when imported by tests).
if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    main();
  } catch (err) {
    process.stderr.write(`helio-mcp: fatal: ${(err as Error).name}\n`);
    process.exit(1);
  }
}
