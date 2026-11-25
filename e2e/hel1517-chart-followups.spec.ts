import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

import { expect, test, type APIRequestContext, type Locator } from "@playwright/test";

import { currentUserId, registerUser } from "./support/auth";
import { evidencePath } from "./support/evidencePath";
import { loginThenIsolate } from "./support/isolateLivePage";

// HEL-1517 -- follow-ups to HEL-1508 on a live dashboard, light + dark, desktop + 375px:
//   * a daily time axis never ticks finer than a day (live `minInterval`, every live tick on a day boundary);
//   * a line with markers off DRAWS a marker on a value that stands alone between gaps (rendered, not just
//     present in the option: an unregistered markPoint component is dropped silently);
//   * rows sharing a time and series are summed, and the footnote says how many.
// Every created id is logged, appended to HEL1517_IDS_FILE (when set) the moment it exists, and deleted
// by exact id in `finally`.

const CSRF = { "X-Helio-Requested-With": "1" };
const IDS_FILE = process.env.HEL1517_IDS_FILE;
const DAY = 86_400_000;

function recordId(kind: string, id: string) {
  console.log(`[HEL-1517 e2e] created ${kind} ${id}`);
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
      console.log(`[HEL-1517 e2e] DELETE ${url} -> ${res.status()}`);
      return;
    }
    await new Promise((r) => setTimeout(r, 11_000));
  }
}

/** Runs `fn` against the ECharts instance of the first canvas inside `card`. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the live ECharts instance is untyped here
async function withChart<T>(card: Locator, fn: (chart: any) => T): Promise<T> {
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

// Daily data: two rows of series A on 09-01 (summed to 7), then single values between gaps.
const ROWS: Array<Array<string | null>> = [
  ["2026-09-01", "4", "A"],
  ["2026-09-01", "3", "A"],
  ["2026-09-02", "n/a", "A"],
  ["2026-09-03", "5", "A"],
  ["2026-09-04", "n/a", "A"],
  ["2026-09-05", "2", "A"],
];
const SUM_NOTE = "2 rows with the same time and series were added together.";

for (const { theme, width } of CASES) {
  const label = `${theme}-${width}`;
  test(`chart follow-ups render on a dashboard (${label})`, async ({ page, request }) => {
    test.setTimeout(300_000);
    page.setDefaultTimeout(20_000);
    await page.setViewportSize({ width: 1440, height: 1300 });
    await page.addInitScript((t) => window.localStorage.setItem("helio-theme", t as string), theme);
    const credentials = await registerUser(request, {
      prefix: "hel1517-exec",
      displayName: "HEL-1517",
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
          name: `HEL-1517 ${label}`,
          type: "static",
          columns: [
            { name: "day", type: "timestamp" },
            { name: "value", type: "string" },
            { name: "region", type: "string" },
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
        { name: `HEL-1517 ${label}`, roots: [{ sourceId: source.id }] },
        201,
      );
      created.pipeline = pipeline.id;
      recordId("pipeline", pipeline.id);
      const output = async (name: string, config: Record<string, unknown>) => {
        const out = await postJson<{ id: string }>(
          request,
          `/api/pipelines/${pipeline.id}/outputs`,
          { kind: "chart", name, config: { aggregation: null, chartType: "line", ...config } },
          201,
        );
        recordId("output", out.id);
        return out.id;
      };
      const outputs: Array<[string, string]> = [
        [
          "HEL-1517 PMarks",
          await output("HEL-1517 Marks", {
            fieldMapping: { xAxis: "day", yAxis: "value" },
            chartOptions: { line: { showPoints: false } },
          }),
        ],
        [
          "HEL-1517 PSum",
          await output("HEL-1517 Sum", {
            fieldMapping: { xAxis: "day", yAxis: "value", series: "region" },
          }),
        ],
      ];
      const dashboard = await postJson<{ id: string }>(
        request,
        "/api/dashboards",
        { name: `HEL-1517 ${label}` },
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
      await page.getByText(`HEL-1517 ${label}`).first().click();
      if (width === 375) {
        await page.setViewportSize({ width: 375, height: 900 });
        await expect(page.locator(".mobile-panel-stack:not([aria-hidden='true'] *)")).toBeVisible();
      }
      const card = (title: string) =>
        page
          .locator(width === 375 ? ".mobile-panel-stack__item" : "article", { hasText: title })
          .first();
      const marks = card("HEL-1517 PMarks");
      const sum = card("HEL-1517 PSum");
      for (const c of [marks, sum]) {
        await c.scrollIntoViewIfNeeded();
        await expectRendered(c);
      }
      await page.waitForTimeout(1500);

      // 1. A daily time axis: live minInterval is one day and every live tick is on a day boundary.
      await marks.scrollIntoViewIfNeeded();
      const axis = await withChart(marks, (chart) => {
        const opt = chart.getOption();
        const scale = chart.getModel().getComponent("xAxis", 0).axis.scale;
        return {
          type: opt.xAxis?.[0]?.type,
          minInterval: opt.xAxis?.[0]?.minInterval,
          ticks: scale.getTicks().map((t: { value: number }) => t.value),
        };
      });
      console.log(`[HEL-1517 e2e] ${label} axis ${JSON.stringify(axis)}`);
      expect(axis!.type).toBe("time");
      expect(axis!.minInterval).toBe(DAY);
      expect(axis!.ticks.length).toBeGreaterThan(0);
      for (const t of axis!.ticks) expect(t % DAY).toBe(0);

      // 2. Markers off: the isolated values (09-03 = 5 and 09-05 = 2) are DRAWN. The markPoint
      // component model holds them, and a zrender symbol is on the canvas at each one's pixel.
      const drawn = await withChart(marks, (chart) => {
        const series = chart.getModel().getSeriesByIndex(0);
        const data = (series.get("markPoint")?.data ?? []) as Array<{ coord: [number, number] }>;
        type El = {
          type?: string;
          getBoundingRect?: () => { x: number; y: number; width: number; height: number };
          transform?: number[] | null;
          parent?: unknown;
          style?: { stroke?: unknown; fill?: unknown };
          shape?: unknown;
          invisible?: boolean;
        };
        const list = chart.getZr().storage.getDisplayList(true) as El[];
        const near = (px: number[]) =>
          list.filter((e) => {
            if (e.type === "line" || e.type === "text" || e.invisible) return false;
            const r = e.getBoundingRect?.();
            if (!r) return false;
            const m = e.transform ?? [1, 0, 0, 1, 0, 0];
            const cx = m[0] * (r.x + r.width / 2) + m[2] * (r.y + r.height / 2) + m[4];
            const cy = m[1] * (r.x + r.width / 2) + m[3] * (r.y + r.height / 2) + m[5];
            return Math.abs(cx - px[0]) <= 3 && Math.abs(cy - px[1]) <= 3;
          });
        return {
          coords: data.map((d) => d.coord),
          pixels: data.map((d) => chart.convertToPixel({ seriesIndex: 0 }, d.coord)),
          nearby: data.map((d) =>
            near(chart.convertToPixel({ seriesIndex: 0 }, d.coord)).map((e) => ({
              type: e.type,
              stroke: e.style?.stroke,
              fill: e.style?.fill,
            })),
          ),
        };
      });
      console.log(`[HEL-1517 e2e] ${label} marks ${JSON.stringify(drawn)}`);
      expect(drawn!.coords).toEqual([
        [Date.parse("2026-09-03T00:00:00Z"), 5],
        [Date.parse("2026-09-05T00:00:00Z"), 2],
      ]);
      // One ringed (stroked, non-line) symbol is on the canvas at each marker's pixel, in the series colour.
      for (const symbols of drawn!.nearby) {
        expect(symbols).toHaveLength(1);
        expect(symbols[0].type).toBe("path");
        expect(typeof symbols[0].stroke).toBe("string");
      }

      // 3. Summed rows: series A plots 7 at 09-01 and the footnote counts the two rows.
      const a = await withChart(sum, (chart) =>
        (chart.getOption().series?.[0]?.data ?? []).map((d: { value: unknown[] }) => d.value[1]),
      );
      console.log(`[HEL-1517 e2e] ${label} sum series A ${JSON.stringify(a)}`);
      expect(a![0]).toBe(7);
      await expect(sum.locator(".chart-panel__skipped-note")).toHaveText(SUM_NOTE);

      for (const [key, c] of [
        ["marks", marks],
        ["sum", sum],
      ] as const) {
        await c.scrollIntoViewIfNeeded();
        await c.screenshot({ path: evidencePath("HEL-1517", `${key}-${label}.png`) });
      }
    } finally {
      if (created.dashboard) await deleteExact(request, `/api/dashboards/${created.dashboard}`);
      if (created.pipeline) await deleteExact(request, `/api/pipelines/${created.pipeline}`);
      if (created.source) await deleteExact(request, `/api/data-sources/${created.source}`);
    }
  });
}
