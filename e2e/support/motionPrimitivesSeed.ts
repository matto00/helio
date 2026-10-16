import { expect, type APIRequestContext, type Page } from "@playwright/test";

import { CSRF_HEADER } from "./auth";
import type { Mode, Theme } from "./motionRecorder";

const json = { [CSRF_HEADER]: "1" };

export async function post<T>(request: APIRequestContext, url: string, data: unknown): Promise<T> {
  const res = await request.post(url, { data, headers: json });
  expect(res.status(), `${url} ${await res.text()}`).toBeLessThan(300);
  return (await res.json()) as T;
}

/** Four plain dashboards for the list, then a primary one (selected on /home) with a metric, a chart and a table. */
export async function seedWorld(request: APIRequestContext, tag: string) {
  for (const name of ["Alpha", "Beta", "Gamma", "Delta"]) {
    await post(request, "/api/dashboards", { name: `${tag} ${name}` });
  }
  const dash = await post<{ id: string }>(request, "/api/dashboards", { name: `${tag} Primary` });
  const source = await post<{ id: string }>(request, "/api/data-sources", {
    name: `${tag} source`,
    type: "static",
    columns: [
      { name: "region", type: "string", required: true },
      { name: "amount", type: "integer", required: true },
    ],
    rows: [
      ["East", 500],
      ["West", 575],
      ["North", 320],
      ["South", 410],
    ],
  });
  const pipeline = await post<{ id: string }>(request, "/api/pipelines", {
    name: `${tag} pipeline`,
    roots: [{ sourceId: source.id }],
  });
  const output = (kind: string, name: string, config: unknown) =>
    post<{ id: string }>(request, `/api/pipelines/${pipeline.id}/outputs`, { kind, name, config });
  const metric = await output("metric", `${tag} metric`, {
    fieldMapping: {},
    aggregation: { value: "amount", agg: "sum" },
    format: "integer",
  });
  const chart = await output("chart", `${tag} chart`, {
    chartType: "bar",
    fieldMapping: { xAxis: "region", yAxis: "amount" },
  });
  const table = await output("table", `${tag} table`, {});
  await post(request, `/api/pipelines/${pipeline.id}/run`, {});
  const panel = (title: string, outputId: string) =>
    post<{ id: string }>(request, "/api/panels", {
      dashboardId: dash.id,
      title,
      type: "output",
      config: { outputId },
    });
  const m = await panel(`${tag} Metric`, metric.id);
  const c = await panel(`${tag} Chart`, chart.id);
  const t = await panel(`${tag} Table`, table.id);
  const lg = [
    { panelId: m.id, x: 0, y: 0, w: 3, h: 4 },
    { panelId: c.id, x: 3, y: 0, w: 9, h: 6 },
    { panelId: t.id, x: 0, y: 6, w: 12, h: 5 },
  ];
  const stacked = (maxW: number) =>
    lg.map((i, n) => ({ ...i, x: 0, y: n * 6, w: Math.min(i.w + 1, maxW) }));
  const upd = await request.patch(`/api/dashboards/${dash.id}/update`, {
    data: {
      fields: ["layout"],
      dashboard: { layout: { lg, md: stacked(10), sm: stacked(2), xs: stacked(2) } },
    },
    headers: json,
  });
  expect(upd.status(), await upd.text()).toBe(200);
  return { dashboardId: dash.id, sourceId: source.id, pipelineId: pipeline.id };
}

export async function setMotion(request: APIRequestContext, mode: Mode) {
  const motion = mode === "os-reduce" ? null : mode;
  const res = await request.patch("/api/users/me/preferences", { data: { motion }, headers: json });
  expect(res.status()).toBe(200);
}

export async function setTheme(page: Page, theme: Theme) {
  await page.goto("/settings");
  await page.evaluate((value) => window.localStorage.setItem("helio-theme", value), theme);
}
