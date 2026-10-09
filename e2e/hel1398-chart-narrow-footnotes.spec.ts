import { writeFileSync } from "node:fs";

import { expect, test, type Page } from "@playwright/test";

import { CSRF_HEADER, registerAndLogin } from "./support/auth";
import { evidencePath } from "./support/evidencePath";
import { deleteExact } from "./support/remountBurstSeed";

// HEL-1398 -- a w=2, h=4 chart (the grid's narrowest/shortest card) carrying BOTH the annotation
// footnote and the truncation note must keep a usable chart canvas. Red-first: on the unfixed code the
// two footnotes eat the card and the canvas collapses. Measured in the running app, light + dark,
// plus the phone stack (reported only -- HEL-1438 owns the stack card height) and the live
// "matching rows" wording under a viewer filter (item 4).

const MIN_CANVAS_PX = 96;
const DESKTOP = { width: 1900, height: 1000 };
const PHONE = { width: 390, height: 844 };

interface Measure {
  card: number;
  cardWidth: number;
  header: number;
  annotation: { h: number; lines: number; text: string } | null;
  note: { h: number; lines: number; text: string; visibleText: string } | null;
  canvas: number;
  canvasWidth: number;
  chain: string[];
}

async function measure(page: Page, title: string, surface: string): Promise<Measure> {
  return page
    .locator(surface, { hasText: title })
    .first()
    .evaluate((card) => {
      const r = (el: Element | null) => (el ? el.getBoundingClientRect() : null);
      const lines = (el: Element | null) => {
        if (!el) return 0;
        const lh = parseFloat(getComputedStyle(el).lineHeight);
        const cs = getComputedStyle(el);
        const pad = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
        return Math.round((el.getBoundingClientRect().height - pad) / lh);
      };
      const visibleText = (el: Element) => {
        let out = "";
        el.querySelectorAll(":scope > span").forEach((s) => {
          if (getComputedStyle(s).display !== "none" && s.getBoundingClientRect().width > 2) {
            out += (s as HTMLElement).innerText;
          }
        });
        return out || (el as HTMLElement).innerText;
      };
      const chain: string[] = [];
      let el: Element | null = card.querySelector(".chart-panel__canvas");
      while (el && el !== card.parentElement) {
        const cs = getComputedStyle(el);
        chain.unshift(
          `${el.tagName.toLowerCase()}.${(el.getAttribute("class") ?? "").split(" ").slice(0, 2).join(".")} h=${el.getBoundingClientRect().height.toFixed(1)} pad=${cs.paddingTop}/${cs.paddingBottom}`,
        );
        for (const sib of Array.from(el.parentElement?.children ?? [])) {
          if (sib !== el && !sib.classList.contains("chart-panel__annotation"))
            chain.unshift(
              `  sibling ${sib.tagName.toLowerCase()}.${(sib.getAttribute("class") ?? "").split(" ")[0]} h=${sib.getBoundingClientRect().height.toFixed(1)}`,
            );
        }
        el = el.parentElement;
      }
      const ann = card.querySelector(".chart-panel__annotation");
      const note = card.querySelector(".chart-panel__truncation-note");
      const header = card.querySelector(".panel-card__header, header");
      return {
        card: r(card)!.height,
        cardWidth: r(card)!.width,
        header: r(header)?.height ?? 0,
        annotation: ann
          ? { h: r(ann)!.height, lines: lines(ann), text: (ann as HTMLElement).innerText }
          : null,
        note: note
          ? {
              h: r(note)!.height,
              lines: lines(note),
              text: (note as HTMLElement).innerText,
              visibleText: visibleText(note),
            }
          : null,
        canvas: r(card.querySelector(".chart-panel__canvas"))!.height,
        canvasWidth: r(card.querySelector(".chart-panel__canvas"))!.width,
        chain,
      };
    });
}

async function seed(
  request: Parameters<typeof deleteExact>[0],
  w: number,
  h: number,
  withControl = false,
) {
  const post = async <T>(url: string, data: unknown) => {
    const res = await request.post(url, { data, headers: { [CSRF_HEADER]: "1" } });
    expect(res.status(), `${url} ${await res.text()}`).toBeLessThan(300);
    return (await res.json()) as T;
  };
  const dash = await post<{ id: string }>("/api/dashboards", { name: "HEL-1398 narrow" });
  // 500 rows > the 200-row page, so the chart is truncated; East is every 2nd row (250 matching).
  const rows = Array.from({ length: 500 }, (_, i) => [["East", "West"][i % 2], i + 1]);
  const source = await post<{ id: string }>("/api/data-sources", {
    name: "HEL-1398 source",
    type: "static",
    columns: [
      { name: "region", type: "string", required: true },
      { name: "revenue", type: "integer", required: true },
    ],
    rows,
  });
  const pipeline = await post<{ id: string }>("/api/pipelines", {
    name: "HEL-1398 pipeline",
    roots: [{ sourceId: source.id }],
  });
  const chart = await post<{ id: string }>(`/api/pipelines/${pipeline.id}/outputs`, {
    kind: "chart",
    name: "HEL-1398 chart",
    config: {
      chartType: "bar",
      fieldMapping: { xAxis: "region", yAxis: "revenue" },
      annotation: "Source: internal sales ledger, refreshed nightly",
    },
  });
  await post(`/api/pipelines/${pipeline.id}/run`, {});
  const panel = await post<{ id: string }>("/api/panels", {
    dashboardId: dash.id,
    title: "HEL-1398 narrow",
    type: "output",
    config: {
      outputId: chart.id,
      ...(withControl
        ? { controls: [{ id: "c1", kind: "dropdown", column: "region", label: "Region" }] }
        : {}),
    },
  });
  // auto-layout normalises sizes, so write the exact lg item (and the other breakpoints) directly.
  const item = { panelId: panel.id, x: 0, y: 0, w, h };
  const layout = { lg: [item], md: [item], sm: [item], xs: [{ ...item, w: Math.min(w, 2) }] };
  const upd = await request.patch(`/api/dashboards/${dash.id}/update`, {
    data: { fields: ["layout"], dashboard: { layout } },
    headers: { [CSRF_HEADER]: "1" },
  });
  expect(upd.status(), await upd.text()).toBe(200);
  return { dashboard: dash.id, pipeline: pipeline.id, source: source.id, panel: panel.id };
}

interface Rect {
  top: number;
  bottom: number;
  height: number;
}

/** Geometry of the w=2 card's stacked regions, in viewport px (null when absent). */
async function geometry(page: Page): Promise<Record<string, Rect | null>> {
  return page.locator(".react-grid-item", { hasText: "HEL-1398 narrow" }).evaluate((card) => {
    const rect = (sel: string) => {
      const el = card.querySelector(sel);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { top: r.top, bottom: r.bottom, height: r.height };
    };
    return {
      card: rect("article.panel-grid-card"),
      top: rect(".panel-grid-card__top"),
      bar: rect(".output-viewer-control-bar"),
      content: rect(".panel-content"),
      canvas: rect(".chart-panel__canvas"),
      annotation: rect(".chart-panel__annotation"),
      note: rect(".chart-panel__truncation-note"),
      footer: rect(".panel-grid-card__footer"),
    };
  });
}

// HEL-1398 cycle 3 -- the title/footer tightening is scoped to chart cards that carry a footnote:
// a table card and a footnote-less chart at the same w=2,h=4 keep their wrapping title and footer.
for (const theme of ["light", "dark"] as const) {
  test(`HEL-1398 scope: non-footnote w=2,h=4 cards keep an unclamped title (${theme})`, async ({
    page,
    request,
  }) => {
    test.setTimeout(180_000);
    await page.addInitScript((t) => window.localStorage.setItem("helio-theme", t), theme);
    const { email } = await registerAndLogin(page, request, {
      prefix: "hel1398s",
      label: theme,
      displayName: "HEL-1398 scope",
      isolate: true,
    });
    const post = async <T>(url: string, data: unknown) => {
      const res = await request.post(url, { data, headers: { [CSRF_HEADER]: "1" } });
      expect(res.status(), `${url} ${await res.text()}`).toBeLessThan(300);
      return (await res.json()) as T;
    };
    const dash = await post<{ id: string }>("/api/dashboards", { name: "HEL-1398 scope" });
    const source = await post<{ id: string }>("/api/data-sources", {
      name: "HEL-1398 scope source",
      type: "static",
      columns: [
        { name: "region", type: "string", required: true },
        { name: "revenue", type: "integer", required: true },
      ],
      rows: [
        ["East", 1],
        ["West", 2],
        ["North", 3],
      ],
    });
    const pipeline = await post<{ id: string }>("/api/pipelines", {
      name: "HEL-1398 scope pipeline",
      roots: [{ sourceId: source.id }],
    });
    const out = (kind: string, name: string, config: unknown) =>
      post<{ id: string }>(`/api/pipelines/${pipeline.id}/outputs`, { kind, name, config });
    const table = await out("table", "scope table", {});
    const chart = await out("chart", "scope chart", {
      chartType: "bar",
      fieldMapping: { xAxis: "region", yAxis: "revenue" },
    });
    await post(`/api/pipelines/${pipeline.id}/run`, {});
    const titles = ["Quarterly revenue table", "Plain chart without footnotes"];
    const p1 = await post<{ id: string }>("/api/panels", {
      dashboardId: dash.id,
      title: titles[0],
      type: "output",
      config: { outputId: table.id },
    });
    const p2 = await post<{ id: string }>("/api/panels", {
      dashboardId: dash.id,
      title: titles[1],
      type: "output",
      config: { outputId: chart.id },
    });
    const item = (panelId: string, x: number) => ({ panelId, x, y: 0, w: 2, h: 4 });
    const layout = {
      lg: [item(p1.id, 0), item(p2.id, 2)],
      md: [item(p1.id, 0), item(p2.id, 2)],
      sm: [item(p1.id, 0), item(p2.id, 2)],
      xs: [item(p1.id, 0), { ...item(p2.id, 0), y: 4 }],
    };
    const upd = await request.patch(`/api/dashboards/${dash.id}/update`, {
      data: { fields: ["layout"], dashboard: { layout } },
      headers: { [CSRF_HEADER]: "1" },
    });
    expect(upd.status(), await upd.text()).toBe(200);
    console.log(`[HEL-1398 e2e] user ${email} created ${dash.id} ${pipeline.id} ${source.id}`);
    try {
      await page.setViewportSize({ width: 1440, height: 1000 });
      await page.goto(`/dashboards/${dash.id}`);
      for (const title of titles) {
        const card = page.locator(".react-grid-item", { hasText: title });
        await expect(card).toBeVisible({ timeout: 20_000 });
        await page.waitForTimeout(800);
        const info = await card.locator(".panel-grid-card__title").evaluate((el) => ({
          clamp: getComputedStyle(el).webkitLineClamp,
          lines: Math.round(
            el.getBoundingClientRect().height / parseFloat(getComputedStyle(el).lineHeight),
          ),
          cardWidth: el.closest(".react-grid-item")!.getBoundingClientRect().width,
        }));
        console.log(`[HEL-1398 scope ${theme}] ${title} ${JSON.stringify(info)}`);
        expect(info.cardWidth, "narrow w=2 card").toBeLessThan(260);
        expect(info.clamp, `${title}: title is not line-clamped`).toBe("none");
        expect(info.lines, `${title}: title wraps over several lines`).toBeGreaterThanOrEqual(2);
      }
    } finally {
      await deleteExact(request, `/api/dashboards/${dash.id}`);
      await deleteExact(request, `/api/pipelines/${pipeline.id}`);
      await deleteExact(request, `/api/data-sources/${source.id}`);
    }
  });
}

// CR2 -- the narrow layout must FIT: canvas and both footnotes inside `.panel-content`, which itself
// sits below the header / control bar and above the footer, at both viewports the w=2 card has two
// widths (1440 -> 216px with a wrapping title; 1900 -> 254px), with and without a control bar.
const TOL = 0.5;
for (const theme of ["light", "dark"] as const) {
  for (const vw of [1440, 1900]) {
    for (const controls of [false, true]) {
      test(`HEL-1398 containment: w=2,h=4 @${vw}px ${controls ? "with" : "no"} control bar (${theme})`, async ({
        page,
        request,
      }) => {
        test.setTimeout(180_000);
        await page.addInitScript((t) => window.localStorage.setItem("helio-theme", t), theme);
        const { email } = await registerAndLogin(page, request, {
          prefix: "hel1398c",
          label: `${theme}-${vw}-${controls ? "ctl" : "std"}`,
          displayName: "HEL-1398 containment",
          isolate: true,
        });
        const ids = await seed(request, 2, 4, controls);
        console.log(`[HEL-1398 e2e] user ${email} created ${JSON.stringify(ids)}`);
        try {
          await page.setViewportSize({ width: vw, height: 1000 });
          await page.goto(`/dashboards/${ids.dashboard}`);
          const card = page.locator(".react-grid-item", { hasText: "HEL-1398 narrow" });
          await expect(card.locator(".chart-panel__truncation-note")).toBeVisible({
            timeout: 20_000,
          });
          await page.waitForTimeout(1_200);
          const g = await geometry(page);
          const tag = `${vw}-${controls ? "ctl" : "std"}-${theme}`;
          console.log(`[HEL-1398 geometry ${tag}] ${JSON.stringify(g)}`);
          writeFileSync(
            evidencePath("HEL-1398", `geometry-${tag}.json`),
            JSON.stringify(g, null, 2),
          );
          await page.mouse.move(0, 0);
          await card.screenshot({ path: evidencePath("HEL-1398", `containment-${tag}.png`) });
          const { content, canvas, annotation, note, footer, top, bar } = g;
          expect(content && canvas && annotation && note && footer && top).toBeTruthy();
          expect(canvas!.top, "canvas starts inside the content box").toBeGreaterThanOrEqual(
            content!.top - TOL,
          );
          for (const [name, r] of [
            ["annotation", annotation!],
            ["note", note!],
            ["canvas", canvas!],
          ] as const) {
            expect(r.bottom, `${name} ends inside the content box`).toBeLessThanOrEqual(
              content!.bottom + TOL,
            );
          }
          expect(content!.top, "content below the header").toBeGreaterThanOrEqual(
            top!.bottom - TOL,
          );
          if (bar) {
            expect(content!.top, "content below the control bar").toBeGreaterThanOrEqual(
              bar.bottom - TOL,
            );
            expect(canvas!.top, "canvas below the control bar").toBeGreaterThanOrEqual(
              bar.bottom - TOL,
            );
          }
          expect(content!.bottom, "content above the footer").toBeLessThanOrEqual(
            footer!.top + TOL,
          );
          expect(note!.height, "the note stays visible").toBeGreaterThan(8);
          expect(annotation!.height, "the annotation stays visible").toBeGreaterThan(8);
          if (!controls) {
            expect(canvas!.height, `canvas (measured ${canvas!.height}px)`).toBeGreaterThanOrEqual(
              MIN_CANVAS_PX,
            );
          } else {
            console.log(`[HEL-1398 control-bar canvas ${tag}] ${canvas!.height}px`);
          }
        } finally {
          await deleteExact(request, `/api/dashboards/${ids.dashboard}`);
          await deleteExact(request, `/api/pipelines/${ids.pipeline}`);
          await deleteExact(request, `/api/data-sources/${ids.source}`);
        }
      });
    }
  }
}

for (const theme of ["light", "dark"] as const) {
  test.describe(`HEL-1398 (${theme})`, () => {
    test.setTimeout(180_000);

    test(`w=2,h=4 chart with annotation + truncation note keeps >= ${MIN_CANVAS_PX}px canvas`, async ({
      page,
      request,
    }) => {
      await page.addInitScript((t) => window.localStorage.setItem("helio-theme", t), theme);
      const { email } = await registerAndLogin(page, request, {
        prefix: "hel1398",
        label: theme,
        displayName: "HEL-1398",
        isolate: true,
      });
      const ids = await seed(request, 2, 4);
      console.log(`[HEL-1398 e2e] user ${email} created ${JSON.stringify(ids)}`);
      try {
        await page.setViewportSize(DESKTOP);
        await page.goto(`/dashboards/${ids.dashboard}`);
        const card = page.locator(".react-grid-item", { hasText: "HEL-1398 narrow" });
        await expect(card.locator(".chart-panel__truncation-note")).toBeVisible({
          timeout: 20_000,
        });
        await page.waitForTimeout(1_000);
        const m = await measure(page, "HEL-1398 narrow", ".react-grid-item");
        console.log(`[HEL-1398 measure desktop ${theme}] ${JSON.stringify(m)}`);
        writeFileSync(
          evidencePath("HEL-1398", `measure-desktop-${theme}.json`),
          JSON.stringify(m, null, 2),
        );
        await page.mouse.move(0, 0);
        await card.screenshot({ path: evidencePath("HEL-1398", `w2-card-${theme}.png`) });

        // Phone stack: report-only (HEL-1438 owns the stack card height).
        await page.setViewportSize(PHONE);
        await expect(page.locator(".mobile-panel-stack")).toBeVisible();
        const stackCard = page.locator(".mobile-panel-stack__item", { hasText: "HEL-1398 narrow" });
        await expect(stackCard.locator(".chart-panel__truncation-note")).toBeVisible({
          timeout: 20_000,
        });
        await page.waitForTimeout(1_000);
        const s = await measure(page, "HEL-1398 narrow", ".mobile-panel-stack__item");
        console.log(`[HEL-1398 measure phone-stack ${theme}] ${JSON.stringify(s)}`);
        writeFileSync(
          evidencePath("HEL-1398", `measure-phone-${theme}.json`),
          JSON.stringify(s, null, 2),
        );
        await stackCard.screenshot({ path: evidencePath("HEL-1398", `phone-card-${theme}.png`) });

        // C2: the narrowest phone viewport still gets the stack's unchanged long form.
        await page.setViewportSize({ width: 320, height: 700 });
        await page.waitForTimeout(800);
        const s320 = await measure(page, "HEL-1398 narrow", ".mobile-panel-stack__item");
        console.log(`[HEL-1398 measure phone-stack-320 ${theme}] ${JSON.stringify(s320)}`);
        writeFileSync(
          evidencePath("HEL-1398", `measure-phone320-${theme}.json`),
          JSON.stringify(s320, null, 2),
        );

        // The assertions (desktop w=2).
        for (const stack of [s, s320]) {
          expect(stack.note!.visibleText, "phone stack keeps the full sentence").toBe(
            "Based on the first 200 of 500 rows.",
          );
          expect(stack.canvas, "phone stack canvas unchanged by the narrow query").toBe(100);
        }
        expect(m.note!.visibleText, "narrow card shows the short form").toBe("200 of 500 rows.");
        for (const f of [m.annotation!, m.note!]) {
          expect(f.lines, "footnotes clamp to one line").toBe(1);
        }
        expect(m.cardWidth, "card is the narrow w=2 card").toBeLessThan(300);
        expect(m.annotation, "annotation rendered").not.toBeNull();
        expect(m.note, "truncation note rendered").not.toBeNull();
        expect(m.canvas, `canvas height (measured ${m.canvas}px)`).toBeGreaterThanOrEqual(
          MIN_CANVAS_PX,
        );
      } finally {
        await deleteExact(request, `/api/dashboards/${ids.dashboard}`);
        await deleteExact(request, `/api/pipelines/${ids.pipeline}`);
        await deleteExact(request, `/api/data-sources/${ids.source}`);
      }
    });

    test(`item 4: "matching rows" wording live under a viewer filter`, async ({
      page,
      request,
    }) => {
      await page.addInitScript((t) => window.localStorage.setItem("helio-theme", t), theme);
      const { email } = await registerAndLogin(page, request, {
        prefix: "hel1398m",
        label: theme,
        displayName: "HEL-1398 matching",
        isolate: true,
      });
      const ids = await seed(request, 6, 6, true);
      console.log(`[HEL-1398 e2e] user ${email} created ${JSON.stringify(ids)}`);
      try {
        await page.setViewportSize(DESKTOP);
        await page.goto(`/dashboards/${ids.dashboard}`);
        const card = page.locator(".react-grid-item", { hasText: "HEL-1398 narrow" });
        const note = card.locator(".chart-panel__truncation-note");
        await expect(note).toBeVisible({ timeout: 20_000 });
        await expect(note).toContainText("rows");
        await expect(note).not.toContainText("matching");
        await page.goto(`/dashboards/${ids.dashboard}?p.${ids.panel}.c1=East`);
        await expect(note).toContainText("matching rows", { timeout: 20_000 });
        const text = await note.innerText();
        console.log(`[HEL-1398 matching ${theme}] ${JSON.stringify(text)}`);
        await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
        await page.mouse.move(0, 0);
        await page.waitForTimeout(800);
        await page.screenshot({ path: evidencePath("HEL-1398", `matching-rows-${theme}.png`) });
      } finally {
        await deleteExact(request, `/api/dashboards/${ids.dashboard}`);
        await deleteExact(request, `/api/pipelines/${ids.pipeline}`);
        await deleteExact(request, `/api/data-sources/${ids.source}`);
      }
    });
  });
}
