import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

import { expect, test, type APIRequestContext, type Locator } from "@playwright/test";

import { currentUserId, registerUser } from "./support/auth";
import { evidencePath } from "./support/evidencePath";
import { loginThenIsolate } from "./support/isolateLivePage";
import { showOutputs } from "./support/pipelineSpine";

// HEL-1306 -- reference lines and bands on a live dashboard, light + dark, desktop + 375px.
//   * a bar chart whose threshold (95) lies ABOVE its data (max 40) draws the labelled line and a band, and
//     the value axis was widened to include it with zero kept;
//   * the marks do not change the bar width (an identical Output without marks is the control);
//   * a line chart with the "vs previous run" overlay and a NEUTRAL reference line draws both, and the
//     carrier adds no legend entry;
//   * toggling a data series in the legend does not remove the marks, and hovering a data series
//     does not fade them (read from the live ECharts display list).
// Every created id is logged, appended to the evidence file named by HEL1306_IDS_FILE (when set) the moment
// it exists, and deleted by exact id in `finally` (including after a timeout failure).

const CSRF = { "X-Helio-Requested-With": "1" };
const IDS_FILE = process.env.HEL1306_IDS_FILE;

function recordId(kind: string, id: string) {
  console.log(`[HEL-1306 e2e] created ${kind} ${id}`);
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
      console.log(`[HEL-1306 e2e] DELETE ${url} -> ${res.status()}`);
      return;
    }
    await new Promise((r) => setTimeout(r, 11_000));
  }
}

type Elem = {
  type?: string;
  style?: { stroke?: unknown; fill?: unknown; opacity?: number };
  invisible?: boolean;
};
type EchartsInstance = {
  getOption(): {
    series?: Array<{
      id?: string;
      name?: string;
      type?: string;
      markLine?: { data?: Array<{ lineStyle: { color: string } }> };
      markArea?: { data?: Array<Array<{ itemStyle?: { color: string } }>> };
    }>;
    legend?: Array<{ data?: unknown[] }>;
    tooltip?: Array<{ trigger?: string }>;
  };
  convertToPixel(finder: unknown, value: unknown): number[];
  dispatchAction(action: Record<string, unknown>): void;
  getZr(): { storage: { getDisplayList(update?: boolean): Elem[] } };
  getModel(): {
    getComponent(name: string): { axis: { scale: { getExtent(): [number, number] } } };
    getSeriesByIndex(i: number): {
      getData(): { getItemLayout(i: number): { width?: number } | undefined };
    };
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

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri"];
const rowsRun1 = DAYS.map((d, i) => [d, 12 + i * 7]);
const rowsRun2 = DAYS.map((d, i) => [d, 10 + i * 7]);

for (const { theme, width } of CASES) {
  const label = `${theme}-${width}`;
  test(`reference lines and bands render on a dashboard (${label})`, async ({ page, request }) => {
    test.setTimeout(240_000);
    page.setDefaultTimeout(20_000);
    await page.setViewportSize({ width: 1440, height: 1300 });
    await page.addInitScript((t) => window.localStorage.setItem("helio-theme", t as string), theme);
    const credentials = await registerUser(request, {
      prefix: `hel1306-${label}`,
      displayName: "HEL-1306",
      logEmail: false,
    });
    const userId = await currentUserId(request);
    recordId("user", userId);
    await loginThenIsolate(page, credentials);

    const created: { source?: string; pipeline?: string; dashboard?: string } = {};
    try {
      const source = await postJson<{ id: string }>(
        request,
        "/api/data-sources",
        {
          name: `HEL-1306 ci ${label}`,
          type: "static",
          columns: [
            { name: "day", type: "string" },
            { name: "value", type: "integer" },
          ],
          rows: rowsRun1,
        },
        201,
      );
      created.source = source.id;
      recordId("data-source", source.id);
      const pipeline = await postJson<{ id: string }>(
        request,
        "/api/pipelines",
        { name: `HEL-1306 pipeline ${label}`, roots: [{ sourceId: source.id }] },
        201,
      );
      created.pipeline = pipeline.id;
      recordId("pipeline", pipeline.id);
      const output = async (name: string, config: Record<string, unknown>) => {
        const out = await postJson<{ id: string }>(
          request,
          `/api/pipelines/${pipeline.id}/outputs`,
          {
            kind: "chart",
            name,
            config: {
              aggregation: null,
              fieldMapping: { xAxis: "day", yAxis: "value" },
              ...config,
            },
          },
          201,
        );
        recordId("output", out.id);
        return out;
      };
      const marked = await output("HEL-1306 Marked bar", {
        chartType: "bar",
        referenceLines: [{ value: 95, label: "SLO 95", tone: "warning" }, { value: 25 }],
        referenceBands: [{ from: 0, to: 20, label: "Healthy", tone: "success" }],
      });
      const control = await output("HEL-1306 Plain bar", { chartType: "bar" });
      const overlaid = await output("HEL-1306 Overlay line", {
        chartType: "line",
        compare: "previous_run",
        referenceLines: [{ value: 30 }],
      });
      const dashboard = await postJson<{ id: string }>(
        request,
        "/api/dashboards",
        { name: `HEL-1306 ${label}` },
        201,
      );
      created.dashboard = dashboard.id;
      recordId("dashboard", dashboard.id);

      const run = async () => {
        const res = await request.post(`/api/pipelines/${pipeline.id}/run`, {
          data: {},
          headers: CSRF,
        });
        expect(res.status(), await res.text()).toBe(200);
      };
      await run();
      const put = await request.put(`/api/data-sources/${source.id}/rows`, {
        data: { rows: rowsRun2 },
        headers: CSRF,
      });
      expect(put.status(), await put.text()).toBe(200);
      await run();

      const batch = await postJson<{ panels: { id: string; title: string }[] }>(
        request,
        "/api/panels/batch",
        {
          dashboardId: dashboard.id,
          panels: [
            ["HEL-1306 PanelMarked", marked.id],
            ["HEL-1306 PanelPlain", control.id],
            ["HEL-1306 PanelOverlay", overlaid.id],
          ].map(([title, outputId]) => ({ title, type: "output", config: { outputId } })),
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
      await page.getByText(`HEL-1306 ${label}`).first().click();
      if (width === 375) {
        await page.setViewportSize({ width: 375, height: 900 });
        await expect(page.locator(".mobile-panel-stack:not([aria-hidden='true'] *)")).toBeVisible();
      }
      const card = (title: string) =>
        page
          .locator(width === 375 ? ".mobile-panel-stack__item" : "article", { hasText: title })
          .first();
      const markedCard = card("HEL-1306 PanelMarked");
      const plainCard = card("HEL-1306 PanelPlain");
      const overlayCard = card("HEL-1306 PanelOverlay");
      for (const c of [markedCard, plainCard, overlayCard]) {
        await c.scrollIntoViewIfNeeded();
        await expectRendered(c);
      }
      await page.waitForTimeout(1500); // let the entry animation finish before measuring / shooting

      // 1. The marked bar: carrier present, extent widened to the threshold with zero kept, line + band.
      const info = await withChart(markedCard, (chart) => {
        const opt = chart.getOption();
        const carrier = (opt.series ?? []).find((s) => s.id === "__helio_reference_marks__");
        const m = chart.getModel();
        return {
          hasCarrier: carrier !== undefined,
          lineColour: carrier?.markLine?.data?.[0]?.lineStyle.color,
          bandColour: carrier?.markArea?.data?.[0]?.[0]?.itemStyle?.color,
          extent: m.getComponent("yAxis").axis.scale.getExtent(),
          barWidth: m.getSeriesByIndex(0).getData().getItemLayout(0)?.width,
          legendData: JSON.stringify(opt.legend?.[0]?.data ?? []),
        };
      });
      console.log(`[HEL-1306 e2e] ${label} marked bar ${JSON.stringify(info)}`);
      expect(info?.hasCarrier).toBe(true);
      expect(info!.extent[0]).toBe(0);
      expect(info!.extent[1]).toBeGreaterThanOrEqual(95);
      expect(info!.legendData).not.toContain("__helio_reference_marks__");
      const plain = await withChart(plainCard, (chart) => {
        const m = chart.getModel();
        return {
          extent: m.getComponent("yAxis").axis.scale.getExtent(),
          barWidth: m.getSeriesByIndex(0).getData().getItemLayout(0)?.width,
        };
      });
      console.log(`[HEL-1306 e2e] ${label} plain bar ${JSON.stringify(plain)}`);
      expect(plain!.extent[1]).toBeLessThan(95);
      // The marks must not change the bar width (an empty bar carrier halves it).
      // Desktop: identical. At 375px the wider value labels ("100" vs "40") take a few px of plot width
      // under the compact `containLabel` grid, so allow that, nowhere near the carrier's 50% halving.
      if (width === 1440) expect(info!.barWidth).toBe(plain!.barWidth);
      else expect(info!.barWidth! / plain!.barWidth!).toBeGreaterThan(0.95);
      // Band label: above the bars at desktop; hidden in the compact 375 stack (design D5).
      const zs = await withChart(markedCard, (chart) => {
        const list = chart.getZr().storage.getDisplayList(true) as Array<{
          type?: string;
          z?: number;
          style?: { text?: string };
        }>;
        return {
          labelZ: list.find((e) => e.style?.text === "Healthy")?.z,
          barZs: list.filter((e) => e.type === "rect" && e.z === 2).length,
        };
      });
      console.log(`[HEL-1306 e2e] ${label} band label z ${JSON.stringify(zs)}`);
      if (width === 1440) {
        expect(zs!.barZs).toBeGreaterThan(0);
        expect(zs!.labelZ).toBeGreaterThan(2);
      } else {
        expect(zs!.labelZ).toBeUndefined();
      }
      await markedCard.screenshot({ path: evidencePath("HEL-1306", `marked-bar-${label}.png`) });

      // 2. Overlay line + neutral reference line: both drawn, tooltip trigger as without a mark.
      const overlay = await withChart(overlayCard, (chart) => {
        const opt = chart.getOption();
        return {
          names: (opt.series ?? []).map((s) => s.name ?? s.id ?? ""),
          trigger: opt.tooltip?.[0]?.trigger,
          legend: JSON.stringify(opt.legend?.[0]?.data ?? []),
        };
      });
      console.log(`[HEL-1306 e2e] ${label} overlay line ${JSON.stringify(overlay)}`);
      expect(overlay!.names.some((n) => n.startsWith("vs"))).toBe(true);
      expect(overlay!.names).toContain("__helio_reference_marks__");
      expect(overlay!.legend).not.toContain("__helio_reference_marks__");
      await overlayCard.screenshot({ path: evidencePath("HEL-1306", `overlay-line-${label}.png`) });

      // 3. Hovering a data series does not fade the marks (focus: "series" blurs everything else).
      await markedCard.scrollIntoViewIfNeeded();
      const box = (await markedCard.locator("canvas").first().boundingBox())!;
      const barPx = await withChart(markedCard, (chart) =>
        chart.convertToPixel({ seriesIndex: 0 }, [3, 10]),
      );
      await page.mouse.move(box.x + barPx![0], box.y + barPx![1]);
      await page.waitForTimeout(600);
      const hover = await readMarkOpacities(markedCard, info!.lineColour!, info!.bandColour!);
      console.log(`[HEL-1306 e2e] ${label} hover opacities ${JSON.stringify(hover)}`);
      expect(hover.line.length).toBeGreaterThan(0);
      expect(hover.band.length).toBeGreaterThan(0);
      for (const o of hover.line) expect(o).toBe(1);
      for (const o of hover.band) expect(o).toBeCloseTo(0.12, 2);
      await markedCard.screenshot({ path: evidencePath("HEL-1306", `hover-bar-${label}.png`) });
      await page.mouse.move(0, 0);

      // 4. Toggling the data series in the legend leaves the marks drawn.
      await withChart(markedCard, (chart) => {
        chart.dispatchAction({ type: "legendToggleSelect", name: "value" });
      });
      await page.waitForTimeout(600);
      const afterToggle = await readMarkOpacities(markedCard, info!.lineColour!, info!.bandColour!);
      console.log(`[HEL-1306 e2e] ${label} after legend toggle ${JSON.stringify(afterToggle)}`);
      expect(afterToggle.line.length).toBeGreaterThan(0);
      expect(afterToggle.band.length).toBeGreaterThan(0);
      await markedCard.screenshot({ path: evidencePath("HEL-1306", `legend-toggle-${label}.png`) });
    } finally {
      if (created.dashboard) await deleteExact(request, `/api/dashboards/${created.dashboard}`);
      if (created.pipeline) await deleteExact(request, `/api/pipelines/${created.pipeline}`);
      if (created.source) await deleteExact(request, `/api/data-sources/${created.source}`);
    }
  });
}

/** Opacities of the live canvas elements painted in the line colour / band colour. */
async function readMarkOpacities(card: Locator, lineColour: string, bandColour: string) {
  return withChart(
    card,
    (chart, _canvas, [line, band]) => {
      const list = chart.getZr().storage.getDisplayList(true);
      const opacity = (e: Elem) => (e.style?.opacity === undefined ? 1 : e.style.opacity);
      return {
        line: list
          .filter((e) => !e.invisible && e.style?.stroke === line && e.type !== "text")
          .map(opacity),
        band: list
          .filter((e) => !e.invisible && e.style?.fill === band && e.type !== "text")
          .map(opacity),
      };
    },
    [lineColour, bandColour],
  ) as Promise<{ line: number[]; band: number[] }>;
}

// The Output editor: the Reference lines / bands section, both themes, desktop and 375px. Adds a line
// and a band through the UI, checks the preview draws them, the invalid state blocks Save, and the 44px
// touch rule holds at 375px.
for (const { theme, width } of CASES) {
  const label = `${theme}-${width}`;
  test(`Output editor edits reference lines and bands (${label})`, async ({ page, request }) => {
    test.setTimeout(180_000);
    page.setDefaultTimeout(20_000);
    await page.setViewportSize({ width, height: width === 375 ? 1500 : 1300 });
    await page.addInitScript((t) => window.localStorage.setItem("helio-theme", t as string), theme);
    const credentials = await registerUser(request, {
      prefix: `hel1306-ed-${label}`,
      displayName: "HEL-1306",
      logEmail: false,
    });
    recordId("user", await currentUserId(request));
    await loginThenIsolate(page, credentials);

    const created: { source?: string; pipeline?: string } = {};
    try {
      const source = await postJson<{ id: string }>(
        request,
        "/api/data-sources",
        {
          name: `HEL-1306 editor ${label}`,
          type: "static",
          columns: [
            { name: "day", type: "string" },
            { name: "value", type: "integer" },
          ],
          rows: rowsRun1,
        },
        201,
      );
      created.source = source.id;
      recordId("data-source", source.id);
      const pipeline = await postJson<{ id: string }>(
        request,
        "/api/pipelines",
        { name: `HEL-1306 editor pipeline ${label}`, roots: [{ sourceId: source.id }] },
        201,
      );
      created.pipeline = pipeline.id;
      recordId("pipeline", pipeline.id);
      const out = await postJson<{ id: string }>(
        request,
        `/api/pipelines/${pipeline.id}/outputs`,
        {
          kind: "chart",
          name: "HEL-1306 Editor bar",
          config: {
            chartType: "bar",
            aggregation: null,
            fieldMapping: { xAxis: "day", yAxis: "value" },
          },
        },
        201,
      );
      recordId("output", out.id);

      await page.goto(`/pipelines/${pipeline.id}`);
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      await showOutputs(page); // HEL-1579: a tab on the phone, the spine's OUTPUTS section on desktop
      await page.getByRole("button", { name: "Open HEL-1306 Editor bar output" }).click();

      await page.getByRole("button", { name: "Add line" }).click();
      await page.getByRole("textbox", { name: "Line 1 value" }).fill("95");
      await page.getByRole("textbox", { name: "Line 1 label" }).fill("SLO 95");
      await page.getByRole("combobox", { name: "Line 1 tone" }).click();
      await page.getByRole("option", { name: "Warning" }).click();
      await page.getByRole("button", { name: "Add band" }).click();
      await page.getByRole("textbox", { name: "Band 1 from" }).fill("0");
      await page.getByRole("textbox", { name: "Band 1 to" }).fill("20");
      await page.getByRole("textbox", { name: "Band 1 label" }).fill("Healthy");
      await page.getByRole("combobox", { name: "Band 1 tone" }).click();
      await page.getByRole("option", { name: "Good" }).click();

      const heights = await Promise.all(
        [
          page.getByRole("textbox", { name: "Line 1 value" }),
          page.getByRole("textbox", { name: "Line 1 label" }),
          page.getByRole("combobox", { name: "Line 1 tone" }),
          page.getByRole("textbox", { name: "Band 1 from" }),
        ].map(async (l) => (await l.boundingBox())!.height),
      );
      // The icon-only remove button keeps its painted box and reaches 44px with a hit expander.
      const removeExpander = await page
        .getByRole("button", { name: "Remove line 1" })
        .evaluate((el) => getComputedStyle(el, "::after").height);
      console.log(
        `[HEL-1306 e2e] ${label} editor control heights ${JSON.stringify(heights)} remove expander ${removeExpander}`,
      );
      if (width === 375) {
        for (const h of heights) expect(h).toBeGreaterThanOrEqual(43);
        expect(removeExpander).toBe("44px");
      }

      // The preview card draws the unsaved marks from the same renderer.
      await expect(page.locator(".output-preview-pane__chart canvas").first()).toBeVisible();
      await page.waitForTimeout(1500);
      await page.getByRole("group", { name: "Reference lines" }).scrollIntoViewIfNeeded();
      await page.screenshot({ path: evidencePath("HEL-1306", `editor-${label}.png`) });
      const preview = page.locator(".output-preview-pane__chart");
      const previewMarks = await withChart(preview, (chart) => {
        const carrier = (chart.getOption().series ?? []).find(
          (s) => s.id === "__helio_reference_marks__",
        );
        return {
          lines: carrier?.markLine?.data?.length ?? 0,
          bands: carrier?.markArea?.data?.length ?? 0,
        };
      });
      expect(previewMarks).toEqual({ lines: 1, bands: 1 });

      // An invalid draft blocks Save with an inline error.
      await page.getByRole("textbox", { name: "Band 1 to" }).fill("0");
      await expect(
        page.getByRole("alert").filter({ hasText: "From must be less than To." }),
      ).toBeVisible();
      await expect(page.getByRole("button", { name: "Save" })).toBeDisabled();
      await page.screenshot({ path: evidencePath("HEL-1306", `editor-invalid-${label}.png`) });
      await page.getByRole("textbox", { name: "Band 1 to" }).fill("20");
      await expect(page.getByRole("button", { name: "Save" })).toBeEnabled();

      // Save persists exactly the two new keys, readable from the API.
      await page.getByRole("button", { name: "Save" }).click();
      await expect
        .poll(async () => {
          const res = await request.get(`/api/outputs/${out.id}`);
          const cfg = ((await res.json()) as { config: Record<string, unknown> }).config;
          return { lines: cfg.referenceLines, bands: cfg.referenceBands };
        })
        .toEqual({
          lines: [{ value: 95, label: "SLO 95", tone: "warning" }],
          bands: [{ from: 0, to: 20, label: "Healthy", tone: "success" }],
        });
    } finally {
      if (created.pipeline) await deleteExact(request, `/api/pipelines/${created.pipeline}`);
      if (created.source) await deleteExact(request, `/api/data-sources/${created.source}`);
    }
  });
}
