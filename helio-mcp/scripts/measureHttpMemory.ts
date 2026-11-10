/**
 * HEL-1709 task 5.1a: peak RSS of the built HTTP entry (`dist/http.js`) idle and under one 8 MiB
 * and one 32 MiB `create_csv_data_source` call, read from /proc/<pid>/status (VmHWM = peak RSS).
 *
 *   npm run build && npx tsx scripts/measureHttpMemory.ts
 *
 * Keys are generated here per run; the "backend" is a local stub that drains the upload and
 * answers 201. Nothing real is contacted.
 */

import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { fullFlow, mcpPost, type McpHarness } from "../src/testing/httpHarness.js";

const MIB = 1024 * 1024;

function procKb(pid: number, field: "VmRSS" | "VmHWM"): number {
  const text = readFileSync(`/proc/${pid}/status`, "utf8");
  const m = new RegExp(`${field}:\\s+(\\d+) kB`).exec(text);
  return m ? Number(m[1]) : NaN;
}

async function main(): Promise<void> {
  const PAT = "helio_pat_measure";
  const backend = createServer((req, res) => {
    req.on("data", () => undefined);
    req.on("end", () => {
      res.setHeader("Content-Type", "application/json");
      if (req.url?.startsWith("/api/tokens")) return void res.end("[]");
      res.statusCode = 201;
      res.end(JSON.stringify({ id: "ds1", name: "m", type: "csv" }));
    });
  });
  await new Promise<void>((r) => backend.listen(0, "127.0.0.1", r));
  const backendUrl = `http://127.0.0.1:${(backend.address() as AddressInfo).port}`;

  const mcpPort = 18000 + Math.floor(Math.random() * 1000);
  const url = `http://127.0.0.1:${mcpPort}`;
  const child = spawn("node", ["dist/http.js"], {
    env: {
      PATH: process.env.PATH ?? "",
      NODE_ENV: "production",
      PORT: String(mcpPort),
      HELIO_MCP_PUBLIC_URL: url,
      HELIO_APP_URL: "http://localhost:5173",
      HELIO_API_BASE_URL: backendUrl,
      HELIO_MCP_TOKEN_KEY: randomBytes(32).toString("base64"),
    },
    stdio: ["ignore", "ignore", "ignore"],
  });
  await new Promise((r) => setTimeout(r, 1500));
  const pid = child.pid as number;
  const mcp = { url } as McpHarness;

  // The OAuth harness expects the PAT to be accepted by the stub backend: it answers any PAT.
  const { accessToken } = await fullFlow(mcp, PAT);
  const idle = procKb(pid, "VmRSS");
  const out: Record<string, number> = { idleRssMiB: Math.round(idle / 1024) };

  for (const size of (process.env.SIZES ?? "8,32").split(",").map(Number)) {
    const overhead = 512;
    const content = "a".repeat(size * MIB - overhead);
    const body = JSON.stringify({
      jsonrpc: "2.0",
      id: 9,
      method: "tools/call",
      params: { name: "create_csv_data_source", arguments: { name: "m", content } },
    });
    const res = await mcpPost(mcp, accessToken, body);
    const text = await res.text();
    out[`status${size}`] = res.status;
    out[`bodyBytes${size}`] = body.length;
    out[`responseHasId${size}`] = text.includes("ds1") ? 1 : 0;
    out[`peakHwmMiBAfter${size}`] = Math.round(procKb(pid, "VmHWM") / 1024);
    await new Promise((r) => setTimeout(r, 500));
    out[`rssMiBSettledAfter${size}`] = Math.round(procKb(pid, "VmRSS") / 1024);
  }
  console.log(JSON.stringify(out, null, 2));
  child.kill("SIGTERM");
  backend.close();
}

main().catch((e) => {
  console.error(String(e));
  process.exit(1);
});
