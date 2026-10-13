/**
 * HEL-1524 live seam check (design D7): the layout-version precondition against a REAL backend.
 *
 *   BASE_URL=http://localhost:<port> npx tsx scripts/layoutPreconditionSeam.ts
 *   SEAM_STRIP_PRECONDITION=1 ...   # mutation: strips expectedLayoutVersion from every request;
 *                                   # the check MUST then go red (stale writer wins)
 *
 * Registers a throwaway @example.test user, mints a PAT, drives the REAL MCP server (in-process
 * client/server pair over the real HelioApi + HelioHttpClient), and deletes the user by exact
 * (id, email) via e2e/support/userCleanupCore.cjs buildUserDeleteSql. Exit 0 = all checks green.
 */

import { randomBytes } from "node:crypto";
import { createRequire } from "node:module";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { HelioApi } from "../src/helioApi.js";
import { HelioHttpClient, type HelioRequestInit } from "../src/httpClient.js";
import type { HelioConfig } from "../src/config.js";
import { createServer } from "../src/server.js";
import { mintBootstrapPat, register } from "./isolatedAuth.js";

const require = createRequire(import.meta.url);
const { buildUserDeleteSql } = require("../../e2e/support/userCleanupCore.cjs") as {
  buildUserDeleteSql: (records: { id: string; email: string }[]) => string;
};
const { psql } = require("../../e2e/support/db.cjs") as {
  psql: (sql: string, label?: string) => string[];
};

const baseUrl = process.env.BASE_URL ?? "";
if (!baseUrl) throw new Error("BASE_URL is required");
const STRIP = process.env.SEAM_STRIP_PRECONDITION === "1";

let failures = 0;
function check(name: string, ok: boolean, detail?: unknown): void {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `  ${JSON.stringify(detail)}`}`);
}

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const requests: { method: string; url: string; body: Json | undefined }[] = [];

async function main(): Promise<void> {
  console.log(`# HEL-1524 layout precondition seam check  base=${baseUrl}  strip=${STRIP}`);
  const email = `hel1524-seam-${Date.now()}-${randomBytes(3).toString("hex")}@example.test`;
  const reg = await register(baseUrl, email, randomBytes(12).toString("hex"));
  const pat = await mintBootstrapPat(baseUrl, reg.cookie, "hel1524");
  const record = { id: reg.userId, email };
  console.log(`user ${record.id} ${record.email} (throwaway)`);

  try {
    const config = { baseUrl, pat: pat.token } as HelioConfig;
    const fetchImpl = (url: string, init: HelioRequestInit) => {
      let body = init.body;
      if (typeof body === "string") {
        const parsed = JSON.parse(body) as Json;
        if (STRIP) delete parsed.expectedLayoutVersion;
        body = JSON.stringify(parsed);
        requests.push({ method: init.method, url, body: parsed });
      }
      return fetch(url, { ...init, body });
    };
    const api = new HelioApi(new HelioHttpClient(config, { fetchImpl }));
    const server = createServer(api);
    const [ct, st] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "seam", version: "0" });
    await Promise.all([server.connect(st), client.connect(ct)]);

    const call = async (
      name: string,
      args: Json,
    ): Promise<{ isError: boolean; json: Json; raw: string }> => {
      const r = await client.callTool({ name, arguments: args });
      const raw = (r.content as { text: string }[])[0]!.text;
      let json: Json = {};
      try {
        json = JSON.parse(raw) as Json;
      } catch {
        /* plain-text error */
      }
      return { isError: r.isError === true, json, raw };
    };
    const lg = (d: Json) => JSON.stringify(d.layout.lg);

    const dash = (await call("create_dashboard", { name: "HEL-1524 seam" })).json;
    const dashboardId = dash.id as string;
    const panelA = (
      await call("create_content_panel", {
        dashboardId,
        type: "text",
        title: "A",
        config: { content: "a" },
      })
    ).json.id as string;
    const panelB = (
      await call("create_content_panel", {
        dashboardId,
        type: "text",
        title: "B",
        config: { content: "b" },
      })
    ).json.id as string;

    // D1: the list endpoint carries layoutVersion, passed through get_dashboard.
    const read = (await call("get_dashboard", { dashboardId })).json;
    const readDash = (read.dashboard ?? read) as Json;
    const N = readDash.layoutVersion as number;
    check(
      "D1 get_dashboard exposes numeric layoutVersion",
      typeof N === "number",
      readDash.layoutVersion,
    );
    console.log(`agent reads layoutVersion N=${N}`);

    // A second writer (a browser tab / another agent) moves the layout after the agent's read.
    const other = await call("update_dashboard_layout", {
      dashboardId,
      expectedLayoutVersion: N,
      items: [{ panelId: panelB, x: 0, y: 0, w: 6, h: 3 }],
    });
    check("second writer (with current version) succeeds", !other.isError, other.raw);
    const otherLg = lg(other.json);
    const N1 = other.json.layoutVersion as number;
    check("second write bumped layoutVersion", N1 > N, { N, N1 });

    // The stale agent now writes a whole lg breakpoint computed from its N-era read.
    const before = requests.length;
    const stale = await call("update_dashboard_layout", {
      dashboardId,
      expectedLayoutVersion: N,
      items: [{ panelId: panelA, x: 6, y: 0, w: 6, h: 3 }],
    });
    check(
      "stale update_dashboard_layout -> layout_conflict error result",
      stale.isError && stale.json.error === "layout_conflict",
      stale.raw.slice(0, 300),
    );
    check(
      "conflict carries current dashboard with newer layoutVersion",
      stale.json.currentLayoutVersion === N1 && stale.json.dashboard?.layoutVersion === N1,
      stale.json.currentLayoutVersion,
    );
    check(
      "conflict dashboard.layout.lg is the second writer's",
      stale.json.dashboard && lg(stale.json.dashboard) === otherLg,
    );
    check(
      "exactly one PATCH sent for the stale call (no retry)",
      requests.slice(before).filter((r) => r.method === "PATCH").length === 1,
      requests.slice(before),
    );
    const stored = (await call("get_dashboard", { dashboardId })).json as Json;
    const storedDash = (stored.dashboard ?? stored) as Json;
    check(
      "stored lg layout still equals the second writer's (stale write did not land)",
      lg(storedDash) === otherLg,
      { stored: lg(storedDash), otherLg },
    );

    // The agent recovers by recomputing against the returned dashboard.
    const retry = await call("update_dashboard_layout", {
      dashboardId,
      expectedLayoutVersion: N1,
      items: [
        { panelId: panelB, x: 0, y: 0, w: 6, h: 3 },
        { panelId: panelA, x: 6, y: 0, w: 6, h: 3 },
      ],
    });
    check("re-call with dashboard.layoutVersion succeeds", !retry.isError, retry.raw.slice(0, 200));
    const N2 = retry.json.layoutVersion as number;

    // auto_layout_dashboard with a stale version.
    const staleAuto = await call("auto_layout_dashboard", {
      dashboardId,
      expectedLayoutVersion: N,
      items: [{ panelId: panelA, w: 4, h: 3 }],
    });
    check(
      "stale auto_layout_dashboard -> layout_conflict with current dashboard",
      staleAuto.isError &&
        staleAuto.json.error === "layout_conflict" &&
        staleAuto.json.currentLayoutVersion === N2,
      staleAuto.raw.slice(0, 300),
    );
    const freshAuto = await call("auto_layout_dashboard", {
      dashboardId,
      items: [{ panelId: panelA, w: 4, h: 3 }],
    });
    check(
      "auto_layout_dashboard without a version still works (optional)",
      !freshAuto.isError,
      freshAuto.raw.slice(0, 200),
    );
    const N3 = freshAuto.json.layoutVersion as number;

    // D5: a stale apply_patch_set layout edit -> 200 + failure + rollback, nothing saved.
    const preLg = lg(freshAuto.json);
    const stalePatch = await call("apply_patch_set", {
      patchSet: {
        edits: [
          {
            target: { kind: "dashboard", id: dashboardId },
            op: "update",
            patch: {
              layout: { lg: [{ panelId: panelA, x: 0, y: 6, w: 3, h: 3 }] },
              expectedLayoutVersion: N,
            },
          },
        ],
      },
    });
    console.log(
      `apply_patch_set stale result: ${stalePatch.raw.replace(/\s+/g, " ").slice(0, 400)}`,
    );
    check(
      "stale apply_patch_set: failure string, no applicationId (omitted on the wire), not an error result",
      !stalePatch.isError &&
        stalePatch.json.failure ===
          "This dashboard's layout was changed elsewhere; the layout was not saved." &&
        stalePatch.json.applicationId == null,
      stalePatch.raw.slice(0, 300),
    );
    const after = (await call("get_dashboard", { dashboardId })).json;
    const afterDash = (after.dashboard ?? after) as Json;
    check(
      "layout unchanged after the stale patch set",
      lg(afterDash) === preLg && afterDash.layoutVersion === N3,
      { preLg, now: lg(afterDash) },
    );

    await Promise.all([client.close(), server.close()]);
  } finally {
    psql(buildUserDeleteSql([record]), "seam userCleanup");
    const left = psql(`SELECT count(*) FROM users WHERE id = '${record.id}';`, "seam verify");
    check("throwaway user deleted by exact (id, email)", left[0] === "0", left);
  }
  console.log(failures === 0 ? "RESULT: GREEN" : `RESULT: RED (${failures} failed)`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("seam check crashed:", e instanceof Error ? e.message : e);
  process.exit(2);
});
