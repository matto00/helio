import { expect, test, type APIRequestContext, type Locator } from "@playwright/test";

import { evidencePath } from "./support/evidencePath";
import { currentUserId, registerUser } from "./support/auth";
import { loginThenIsolate } from "./support/isolateLivePage";

// HEL-1487 — heatmap and histogram category axes show every label that fits and never overlap when
// they do not, read from the RENDERED chart (ECharts 6.1.0 per frontend/package-lock.json; the probe
// reads the axis views' label elements, so an ECharts upgrade must re-check it). Light + dark, 1440
// and 375. Every created id is logged and deleted by exact id in `finally`.

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

interface AxisLabels {
  /** Text of every label element ECharts left visible (not `ignore`d by `hideOverlap`). */
  shown: string[];
  /** Pairs of shown labels whose global bounding boxes intersect. */
  overlaps: string[];
}

/** Rendered labels of one axis ("xAxis" | "yAxis") of the first chart inside `card`. */
async function axisLabels(card: Locator, axis: "xAxis" | "yAxis"): Promise<AxisLabels> {
  return card
    .locator("canvas")
    .first()
    .evaluate((canvas, which) => {
      type El = {
        ignore?: boolean;
        style?: { text?: string };
        children?: () => El[];
        getBoundingRect?: () => { x: number; y: number; width: number; height: number };
        getComputedTransform?: () => number[] | null;
      };
      type AxisView = {
        _axisGroup?: El;
        __model?: { axis?: { dim?: string } };
      };
      type Fiber = { stateNode?: { getEchartsInstance?: () => unknown } | null; return?: Fiber };
      let chart: { _componentsViews: AxisView[] } | null = null;
      for (let host: Element | null = canvas; host && !chart; host = host.parentElement) {
        const key = Object.keys(host).find((k) => k.startsWith("__reactFiber$"));
        let f: Fiber | null | undefined = key
          ? (host as unknown as Record<string, Fiber>)[key]
          : null;
        while (f && !chart) {
          if (f.stateNode && typeof f.stateNode.getEchartsInstance === "function") {
            chart = f.stateNode.getEchartsInstance() as typeof chart;
          }
          f = f.return;
        }
      }
      // Both axes' views report the same `type`; the axis dimension is what tells them apart.
      const dim = which === "xAxis" ? "x" : "y";
      const view = chart!._componentsViews.find((v) => v.__model?.axis?.dim === dim);
      const found: Array<{ text: string; box: number[] }> = [];
      const walk = (el: El) => {
        if (el.ignore) return;
        if (el.style?.text && el.getBoundingRect) {
          const r = el.getBoundingRect();
          const m = el.getComputedTransform?.() ?? [1, 0, 0, 1, 0, 0];
          const xs = [r.x, r.x + r.width].map((x) => m[0] * x + m[4]);
          const ys = [r.y, r.y + r.height].map((y) => m[3] * y + m[5]);
          found.push({
            text: el.style.text,
            box: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)],
          });
        }
        el.children?.().forEach(walk);
      };
      if (view?._axisGroup) walk(view._axisGroup);
      // Axis NAME text is not a tick label; with no axis name set, every text element is a label.
      const overlaps: string[] = [];
      found.forEach((a, i) =>
        found.slice(i + 1).forEach((b) => {
          const hit =
            a.box[0] < b.box[2] - 0.5 &&
            b.box[0] < a.box[2] - 0.5 &&
            a.box[1] < b.box[3] - 0.5 &&
            b.box[1] < a.box[3] - 0.5;
          if (hit) overlaps.push(`${a.text} | ${b.text}`);
        }),
      );
      return { shown: found.map((f) => f.text), overlaps };
    }, axis);
}

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const TESTS = ["testA", "testB", "testC"];
const HIST_ROWS = 40;

for (const { theme, width } of [
  { theme: "light", width: 1440 },
  { theme: "dark", width: 1440 },
  { theme: "light", width: 375 },
  { theme: "dark", width: 375 },
] as const) {
  const label = `${theme}-${width}`;
  test(`heatmap and histogram axes show every label that fits (${label})`, async ({
    page,
    request,
  }) => {
    test.setTimeout(180_000);
    page.setDefaultTimeout(20_000);
    await page.setViewportSize({ width: 1440, height: 1300 });
    await page.addInitScript((t) => window.localStorage.setItem("helio-theme", t), theme);
    const credentials = await registerUser(request, {
      prefix: `hel1487-${label}`,
      displayName: "HEL-1487",
      logEmail: false,
    });
    console.log(`[HEL-1487 e2e] created user ${await currentUserId(request)}`);
    await loginThenIsolate(page, credentials);

    const created: { source?: string; pipeline?: string; dashboard?: string } = {};
    try {
      const rows: (string | number)[][] = [];
      DAYS.forEach((day, d) =>
        TESTS.forEach((test, t) => rows.push([day, test, d + t + 1, (d * 3 + t) * 5 + 10])),
      );
      for (let i = rows.length; i < HIST_ROWS; i += 1) rows.push(["Mon", "testA", 1, 10 + i]);
      const source = await postJson<{ id: string }>(
        request,
        "/api/data-sources",
        {
          name: `HEL-1487 ${label}`,
          type: "static",
          columns: [
            { name: "day", type: "string" },
            { name: "test", type: "string" },
            { name: "failures", type: "integer" },
            { name: "duration", type: "integer" },
          ],
          rows,
        },
        201,
      );
      created.source = source.id;
      const pipeline = await postJson<{ id: string }>(
        request,
        "/api/pipelines",
        { name: `HEL-1487 pipeline ${label}`, roots: [{ sourceId: source.id }] },
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
      const heat = await output("HEL-1487 Heat", {
        chartType: "heatmap",
        aggregation: null,
        fieldMapping: { xAxis: "day", series: "test", yAxis: "failures" },
      });
      const hist5 = await output("HEL-1487 Hist5", {
        chartType: "histogram",
        aggregation: null,
        fieldMapping: { xAxis: "duration" },
        chartOptions: { histogram: { binCount: 5 } },
      });
      const hist10 = await output("HEL-1487 Hist10", {
        chartType: "histogram",
        aggregation: null,
        fieldMapping: { xAxis: "duration" },
        chartOptions: { histogram: { binCount: 10 } },
      });
      const hist12 = await output("HEL-1487 Hist12", {
        chartType: "histogram",
        aggregation: null,
        fieldMapping: { xAxis: "duration" },
        chartOptions: { histogram: { binCount: 12 } },
      });
      const dashboard = await postJson<{ id: string }>(
        request,
        "/api/dashboards",
        { name: `HEL-1487 ${label}` },
        201,
      );
      created.dashboard = dashboard.id;
      console.log(
        `[HEL-1487 e2e] created source ${source.id} pipeline ${pipeline.id} dashboard ${dashboard.id}`,
      );
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
          panels: [
            ["HEL-1487 PanelHeat", heat.id],
            ["HEL-1487 PanelHist5", hist5.id],
            ["HEL-1487 PanelHist10", hist10.id],
            ["HEL-1487 PanelHist12", hist12.id],
          ].map(([title, outputId]) => ({ title, type: "output", config: { outputId } })),
        },
        201,
      );
      await postJson(
        request,
        `/api/dashboards/${dashboard.id}/auto-layout`,
        { items: batch.panels.map((p) => ({ panelId: p.id, w: 12, h: 5 })) },
        200,
      );

      await page.goto("/");
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      await page.getByText(`HEL-1487 ${label}`).first().click();
      if (width === 375) {
        await page.setViewportSize({ width: 375, height: 900 });
        await expect(page.locator(".mobile-panel-stack")).toBeVisible();
      }
      const card = (title: string) =>
        page
          .locator(width === 375 ? ".mobile-panel-stack__item" : "article", { hasText: title })
          .first();
      const cards = {
        heat: card("HEL-1487 PanelHeat"),
        hist5: card("HEL-1487 PanelHist5"),
        hist10: card("HEL-1487 PanelHist10"),
        hist12: card("HEL-1487 PanelHist12"),
      };
      for (const c of Object.values(cards)) {
        await expect(c.locator("canvas").first()).toBeVisible({ timeout: 15_000 });
        await c.scrollIntoViewIfNeeded();
      }
      await page.waitForTimeout(1500); // the series' entry animation

      const read = {
        heatX: await axisLabels(cards.heat, "xAxis"),
        heatY: await axisLabels(cards.heat, "yAxis"),
        hist5: await axisLabels(cards.hist5, "xAxis"),
        hist10: await axisLabels(cards.hist10, "xAxis"),
        hist12: await axisLabels(cards.hist12, "xAxis"),
      };
      console.log(`[HEL-1487 e2e] ${label} rendered labels ${JSON.stringify(read)}`);
      for (const [name, c] of Object.entries(cards)) {
        await c.screenshot({ path: evidencePath("HEL-1487", `${name}-${label}.png`) });
      }

      for (const [name, r] of Object.entries(read)) {
        expect(r.overlaps, `${name} labels overlap`).toEqual([]);
      }
      if (width === 1440) {
        expect(read.heatX.shown).toEqual(DAYS);
        expect(read.heatY.shown).toEqual(TESTS);
        expect(read.hist5.shown).toHaveLength(5);
        expect(read.hist10.shown).toHaveLength(10);
      }
      // Whatever is shown, every shown bin label uses one number of decimal places.
      const places = new Set(
        read.hist12.shown.flatMap((l) =>
          l.split(" to ").map((n) => (n.split(".")[1] ?? "").length),
        ),
      );
      expect(places.size, `bin label decimals ${[...places]}`).toBe(1);
    } finally {
      console.log(
        `[HEL-1487 e2e] deleting dashboard ${created.dashboard} pipeline ${created.pipeline} source ${created.source}`,
      );
      if (created.dashboard)
        await request.delete(`/api/dashboards/${created.dashboard}`, { headers: CSRF });
      if (created.pipeline)
        await request.delete(`/api/pipelines/${created.pipeline}`, { headers: CSRF });
      if (created.source)
        await request.delete(`/api/data-sources/${created.source}`, { headers: CSRF });
    }
  });
}
