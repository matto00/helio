import { writeFileSync } from "node:fs";

import { expect, test } from "@playwright/test";

import { CSRF_HEADER, registerAndLogin } from "./support/auth";
import { evidencePath } from "./support/evidencePath";
import { clearLog, log, RECORDER } from "./support/motionRecorder";
import { post, seedWorld, setMotion } from "./support/motionPrimitivesSeed";

// HEL-1573 -- the panel-grid vendor overrides (C2, HEL-1032), a real drag and resize, and the chart entrance (C1,
// HEL-1034), all in a real browser. Split from hel1573-motion-primitives.spec.ts, which holds the per-mode matrix.

test.describe.configure({ mode: "parallel" });
test.use({ video: "on", viewport: { width: 1900, height: 1000 } });

const TICKET = "HEL-1573";
const AUTH = { prefix: "hel1573", displayName: "HEL-1573" } as const;
const json = { [CSRF_HEADER]: "1" };

test.describe("HEL-1573 panel grid vendor overrides (C2) and chart entrance (C1)", () => {
  test("grid: dragging / resizing / placeholder-resizing keep transition none, and our timing wins in either stylesheet order", async ({
    page,
    request,
  }) => {
    test.setTimeout(120_000);
    await page.addInitScript(RECORDER);
    await registerAndLogin(page, request, { ...AUTH, label: "c2", isolate: true });
    await setMotion(request, "full");
    await seedWorld(request, "M-c2");
    await page.goto("/dashboards");
    await expect(page.locator(".panel-grid-card")).toHaveCount(3);
    await page.waitForTimeout(800);

    const read = () =>
      page.evaluate(() => {
        const grid = document.querySelector(".panel-grid") as HTMLElement;
        const item = grid.querySelector(":scope > .react-grid-item") as HTMLElement;
        const timing = (el: Element) => {
          const s = getComputedStyle(el);
          return {
            property: s.transitionProperty,
            duration: s.transitionDuration,
            easing: s.transitionTimingFunction,
          };
        };
        const withClass = (el: HTMLElement, ...names: string[]) => {
          el.classList.add(...names);
          const result = timing(el);
          el.classList.remove(...names);
          return result;
        };
        const placeholder = document.createElement("div");
        placeholder.className = "react-grid-item react-grid-placeholder cssTransforms";
        grid.appendChild(placeholder);
        const out = {
          container: timing(grid),
          item: timing(item),
          dragging: withClass(item, "react-draggable-dragging"),
          resizing: withClass(item, "resizing"),
          placeholder: timing(placeholder),
          placeholderResizing: withClass(placeholder, "placeholder-resizing"),
        };
        placeholder.remove();
        return out;
      });

    const check = (t: Awaited<ReturnType<typeof read>>) => {
      const curve = "cubic-bezier(0.3, 0.9, 0.4, 1)";
      expect(t.container).toMatchObject({ property: "height", duration: "0.28s", easing: curve });
      expect(t.item).toMatchObject({
        property: "transform, width, height",
        easing: `${curve}, ${curve}, ${curve}`,
      });
      expect(t.item.duration).toBe("0.28s, 0.28s, 0.28s");
      // The placeholder sets only the duration and the curve (longhands), so the vendor 100ms cannot survive.
      expect(t.placeholder.duration).toBe("0.28s");
      expect(t.placeholder.easing).toContain(curve);
      for (const none of [t.dragging, t.resizing, t.placeholderResizing]) {
        expect(none.property).toBe("none");
        expect(none.duration).toBe("0s");
      }
    };

    check(await read());
    // Same page, vendor stylesheet moved AFTER ours: the result must not depend on stylesheet order.
    const moved = await page.evaluate(() => {
      const styles = [
        ...document.querySelectorAll("style[data-vite-dev-id], link[rel=stylesheet]"),
      ];
      const vendor = styles.find((s) =>
        (s.getAttribute("data-vite-dev-id") ?? s.getAttribute("href") ?? "").includes(
          "react-grid-layout/css/styles.css",
        ),
      );
      if (!vendor) return false;
      document.head.appendChild(vendor);
      return true;
    });
    expect(moved, "found the vendor react-grid-layout stylesheet").toBe(true);
    check(await read());
  });

  test("chart: the entrance runs about the standard token (not 1000ms) once per mount, and a refresh does not replay it", async ({
    page,
    request,
  }, testInfo) => {
    test.setTimeout(120_000);
    await page.addInitScript(RECORDER);
    await registerAndLogin(page, request, { ...AUTH, label: "chart", isolate: true });
    await setMotion(request, "full");
    const world = await seedWorld(request, "M-chart");
    await page.mouse.move(5, 5);
    await page.goto("/dashboards");
    await expect(page.locator(".chart-panel__canvas canvas").first()).toBeVisible();
    await page.waitForTimeout(2500);

    type Edge = { t: number; unfinished: boolean };
    const edges = () =>
      page.evaluate(() => (window as unknown as { __chartEdges: Edge[] }).__chartEdges);
    const spans = (list: Edge[]) => {
      const out: number[] = [];
      let start: number | null = null;
      for (const e of list) {
        if (e.unfinished && start === null) start = e.t;
        if (!e.unfinished && start !== null) {
          out.push(e.t - start);
          start = null;
        }
      }
      return out;
    };

    const first = spans(await edges());
    testInfo.attach("chart-entrance-spans.json", {
      body: JSON.stringify(first),
      contentType: "application/json",
    });
    expect(
      first.length,
      "the chart entrance ran (the animation clock was busy at least once)",
    ).toBeGreaterThanOrEqual(1);
    const entrance = Math.max(...first);
    // About the token (280ms) plus frame granularity; the library default is 1000ms.
    expect(entrance).toBeGreaterThan(150);
    expect(entrance).toBeLessThan(600);

    // New data (a rebuilt option) arriving through the panel's Refresh must not replay the entrance. The rows really
    // change, so the chart's option differs and echarts-for-react re-applies it.
    const before = (await edges()).length;
    const put = await request.put(`/api/data-sources/${world.sourceId}/rows`, {
      data: {
        rows: [
          ["East", 90],
          ["West", 640],
          ["North", 150],
          ["South", 700],
        ],
      },
      headers: json,
    });
    expect(put.status(), await put.text()).toBe(200);
    await post(request, `/api/pipelines/${world.pipelineId}/run`, {});
    const refreshedAt = await page.evaluate(() => performance.now());
    await page
      .locator(".panel-grid-card", { hasText: "M-chart Chart" })
      .getByRole("button", { name: /refresh/i })
      .click();
    await page.waitForTimeout(1800);
    // And a viewport change (a ResizeObserver-driven rebuild).
    await page.setViewportSize({ width: 1500, height: 1000 });
    await page.waitForTimeout(1500);
    const barSamples = await page.evaluate(
      () => (window as unknown as { __chartBars: Array<{ t: number; sum: number }> }).__chartBars,
    );
    const settledSum = barSamples.filter((b) => b.t < refreshedAt).at(-1)?.sum ?? 0;
    const afterSums = barSamples
      .filter((b) => b.t >= refreshedAt && b.t < refreshedAt + 1800)
      .map((b) => b.sum);
    const minRatio = Math.min(...afterSums) / settledSum;
    // A replayed entrance grows every bar from zero; an update tween between old and new data never collapses them.
    expect(
      minRatio,
      "guard (a same-type refresh never replayed, even before the fix): bars do not collapse toward zero after the refresh",
    ).toBeGreaterThan(0.4);
    // What the browser's own chart instance applied: the entrance is closed (0) while updates keep the token.
    const applied = await page.evaluate(() => {
      const find = (window as unknown as { __findChart: () => unknown }).__findChart;
      const chart = find() as { getOption(): Record<string, unknown> };
      const option = chart.getOption();
      return {
        animationDuration: option.animationDuration,
        animationDurationUpdate: option.animationDurationUpdate,
        animationEasing: option.animationEasing,
      };
    });
    expect(applied).toEqual({
      animationDuration: 0,
      animationDurationUpdate: 280,
      animationEasing: "cubicOut",
    });
    // Replay-capable case. A same-type data refresh never replays (ECharts reuses the view and tweens), so this drives
    // a series-type change, which recreates the view and replays whatever entrance duration the option carries.
    // The option is the one the app applied after the window closed. This calls ECharts directly with that option:
    // the app has no in-place chart-type change (the type lives in the Output editor, a different route), so what
    // this proves is that the duration the app applies (0) is what keeps a recreated view from replaying.
    const replay = await page.evaluate(async () => {
      type Chart = {
        getOption(): Record<string, unknown> & { series: Array<Record<string, unknown>> };
        setOption(option: unknown, notMerge: boolean): void;
      };
      const w = window as unknown as {
        __findChart: () => Chart;
        __chartEdges: Array<{ t: number; unfinished: boolean }>;
        __chartBars: Array<{ t: number; sum: number }>;
      };
      const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
      const chart = w.__findChart();
      const applied = chart.getOption();
      const asLine = { ...applied, series: applied.series.map((s) => ({ ...s, type: "line" })) };
      chart.setOption(asLine, true);
      await wait(1200);
      const from = w.__chartEdges.length;
      const t0 = performance.now();
      chart.setOption({ ...applied }, true);
      await wait(1500);
      let start: number | null = null;
      let longest = 0;
      for (const e of w.__chartEdges.slice(from)) {
        if (e.unfinished && start === null) start = e.t;
        if (!e.unfinished && start !== null) {
          longest = Math.max(longest, e.t - start);
          start = null;
        }
      }
      const sums = w.__chartBars.filter((b) => b.t >= t0).map((b) => b.sum);
      return {
        appliedAnimationDuration: applied.animationDuration,
        longestSpanMs: longest,
        barGrowMinRatio: Math.min(...sums) / (sums[sums.length - 1] || 1),
      };
    });
    expect(replay.longestSpanMs, "a recreated view does not replay the entrance").toBeLessThan(60);
    expect(
      replay.barGrowMinRatio,
      "bars do not grow from zero after a type change",
    ).toBeGreaterThan(0.9);
    expect(replay.appliedAnimationDuration).toBe(0);
    const later = (await edges()).slice(before);
    // The data update itself may tween (animationDurationUpdate keeps the token), but never beyond the token.
    expect(Math.max(0, ...spans(later))).toBeLessThan(600);

    writeFileSync(
      evidencePath(TICKET, "chart-entrance.json"),
      JSON.stringify(
        {
          entranceSpansMs: first,
          afterRefreshSpansMs: spans(later),
          barSumMinRatioAfterRefresh: minRatio,
          optionAppliedAfterRefresh: applied,
          typeChangeReplay: replay,
        },
        null,
        2,
      ),
    );
  });

  test("grid: a real drag and a real resize track the pointer with no transition, and the siblings then reflow at the move token", async ({
    page,
    request,
  }) => {
    test.setTimeout(120_000);
    await page.addInitScript(RECORDER);
    await registerAndLogin(page, request, { ...AUTH, label: "drag", isolate: true });
    await setMotion(request, "full");
    const world = await seedWorld(request, "M-drag");
    await page.goto(`/dashboards/${world.dashboardId}`);
    await expect(page.locator(".panel-grid-card")).toHaveCount(3);
    await page.waitForTimeout(1500);
    await page.getByRole("button", { name: "Edit layout" }).click();

    const items = page.locator(".panel-grid > .react-grid-item");
    const metric = items.filter({ hasText: "M-drag Metric" });
    const probe = (locator: typeof metric) =>
      locator.evaluate((el) => {
        const r = el.getBoundingClientRect();
        return {
          left: r.left,
          top: r.top,
          width: r.width,
          transition: getComputedStyle(el).transitionProperty,
          classes: el.className,
        };
      });

    // Drag by the handle: the item follows the pointer and carries transition: none while it is held.
    const start = await probe(metric);
    const handle = metric.locator(".panel-grid-card__handle");
    const hb = (await handle.boundingBox())!;
    const hx = hb.x + hb.width / 2;
    const hy = hb.y + hb.height / 2;
    await page.mouse.move(hx, hy);
    await page.mouse.down();
    await page.mouse.move(hx + 40, hy + 10, { steps: 4 });
    const samples: Array<{ dx: number; moved: number; transition: string }> = [];
    for (const dx of [120, 260, 420]) {
      await page.mouse.move(hx + dx, hy + 10, { steps: 6 });
      await page.waitForTimeout(60);
      const now = await probe(metric);
      samples.push({ dx, moved: now.left - start.left, transition: now.transition });
    }
    await clearLog(page);
    await page.screenshot({ path: evidencePath(TICKET, "grid-drag-held.png") });
    await page.mouse.up();
    await page.waitForTimeout(700);
    const afterDrag = await log(page);
    for (const sample of samples) {
      expect(sample.transition, `dragging item has no transition at dx=${sample.dx}`).toBe("none");
      expect(
        Math.abs(sample.moved - sample.dx),
        `item tracks the pointer at dx=${sample.dx}`,
      ).toBeLessThan(30);
    }

    // Resize by the SE handle: the width follows the pointer with no transition, then the placeholder settles.
    const w0 = (await probe(metric)).width;
    const rh = (await metric.locator(".react-resizable-handle-se").boundingBox())!;
    const rx = rh.x + rh.width / 2;
    const ry = rh.y + rh.height / 2;
    await page.mouse.move(rx, ry);
    await page.mouse.down();
    await page.mouse.move(rx + 60, ry, { steps: 4 });
    const resizeSamples: Array<{ dx: number; grew: number; transition: string }> = [];
    for (const dx of [150, 300]) {
      await page.mouse.move(rx + dx, ry, { steps: 6 });
      await page.waitForTimeout(60);
      const now = await probe(metric);
      resizeSamples.push({ dx, grew: now.width - w0, transition: now.transition });
    }
    await page.screenshot({ path: evidencePath(TICKET, "grid-resize-held.png") });
    await clearLog(page);
    await page.mouse.up();
    await page.waitForTimeout(700);
    const afterResize = await log(page);
    for (const sample of resizeSamples) {
      expect(sample.transition, `resizing item has no transition at dx=${sample.dx}`).toBe("none");
      expect(
        Math.abs(sample.grew - sample.dx),
        `width tracks the pointer at dx=${sample.dx}`,
      ).toBeLessThan(40);
    }

    // On release the reflow of the other items uses the move token, not 180ms / 200ms.
    const reflow = [...afterDrag, ...afterResize].filter(
      (r) => r.target.includes("react-grid-item") && r.name === "transform",
    );
    writeFileSync(
      evidencePath(TICKET, "grid-drag-resize.json"),
      JSON.stringify(
        { samples, resizeSamples, reflowDurationsMs: reflow.map((r) => r.duration) },
        null,
        2,
      ),
    );
    expect(
      reflow.length,
      "released items settle with a transform transition",
    ).toBeGreaterThanOrEqual(1);
    expect(new Set(reflow.map((r) => Math.round(r.duration)))).toEqual(new Set([280]));
    await page.screenshot({ path: evidencePath(TICKET, "grid-after-release.png") });
  });

  test("shrinking a mounted panel after load keeps every chart canvas and table inside its card (Crossfade sizing, C3)", async ({
    page,
    request,
  }) => {
    test.setTimeout(120_000);
    await registerAndLogin(page, request, { ...AUTH, label: "fit", isolate: true });
    await setMotion(request, "full");
    const world = await seedWorld(request, "M-fit");
    await page.goto(`/dashboards/${world.dashboardId}`);
    await expect(page.locator(".panel-grid-card")).toHaveCount(3);
    await expect(page.locator(".chart-panel__canvas canvas").first()).toBeVisible();
    await page.waitForTimeout(1200);

    const overflow = () =>
      page.evaluate(() => {
        const bad: string[] = [];
        for (const card of document.querySelectorAll(".panel-grid-card")) {
          const edge = card.getBoundingClientRect().right;
          const title = card.querySelector(".panel-grid-card__title")?.textContent ?? "?";
          for (const el of card.querySelectorAll(".chart-panel__canvas canvas, .panel-content")) {
            const right = el.getBoundingClientRect().right;
            if (right > edge + 1)
              bad.push(`${title}: ${el.tagName.toLowerCase()} right ${right} > card ${edge}`);
          }
        }
        return bad;
      });

    // Wider viewport (the lg columns grow, so the cards grow) and back: the mounted canvas must follow the card down.
    expect(await overflow()).toEqual([]);
    await page.setViewportSize({ width: 2500, height: 1000 });
    await page.waitForTimeout(1500);
    await page.setViewportSize({ width: 1900, height: 1000 });
    await page.waitForTimeout(2000);
    const bad = await overflow();
    await page.screenshot({ path: evidencePath(TICKET, "panel-fit-after-shrink.png") });
    expect(bad, "nothing overflows its card after a shrink").toEqual([]);
  });
});
