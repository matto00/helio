import { expect, type APIRequestContext } from "@playwright/test";

import { CSRF_HEADER } from "./auth";

// HEL-1392 — seeds one dashboard of eight Output-bound panels that stress the remount-reuse
// predicate: plain tables, a pie and a bar chart, tables with a PERSISTED `columnSort` default, and
// tables carrying a viewer control that the spec activates through the URL.

async function post<T>(request: APIRequestContext, url: string, data: unknown): Promise<T> {
  const res = await request.post(url, { data, headers: { [CSRF_HEADER]: "1" } });
  expect(res.status(), `${url} ${await res.text()}`).toBeLessThan(300);
  return (await res.json()) as T;
}

export interface BurstSeed {
  dashboardId: string;
  sourceId: string;
  pipelineIds: string[];
  outputIds: string[];
  panelIds: Record<string, string>;
  controlPanelIds: string[];
  piePanelTitle: string;
  /** Every id this seed created, for exact-id cleanup and for the evidence log. */
  created: { dashboard: string; pipelines: string[]; source: string };
}

export async function seedBurstDashboard(request: APIRequestContext): Promise<BurstSeed> {
  const dash = await post<{ id: string }>(request, "/api/dashboards", { name: "HEL-1392 burst" });
  const source = await post<{ id: string }>(request, "/api/data-sources", {
    name: "HEL-1392 Source",
    type: "static",
    columns: [
      { name: "region", type: "string", required: true },
      { name: "revenue", type: "integer", required: true },
    ],
    rows: [
      ["East", 100],
      ["East", 120],
      ["West", 150],
      ["West", 90],
      ["North", 70],
      ["South", 60],
    ],
  });
  const pipeline = await post<{ id: string }>(request, "/api/pipelines", {
    name: "HEL-1392 Pipeline",
    roots: [{ sourceId: source.id }],
  });
  const mk = (kind: string, name: string, config: unknown) =>
    post<{ id: string }>(request, `/api/pipelines/${pipeline.id}/outputs`, { kind, name, config });
  const defs: { key: string; kind: string; config: unknown; controls?: boolean }[] = [
    { key: "T1", kind: "table", config: {} },
    { key: "T2", kind: "table", config: {} },
    {
      key: "C1",
      kind: "chart",
      config: { chartType: "pie", fieldMapping: { xAxis: "region", yAxis: "revenue" } },
    },
    {
      key: "C2",
      kind: "chart",
      config: { chartType: "bar", fieldMapping: { xAxis: "region", yAxis: "revenue" } },
    },
    { key: "S1", kind: "table", config: { columnSort: { key: "revenue", direction: "desc" } } },
    { key: "S2", kind: "table", config: { columnSort: { key: "revenue", direction: "asc" } } },
    { key: "K1", kind: "table", config: {}, controls: true },
    { key: "K2", kind: "table", config: {}, controls: true },
  ];
  const outputIds: string[] = [];
  const panelIds: Record<string, string> = {};
  const controlPanelIds: string[] = [];
  const outputs: { key: string; id: string; controls?: boolean }[] = [];
  for (const d of defs) {
    const o = await mk(d.kind, `HEL-1392 ${d.key}`, d.config);
    outputIds.push(o.id);
    outputs.push({ key: d.key, id: o.id, controls: d.controls });
  }
  await post(request, `/api/pipelines/${pipeline.id}/run`, {});
  for (const o of outputs) {
    const panel = await post<{ id: string }>(request, "/api/panels", {
      dashboardId: dash.id,
      title: `HEL-1392 ${o.key}`,
      type: "output",
      config: {
        outputId: o.id,
        ...(o.controls
          ? { controls: [{ id: "c1", kind: "dropdown", column: "region", label: "Region" }] }
          : {}),
      },
    });
    panelIds[o.key] = panel.id;
    if (o.controls) controlPanelIds.push(panel.id);
  }
  const patch = await request.patch(`/api/panels/${panelIds.C1}`, {
    data: {
      appearance: {
        background: "transparent",
        color: "inherit",
        transparency: 0,
        chart: {
          seriesColors: [],
          legend: { show: true, position: "top" },
          tooltip: { enabled: true },
          axisLabels: { x: { show: true }, y: { show: true } },
          chartType: "pie",
        },
      },
    },
    headers: { [CSRF_HEADER]: "1" },
  });
  expect(patch.status()).toBe(200);
  await post(request, `/api/dashboards/${dash.id}/auto-layout`, {
    items: Object.values(panelIds).map((panelId) => ({ panelId, w: 6, h: 5 })),
  });
  return {
    dashboardId: dash.id,
    sourceId: source.id,
    pipelineIds: [pipeline.id],
    outputIds,
    panelIds,
    controlPanelIds,
    piePanelTitle: "HEL-1392 C1",
    created: { dashboard: dash.id, pipelines: [pipeline.id], source: source.id },
  };
}

/** Exact-id deletion with a 429 retry, so a rate-limited cleanup never leaks a row. */
export async function deleteExact(request: APIRequestContext, url: string): Promise<number> {
  let status = 0;
  for (let attempt = 0; attempt < 8; attempt++) {
    const res = await request.delete(url, { headers: { [CSRF_HEADER]: "1" } });
    status = res.status();
    if (status !== 429) return status;
    await new Promise((r) => setTimeout(r, 11_000));
  }
  return status;
}
