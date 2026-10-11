import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

import { expect, test, type APIRequestContext, type Locator } from "@playwright/test";

import { currentUserId, registerUser } from "./support/auth";
import { evidencePath } from "./support/evidencePath";
import { loginThenIsolate } from "./support/isolateLivePage";

// HEL-1305 -- charts over a timestamp x field on a live dashboard, light + dark, desktop + 375px.
//   * irregular days are spaced in proportion to the time between them (measured in rendered pixels);
//   * a series that misses a day plots a gap (null), never 0, and its tooltip reads an em dash;
//   * the "vs" overlay and reference marks still draw on a time axis; a stacked bar stacks by instant;
//   * an aggregated (grouped-by-timestamp) bar and a scatter use the time axis; a string-typed x (a non-date label column; a date-looking string column would be inferred timestamp) does not.
// Every created id is logged, appended to HEL1305_IDS_FILE (when set) the moment it exists, and deleted
// by exact id in `finally`.

const CSRF = { "X-Helio-Requested-With": "1" };
const IDS_FILE = process.env.HEL1305_IDS_FILE;

function recordId(kind: string, id: string) {
  console.log(`[HEL-1305 e2e] created ${kind} ${id}`);
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
      console.log(`[HEL-1305 e2e] DELETE ${url} -> ${res.status()}`);
      return;
    }
    await new Promise((r) => setTimeout(r, 11_000));
  }
}

type SeriesOpt = { id?: string; name?: string; type?: string; stack?: string; data?: unknown[] };
type EchartsInstance = {
  getOption(): {
    series?: SeriesOpt[];
    xAxis?: Array<{ type?: string }>;
    useUTC?: boolean;
  };
  convertToPixel(finder: unknown, value: unknown): number[];
  dispatchAction(action: Record<string, unknown>): void;
  getModel(): {
    getSeriesByIndex(i: number): { getData(): { getLayout(key: string): number[] } };
  };
};

/** Runs `fn` against the ECharts instance of the first canvas inside `card`. */
async function withChart<T, A = undefined>(
  card: Locator,
  fn: (chart: EchartsInstance, canvas: HTMLCanvasElement, arg: A) => T,
  arg?: A,
): Promise<T> {
  return card
    .locator("canvas")
    .first()
    .evaluate(
      (canvas, [src, argument]) => {
        type Fiber = { stateNode?: { getEchartsInstance?: () => unknown } | null; return?: Fiber };
        let host: Element | null = canvas;
        while (host) {
          const key = Object.keys(host).find((k) => k.startsWith("__reactFiber$"));
          let f: Fiber | null | undefined = key
            ? (host as unknown as Record<string, Fiber>)[key]
            : null;
          while (f) {
            if (f.stateNode && typeof f.stateNode.getEchartsInstance === "function") {
              return new Function("chart", "canvas", "arg", `return (${src})(chart, canvas, arg)`)(
                f.stateNode.getEchartsInstance(),
                canvas,
                argument,
              );
            }
            f = f.return;
          }
          host = host.parentElement;
        }
        return null;
      },
      [fn.toString(), arg] as const,
    ) as Promise<T>;
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

// Irregular days: gaps of 1, 1, 7, 1 and 13 days. Series B has no row on 09-03 and 09-11.
const DAYS = ["2026-09-01", "2026-09-02", "2026-09-03", "2026-09-10", "2026-09-11", "2026-09-24"];
const DAY_MS = 86_400_000;
const rowsTwoSeries = [
  ...DAYS.map((d, i) => [d, "A", 10 + i * 3, `D${i + 1}`]),
  ...DAYS.filter((d) => d !== "2026-09-03" && d !== "2026-09-11").map((d, i) => [
    d,
    "B",
    4 + i,
    `D${DAYS.indexOf(d) + 1}`,
  ]),
];
const rowsSingleRun1 = DAYS.map((d, i) => [d, "A", 12 + i * 4, `D${i + 1}`]);
const rowsSingleRun2 = DAYS.map((d, i) => [d, "A", 10 + i * 4, `D${i + 1}`]);

for (const { theme, width } of CASES) {
  const label = `${theme}-${width}`;
  test(`time axis and gaps render on a dashboard (${label})`, async ({ page, request }) => {
    test.setTimeout(300_000);
    page.setDefaultTimeout(20_000);
    await page.setViewportSize({ width: 1440, height: 1300 });
    await page.addInitScript((t) => window.localStorage.setItem("helio-theme", t as string), theme);
    const credentials = await registerUser(request, {
      prefix: `hel1305-${label}`,
      displayName: "HEL-1305",
      logEmail: false,
    });
    recordId("user", await currentUserId(request));
    await loginThenIsolate(page, credentials);

    const created: { sources: string[]; pipelines: string[]; dashboard?: string } = {
      sources: [],
      pipelines: [],
    };
    try {
      const columns = [
        { name: "day", type: "timestamp" },
        { name: "series", type: "string" },
        { name: "value", type: "integer" },
        { name: "label", type: "string" },
      ];
      const makePipeline = async (name: string, rows: unknown[][]) => {
        const source = await postJson<{ id: string }>(
          request,
          "/api/data-sources",
          { name: `HEL-1305 ${name} ${label}`, type: "static", columns, rows },
          201,
        );
        created.sources.push(source.id);
        recordId("data-source", source.id);
        const pipeline = await postJson<{ id: string }>(
          request,
          "/api/pipelines",
          { name: `HEL-1305 ${name} ${label}`, roots: [{ sourceId: source.id }] },
          201,
        );
        created.pipelines.push(pipeline.id);
        recordId("pipeline", pipeline.id);
        return { source: source.id, pipeline: pipeline.id };
      };
      const multi = await makePipeline("two-series", rowsTwoSeries);
      const single = await makePipeline("single", rowsSingleRun1);
      const output = async (
        pipelineId: string,
        name: string,
        config: Record<string, unknown>,
        mapping: Record<string, string> = { xAxis: "day", yAxis: "value" },
      ) => {
        const out = await postJson<{ id: string }>(
          request,
          `/api/pipelines/${pipelineId}/outputs`,
          {
            kind: "chart",
            name,
            config: { aggregation: null, fieldMapping: mapping, ...config },
          },
          201,
        );
        recordId("output", out.id);
        return out;
      };
      const seriesMapping = { xAxis: "day", yAxis: "value", series: "series" };
      const outLine = await output(
        multi.pipeline,
        "HEL-1305 Multi line",
        { chartType: "line" },
        seriesMapping,
      );
      const outStack = await output(
        multi.pipeline,
        "HEL-1305 Stacked bar",
        { chartType: "bar", chartOptions: { bar: { stacking: "stacked" } } },
        seriesMapping,
      );
      const outString = await output(
        multi.pipeline,
        "HEL-1305 String x",
        { chartType: "line" },
        {
          xAxis: "label",
          yAxis: "value",
          series: "series",
        },
      );
      const outOverlay = await output(single.pipeline, "HEL-1305 Overlay line", {
        chartType: "line",
        compare: "previous_run",
        referenceLines: [{ value: 25, label: "Target" }],
        referenceBands: [{ from: 0, to: 15, label: "Low", tone: "success" }],
      });
      const outBar = await output(single.pipeline, "HEL-1305 Bar", { chartType: "bar" });
      const outAgg = await output(single.pipeline, "HEL-1305 Aggregated bar", {
        chartType: "bar",
        aggregation: { groupBy: "day", agg: "sum", yField: "value" },
      });
      const outScatter = await output(single.pipeline, "HEL-1305 Scatter", {
        chartType: "scatter",
      });
      const dashboard = await postJson<{ id: string }>(
        request,
        "/api/dashboards",
        { name: `HEL-1305 ${label}` },
        201,
      );
      created.dashboard = dashboard.id;
      recordId("dashboard", dashboard.id);

      const run = async (pipelineId: string) => {
        const res = await request.post(`/api/pipelines/${pipelineId}/run`, {
          data: {},
          headers: CSRF,
        });
        expect(res.status(), await res.text()).toBe(200);
      };
      await run(multi.pipeline);
      await run(single.pipeline);
      const put = await request.put(`/api/data-sources/${single.source}/rows`, {
        data: { rows: rowsSingleRun2 },
        headers: CSRF,
      });
      expect(put.status(), await put.text()).toBe(200);
      await run(single.pipeline);

      const panelDefs: Array<[string, string]> = [
        ["HEL-1305 PMulti", outLine.id],
        ["HEL-1305 PStack", outStack.id],
        ["HEL-1305 PString", outString.id],
        ["HEL-1305 POverlay", outOverlay.id],
        ["HEL-1305 PBar", outBar.id],
        ["HEL-1305 PAgg", outAgg.id],
        ["HEL-1305 PScatter", outScatter.id],
      ];
      const batch = await postJson<{ panels: { id: string; title: string }[] }>(
        request,
        "/api/panels/batch",
        {
          dashboardId: dashboard.id,
          panels: panelDefs.map(([title, outputId]) => ({
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

      await page.goto("/");
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      await page.getByText(`HEL-1305 ${label}`).first().click();
      if (width === 375) {
        await page.setViewportSize({ width: 375, height: 900 });
        await expect(page.locator(".mobile-panel-stack")).toBeVisible();
      }
      const card = (title: string) =>
        page
          .locator(width === 375 ? ".mobile-panel-stack__item" : "article", { hasText: title })
          .first();
      const cards = {
        multi: card("HEL-1305 PMulti"),
        stack: card("HEL-1305 PStack"),
        text: card("HEL-1305 PString"),
        overlay: card("HEL-1305 POverlay"),
        bar: card("HEL-1305 PBar"),
        agg: card("HEL-1305 PAgg"),
        scatter: card("HEL-1305 PScatter"),
      };
      for (const c of Object.values(cards)) {
        await c.scrollIntoViewIfNeeded();
        await expectRendered(c);
      }
      await page.waitForTimeout(1500);

      // 1. Multi-series line: a time axis, proportional spacing, and gaps (null) for series B.
      const multiInfo = await withChart(cards.multi, (chart) => {
        const opt = chart.getOption();
        const [a, b] = opt.series ?? [];
        const points = chart.getModel().getSeriesByIndex(0).getData().getLayout("points");
        const xs = points.filter((_, i) => i % 2 === 0);
        return {
          axis: opt.xAxis?.[0]?.type,
          useUTC: opt.useUTC,
          aLen: a?.data?.length,
          bValues: (b?.data ?? []).map((d) => (d as { value: unknown[] }).value[1]),
          xs,
        };
      });
      console.log(`[HEL-1305 e2e] ${label} multi ${JSON.stringify(multiInfo)}`);
      expect(multiInfo!.axis).toBe("time");
      expect(multiInfo!.useUTC).toBe(true);
      expect(multiInfo!.bValues).toEqual([4, 5, null, 6, null, 7]);
      const dayGaps = DAYS.slice(1).map((d, i) => (Date.parse(d) - Date.parse(DAYS[i])) / DAY_MS);
      const pxGaps = multiInfo!.xs.slice(1).map((x, i) => x - multiInfo!.xs[i]);
      const unit = pxGaps[0] / dayGaps[0];
      console.log(
        `[HEL-1305 e2e] ${label} day gaps ${dayGaps} px gaps ${pxGaps.map((p) => p.toFixed(1))}`,
      );
      pxGaps.forEach((px, i) => expect(px / unit).toBeCloseTo(dayGaps[i], 1));

      // 2. The gap's tooltip reads an em dash, never 0 (axis tooltip at the third x, 2026-09-03, where series B has no row).
      await cards.multi.scrollIntoViewIfNeeded();
      await withChart(cards.multi, (chart) =>
        chart.dispatchAction({ type: "showTip", seriesIndex: 0, dataIndex: 2 }),
      );
      await page.waitForTimeout(500);
      const tip = (await cards.multi.locator(".chart-tooltip").first().innerText()).replace(
        /\s+/g,
        " ",
      );
      console.log(`[HEL-1305 e2e] ${label} gap tooltip ${JSON.stringify(tip)}`);
      expect(tip).toContain("2026-09-03");
      expect(tip).toMatch(/B\s*:?\s*—/);
      await cards.multi.screenshot({
        path: evidencePath("HEL-1305", `multi-line-gap-tooltip-${label}.png`),
      });

      // 3. Overlay + reference marks on a time axis.
      const overlayInfo = await withChart(cards.overlay, (chart) => {
        const opt = chart.getOption();
        return {
          axis: opt.xAxis?.[0]?.type,
          names: (opt.series ?? []).map((s) => s.name ?? s.id ?? ""),
        };
      });
      console.log(`[HEL-1305 e2e] ${label} overlay ${JSON.stringify(overlayInfo)}`);
      expect(overlayInfo!.axis).toBe("time");
      expect(overlayInfo!.names.some((n) => n.startsWith("vs"))).toBe(true);
      expect(overlayInfo!.names).toContain("__helio_reference_marks__");
      await cards.overlay.scrollIntoViewIfNeeded();
      await cards.overlay.screenshot({
        path: evidencePath("HEL-1305", `overlay-refmarks-${label}.png`),
      });

      // 4. Stacked bar on a time axis: one stack, equal-length series, drawn.
      const stackInfo = await withChart(cards.stack, (chart) => {
        const opt = chart.getOption();
        return {
          axis: opt.xAxis?.[0]?.type,
          stacks: (opt.series ?? []).map((s) => s.stack),
          lens: (opt.series ?? []).map((s) => s.data?.length),
        };
      });
      console.log(`[HEL-1305 e2e] ${label} stacked ${JSON.stringify(stackInfo)}`);
      expect(stackInfo!.axis).toBe("time");
      expect(new Set(stackInfo!.stacks)).toEqual(new Set(["total"]));
      expect(new Set(stackInfo!.lens).size).toBe(1);
      await cards.stack.scrollIntoViewIfNeeded();
      await cards.stack.screenshot({ path: evidencePath("HEL-1305", `stacked-bar-${label}.png`) });

      // 5. Bar, aggregated bar, scatter use a time axis; the string-typed x keeps a category axis.
      for (const [key, expected] of [
        ["bar", "time"],
        ["agg", "time"],
        ["scatter", "time"],
        ["text", "category"],
      ] as const) {
        const axis = await withChart(cards[key], (chart) => chart.getOption().xAxis?.[0]?.type);
        console.log(`[HEL-1305 e2e] ${label} ${key} axis ${axis}`);
        expect(axis).toBe(expected);
        await cards[key].scrollIntoViewIfNeeded();
        await cards[key].screenshot({ path: evidencePath("HEL-1305", `${key}-${label}.png`) });
      }
    } finally {
      if (created.dashboard) await deleteExact(request, `/api/dashboards/${created.dashboard}`);
      for (const id of created.pipelines) await deleteExact(request, `/api/pipelines/${id}`);
      for (const id of created.sources) await deleteExact(request, `/api/data-sources/${id}`);
    }
  });
}

// An intra-day (hourly) and a month-span timestamp line at 375px: the time axis must not run its
// labels together (`axisLabel.hideOverlap`), light and dark.
for (const theme of ["light", "dark"] as const) {
  test(`time-axis labels stay legible at 375px (${theme})`, async ({ page, request }) => {
    test.setTimeout(240_000);
    page.setDefaultTimeout(20_000);
    await page.setViewportSize({ width: 1440, height: 1300 });
    await page.addInitScript((t) => window.localStorage.setItem("helio-theme", t as string), theme);
    const credentials = await registerUser(request, {
      prefix: `hel1305-labels-${theme}`,
      displayName: "HEL-1305",
      logEmail: false,
    });
    recordId("user", await currentUserId(request));
    await loginThenIsolate(page, credentials);

    const created: { sources: string[]; pipelines: string[]; dashboard?: string } = {
      sources: [],
      pipelines: [],
    };
    try {
      const columns = [
        { name: "ts", type: "timestamp" },
        { name: "value", type: "integer" },
      ];
      const hourly = Array.from({ length: 28 }, (_, i) => [
        new Date(Date.UTC(2026, 8, 1, 8 + i)).toISOString(),
        10 + ((i * 7) % 13),
      ]);
      const monthly = Array.from({ length: 11 }, (_, i) => [
        new Date(Date.UTC(2026, 1 + i, 1)).toISOString(),
        20 + ((i * 5) % 11),
      ]);
      const outputs: Array<[string, string]> = [];
      for (const [name, rows] of [
        ["Hourly", hourly],
        ["Monthly", monthly],
      ] as const) {
        const source = await postJson<{ id: string }>(
          request,
          "/api/data-sources",
          { name: `HEL-1305 ${name} ${theme}`, type: "static", columns, rows },
          201,
        );
        created.sources.push(source.id);
        recordId("data-source", source.id);
        const pipeline = await postJson<{ id: string }>(
          request,
          "/api/pipelines",
          { name: `HEL-1305 ${name} ${theme}`, roots: [{ sourceId: source.id }] },
          201,
        );
        created.pipelines.push(pipeline.id);
        recordId("pipeline", pipeline.id);
        const out = await postJson<{ id: string }>(
          request,
          `/api/pipelines/${pipeline.id}/outputs`,
          {
            kind: "chart",
            name: `HEL-1305 ${name}`,
            config: {
              aggregation: null,
              fieldMapping: { xAxis: "ts", yAxis: "value" },
              chartType: "line",
            },
          },
          201,
        );
        recordId("output", out.id);
        const run = await request.post(`/api/pipelines/${pipeline.id}/run`, {
          data: {},
          headers: CSRF,
        });
        expect(run.status(), await run.text()).toBe(200);
        outputs.push([`HEL-1305 P${name}`, out.id]);
      }
      const dashboard = await postJson<{ id: string }>(
        request,
        "/api/dashboards",
        { name: `HEL-1305 labels ${theme}` },
        201,
      );
      created.dashboard = dashboard.id;
      recordId("dashboard", dashboard.id);
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

      await page.goto("/");
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      await page.getByText(`HEL-1305 labels ${theme}`).first().click();
      await page.setViewportSize({ width: 375, height: 900 });
      await expect(page.locator(".mobile-panel-stack")).toBeVisible();
      for (const name of ["Hourly", "Monthly"]) {
        const card = page
          .locator(".mobile-panel-stack__item", { hasText: `HEL-1305 P${name}` })
          .first();
        await card.scrollIntoViewIfNeeded();
        await expectRendered(card);
        await page.waitForTimeout(1500);
        const info = await withChart(card, (chart) => {
          const x = chart.getOption().xAxis?.[0] as {
            type?: string;
            axisLabel?: { hideOverlap?: boolean };
          };
          return { type: x?.type, hideOverlap: x?.axisLabel?.hideOverlap };
        });
        console.log(`[HEL-1305 e2e] labels ${theme} ${name} ${JSON.stringify(info)}`);
        expect(info).toEqual({ type: "time", hideOverlap: true });
        await card.screenshot({
          path: evidencePath("HEL-1305", `labels-${name.toLowerCase()}-${theme}-375.png`),
        });
      }
    } finally {
      if (created.dashboard) await deleteExact(request, `/api/dashboards/${created.dashboard}`);
      for (const id of created.pipelines) await deleteExact(request, `/api/pipelines/${id}`);
      for (const id of created.sources) await deleteExact(request, `/api/data-sources/${id}`);
    }
  });
}
