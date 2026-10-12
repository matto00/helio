import { expect, test, type APIRequestContext, type Locator, type Page } from "@playwright/test";

import { evidencePath } from "./support/evidencePath";
import { currentUserId, registerUser } from "./support/auth";
import { loginThenIsolate } from "./support/isolateLivePage";

// HEL-1311 — heatmap and histogram chart Outputs on a live dashboard, light + dark, desktop + 375px:
//   * the heatmap draws a matrix whose cells carry the user's accent (opacity ramp), with a visualMap
//     colour scale; the histogram draws touching bars and states how many cells it skipped;
//   * neither advertises a pointer cursor over a cell / bar (the canvas cursor, not just the option);
//   * the heatmap tooltip names the row, column and summed value.
// Every created id is logged and deleted by exact id in `finally`.

const CSRF = { "X-Helio-Requested-With": "1" };

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

type EchartsInstance = {
  getOption(): {
    series?: { type?: string; data?: unknown[] }[];
    visualMap?: { inRange?: { color?: string[] } }[];
  };
  convertToPixel(finder: unknown, value: unknown): number[];
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

async function expectRendered(card: Locator, type: string) {
  await expect(card.locator("canvas").first()).toBeVisible({ timeout: 15_000 });
  await expect
    .poll(
      async () =>
        withChart(card, (chart) => (chart.getOption().series ?? []).map((s) => s.type ?? ""))
          .then((t) => t?.join(",") ?? "")
          .catch(() => ""),
      { timeout: 15_000 },
    )
    .toContain(type);
}

const DAYS = ["Mon", "Tue", "Wed"];
const TESTS = ["testA", "testB", "testC", "testD"];

function heatmapRows(): (string | number)[][] {
  const rows: (string | number)[][] = [];
  DAYS.forEach((day, d) =>
    TESTS.forEach((test, t) => {
      if (d === 2 && t === 3) return; // an empty cell
      rows.push([day, test, (d * 4 + t) % 5 === 0 ? 1 : d * 4 + t]);
      if (d === 0 && t === 0) rows.push([day, test, 2]); // duplicate -> summed
    }),
  );
  return rows;
}

/** Moves the mouse over the centre of a plotted element and reads the resulting canvas cursor:
 *  heatmap cell (column 1, row 1), or the middle of the tallest histogram bar. */
async function cursorOverElement(page: Page, card: Locator, target: "cell" | "bar") {
  const box = await card.locator("canvas").first().boundingBox();
  const px = await withChart(
    card,
    (chart, _canvas, t) => {
      if (t === "cell") return chart.convertToPixel({ seriesIndex: 0 }, [1, 1]);
      const counts = (chart.getOption().series?.[0].data ?? []) as number[];
      const tallest = counts.indexOf(Math.max(...counts));
      return chart.convertToPixel({ seriesIndex: 0 }, [tallest, counts[tallest] / 2]);
    },
    target,
  );
  await page.mouse.move(box!.x + px[0], box!.y + px[1]);
  await page.waitForTimeout(250);
  return card
    .locator("canvas")
    .first()
    .evaluate((c) => ({
      host: getComputedStyle(c.parentElement as Element).cursor,
      canvas: getComputedStyle(c).cursor,
    }));
}

const CASES = [
  { theme: "light", width: 1440, accent: null },
  { theme: "dark", width: 1440, accent: null },
  { theme: "light", width: 375, accent: null },
  { theme: "dark", width: 375, accent: null },
  { theme: "light", width: 1440, accent: "#eab308" }, // Yellow: the palest accent on a light surface
] as const;

for (const { theme, width, accent } of CASES) {
  const label = `${theme}-${width}${accent ? "-yellow" : ""}`;
  test(`heatmap and histogram render on a dashboard (${label})`, async ({ page, request }) => {
    test.setTimeout(180_000);
    // Bounded waits: a hang must fail inside `try` (so `finally` can delete what was created), never
    // run into the test timeout.
    page.setDefaultTimeout(20_000);
    await page.setViewportSize({ width: 1440, height: 1300 }); // the dashboard is opened at desktop size
    await page.addInitScript(
      ([t, a]) => {
        window.localStorage.setItem("helio-theme", t as string);
        if (a) window.localStorage.setItem("helio-accent", a as string);
      },
      [theme, accent],
    );
    const credentials = await registerUser(request, {
      prefix: `hel1311-${label}`,
      displayName: "HEL-1311",
      logEmail: false,
    });
    const userId = await currentUserId(request);
    console.log(`[HEL-1311 e2e] created user ${userId}`);
    await loginThenIsolate(page, credentials);

    const created: { sources: string[]; pipeline?: string; dashboard?: string } = { sources: [] };
    try {
      const rows = heatmapRows().map((row, i) => [
        ...row,
        // Two unusable duration cells (a blank and a word), the rest numbers.
        i === 3 ? "n/a" : i === 5 ? "" : String(10 + ((i * 7) % 45)),
      ]);
      const source = await postJson<{ id: string }>(
        request,
        "/api/data-sources",
        {
          name: `HEL-1311 ci ${label}`,
          type: "static",
          columns: [
            { name: "day", type: "string" },
            { name: "test", type: "string" },
            { name: "failures", type: "integer" },
            { name: "duration", type: "string" },
          ],
          rows,
        },
        201,
      );
      created.sources.push(source.id);
      const pipeline = await postJson<{ id: string }>(
        request,
        "/api/pipelines",
        { name: `HEL-1311 pipeline ${label}`, roots: [{ sourceId: source.id }] },
        201,
      );
      created.pipeline = pipeline.id;
      const output = (name: string, config: unknown) =>
        postJson<{ id: string }>(
          request,
          `/api/pipelines/${pipeline.id}/outputs`,
          { kind: "chart", name, config },
          201,
        );
      const heat = await output("HEL-1311 Heatmap", {
        chartType: "heatmap",
        aggregation: null,
        compare: "7d",
        fieldMapping: { xAxis: "day", series: "test", yAxis: "failures" },
      });
      const hist = await output("HEL-1311 Histogram", {
        chartType: "histogram",
        aggregation: null,
        fieldMapping: { xAxis: "duration" },
        chartOptions: { histogram: { binCount: 5 } },
      });
      const dashboard = await postJson<{ id: string }>(
        request,
        "/api/dashboards",
        { name: `HEL-1311 ${label}` },
        201,
      );
      created.dashboard = dashboard.id;
      console.log(
        `[HEL-1311 e2e] created sources ${created.sources.join(",")} pipeline ${pipeline.id} outputs ${heat.id},${hist.id} dashboard ${dashboard.id}`,
      );
      const run = await request.post(`/api/pipelines/${pipeline.id}/run`, {
        data: {},
        headers: CSRF,
      });
      expect(run.status(), await run.text()).toBe(200);
      const batch = await postJson<{ panels: { id: string; title: string }[] }>(
        request,
        "/api/panels/batch",
        {
          dashboardId: dashboard.id,
          panels: [
            ["HEL-1311 PanelHeat", heat.id],
            ["HEL-1311 PanelHist", hist.id],
          ].map(([title, outputId]) => ({ title, type: "output", config: { outputId } })),
        },
        201,
      );
      await postJson(
        request,
        `/api/dashboards/${dashboard.id}/auto-layout`,
        { items: batch.panels.map((p) => ({ panelId: p.id, w: 6, h: 5 })) },
        200,
      );

      await page.goto("/");
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      await page.getByText(`HEL-1311 ${label}`).first().click();
      if (width === 375) {
        await page.setViewportSize({ width: 375, height: 900 });
        await expect(page.locator(".mobile-panel-stack")).toBeVisible();
      }
      const card = (title: string) =>
        page
          .locator(width === 375 ? ".mobile-panel-stack__item" : "article", { hasText: title })
          .first();
      const heatCard = card("HEL-1311 PanelHeat");
      const histCard = card("HEL-1311 PanelHist");

      await expectRendered(heatCard, "heatmap");
      await expectRendered(histCard, "bar");

      // Heatmap: a visualMap colour scale whose colours come from the accent token, never black.
      const vm = await withChart(heatCard, (chart) => chart.getOption().visualMap?.[0]?.inRange);
      expect(vm?.color?.length).toBe(2);
      expect(vm?.color?.[0]).toMatch(/^rgba\(\d+, \d+, \d+, 0\.25\)$/);
      expect(vm?.color?.[1]).toMatch(/^#[0-9a-f]{6}$/i);
      if (accent) expect(vm?.color?.[1].toLowerCase()).toBe(accent);

      await page.waitForTimeout(1500); // let the series' entry animation finish before reading pixels
      await heatCard.screenshot({ path: evidencePath("HEL-1311", `heatmap-card-${label}.png`) });
      // The lowest populated cell (value 1) must still be visibly tinted, not the card surface.
      const lowCell = await withChart(heatCard, (chart, canvas) => {
        const data = (chart.getOption().series?.[0].data ?? []) as number[][];
        const lowest = data.reduce((m, d) => (d[2] < m[2] ? d : m), data[0]);
        const px = chart.convertToPixel({ seriesIndex: 0 }, [lowest[0], lowest[1]]);
        const dpr = window.devicePixelRatio || 1;
        // Composite every canvas layer of the chart, then read the pixel.
        const flat = document.createElement("canvas");
        flat.width = canvas.width;
        flat.height = canvas.height;
        const ctx = flat.getContext("2d")!;
        canvas.parentElement!.querySelectorAll("canvas").forEach((c) => ctx.drawImage(c, 0, 0));
        const px4 = ctx.getImageData(Math.round(px[0] * dpr), Math.round(px[1] * dpr), 1, 1).data;
        return {
          rgba: Array.from(px4),
          value: lowest[2],
          px,
          dpr,
          w: canvas.width,
          h: canvas.height,
          lowest,
        };
      });
      console.log(`[HEL-1311 e2e] ${label} lowest cell ${JSON.stringify(lowCell)}`);
      const [r, g, b, a] = lowCell!.rgba;
      expect(a, "the lowest cell is painted").toBeGreaterThan(0);
      expect(
        Math.max(r, g, b) - Math.min(r, g, b),
        "the lowest cell is tinted, not grey",
      ).toBeGreaterThan(12);

      // The legend bar must show the colours the cells are painted with: compare its two ends with the
      // lowest / highest cells (RGBA of the composited chart canvas, so the same blend as on screen).
      const legend = await withChart(heatCard, (chart, canvas) => {
        // The continuous visualMap view keeps the gradient polygon; its global bounding box is the bar.
        type Poly = {
          getBoundingRect(): { x: number; y: number; width: number; height: number };
          getComputedTransform(): number[] | null;
        };
        const views = (
          chart as unknown as { _componentsViews: { type: string; _shapes: { inRange: Poly } }[] }
        )._componentsViews;
        const poly = views.find((v) => v.type === "visualMap.continuous")!._shapes.inRange;
        const rect = poly.getBoundingRect();
        const m = poly.getComputedTransform() ?? [1, 0, 0, 1, 0, 0];
        // The bar is rotated 90deg when horizontal: bound the transformed corners.
        const xs: number[] = [];
        const ys: number[] = [];
        for (const [cx, cy] of [
          [rect.x, rect.y],
          [rect.x + rect.width, rect.y],
          [rect.x, rect.y + rect.height],
          [rect.x + rect.width, rect.y + rect.height],
        ]) {
          xs.push(m[0] * cx + m[2] * cy + m[4]);
          ys.push(m[1] * cx + m[3] * cy + m[5]);
        }
        const info = {
          x: Math.min(...xs),
          y: Math.min(...ys),
          width: Math.max(...xs) - Math.min(...xs),
          height: Math.max(...ys) - Math.min(...ys),
        };
        const flat = document.createElement("canvas");
        flat.width = canvas.width;
        flat.height = canvas.height;
        const ctx = flat.getContext("2d")!;
        canvas.parentElement!.querySelectorAll("canvas").forEach((c) => ctx.drawImage(c, 0, 0));
        // Walk the bar's centre row; the bar is the run of painted pixels inside the layout box.
        const y = Math.round(info.y + info.height / 2);
        const row = ctx.getImageData(Math.round(info.x), y, Math.round(info.width), 1).data;
        const painted: number[][] = [];
        for (let i = 0; i < row.length; i += 4)
          if (row[i + 3] > 0) painted.push(Array.from(row.slice(i, i + 4)));
        const data = (chart.getOption().series?.[0].data ?? []) as number[][];
        const at = (d: number[]) => {
          const px = chart.convertToPixel({ seriesIndex: 0 }, [d[0], d[1]]);
          return Array.from(ctx.getImageData(Math.round(px[0]), Math.round(px[1]), 1, 1).data);
        };
        const lo = data.reduce((m, d) => (d[2] < m[2] ? d : m), data[0]);
        const hi = data.reduce((m, d) => (d[2] > m[2] ? d : m), data[0]);
        return {
          legendLow: painted[2],
          legendHigh: painted[painted.length - 3],
          cellLow: at(lo),
          cellHigh: at(hi),
        };
      });
      console.log(`[HEL-1311 e2e] ${label} legend-vs-cell ${JSON.stringify(legend)}`);
      for (const [l, c] of [
        [legend!.legendLow, legend!.cellLow],
        [legend!.legendHigh, legend!.cellHigh],
      ]) {
        expect(l, "legend end is painted").toBeDefined();
        l.forEach((v, i) =>
          expect(Math.abs(v - c[i]), `legend ${l} vs cell ${c}`).toBeLessThanOrEqual(12),
        );
      }

      // Histogram: states what it skipped.
      await expect(histCard.getByText("2 non-numeric values skipped.")).toBeVisible();

      // Cursor: never a pointer over a heatmap cell or a histogram bar.
      const heatCursor = await cursorOverElement(page, heatCard, "cell");
      console.log(`[HEL-1311 e2e] ${label} heatmap cursor ${JSON.stringify(heatCursor)}`);
      expect(heatCursor.host).not.toBe("pointer");
      expect(heatCursor.canvas).not.toBe("pointer");
      await expect(
        page.locator(".chart-tooltip", { hasText: "testB / Tue" }).first(),
      ).toBeVisible();
      await page.screenshot({
        path: evidencePath("HEL-1311", `heatmap-hover-${label}.png`),
      });
      const barCursor = await cursorOverElement(page, histCard, "bar");
      console.log(`[HEL-1311 e2e] ${label} histogram cursor ${JSON.stringify(barCursor)}`);
      expect(barCursor.host).not.toBe("pointer");
      expect(barCursor.canvas).not.toBe("pointer");

      await page.mouse.move(0, 0);
      await page.waitForTimeout(800);
      await page.screenshot({
        path: evidencePath("HEL-1311", `heatmap-histogram-${label}.png`),
        fullPage: true,
      });
    } finally {
      console.log(
        `[HEL-1311 e2e] deleting dashboard ${created.dashboard} pipeline ${created.pipeline} sources ${created.sources.join(",")}`,
      );
      if (created.dashboard)
        await request.delete(`/api/dashboards/${created.dashboard}`, { headers: CSRF });
      if (created.pipeline)
        await request.delete(`/api/pipelines/${created.pipeline}`, { headers: CSRF });
      for (const id of created.sources)
        await request.delete(`/api/data-sources/${id}`, { headers: CSRF });
    }
  });
}

// The Output editor: heatmap slot pickers and the histogram bin-count control, both themes, desktop
// and 375px. Touch targets at 375px must meet the editor's 44px rule (shared `.ui-input`/select).
for (const { theme, width } of [
  { theme: "light", width: 1440 },
  { theme: "dark", width: 1440 },
  { theme: "light", width: 375 },
  { theme: "dark", width: 375 },
] as const) {
  const label = `${theme}-${width}`;
  test(`Output editor offers heatmap and histogram controls (${label})`, async ({
    page,
    request,
  }) => {
    test.setTimeout(180_000);
    page.setDefaultTimeout(20_000);
    await page.setViewportSize({ width, height: width === 375 ? 1100 : 1300 });
    await page.addInitScript((t) => window.localStorage.setItem("helio-theme", t), theme);
    const credentials = await registerUser(request, {
      prefix: `hel1311-ed-${label}`,
      displayName: "HEL-1311",
      logEmail: false,
    });
    console.log(`[HEL-1311 e2e] created user ${await currentUserId(request)}`);
    await loginThenIsolate(page, credentials);

    const created: { source?: string; pipeline?: string } = {};
    try {
      const source = await postJson<{ id: string }>(
        request,
        "/api/data-sources",
        {
          name: `HEL-1311 editor ${label}`,
          type: "static",
          columns: [
            { name: "day", type: "string" },
            { name: "test", type: "string" },
            { name: "failures", type: "integer" },
            { name: "duration", type: "integer" },
          ],
          rows: [
            ["Mon", "a", 1, 10],
            ["Tue", "b", 2, 20],
          ],
        },
        201,
      );
      created.source = source.id;
      const pipeline = await postJson<{ id: string }>(
        request,
        "/api/pipelines",
        { name: `HEL-1311 editor pipeline ${label}`, roots: [{ sourceId: source.id }] },
        201,
      );
      created.pipeline = pipeline.id;
      const output = (name: string, config: unknown) =>
        postJson<{ id: string }>(
          request,
          `/api/pipelines/${pipeline.id}/outputs`,
          { kind: "chart", name, config },
          201,
        );
      await output("HEL-1311 Heat", {
        chartType: "heatmap",
        aggregation: null,
        fieldMapping: { xAxis: "day", series: "test", yAxis: "failures" },
      });
      await output("HEL-1311 Hist", {
        chartType: "histogram",
        aggregation: null,
        fieldMapping: { xAxis: "duration" },
        chartOptions: { histogram: { binCount: 12 } },
      });
      console.log(`[HEL-1311 e2e] created source ${source.id} pipeline ${pipeline.id}`);

      await page.goto(`/pipelines/${pipeline.id}`);
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      await page.getByRole("tab", { name: /^Outputs/ }).click();

      const minHeight = async (names: string[]) =>
        Promise.all(
          names.map(
            async (n) => (await page.getByRole("combobox", { name: n }).boundingBox())!.height,
          ),
        );

      await page.getByRole("button", { name: "Open HEL-1311 Heat output" }).click();
      await expect(page.getByRole("combobox", { name: "Columns field" })).toContainText("day");
      await expect(page.getByRole("combobox", { name: "Rows field" })).toContainText("test");
      await expect(page.getByRole("combobox", { name: "Value field" })).toContainText("failures");
      const heights = await minHeight(["Columns field", "Rows field", "Value field"]);
      console.log(`[HEL-1311 e2e] ${label} heatmap control heights ${JSON.stringify(heights)}`);
      if (width === 375) for (const h of heights) expect(h).toBeGreaterThanOrEqual(43); // 44px rule, sub-pixel layout;
      await page.screenshot({ path: evidencePath("HEL-1311", `editor-heatmap-${label}.png`) });
      await page.getByRole("button", { name: "Cancel" }).click();

      await page.getByRole("button", { name: "Open HEL-1311 Hist output" }).click();
      const bins = page.getByRole("spinbutton", { name: "Histogram bins" });
      await expect(bins).toHaveValue("12");
      const binHeight = (await bins.boundingBox())!.height;
      console.log(`[HEL-1311 e2e] ${label} bin-count height ${binHeight}`);
      if (width === 375) expect(binHeight).toBeGreaterThanOrEqual(43);
      await expect(page.getByRole("combobox", { name: "Histogram field" })).toContainText(
        "duration",
      );
      await page.screenshot({ path: evidencePath("HEL-1311", `editor-histogram-${label}.png`) });
    } finally {
      console.log(`[HEL-1311 e2e] deleting pipeline ${created.pipeline} source ${created.source}`);
      if (created.pipeline)
        await request.delete(`/api/pipelines/${created.pipeline}`, { headers: CSRF });
      if (created.source)
        await request.delete(`/api/data-sources/${created.source}`, { headers: CSRF });
    }
  });
}
