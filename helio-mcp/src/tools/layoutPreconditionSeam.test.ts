/**
 * HEL-1524 — layout-version precondition, end to end through a REAL MCP client/server pair, the
 * real `HelioApi` and `HelioHttpClient`, and a fake `fetch` standing in for the backend (the
 * live-backend counterpart is `openspec/changes/mcp-layout-version-precondition/seam-check.ts`).
 * Only the registered zod schema enforces the required `expectedLayoutVersion`, hence `callTool`.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { HelioConfig } from "../config.js";
import { HelioApi } from "../helioApi.js";
import { HelioHttpClient, type HelioRequestInit } from "../httpClient.js";
import { createServer } from "../server.js";

const config = { baseUrl: "https://helio.test", pat: "pat" } as HelioConfig;
const CURRENT = { id: "dash-1", name: "D", layoutVersion: 9, layout: { lg: [{ panelId: "z" }] } };
const items = [{ panelId: "a", x: 0, y: 0, w: 4, h: 3 }];

type Handler = (url: string, init: HelioRequestInit) => { status: number; body: unknown };

function reply(status: number, body: unknown) {
  return {
    status,
    statusText: String(status),
    ok: status >= 200 && status < 300,
    headers: { get: () => null },
    json: async () => body,
  } as unknown as Response;
}

async function connect(handler: Handler) {
  const calls: { url: string; method: string; body: unknown }[] = [];
  const fetchImpl = async (url: string, init: HelioRequestInit) => {
    calls.push({
      url,
      method: init.method,
      body: typeof init.body === "string" ? JSON.parse(init.body) : undefined,
    });
    const r = handler(url, init);
    return reply(r.status, r.body);
  };
  const api = new HelioApi(new HelioHttpClient(config, { fetchImpl }));
  const server = createServer(api);
  const [ct, st] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "t", version: "0" });
  await Promise.all([server.connect(st), client.connect(ct)]);
  return { client, calls, close: () => Promise.all([client.close(), server.close()]) };
}

function text(result: Awaited<ReturnType<Client["callTool"]>>): string {
  return (result.content as { text: string }[])[0]!.text;
}

const conflict409: Handler = () => ({
  status: 409,
  body: { message: "layout changed", dashboard: CURRENT },
});

describe("update_dashboard_layout precondition (HEL-1524)", () => {
  it("rejects a call without expectedLayoutVersion before any request is sent", async () => {
    const { client, calls, close } = await connect(() => ({ status: 200, body: CURRENT }));
    try {
      const result = await client.callTool({
        name: "update_dashboard_layout",
        arguments: { dashboardId: "dash-1", items },
      });
      expect(result.isError).toBe(true);
      expect(text(result)).toContain("expectedLayoutVersion");
      expect(calls).toHaveLength(0);
    } finally {
      await close();
    }
  });

  it("sends expectedLayoutVersion in the PATCH body", async () => {
    const { client, calls, close } = await connect(() => ({ status: 200, body: CURRENT }));
    try {
      const result = await client.callTool({
        name: "update_dashboard_layout",
        arguments: { dashboardId: "dash-1", items, expectedLayoutVersion: 8 },
      });
      expect(result.isError).toBeFalsy();
      expect(calls).toEqual([
        {
          url: "https://helio.test/api/dashboards/dash-1",
          method: "PATCH",
          body: { layout: { lg: items }, expectedLayoutVersion: 8 },
        },
      ]);
    } finally {
      await close();
    }
  });

  it("returns the current dashboard on a 409 and sends exactly one request (no retry)", async () => {
    const { client, calls, close } = await connect(conflict409);
    try {
      const result = await client.callTool({
        name: "update_dashboard_layout",
        arguments: { dashboardId: "dash-1", items, expectedLayoutVersion: 8 },
      });
      expect(result.isError).toBe(true);
      const payload = JSON.parse(text(result));
      expect(payload).toMatchObject({
        error: "layout_conflict",
        expectedLayoutVersion: 8,
        currentLayoutVersion: 9,
        dashboard: CURRENT,
      });
      expect(payload.nextStep).toContain("dashboard.layoutVersion");
      expect(calls).toHaveLength(1);
    } finally {
      await close();
    }
  });

  it("leaves a 409 without a dashboard body as the verbatim HelioApiError", async () => {
    const { client, calls, close } = await connect(() => ({
      status: 409,
      body: { message: "something else conflicts" },
    }));
    try {
      const result = await client.callTool({
        name: "update_dashboard_layout",
        arguments: { dashboardId: "dash-1", items, expectedLayoutVersion: 8 },
      });
      expect(result.isError).toBe(true);
      expect(text(result)).toContain("HelioApiError (status 409)");
      expect(text(result)).toContain("something else conflicts");
      expect(text(result)).not.toContain("layout_conflict");
      expect(calls).toHaveLength(1);
    } finally {
      await close();
    }
  });
});

describe("auto_layout_dashboard precondition (HEL-1524)", () => {
  const sizes = [{ panelId: "a", w: 4, h: 3 }];

  it("forwards an optional expectedLayoutVersion and omits it otherwise", async () => {
    const { client, calls, close } = await connect(() => ({ status: 200, body: CURRENT }));
    try {
      await client.callTool({
        name: "auto_layout_dashboard",
        arguments: { dashboardId: "dash-1", items: sizes, expectedLayoutVersion: 5 },
      });
      await client.callTool({
        name: "auto_layout_dashboard",
        arguments: { dashboardId: "dash-1", items: sizes },
      });
      expect(calls[0]?.body).toMatchObject({ expectedLayoutVersion: 5 });
      expect(calls[1]?.body).not.toHaveProperty("expectedLayoutVersion");
    } finally {
      await close();
    }
  });

  it("surfaces a 409 with the current dashboard and does not retry", async () => {
    const { client, calls, close } = await connect(conflict409);
    try {
      const result = await client.callTool({
        name: "auto_layout_dashboard",
        arguments: { dashboardId: "dash-1", items: sizes, expectedLayoutVersion: 5 },
      });
      expect(result.isError).toBe(true);
      expect(JSON.parse(text(result))).toMatchObject({
        error: "layout_conflict",
        expectedLayoutVersion: 5,
        dashboard: CURRENT,
      });
      expect(calls).toHaveLength(1);
    } finally {
      await close();
    }
  });
});

describe("place_outputs pack conflict (HEL-1524)", () => {
  const panel = (id: string) => ({ id, type: "output", config: { outputId: "o" } });

  it("names the created panels, says they were not positioned, and carries the dashboard", async () => {
    const { client, calls, close } = await connect((url) =>
      url.endsWith("/api/panels/batch")
        ? { status: 201, body: { panels: [panel("p1"), panel("p2")] } }
        : { status: 409, body: { message: "layout changed", dashboard: CURRENT } },
    );
    try {
      const result = await client.callTool({
        name: "place_outputs",
        arguments: {
          dashboardId: "dash-1",
          items: [
            { outputId: "o", w: 4, h: 3 },
            { outputId: "o", w: 4, h: 3 },
          ],
        },
      });
      expect(result.isError).toBe(true);
      const payload = JSON.parse(text(result));
      expect(payload.error).toBe("layout_conflict");
      expect(payload.createdPanelIds).toEqual(["p1", "p2"]);
      expect(payload.createdButNotPositioned).toContain("NOT positioned");
      expect(payload.dashboard).toEqual(CURRENT);
      expect(payload.expectedLayoutVersion).toBeNull();
      // the pack carried no precondition and was sent exactly once
      expect(calls.filter((c) => c.url.endsWith("/auto-layout"))).toHaveLength(1);
      expect(calls[1]?.body).not.toHaveProperty("expectedLayoutVersion");
    } finally {
      await close();
    }
  });

  it("adds the pack's layoutVersion to the success result", async () => {
    const { client, close } = await connect((url) =>
      url.endsWith("/api/panels/batch")
        ? { status: 201, body: { panels: [panel("p1")] } }
        : { status: 200, body: CURRENT },
    );
    try {
      const result = await client.callTool({
        name: "place_outputs",
        arguments: { dashboardId: "dash-1", items: [{ outputId: "o", w: 4, h: 3 }] },
      });
      expect(result.isError).toBeFalsy();
      expect(JSON.parse(text(result)).layoutVersion).toBe(9);
    } finally {
      await close();
    }
  });
});
