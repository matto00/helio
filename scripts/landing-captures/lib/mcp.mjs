import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { sleep } from "./api.mjs";
import { API_BASE_URL, REPO_ROOT } from "./config.mjs";

const RUNS_PER_MINUTE = 6;
const MCP_DIR = resolve(REPO_ROOT, "helio-mcp");
const sdk = (file) =>
  pathToFileURL(resolve(MCP_DIR, "node_modules/@modelcontextprotocol/sdk/dist/esm/client", file))
    .href;

/** Starts the repo's own helio-mcp (built to `helio-mcp/dist`) against the local backend with `pat`, and returns
 *  `{ call, close }`. `call(tool, args)` returns the parsed JSON text result and throws on a tool error. */
export async function startMcp(pat) {
  const { Client } = await import(sdk("index.js"));
  const { StdioClientTransport } = await import(sdk("stdio.js"));
  const client = new Client({ name: "landing-captures", version: "0.1.0" });
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: [resolve(MCP_DIR, "dist/index.js")],
      env: { HELIO_API_BASE_URL: API_BASE_URL, HELIO_PAT: pat, PATH: process.env.PATH ?? "" },
    }),
  );
  // The backend allows PIPELINE_RUN_RATE_LIMIT_PER_WINDOW (default 10) pipeline runs per user per minute, dataset
  // auto-runs included. Keep well under it, and on a 429 wait out the advertised delay and retry.
  const runStamps = [];
  async function paceRuns() {
    for (;;) {
      const now = Date.now();
      while (runStamps.length && now - runStamps[0] > 62_000) runStamps.shift();
      if (runStamps.length < RUNS_PER_MINUTE) break;
      await sleep(runStamps[0] + 62_000 - now);
    }
    runStamps.push(Date.now());
  }
  async function call(name, args) {
    for (let attempt = 0; ; attempt++) {
      if (name === "run_pipeline") await paceRuns();
      const res = await client.callTool({ name, arguments: args });
      const text = res.content?.find((c) => c.type === "text")?.text ?? "";
      const retryAfter = /retry after (\d+)s/.exec(text);
      if (res.isError && retryAfter && attempt < 5) {
        console.log(`  helio · ${name}: rate limited, waiting ${retryAfter[1]}s`);
        await sleep((Number(retryAfter[1]) + 2) * 1000);
        continue;
      }
      console.log(`  helio · ${name}`);
      if (res.isError) throw new Error(`${name} failed: ${text.slice(0, 400)}`);
      return JSON.parse(text);
    }
  }
  return { call, close: () => client.close() };
}
