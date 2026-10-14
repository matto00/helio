#!/usr/bin/env node
// Rebuilds the landing page's example dashboards in a throwaway local account and captures them. See README.md.
//   HELIO_API_BASE_URL=http://localhost:8080 HELIO_BASE_URL=http://localhost:5173 node scripts/landing-captures/run.mjs
import { randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { createRequire } from "node:module";

import { chromium } from "@playwright/test";

import { makeRest } from "./lib/api.mjs";
import {
  API_BASE_URL,
  APP_BASE_URL,
  CSRF_HEADER,
  MD_LAYOUT,
  REPO_ROOT,
  TAGS,
} from "./lib/config.mjs";
import { startMcp } from "./lib/mcp.mjs";
import { captureAll, writeOgImage, writeRects } from "./capture.mjs";
import { buildLaunch } from "./steps/build-launch.mjs";
import { buildReplicas } from "./steps/build-replicas.mjs";
import { buildUsecases } from "./steps/build-usecases.mjs";
import { enhanceUsecases } from "./steps/enhance.mjs";

const require = createRequire(import.meta.url);

function buildMcp() {
  const dir = resolve(REPO_ROOT, "helio-mcp");
  // `npm ci` rewrites node_modules, which a delivery worktree links to the main checkout's: only install when absent.
  if (!existsSync(resolve(dir, "node_modules")))
    execFileSync("npm", ["--prefix", dir, "ci"], { stdio: "inherit" });
  execFileSync("npm", ["--prefix", dir, "run", "build"], { stdio: "inherit" });
}

async function register() {
  const email = `landing-captures-${Date.now()}-${randomBytes(3).toString("hex")}@example.test`;
  const password = randomBytes(18).toString("base64url");
  const res = await fetch(`${API_BASE_URL}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json", [CSRF_HEADER]: "1" },
    body: JSON.stringify({ email, password, displayName: "Landing captures" }),
  });
  if (res.status !== 201) throw new Error(`register failed: ${res.status}`);
  const { user } = await res.json();
  const setCookie = res.headers.getSetCookie().find((c) => c.startsWith("helio_session="));
  if (!user?.id || !setCookie) throw new Error("register returned no user id or session cookie");
  const value = setCookie.split(";")[0].slice("helio_session=".length);
  return { user: { id: user.id, email: user.email }, sessionValue: value };
}

async function main() {
  for (const url of [`${API_BASE_URL}/health`, APP_BASE_URL]) {
    const res = await fetch(url).catch(() => null);
    if (!res?.ok)
      throw new Error(`${url} is not reachable; start the backend and the dev server first`);
  }
  buildMcp();

  const created = await register();
  console.log(`throwaway account ${created.user.email} (id ${created.user.id})`);
  let mcp = null;
  let browser = null;
  const sessionRest = makeRest({ Cookie: `helio_session=${created.sessionValue}` });
  try {
    const token = await sessionRest("POST", "/api/tokens", {
      name: "landing-captures",
      expiresInDays: 1,
    });
    const rest = makeRest({ Authorization: `Bearer ${token.token}` });
    mcp = await startMcp(token.token);
    const setLayout = (dashboardId, panelIds) =>
      rest("PATCH", `/api/dashboards/${dashboardId}`, {
        layout: {
          md: panelIds.map((panelId, i) => ({
            panelId,
            x: MD_LAYOUT[i][0],
            y: MD_LAYOUT[i][1],
            w: MD_LAYOUT[i][2],
            h: MD_LAYOUT[i][3],
          })),
        },
      });

    const launch = await buildLaunch(mcp);
    await setLayout(launch.id, launch.panelIds);
    const ids = { launch: launch.id, ...(await buildUsecases({ ...mcp, setLayout })) };
    await enhanceUsecases({ rest });
    Object.assign(ids, await buildReplicas({ ...mcp, setLayout }));

    browser = await chromium.launch();
    const host = new URL(APP_BASE_URL).hostname;
    const cookie = {
      name: "helio_session",
      value: created.sessionValue,
      domain: host,
      path: "/",
      httpOnly: true,
      sameSite: "Lax",
    };
    const measured = await captureAll(browser, cookie, ids);
    console.log("panel rectangles:", JSON.stringify(writeRects(measured)));
    await writeOgImage(browser);
    console.log("done: shots, rects.json and og.jpg written");
  } finally {
    if (browser) await browser.close().catch(() => {});
    if (mcp) await mcp.close().catch(() => {});
    await cleanup(created, sessionRest);
  }
}

/** Tag-scoped teardown through the API, then the throwaway user row by exact id (the shared dev DB keeps residue). */
async function cleanup(created, sessionRest) {
  for (const tag of TAGS) {
    await sessionRest("POST", "/api/workspace/teardown", { tag, dryRun: false }).catch((e) =>
      console.log(`  teardown ${tag}: ${e.message.slice(0, 120)}`),
    );
  }
  const { psql } = require("../../e2e/support/db.cjs");
  const { buildUserDeleteSql } = require("../../e2e/support/userCleanupCore.cjs");
  psql(buildUserDeleteSql([created.user]), "landing-captures cleanup");
  console.log(`deleted throwaway user ${created.user.id}`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
