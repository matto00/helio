import { writeFileSync } from "node:fs";

import { expect, test, type Locator, type Page } from "@playwright/test";

import { CSRF_HEADER, registerAndLogin } from "./support/auth";
import { evidencePath } from "./support/evidencePath";
import { deleteExact } from "./support/remountBurstSeed";

// HEL-1444 -- a short (h=4) desktop chart card carrying footnotes, optionally with a viewer-control bar,
// keeps a usable canvas at every width, its value-axis labels never overprint, and its title is a native
// tooltip. Measured in the running app (layout geometry only reads in a browser), light + dark, 1440 + 1900.
// Red-first on unfixed main; the floors are the specs/ floors, never loosened.

const FLOOR = { plain: { two: 96, three: 84 }, ctl: { two: 60, three: 48 } } as const;
const TOL = 0.5;
const ANNOTATION =
  "Source: internal sales ledger, refreshed nightly and reconciled against the finance warehouse and the audited quarterly close, including adjustments";

// Heights (px) of the stacked bars on unchanged main (a369a9cb8), measured by the red run of this spec.
// A multi-control bar and a lone range bar must be no taller than these (spec scenario).
const MAIN_BAR_HEIGHT = { two: { 2: 57, 4: 57 }, range: { 2: 57, 4: 57 } } as Record<
  string,
  Record<number, number>
>;

type Kind = "bar" | "hist" | "bare" | "table";
interface Variant {
  tag: string;
  kind: Kind;
  ctl: "none" | "one" | "text" | "two" | "range";
  w: number;
  h: number;
  x: number;
  y: number;
}

const WIDTHS = [
  { w: 2, x: 0 },
  { w: 4, x: 2 },
  { w: 6, x: 6 },
];

function variants(): Variant[] {
  const out: Variant[] = [];
  const rows: Array<[Kind, "none" | "one"]> = [
    ["bar", "none"],
    ["bar", "one"],
    ["hist", "none"],
    ["hist", "one"],
  ];
  rows.forEach(([kind, ctl], row) => {
    for (const { w, x } of WIDTHS) {
      out.push({ tag: `${kind}-${ctl}-w${w}`, kind, ctl, w, h: 4, x, y: row * 4 });
    }
  });
  // One TEXT control (HEL-1444 cycle 2): its label must not be truncated.
  for (const { w, x } of WIDTHS) {
    out.push({ tag: `bar-text-w${w}`, kind: "bar", ctl: "text", w, h: 4, x, y: 25 });
  }
  // Bars that must not get taller: two controls and a lone range, at w=2 and w=4 (side by side).
  out.push({ tag: "bar-two-w2", kind: "bar", ctl: "two", w: 2, h: 4, x: 0, y: 16 });
  out.push({ tag: "bar-two-w4", kind: "bar", ctl: "two", w: 4, h: 4, x: 2, y: 16 });
  out.push({ tag: "bar-range-w2", kind: "bar", ctl: "range", w: 2, h: 4, x: 6, y: 16 });
  out.push({ tag: "bar-range-w4", kind: "bar", ctl: "range", w: 4, h: 4, x: 8, y: 16 });
  // A taller card keeps its current layout.
  out.push({ tag: "bar-one-h5-w6", kind: "bar", ctl: "one", w: 6, h: 5, x: 0, y: 20 });
  return out;
}

// Short enough to stay on one line at w=4 and w=6 (the floors assume a one-line header there).
const isOne = (v: { ctl: Variant["ctl"] }) => v.ctl === "one" || v.ctl === "text";
const titleOf = (v: Variant) => `Revenue ${v.tag}`;

function controlsFor(ctl: Variant["ctl"]) {
  const region = { id: "c1", kind: "dropdown", column: "region", label: "Region" };
  if (ctl === "one") return [region];
  if (ctl === "text") return [{ id: "c4", kind: "text", column: "region", label: "Region" }];
  if (ctl === "two")
    return [region, { id: "c2", kind: "dropdown", column: "region", label: "Area" }];
  if (ctl === "range")
    return [{ id: "c3", kind: "numeric-range", column: "revenue", label: "Revenue" }];
  return [];
}

async function seed(request: Parameters<typeof deleteExact>[0], list: Variant[]) {
  const post = async <T>(url: string, data: unknown) => {
    const res = await request.post(url, { data, headers: { [CSRF_HEADER]: "1" } });
    expect(res.status(), `${url} ${await res.text()}`).toBeLessThan(300);
    return (await res.json()) as T;
  };
  const dash = await post<{ id: string }>("/api/dashboards", { name: "HEL-1444 canvas" });
  // 500 rows > the 200-row page (truncation note); every 7th duration is text (histogram skipped note).
  const rows = Array.from({ length: 500 }, (_, i) => [
    ["East", "West"][i % 2],
    i + 1,
    i % 7 === 3 ? "n/a" : String(10 + ((i * 7) % 45)),
  ]);
  const source = await post<{ id: string }>("/api/data-sources", {
    name: "HEL-1444 source",
    type: "static",
    columns: [
      { name: "region", type: "string", required: true },
      { name: "revenue", type: "integer", required: true },
      { name: "duration", type: "string", required: true },
    ],
    rows,
  });
  const pipeline = await post<{ id: string }>("/api/pipelines", {
    name: "HEL-1444 pipeline",
    roots: [{ sourceId: source.id }],
  });
  const output = (name: string, config: unknown) =>
    post<{ id: string }>(`/api/pipelines/${pipeline.id}/outputs`, { kind: "chart", name, config });
  const bar = await output("HEL-1444 bar", {
    chartType: "bar",
    fieldMapping: { xAxis: "region", yAxis: "revenue" },
    annotation: ANNOTATION,
  });
  const hist = await output("HEL-1444 hist", {
    chartType: "histogram",
    aggregation: null,
    fieldMapping: { xAxis: "duration" },
    chartOptions: { histogram: { binCount: 5 } },
    annotation: ANNOTATION,
  });
  await post(`/api/pipelines/${pipeline.id}/run`, {});
  // Footnote-less outputs (3 rows: no truncation; no annotation) for the D2 keying tests.
  let extra: { pipeline: string; source: string; chart: string; table: string } | null = null;
  if (list.some((v) => v.kind === "bare" || v.kind === "table")) {
    const small = await post<{ id: string }>("/api/data-sources", {
      name: "HEL-1444 small source",
      type: "static",
      columns: [
        { name: "region", type: "string", required: true },
        { name: "revenue", type: "integer", required: true },
      ],
      rows: [
        ["East", 10],
        ["West", 150],
        ["North", 90],
      ],
    });
    const p2 = await post<{ id: string }>("/api/pipelines", {
      name: "HEL-1444 small pipeline",
      roots: [{ sourceId: small.id }],
    });
    const out2 = (kind: string, name: string, config: unknown) =>
      post<{ id: string }>(`/api/pipelines/${p2.id}/outputs`, { kind, name, config });
    const chart = await out2("chart", "HEL-1444 bare", {
      chartType: "bar",
      fieldMapping: { xAxis: "region", yAxis: "revenue" },
    });
    const table = await out2("table", "HEL-1444 table", {});
    await post(`/api/pipelines/${p2.id}/run`, {});
    extra = { pipeline: p2.id, source: small.id, chart: chart.id, table: table.id };
  }
  const items: Array<{ panelId: string; x: number; y: number; w: number; h: number }> = [];
  for (const v of list) {
    const panel = await post<{ id: string }>("/api/panels", {
      dashboardId: dash.id,
      title: titleOf(v),
      type: "output",
      config: {
        outputId: {
          bar: bar.id,
          hist: hist.id,
          bare: extra?.chart,
          table: extra?.table,
        }[v.kind],
        ...(v.ctl === "none" ? {} : { controls: controlsFor(v.ctl) }),
      },
    });
    items.push({ panelId: panel.id, x: v.x, y: v.y, w: v.w, h: v.h });
  }
  // 1504px resolves to md (HEL-1574: the rail and context list take 352px, so the grid container is 1152 as 1440 gave before) (10 columns), 1900px to lg (12): md stacks the panels one per row at their
  // own width (w <= 10), so the card widths match the lg w=2/4/6 cards; sm/xs stack in one column.
  const stacked = (maxW: number) =>
    items.map((i, n) => ({ ...i, x: 0, y: n * 5, w: Math.min(i.w, maxW) }));
  const layout = { lg: items, md: stacked(10), sm: stacked(2), xs: stacked(2) };
  const upd = await request.patch(`/api/dashboards/${dash.id}/update`, {
    data: { fields: ["layout"], dashboard: { layout } },
    headers: { [CSRF_HEADER]: "1" },
  });
  expect(upd.status(), await upd.text()).toBe(200);
  return { dashboard: dash.id, pipeline: pipeline.id, source: source.id, extra };
}

interface Rect {
  top: number;
  bottom: number;
  left: number;
  right: number;
  height: number;
}

interface Measure {
  card: Rect | null;
  contentBoxBottom: number;
  top: Rect | null;
  bar: Rect | null;
  content: Rect | null;
  canvas: Rect | null;
  annotation: (Rect & { lines: number }) | null;
  footnotes: Array<Rect & { lines: number; text: string }>;
  footer: Rect | null;
  footerOverrunPx: number;
  label: Rect | null;
  labelClipped: boolean;
  input: Rect | null;
  titleAttr: string | null;
  titleText: string;
}

/** Geometry of one card's regions, in viewport px (null when absent). */
async function measure(card: Locator): Promise<Measure> {
  return card.evaluate((item) => {
    const rect = (el: Element | null) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, height: r.height };
    };
    const lines = (el: Element) => {
      const cs = getComputedStyle(el);
      const pad = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
      return Math.round((el.getBoundingClientRect().height - pad) / parseFloat(cs.lineHeight));
    };
    const article = item.querySelector("article.panel-grid-card")!;
    const acs = getComputedStyle(article);
    const contentBoxBottom =
      article.getBoundingClientRect().bottom -
      parseFloat(acs.paddingBottom) -
      parseFloat(acs.borderBottomWidth);
    const footer = item.querySelector(".panel-grid-card__footer");
    const ann = item.querySelector(".chart-panel__annotation");
    const bar = item.querySelector(".output-viewer-control-bar");
    const label = bar?.querySelector(".output-viewer-control-bar__label") ?? null;
    const input = bar?.querySelector("select, [role=combobox], button, input") ?? null;
    const h3 = item.querySelector("h3.panel-grid-card__title");
    return {
      card: rect(article),
      contentBoxBottom,
      top: rect(item.querySelector(".panel-grid-card__top")),
      bar: rect(bar),
      content: rect(item.querySelector(".panel-content")),
      canvas: rect(item.querySelector(".chart-panel__canvas")),
      annotation: ann ? { ...rect(ann)!, lines: lines(ann) } : null,
      footnotes: Array.from(item.querySelectorAll(".chart-panel__truncation-note")).map((n) => ({
        ...rect(n)!,
        lines: lines(n),
        text: (n as HTMLElement).innerText,
      })),
      footer: rect(footer),
      footerOverrunPx: footer ? footer.getBoundingClientRect().bottom - contentBoxBottom : 0,
      label: rect(label),
      labelClipped: label ? label.scrollWidth > label.clientWidth + 0.5 : false,
      input: rect(input),
      titleAttr: h3?.getAttribute("title") ?? null,
      titleText: h3?.textContent ?? "",
    };
  });
}

interface DrawnLabel {
  text: string;
  top: number;
  bottom: number;
}

type YAxisProbe = {
  /** The value axis' tick values, ascending (the axis minimum and maximum are its ends). */
  ticks: number[];
  /** The y-axis label texts ECharts actually drew (not hidden by `hideOverlap`), with their bands. */
  drawn: DrawnLabel[];
  /** What the option asked for, and the canvas / plot area it was asked for (evidence only). */
  splitNumber: number | null;
  chartHeight: number;
  /** The y-axis label font size (the compact 10px, or ECharts' 12px default). */
  fontSize: number;
  plotHeight: number;
} | null;

/** Reads the value-axis labels the card's ECharts instance DRAWS: its zrender text elements whose
 *  text is a tick label, minus any hidden by `hideOverlap`. */
async function yAxisProbe(card: Locator): Promise<YAxisProbe> {
  return card
    .locator("canvas")
    .first()
    .evaluate((canvas) => {
      type Fiber = { stateNode?: { getEchartsInstance?: () => unknown } | null; return?: Fiber };
      type Rect = { y: number; height: number; clone(): Rect; applyTransform(m: number[]): void };
      type TextEl = {
        ignore?: boolean;
        invisible?: boolean;
        parent?: TextEl | null;
        style?: { text?: string };
        getComputedTransform(): number[] | null;
        getBoundingRect(): Rect;
      };
      // `hideOverlap` hides the whole text element, which is the parent of the drawn tspan.
      const hidden = (el: TextEl | null | undefined): boolean =>
        !!el && (!!el.ignore || !!el.invisible || hidden(el.parent));
      let host: Element | null = canvas;
      while (host) {
        const key = Object.keys(host).find((k) => k.startsWith("__reactFiber$"));
        let f: Fiber | null | undefined = key
          ? (host as unknown as Record<string, Fiber>)[key]
          : null;
        while (f) {
          if (f.stateNode && typeof f.stateNode.getEchartsInstance === "function") {
            const chart = f.stateNode.getEchartsInstance() as {
              getModel(): {
                getComponent(
                  t: string,
                  i: number,
                ): {
                  axis: {
                    getViewLabels(): Array<{ formattedLabel: string; tick: { value: number } }>;
                  };
                };
              };
              getOption(): {
                yAxis?: Array<{ splitNumber?: number; axisLabel?: { fontSize?: number } }>;
              };
              getHeight(): number;
              getZr(): { storage: { getDisplayList(u?: boolean, ignored?: boolean): TextEl[] } };
            };
            const labels = chart.getModel().getComponent("yAxis", 0).axis.getViewLabels();
            const texts = new Set(labels.map((l) => l.formattedLabel));
            const drawn = chart
              .getZr()
              .storage.getDisplayList(true, true)
              .filter((el) => texts.has(el.style?.text ?? "") && !hidden(el))
              .map((el) => {
                const r = el.getBoundingRect().clone();
                const m = el.getComputedTransform();
                if (m) r.applyTransform(m);
                return { text: el.style!.text!, top: r.y, bottom: r.y + r.height };
              })
              .sort((a, b) => a.top - b.top);
            const grid = (
              chart.getModel() as unknown as {
                getComponent(
                  t: string,
                  i: number,
                ): { coordinateSystem: { getRect(): { height: number } } };
              }
            ).getComponent("grid", 0);
            return {
              ticks: labels.map((l) => l.tick.value).sort((a, b) => a - b),
              drawn,
              splitNumber: chart.getOption().yAxis?.[0]?.splitNumber ?? null,
              chartHeight: chart.getHeight(),
              fontSize: chart.getOption().yAxis?.[0]?.axisLabel?.fontSize ?? 12,
              plotHeight: grid.coordinateSystem.getRect().height,
            };
          }
          f = f.return;
        }
        host = host.parentElement;
      }
      return null;
    });
}

async function openDashboard(page: Page, id: string, width: number) {
  await page.setViewportSize({ width, height: 1000 });
  await page.goto(`/dashboards/${id}`);
  for (const v of variants()) {
    const card = page.locator(".react-grid-item", { hasText: titleOf(v) });
    await card.scrollIntoViewIfNeeded();
    await expect(card.locator(".chart-panel__truncation-note").first()).toBeVisible({
      timeout: 25_000,
    });
  }
  await page.waitForTimeout(1_500);
}

const VIEWPORTS = [1504, 1900];
for (const theme of ["light", "dark"] as const) {
  for (const width of VIEWPORTS) {
    test(`HEL-1444 canvas floors, containment, title, y-axis @${width}px (${theme})`, async ({
      page,
      request,
    }) => {
      test.setTimeout(300_000);
      await page.addInitScript((t) => window.localStorage.setItem("helio-theme", t), theme);
      const { email } = await registerAndLogin(page, request, {
        prefix: "hel1444",
        label: `${theme}-${width}`,
        displayName: "HEL-1444",
        isolate: true,
      });
      const list = variants();
      const ids = await seed(request, list);
      console.log(`[HEL-1444 e2e] user ${email} created ${JSON.stringify(ids)}`);
      const all: Record<string, unknown> = {};
      try {
        await openDashboard(page, ids.dashboard, width);
        for (const v of list) {
          const card = page.locator(".react-grid-item", { hasText: titleOf(v) });
          await card.scrollIntoViewIfNeeded();
          await page.mouse.move(0, 0);
          await page.waitForTimeout(200);
          const m = await measure(card);
          const y = isOne(v) && v.h === 4 ? await yAxisProbe(card) : null;
          all[v.tag] = { m, y };
          const tag = `${theme}-${width}-${v.tag}`;
          await card.screenshot({ path: evidencePath("HEL-1444", `card-${tag}.png`) });
          const where = `${v.tag} @${width} ${theme}`;
          const { content, canvas, footer, top, bar, annotation, footnotes } = m;
          expect(content && canvas && footer && top, `${where}: regions present`).toBeTruthy();

          // Containment: nothing overlaps the header, the control bar or the footer.
          expect
            .soft(canvas!.top, `${where}: canvas inside content`)
            .toBeGreaterThanOrEqual(content!.top - TOL);
          for (const [n, r] of [
            ["canvas", canvas!],
            ...(annotation ? ([["annotation", annotation]] as const) : []),
            ...footnotes.map((f, i) => [`note${i}`, f] as const),
          ] as const) {
            expect
              .soft(r.bottom, `${where}: ${n} ends inside content`)
              .toBeLessThanOrEqual(content!.bottom + TOL);
          }
          expect
            .soft(content!.top, `${where}: content below header`)
            .toBeGreaterThanOrEqual(top!.bottom - TOL);
          if (bar) {
            expect
              .soft(content!.top, `${where}: content below bar`)
              .toBeGreaterThanOrEqual(bar.bottom - TOL);
          }
          expect
            .soft(content!.bottom, `${where}: content above footer`)
            .toBeLessThanOrEqual(footer!.top + TOL);
          expect
            .soft(m.footerOverrunPx, `${where}: footer within card content box`)
            .toBeLessThanOrEqual(TOL);

          // Title tooltip + accessible name (item 2).
          expect.soft(m.titleAttr, `${where}: title tooltip`).toBe(titleOf(v));
          await expect
            .soft(
              card.getByRole("heading", { name: titleOf(v), exact: true }),
              `${where}: accessible name`,
            )
            .toHaveCount(1);

          if (v.h === 5) {
            // Taller cards are unchanged: annotation visible, two-line clamp, label above input.
            expect.soft(annotation!.height, `${where}: annotation visible`).toBeGreaterThan(8);
            expect.soft(annotation!.lines, `${where}: two-line clamp kept`).toBe(2);
            expect
              .soft(m.label!.bottom, `${where}: label above input`)
              .toBeLessThanOrEqual(m.input!.top + TOL);
            continue;
          }

          if (v.ctl === "two" || v.ctl === "range") {
            const base = MAIN_BAR_HEIGHT[v.ctl][v.w];
            console.log(`[HEL-1444 bar ${where}] ${bar!.height}px (main ${base})`);
            expect
              .soft(bar!.height, `${where}: bar no taller than main`)
              .toBeLessThanOrEqual(base + TOL);
            expect
              .soft(m.label!.bottom, `${where}: label above input`)
              .toBeLessThanOrEqual(m.input!.top + TOL);
            continue;
          }

          // Footnotes: one line each; the annotation yields (sr-only) only at w=2 with a bar.
          const hidesAnnotation = v.w === 2 && isOne(v);
          for (const [i, f] of footnotes.entries()) {
            expect.soft(f.height, `${where}: note${i} visible`).toBeGreaterThan(8);
            expect.soft(f.lines, `${where}: note${i} one line`).toBe(1);
          }
          if (hidesAnnotation) {
            expect
              .soft(annotation!.height, `${where}: annotation visually hidden`)
              .toBeLessThanOrEqual(2);
            await expect
              .soft(
                card.getByText(ANNOTATION, { exact: true }),
                `${where}: annotation kept for assistive tech`,
              )
              .toHaveCount(1);
          } else {
            expect.soft(annotation!.height, `${where}: annotation visible`).toBeGreaterThan(8);
            expect.soft(annotation!.lines, `${where}: annotation one line`).toBe(1);
          }

          const floors = isOne(v) ? FLOOR.ctl : FLOOR.plain;
          const floor = v.kind === "hist" ? floors.three : floors.two;
          expect.soft(canvas!.height, `${where}: canvas height`).toBeGreaterThanOrEqual(floor);

          if (isOne(v)) {
            // The label sits beside its input on one row, inside the bar.
            const { label, input } = m;
            const mid = (label!.top + label!.bottom) / 2;
            expect
              .soft(mid, `${where}: label on the input's row`)
              .toBeGreaterThanOrEqual(input!.top - TOL);
            expect
              .soft(mid, `${where}: label on the input's row`)
              .toBeLessThanOrEqual(input!.bottom + TOL);
            expect.soft(m.labelClipped, `${where}: label text is not truncated`).toBe(false);
            expect
              .soft(label!.right, `${where}: label left of input`)
              .toBeLessThanOrEqual(input!.left + TOL);
            expect
              .soft(input!.right, `${where}: input inside bar`)
              .toBeLessThanOrEqual(bar!.right + TOL);
          }
        }

        // Value axis (C2): the labels ECharts draws never overprint; at least one is drawn, and when two fit
        // (a plot area of at least one label pitch) the axis minimum and maximum are both labelled.
        for (const v of list.filter((x) => isOne(x) && x.h === 4)) {
          const probe = (all[v.tag] as { y: YAxisProbe }).y;
          const where = `${v.tag} @${width} ${theme}`;
          expect(probe, `${where}: y axis readable`).not.toBeNull();
          const drawn = probe!.drawn;
          expect
            .soft(drawn.length, `${where}: at least one y label drawn`)
            .toBeGreaterThanOrEqual(1);
          // zrender's text rect is only ~6px tall for 10px text (the glyph ink), so comparing rects hides
          // labels whose line boxes overlap (HEL-1444 cycle 2: "60/30/0" drawn 7.5px apart passed). Drawn
          // labels must be at least one font line box (1.2 x the font size) apart, top to top.
          const lineBox = Math.ceil(probe!.fontSize * 1.2);
          for (let i = 1; i < drawn.length; i++) {
            expect
              .soft(
                drawn[i].top - drawn[i - 1].top,
                `${where}: y labels ${JSON.stringify(drawn)} closer than a ${lineBox}px line box`,
              )
              .toBeGreaterThanOrEqual(lineBox - 0.01);
          }
          // Two labels fit when the plot area is at least one label pitch (12px for the 10px font).
          if (probe!.ticks.length >= 2 && probe!.plotHeight >= 12) {
            const texts = drawn.map((d) => d.text);
            expect.soft(texts, `${where}: axis min labelled`).toContain(String(probe!.ticks[0]));
            expect
              .soft(texts, `${where}: axis max labelled`)
              .toContain(String(probe!.ticks[probe!.ticks.length - 1]));
          }
        }
        writeFileSync(
          evidencePath("HEL-1444", `measure-${theme}-${width}.json`),
          JSON.stringify(all, null, 2),
        );
      } finally {
        await deleteExact(request, `/api/dashboards/${ids.dashboard}`);
        await deleteExact(request, `/api/pipelines/${ids.pipeline}`);
        await deleteExact(request, `/api/data-sources/${ids.source}`);
        if (ids.extra) {
          await deleteExact(request, `/api/pipelines/${ids.extra.pipeline}`);
          await deleteExact(request, `/api/data-sources/${ids.extra.source}`);
        }
      }
    });
  }
}

// HEL-1444 cycle 2 -- D2 (the inline one-control bar) is keyed on the chart OUTPUT, not on rendered
// footnotes: a footnote-less chart inlines too, a non-chart panel keeps its stacked bar, and typing a
// filter that empties the result (which unmounts the footnotes) never moves the focused input.
test("HEL-1444 D2 is keyed on the chart output (footnote-less chart inlines, table stays stacked)", async ({
  page,
  request,
}) => {
  test.setTimeout(180_000);
  await registerAndLogin(page, request, {
    prefix: "hel1444k",
    label: "keyed",
    displayName: "HEL-1444 keyed",
    isolate: true,
  });
  const list: Variant[] = [
    { tag: "bare-one-w2", kind: "bare", ctl: "one", w: 2, h: 4, x: 0, y: 0 },
    { tag: "bare-text-w2", kind: "bare", ctl: "text", w: 2, h: 4, x: 2, y: 0 },
    { tag: "table-one-w2", kind: "table", ctl: "one", w: 2, h: 4, x: 4, y: 0 },
  ];
  const ids = await seed(request, list);
  try {
    await page.setViewportSize({ width: 1900, height: 1000 });
    await page.goto(`/dashboards/${ids.dashboard}`);
    for (const v of list) {
      await expect(
        page
          .locator(".react-grid-item", { hasText: titleOf(v) })
          .locator(".output-viewer-control-bar"),
      ).toBeVisible({ timeout: 25_000 });
    }
    await page.waitForTimeout(1_200);
    for (const v of list) {
      const card = page.locator(".react-grid-item", { hasText: titleOf(v) });
      const m = await measure(card);
      await card.screenshot({ path: evidencePath("HEL-1444", `keyed-${v.tag}.png`) });
      expect(m.footnotes.length, `${v.tag}: no footnote`).toBe(0);
      if (v.kind === "table") {
        expect
          .soft(m.label!.bottom, `${v.tag}: table label above input`)
          .toBeLessThanOrEqual(m.input!.top + TOL);
      } else {
        const mid = (m.label!.top + m.label!.bottom) / 2;
        expect
          .soft(mid, `${v.tag}: label on the input's row`)
          .toBeGreaterThanOrEqual(m.input!.top - TOL);
        expect
          .soft(mid, `${v.tag}: label on the input's row`)
          .toBeLessThanOrEqual(m.input!.bottom + TOL);
        expect
          .soft(m.label!.right, `${v.tag}: label left of input`)
          .toBeLessThanOrEqual(m.input!.left + TOL);
        expect.soft(m.labelClipped, `${v.tag}: label text is not truncated`).toBe(false);
      }
    }
  } finally {
    await deleteExact(request, `/api/dashboards/${ids.dashboard}`);
    await deleteExact(request, `/api/pipelines/${ids.pipeline}`);
    await deleteExact(request, `/api/data-sources/${ids.source}`);
    if (ids.extra) {
      await deleteExact(request, `/api/pipelines/${ids.extra.pipeline}`);
      await deleteExact(request, `/api/data-sources/${ids.extra.source}`);
    }
  }
});

for (const width of [1504, 1900]) {
  test(`HEL-1444 typing into a footnoted chart's text control never moves the input @${width}px`, async ({
    page,
    request,
  }) => {
    test.setTimeout(180_000);
    await registerAndLogin(page, request, {
      prefix: "hel1444t",
      label: `typing-${width}`,
      displayName: "HEL-1444 typing",
      isolate: true,
    });
    const v: Variant = { tag: "bar-text-w2", kind: "bar", ctl: "text", w: 2, h: 4, x: 0, y: 0 };
    const ids = await seed(request, [v]);
    try {
      await page.setViewportSize({ width, height: 1000 });
      await page.goto(`/dashboards/${ids.dashboard}`);
      const card = page.locator(".react-grid-item", { hasText: titleOf(v) });
      await expect(card.locator(".chart-panel__truncation-note")).toBeVisible({ timeout: 25_000 });
      await page.waitForTimeout(1_200);
      const input = card.getByRole("textbox", { name: "Region" });
      const box = async () => (await input.boundingBox())!;
      const before = await box();
      await input.click();
      await input.fill("zzzz"); // matches no region: the result is empty and the footnotes unmount
      await expect(card.locator(".chart-panel__truncation-note")).toHaveCount(0, {
        timeout: 15_000,
      });
      await page.waitForTimeout(500);
      const after = await box();
      await card.screenshot({ path: evidencePath("HEL-1444", `typing-${width}-empty.png`) });
      for (const k of ["x", "y", "width", "height"] as const) {
        expect
          .soft(after[k], `input ${k} unchanged after an empty result`)
          .toBeCloseTo(before[k], 0);
      }
    } finally {
      await deleteExact(request, `/api/dashboards/${ids.dashboard}`);
      await deleteExact(request, `/api/pipelines/${ids.pipeline}`);
      await deleteExact(request, `/api/data-sources/${ids.source}`);
    }
  });
}

// The phone stack is HEL-1438's: reported (screenshots) and asserted unchanged by canvas height only.
for (const theme of ["light", "dark"] as const) {
  test(`HEL-1444 phone stack at 375px is unchanged (${theme})`, async ({ page, request }) => {
    test.setTimeout(180_000);
    await page.addInitScript((t) => window.localStorage.setItem("helio-theme", t), theme);
    await registerAndLogin(page, request, {
      prefix: "hel1444p",
      label: theme,
      displayName: "HEL-1444 phone",
      isolate: true,
    });
    const list = variants().filter((v) => v.tag === "bar-one-w2");
    const ids = await seed(request, list);
    try {
      await page.setViewportSize({ width: 375, height: 800 });
      await page.goto(`/dashboards/${ids.dashboard}`);
      const stackCard = page.locator(".mobile-panel-stack__item", { hasText: titleOf(list[0]) });
      await expect(stackCard.locator(".chart-panel__truncation-note")).toBeVisible({
        timeout: 25_000,
      });
      await page.waitForTimeout(1_000);
      await page.mouse.move(0, 0);
      await stackCard.screenshot({ path: evidencePath("HEL-1444", `phone-375-${theme}.png`) });
      const canvas = await stackCard.locator(".chart-panel__canvas").boundingBox();
      expect(canvas!.height, "phone stack canvas keeps its 100px").toBe(100);
    } finally {
      await deleteExact(request, `/api/dashboards/${ids.dashboard}`);
      await deleteExact(request, `/api/pipelines/${ids.pipeline}`);
      await deleteExact(request, `/api/data-sources/${ids.source}`);
    }
  });
}
