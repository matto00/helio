import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

import { expect, test, type APIRequestContext, type Locator } from "@playwright/test";

import { currentUserId, registerUser } from "./support/auth";
import { evidencePath } from "./support/evidencePath";
import { loginThenIsolate } from "./support/isolateLivePage";

// HEL-1508 -- follow-ups to the HEL-1305 time axis, on a live dashboard, light + dark, desktop + 375px:
//   * a raw-row single-series bar repeating a date falls back to a category axis with one bar per row;
//   * a time chart that left rows out says how many; a category chart and a fallback bar say nothing;
//   * a non-numeric y is a gap (null / no point): no mark and no tooltip, never a 0.
// Every created id is logged, appended to HEL1508_IDS_FILE (when set) the moment it exists, and deleted
// by exact id in `finally`.

const CSRF = { "X-Helio-Requested-With": "1" };
const IDS_FILE = process.env.HEL1508_IDS_FILE;

function recordId(kind: string, id: string) {
  console.log(`[HEL-1508 e2e] created ${kind} ${id}`);
  if (!IDS_FILE) return;
  mkdirSync(dirname(IDS_FILE), { recursive: true });
  appendFileSync(IDS_FILE, `${kind} ${id}\n`);
}

async function postJson<T>(
  request: APIRequestContext,
  url: string,
  data: unknown,
  status: number,
): Promise<T> {
  const res = await request.post(url, { data, headers: CSRF });
  expect(res.status(), `${url}: ${await res.text()}`).toBe(status);
  return (await res.json()) as T;
}

async function deleteExact(request: APIRequestContext, url: string) {
  for (let attempt = 0; attempt < 8; attempt++) {
    const res = await request.delete(url, { headers: CSRF });
    if (res.status() !== 429) {
      console.log(`[HEL-1508 e2e] DELETE ${url} -> ${res.status()}`);
      return;
    }
    await new Promise((r) => setTimeout(r, 11_000));
  }
}

type SeriesOpt = { name?: string; data?: unknown[] };
type EchartsInstance = {
  getOption(): { series?: SeriesOpt[]; xAxis?: Array<{ type?: string; data?: unknown[] }> };
  dispatchAction(action: Record<string, unknown>): void;
  getModel(): {
    getSeriesByIndex(i: number): {
      getData(): { getItemLayout(i: number): { x: number; width: number } | undefined };
    };
  };
};

/** Runs `fn` against the ECharts instance of the first canvas inside `card`. */
async function withChart<T>(card: Locator, fn: (chart: EchartsInstance) => T): Promise<T> {
  return card
    .locator("canvas")
    .first()
    .evaluate((canvas, src) => {
      type Fiber = { stateNode?: { getEchartsInstance?: () => unknown } | null; return?: Fiber };
      let host: Element | null = canvas;
      while (host) {
        const key = Object.keys(host).find((k) => k.startsWith("__reactFiber$"));
        let f: Fiber | null | undefined = key
          ? (host as unknown as Record<string, Fiber>)[key]
          : null;
        while (f) {
          if (f.stateNode && typeof f.stateNode.getEchartsInstance === "function") {
            return new Function("chart", `return (${src})(chart)`)(
              f.stateNode.getEchartsInstance(),
            );
          }
          f = f.return;
        }
        host = host.parentElement;
      }
      return null;
    }, fn.toString()) as Promise<T>;
}

async function expectRendered(card: Locator) {
  await expect(card.locator("canvas").first()).toBeVisible({ timeout: 15_000 });
  await expect
    .poll(
      async () =>
        withChart(card, (chart) => (chart.getOption().series ?? []).length)
          .then((n) => n ?? 0)
          .catch(() => 0),
      { timeout: 15_000 },
    )
    .toBeGreaterThan(0);
}

const CASES = [
  { theme: "light", width: 1440 },
  { theme: "dark", width: 1440 },
  { theme: "light", width: 375 },
  { theme: "dark", width: 375 },
] as const;

// Two rows on 2026-09-01, a non-numeric y on 09-02, and one empty x (a timestamp column rejects text).
const ROWS: Array<Array<string | null>> = [
  ["2026-09-01", "5", "a"],
  ["2026-09-01", "9", "b"],
  ["2026-09-02", "n/a", "c"],
  ["2026-09-04", "7", "d"],
  [null, "3", "e"],
];
const NOTE = "1 row with no readable date not shown.";

for (const { theme, width } of CASES) {
  const label = `${theme}-${width}`;
  test(`time-axis follow-ups render on a dashboard (${label})`, async ({ page, request }) => {
    test.setTimeout(300_000);
    page.setDefaultTimeout(20_000);
    await page.setViewportSize({ width: 1440, height: 1300 });
    await page.addInitScript((t) => window.localStorage.setItem("helio-theme", t as string), theme);
    const credentials = await registerUser(request, {
      prefix: "hel1508-exec",
      displayName: "HEL-1508",
      logEmail: false,
    });
    recordId("user", await currentUserId(request));
    await loginThenIsolate(page, credentials);

    const created: { source?: string; pipeline?: string; dashboard?: string } = {};
    try {
      const source = await postJson<{ id: string }>(
        request,
        "/api/data-sources",
        {
          name: `HEL-1508 ${label}`,
          type: "static",
          columns: [
            { name: "day", type: "timestamp" },
            { name: "value", type: "string" },
            { name: "label", type: "string" },
          ],
          rows: ROWS,
        },
        201,
      );
      created.source = source.id;
      recordId("data-source", source.id);
      const pipeline = await postJson<{ id: string }>(
        request,
        "/api/pipelines",
        { name: `HEL-1508 ${label}`, roots: [{ sourceId: source.id }] },
        201,
      );
      created.pipeline = pipeline.id;
      recordId("pipeline", pipeline.id);
      const output = async (
        name: string,
        config: Record<string, unknown>,
        mapping = { xAxis: "day", yAxis: "value" },
      ) => {
        const out = await postJson<{ id: string }>(
          request,
          `/api/pipelines/${pipeline.id}/outputs`,
          {
            kind: "chart",
            name,
            config: { aggregation: null, fieldMapping: mapping, ...config },
          },
          201,
        );
        recordId("output", out.id);
        return out.id;
      };
      const outputs: Array<[string, string]> = [
        ["HEL-1508 PBar", await output("HEL-1508 Bar", { chartType: "bar" })],
        ["HEL-1508 PLine", await output("HEL-1508 Line", { chartType: "line" })],
        ["HEL-1508 PScatter", await output("HEL-1508 Scatter", { chartType: "scatter" })],
        [
          "HEL-1508 PAgg",
          await output("HEL-1508 Agg", {
            chartType: "bar",
            aggregation: { groupBy: "day", agg: "count", yField: "value" },
          }),
        ],
        [
          "HEL-1508 PString",
          await output(
            "HEL-1508 String",
            { chartType: "line" },
            { xAxis: "label", yAxis: "value" },
          ),
        ],
      ];
      const dashboard = await postJson<{ id: string }>(
        request,
        "/api/dashboards",
        { name: `HEL-1508 ${label}` },
        201,
      );
      created.dashboard = dashboard.id;
      recordId("dashboard", dashboard.id);
      const run = await request.post(`/api/pipelines/${pipeline.id}/run`, {
        data: {},
        headers: CSRF,
      });
      expect(run.status(), await run.text()).toBe(200);
      const batch = await postJson<{ panels: { id: string }[] }>(
        request,
        "/api/panels/batch",
        {
          dashboardId: dashboard.id,
          panels: outputs.map(([title, outputId]) => ({
            title,
            type: "output",
            config: { outputId },
          })),
        },
        201,
      );
      for (const p of batch.panels) recordId("panel", p.id);
      await postJson(
        request,
        `/api/dashboards/${dashboard.id}/auto-layout`,
        { items: batch.panels.map((p) => ({ panelId: p.id, w: 6, h: 5 })) },
        200,
      );

      await page.goto("/dashboards");
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      await page.getByText(`HEL-1508 ${label}`).first().click();
      if (width === 375) {
        await page.setViewportSize({ width: 375, height: 900 });
        await expect(page.locator(".mobile-panel-stack")).toBeVisible();
      }
      const card = (title: string) =>
        page
          .locator(width === 375 ? ".mobile-panel-stack__item" : "article", { hasText: title })
          .first();
      const cards = {
        bar: card("HEL-1508 PBar"),
        line: card("HEL-1508 PLine"),
        scatter: card("HEL-1508 PScatter"),
        agg: card("HEL-1508 PAgg"),
        text: card("HEL-1508 PString"),
      };
      for (const c of Object.values(cards)) {
        await c.scrollIntoViewIfNeeded();
        await expectRendered(c);
      }
      await page.waitForTimeout(1500);
      const note = (key: keyof typeof cards) => cards[key].locator(".chart-panel__skipped-note");

      // 1. Repeated-date single-series bar: category axis, one bar per row, a gap for the n/a y, no note.
      const bar = await withChart(cards.bar, (chart) => {
        const opt = chart.getOption();
        const layout = chart.getModel().getSeriesByIndex(0).getData();
        return {
          axis: opt.xAxis?.[0]?.type,
          xs: opt.xAxis?.[0]?.data,
          values: opt.series?.[0]?.data,
          barX: [0, 1].map((i) => layout.getItemLayout(i)?.x),
        };
      });
      console.log(`[HEL-1508 e2e] ${label} bar ${JSON.stringify(bar)}`);
      expect(bar!.axis).toBe("category");
      expect(bar!.xs).toEqual(["2026-09-01", "2026-09-01", "2026-09-02", "2026-09-04", ""]);
      expect(bar!.values).toEqual([5, 9, null, 7, 3]);
      expect(bar!.barX[0]).not.toBe(bar!.barX[1]);
      await expect(note("bar")).toHaveCount(0);

      // 2. Line: time axis, the n/a y is a gap (null), the empty x is counted in the note.
      const line = await withChart(cards.line, (chart) => {
        const opt = chart.getOption();
        return {
          axis: opt.xAxis?.[0]?.type,
          ys: (opt.series?.[0]?.data ?? []).map((d) => (d as { value: unknown[] }).value[1]),
        };
      });
      console.log(`[HEL-1508 e2e] ${label} line ${JSON.stringify(line)}`);
      expect(line!.axis).toBe("time");
      expect(line!.ys).toEqual([5, 9, null, 7]);
      await expect(note("line")).toHaveText(NOTE);

      // 3. A single series' item tooltip has no target at a gap (no mark is drawn), so it shows nothing
      // rather than 0; the em dash only reaches a user through an axis tooltip (multi-series, HEL-1305).
      await cards.line.scrollIntoViewIfNeeded();
      await withChart(cards.line, (chart) =>
        chart.dispatchAction({ type: "showTip", seriesIndex: 0, dataIndex: 2 }),
      );
      await page.waitForTimeout(500);
      const tip = (await cards.line.locator(".chart-tooltip").first().innerText()).replace(
        /\s+/g,
        " ",
      );
      console.log(`[HEL-1508 e2e] ${label} gap tooltip ${JSON.stringify(tip)}`);
      expect(tip).toBe("");

      // 4. Scatter: the row with no numeric y is not drawn; the empty x is counted.
      const scatter = await withChart(cards.scatter, (chart) => ({
        axis: chart.getOption().xAxis?.[0]?.type,
        points: chart.getOption().series?.[0]?.data?.length,
      }));
      console.log(`[HEL-1508 e2e] ${label} scatter ${JSON.stringify(scatter)}`);
      expect(scatter).toEqual({ axis: "time", points: 3 });
      await expect(note("scatter")).toHaveText(NOTE);

      // 5. Aggregate grouped by the timestamp: the unreadable group is counted.
      const aggAxis = await withChart(cards.agg, (chart) => chart.getOption().xAxis?.[0]?.type);
      console.log(`[HEL-1508 e2e] ${label} agg axis ${aggAxis}`);
      expect(aggAxis).toBe("time");
      await expect(note("agg")).toHaveText(/^1 group with no readable date not shown\.$/);

      // 6. A string-typed x: category axis, y gap, no note.
      const text = await withChart(cards.text, (chart) => ({
        axis: chart.getOption().xAxis?.[0]?.type,
        values: chart.getOption().series?.[0]?.data,
      }));
      expect(text!.axis).toBe("category");
      expect(text!.values).toEqual([5, 9, null, 7, 3]);
      await expect(note("text")).toHaveCount(0);

      for (const key of ["bar", "line", "scatter", "agg", "text"] as const) {
        await cards[key].scrollIntoViewIfNeeded();
        await cards[key].screenshot({ path: evidencePath("HEL-1508", `${key}-${label}.png`) });
      }
    } finally {
      if (created.dashboard) await deleteExact(request, `/api/dashboards/${created.dashboard}`);
      if (created.pipeline) await deleteExact(request, `/api/pipelines/${created.pipeline}`);
      if (created.source) await deleteExact(request, `/api/data-sources/${created.source}`);
    }
  });
}
