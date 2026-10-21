#!/usr/bin/env node
// HEL-1691 -- run the `@prod-build` e2e tests locally against a production build.
//
//   npm run e2e:prod-build [-- <extra playwright args>]
//
// Builds the frontend (`npm --prefix frontend run build`), serves it with `vite preview` on DEV_PORT (default 5173,
// proxying /api to BACKEND_PORT, default 8080 -- the backend must already be running), waits until it answers, runs
// `HELIO_E2E_PROD_BUILD=1 playwright test`, and ends the preview server it started on EVERY exit path (normal, error,
// SIGINT, SIGTERM) through the child handle -- never by pattern, port or parent. Exits with Playwright's status.
//
// The port must be free: stop a lane's dev server first with
//   scripts/concertino/stop-servers.sh <WORKTREE_PATH> <DEV_PORT> <BACKEND_PORT>
// (that also stops the backend; start it again, or use a free DEV_PORT instead). The full local suite is `npm run e2e`
// (dev server) plus this command.
import { spawn, spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const devPort = process.env.DEV_PORT ?? "5173";
const backendPort = process.env.BACKEND_PORT ?? "8080";
const url = `http://localhost:${devPort}/`;

let preview = null;
let previewExited = false;
let cleaning = false;

function stopPreview() {
  if (preview && !previewExited) preview.kill("SIGTERM");
}

function finish(code) {
  if (cleaning) return;
  cleaning = true;
  stopPreview();
  process.exit(code);
}

process.on("SIGINT", () => finish(130));
process.on("SIGTERM", () => finish(143));
process.on("uncaughtException", (e) => {
  console.error(`e2e:prod-build: ${e.message}`);
  finish(1);
});

async function answers() {
  try {
    const res = await fetch(url);
    return res.status < 500;
  } catch {
    return false;
  }
}

async function main() {
  if (await answers()) {
    throw new Error(
      `port ${devPort} already answers; stop that server first (scripts/concertino/stop-servers.sh) or set DEV_PORT to a free port`,
    );
  }
  const build = spawnSync("npm", ["--prefix", "frontend", "run", "build"], {
    cwd: root,
    stdio: "inherit",
  });
  if (build.status !== 0) throw new Error(`frontend build failed (exit ${build.status})`);

  preview = spawn(
    join(root, "frontend", "node_modules", ".bin", "vite"),
    ["preview", "--port", devPort, "--strictPort"],
    {
      cwd: join(root, "frontend"),
      stdio: "inherit",
      env: { ...process.env, BACKEND_PORT: backendPort },
    },
  );
  preview.on("exit", () => {
    previewExited = true;
  });
  preview.on("error", (e) => {
    console.error(`e2e:prod-build: could not start vite preview: ${e.message}`);
    finish(1);
  });

  const deadline = Date.now() + 60_000;
  while (!(await answers())) {
    if (previewExited) throw new Error("vite preview exited before it answered");
    if (Date.now() > deadline) throw new Error(`vite preview did not answer on ${url} within 60 s`);
    await new Promise((r) => setTimeout(r, 250));
  }

  const code = await new Promise((resolve) => {
    const pw = spawn("npx", ["playwright", "test", ...process.argv.slice(2)], {
      cwd: root,
      stdio: "inherit",
      env: {
        ...process.env,
        HELIO_E2E_PROD_BUILD: "1",
        DEV_PORT: devPort,
        BACKEND_PORT: backendPort,
      },
    });
    pw.on("error", () => resolve(1));
    pw.on("close", (c, s) => resolve(c ?? (s ? 128 : 1)));
  });
  finish(code);
}

main().catch((e) => {
  console.error(`e2e:prod-build: ${e.message}`);
  finish(1);
});
