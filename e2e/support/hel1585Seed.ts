import { expect, type APIRequestContext } from "@playwright/test";

// HEL-1585: the seed for the document-never-scrolls guard. Everything goes through the supplied context (a PAT
// context, so the calls land in the PAT's rate-limit bucket, not the browser session's).

export const CSRF = { "X-Helio-Requested-With": "1" };
export const PIPELINE_COUNT = 32;
export const DASHBOARD_COUNT = 32;
export const LONG_STEPS = 24;
export const SHORT_STEPS = 2;
export const PANEL_TITLES = ["Output table", "Output metric", "Output chart"];

export interface Seeded {
  longId: string;
  shortId: string;
  dashboardId: string;
  sourceId: string;
  seedRequests: number;
}

export async function seed(api: APIRequestContext): Promise<Seeded> {
  let seedRequests = 0;
  const call = async <T>(method: "get" | "post", url: string, data?: unknown): Promise<T> => {
    seedRequests += 1;
    const res =
      method === "get" ? await api.get(url) : await api.post(url, { data, headers: CSRF });
    expect(res.status(), `${method} ${url} ${await res.text()}`).toBeLessThan(300);
    return (await res.json()) as T;
  };
  const rows = Array.from({ length: 14 }, (_, i) => [
    `2026-09-${String(i + 10).padStart(2, "0")}`,
    i % 5 === 0 ? "failed" : "success",
    260 + i * 7,
  ]);
  const source = await call<{ id: string }>("post", "/api/data-sources", {
    name: "hel1585-src",
    type: "static",
    columns: [
      { name: "date", type: "string" },
      { name: "status", type: "string" },
      { name: "duration_s", type: "integer" },
    ],
    rows,
  });
  const create = (name: string, stepCount: number, withOutputs: boolean) =>
    call<{ id: string }>("post", "/api/pipelines", {
      name,
      roots: [{ sourceId: source.id }],
      steps: Array.from({ length: stepCount }, (_, i) => ({
        clientId: `s${i}`,
        ...(i > 0 ? { parentStepId: `s${i - 1}` } : {}),
        type: "compute",
        config: { column: `calc_${i}`, expression: `$duration_s + ${i}`, type: "integer" },
      })),
      outputs: withOutputs
        ? [
            { kind: "table", name: "hel1585 table", config: {} },
            {
              kind: "metric",
              name: "hel1585 metric",
              config: { fieldMapping: { value: "duration_s" }, aggregation: { agg: "sum" } },
            },
            {
              kind: "chart",
              name: "hel1585 chart",
              config: { chartType: "bar", fieldMapping: { xAxis: "status", yAxis: "duration_s" } },
            },
          ]
        : [],
    });
  const longPipe = await create("hel1585 long steps", LONG_STEPS, true);
  const shortPipe = await create("hel1585 short steps", SHORT_STEPS, false);
  for (let i = 0; i < PIPELINE_COUNT - 2; i += 1) {
    await create(`hel1585 pipeline ${String(i).padStart(2, "0")}`, 0, false);
  }
  // Probed against the running backend: the nested list route answers `{items: [...]}` (no bare array).
  const { items: outputList } = await call<{ items: { id: string }[] }>(
    "get",
    `/api/pipelines/${longPipe.id}/outputs`,
  );
  for (let i = 0; i < DASHBOARD_COUNT - 1; i += 1) {
    await call("post", "/api/dashboards", { name: `hel1585 filler ${String(i).padStart(2, "0")}` });
  }
  const dashboard = await call<{ id: string }>("post", "/api/dashboards", {
    name: "hel1585 board",
  });
  for (let i = 0; i < PANEL_TITLES.length; i += 1) {
    await call("post", "/api/panels", {
      dashboardId: dashboard.id,
      title: PANEL_TITLES[i],
      type: "output",
      config: { outputId: outputList[i].id },
    });
  }
  return {
    longId: longPipe.id,
    shortId: shortPipe.id,
    dashboardId: dashboard.id,
    sourceId: source.id,
    seedRequests,
  };
}
