/**
 * HEL-1785 -- helio-mcp includes dashboards shared with the caller, with the caller's role: `list_dashboards` asks the
 * server for them (`include=shared`), `get_dashboard` reads a VIEWER's panels from `GET /api/dashboards/:id/panels`
 * (the export refuses viewers), the workspace context carries `accessRole`, and a write tool aimed at a viewer's
 * dashboard fails as a tool error carrying the server's status and refusal text. Driven through the real server and
 * `HelioApi` with an injected `fetch`.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { connectMcp, resultText, type FakeFetch } from "../testing/mcpFetchHarness.js";

const REPO_ROOT = path.resolve(__dirname, "../../..");

/** The real `GET /api/dashboards/:id/panels` shape, pinned by the backend's `SharedDashboardPanelsSeamSpec`. */
const panelsFixture = JSON.parse(
  readFileSync(
    path.join(REPO_ROOT, "shared-test-fixtures/dashboards/viewer-panels-response.json"),
    "utf8",
  ),
) as {
  items: Array<{ id: string; title: string; type: string; appearance: unknown; config: unknown }>;
  total: number;
};

const VIEW_ONLY = "You have view-only access to this dashboard";

function dashboardRecord(id: string, accessRole: "owner" | "editor" | "viewer") {
  return {
    id,
    name: `Board ${id}`,
    meta: { createdAt: "2026-11-19T00:00:00Z", lastUpdated: "2026-11-19T00:00:00Z" },
    appearance: {},
    layout: { lg: [], md: [], sm: [], xs: [] },
    layoutVersion: 0,
    ownerId: "owner-1",
    accessRole,
  };
}

interface Seen {
  method: string;
  path: string;
  search: string;
}

function recording(
  handler: (path: string, search: string, method: string) => { status: number; body: unknown },
) {
  const seen: Seen[] = [];
  const fake: FakeFetch = (url, init) => {
    const u = new URL(url);
    seen.push({ method: String(init.method), path: u.pathname, search: u.search });
    return handler(u.pathname, u.search, String(init.method));
  };
  return { fake, seen };
}

describe("list_dashboards (HEL-1785)", () => {
  it("asks the server for shared dashboards and says items carry accessRole", async () => {
    const { fake, seen } = recording(() => ({
      status: 200,
      body: { items: [dashboardRecord("d1", "viewer")], total: 1, offset: 0, limit: 200 },
    }));
    const h = await connectMcp(fake);
    try {
      const result = await h.client.callTool({ name: "list_dashboards", arguments: {} });
      expect(new URLSearchParams(seen[0]!.search).get("include")).toBe("shared");
      expect(JSON.parse(resultText(result)).items[0].accessRole).toBe("viewer");
      const tools = (await h.client.listTools()).tools;
      const description = tools.find((t) => t.name === "list_dashboards")!.description!;
      expect(description).toContain("accessRole");
      expect(description).toContain("viewer");
    } finally {
      await h.close();
    }
  });
});

describe("get_dashboard (HEL-1785)", () => {
  it("reads a viewer's panels from /panels, never /export, mapped to the export's panel shape", async () => {
    const { fake, seen } = recording((p) => {
      if (p === "/api/dashboards") {
        return {
          status: 200,
          body: { items: [dashboardRecord("d1", "viewer")], total: 1, offset: 0, limit: 200 },
        };
      }
      if (p === "/api/dashboards/d1/panels") return { status: 200, body: panelsFixture };
      return { status: 500, body: { message: `unexpected ${p}` } };
    });
    const h = await connectMcp(fake);
    try {
      const result = await h.client.callTool({
        name: "get_dashboard",
        arguments: { dashboardId: "d1" },
      });
      expect(result.isError).toBeFalsy();
      const body = JSON.parse(resultText(result));
      expect(body.accessRole).toBe("viewer");
      expect(body.panels).toHaveLength(panelsFixture.items.length);
      for (const [i, panel] of body.panels.entries()) {
        const source = panelsFixture.items[i]!;
        expect(panel).toEqual({
          snapshotId: source.id,
          id: source.id,
          title: source.title,
          type: source.type,
          appearance: source.appearance,
          config: source.config,
        });
      }
      expect(seen.some((s) => s.path.endsWith("/export"))).toBe(false);
      const panelCall = seen.find((s) => s.path === "/api/dashboards/d1/panels")!;
      expect(new URLSearchParams(panelCall.search).get("limit")).toBe("500");
    } finally {
      await h.close();
    }
  });

  it("follows the panel total with further pages, so a viewer's dashboard is not truncated", async () => {
    const mk = (n: number) => ({
      id: `p${n}`,
      dashboardId: "d1",
      title: `P${n}`,
      type: "text",
      appearance: {},
      config: { content: "" },
      meta: {},
    });
    const { fake, seen } = recording((p, search) => {
      if (p === "/api/dashboards") {
        return {
          status: 200,
          body: { items: [dashboardRecord("d1", "viewer")], total: 1, offset: 0, limit: 200 },
        };
      }
      if (p === "/api/dashboards/d1/panels") {
        const offset = Number(new URLSearchParams(search).get("offset") ?? 0);
        const items = offset === 0 ? [mk(1), mk(2)] : [mk(3)];
        return { status: 200, body: { items, total: 3, offset, limit: 2 } };
      }
      return { status: 500, body: {} };
    });
    const h = await connectMcp(fake);
    try {
      const result = await h.client.callTool({
        name: "get_dashboard",
        arguments: { dashboardId: "d1" },
      });
      expect(JSON.parse(resultText(result)).panels.map((p: { id: string }) => p.id)).toEqual([
        "p1",
        "p2",
        "p3",
      ]);
      expect(seen.filter((s) => s.path === "/api/dashboards/d1/panels")).toHaveLength(2);
    } finally {
      await h.close();
    }
  });

  it("keeps the export for an owner or editor and reports the role", async () => {
    const { fake, seen } = recording((p) => {
      if (p === "/api/dashboards") {
        return {
          status: 200,
          body: { items: [dashboardRecord("d2", "editor")], total: 1, offset: 0, limit: 200 },
        };
      }
      if (p === "/api/dashboards/d2/export") {
        return {
          status: 200,
          body: {
            version: 1,
            dashboard: {},
            panels: [
              { snapshotId: "s1", id: "p1", title: "T", type: "text", appearance: {}, config: {} },
            ],
          },
        };
      }
      return { status: 500, body: {} };
    });
    const h = await connectMcp(fake);
    try {
      const result = await h.client.callTool({
        name: "get_dashboard",
        arguments: { dashboardId: "d2" },
      });
      const body = JSON.parse(resultText(result));
      expect(body.accessRole).toBe("editor");
      expect(body.panels[0].snapshotId).toBe("s1");
      expect(seen.some((s) => s.path === "/api/dashboards/d2/panels")).toBe(false);
    } finally {
      await h.close();
    }
  });
});

describe("write tools on a viewer's dashboard (HEL-1785)", () => {
  it("surface the server's 403 and view-only message as a tool error, with no client-side role guess", async () => {
    const { fake, seen } = recording(() => ({ status: 403, body: { message: VIEW_ONLY } }));
    const h = await connectMcp(fake);
    try {
      for (const call of [
        { name: "update_dashboard", arguments: { dashboardId: "d1", name: "New" } },
        { name: "delete_panel", arguments: { panelId: "p1" } },
      ]) {
        const result = await h.client.callTool(call);
        expect(result.isError).toBe(true);
        expect(resultText(result)).toContain("status 403");
        expect(resultText(result)).toContain(VIEW_ONLY);
      }
      // Each tool made exactly the server call; nothing was refused before reaching the server.
      expect(seen.map((s) => s.method)).toEqual(["PATCH", "DELETE"]);
    } finally {
      await h.close();
    }
  });
});

describe("get_workspace_context dashboards (HEL-1785)", () => {
  it("lists shared dashboards (include=shared) and carries each entry's accessRole", async () => {
    const { fake, seen } = recording((p) => {
      if (p === "/api/dashboards") {
        return {
          status: 200,
          body: {
            items: [dashboardRecord("d1", "viewer"), dashboardRecord("d2", "owner")],
            total: 2,
            offset: 0,
            limit: 200,
          },
        };
      }
      if (p === "/api/data-sources")
        return { status: 200, body: { items: [], total: 0, offset: 0, limit: 200 } };
      if (p === "/api/pipelines") return { status: 200, body: [] };
      if (p === "/api/pipeline-shapes") return { status: 200, body: [] };
      if (p === "/api/outputs")
        return { status: 200, body: { items: [], total: 0, offset: 0, limit: 200 } };
      return { status: 404, body: { message: "not found" } };
    });
    const h = await connectMcp(fake);
    try {
      const result = await h.client.callTool({ name: "get_workspace_context", arguments: {} });
      const text = resultText(result);
      if (result.isError) throw new Error(text);
      const context = JSON.parse(text);
      expect(
        seen
          .filter((s) => s.path === "/api/dashboards")
          .every((s) => new URLSearchParams(s.search).get("include") === "shared"),
      ).toBe(true);
      expect(
        context.dashboards.map((d: { id: string; accessRole: string }) => [d.id, d.accessRole]),
      ).toEqual([
        ["d1", "viewer"],
        ["d2", "owner"],
      ]);
    } finally {
      await h.close();
    }
  });
});
