import { writeFileSync } from "node:fs";

import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

import { CSRF_HEADER, registerAndLogin } from "./support/auth";
import { evidencePath } from "./support/evidencePath";
import {
  clearLog,
  log,
  RECORDER,
  type Mode,
  type MotionRecord,
  type Theme,
} from "./support/motionRecorder";
import { post, seedWorld, setMotion, setTheme } from "./support/motionPrimitivesSeed";

// HEL-1584 -- the motion pass on the product surfaces, in a REAL browser (jsdom reads every token as 0): the panel grid
// (cold-load entrance, drag lift and settle), the panel detail modal (backdrop, grow-from-card) and the command palette
// (entrance, results stagger), under Full, Subtle, Off and OS reduced motion with no saved choice, in both themes.
//
// Every run records, from inside the page, each animation and transition the browser starts (motionRecorder.ts). Off
// and OS reduce must run nothing that moves for longer than 0.01ms; Subtle fades only; Full is the control that must
// animate (so each assertion can go red). The behavioural tests below it cover the rules about WHEN the grid enters
// (never on a warm switch, a Home round trip or an edit refetch), the width of the new crossfade layers, and the chart
// refresh morph.

test.describe.configure({ mode: "parallel" });
test.use({ viewport: { width: 1440, height: 900 } });

const TICKET = "HEL-1584";
const AUTH = { prefix: "hel1584", displayName: "HEL-1584" } as const;
const INSTANT_MS = 0.01;
const json = { [CSRF_HEADER]: "1" };

/** The surfaces this ticket animates. Other chrome (the rail, the body colour fade on first load) is outside it. */
const SURFACE_TARGET =
  /panel-grid|react-grid|ui-modal|command-palette|crossfade|mobile-panel-stack|save-state/;
const onSurface = (r: MotionRecord) => SURFACE_TARGET.test(r.target);
const slow = (r: MotionRecord) => r.duration > INSTANT_MS;
const cardEnters = (records: MotionRecord[]) =>
  records.filter((r) => r.name === "motion-enter" && r.target.includes("panel-grid-card"));

async function start(
  page: Page,
  request: APIRequestContext,
  mode: Mode,
  label: string,
  theme: Theme = "light",
) {
  await page.addInitScript(RECORDER);
  await registerAndLogin(page, request, { ...AUTH, label, isolate: true });
  await setMotion(request, mode);
  await page.emulateMedia({ reducedMotion: mode === "os-reduce" ? "reduce" : "no-preference" });
  const world = await seedWorld(request, `M-${label}`);
  await setTheme(page, theme);
  return world;
}

async function openDashboard(page: Page, id: string, cards = 3) {
  await page.goto(`/dashboards/${id}`);
  await expect(page.locator(".panel-grid-card")).toHaveCount(cards);
}

/** Sampled animation/transition properties of the open dialog and its backdrop, straight from the cascade. */
async function sampleDialog(page: Page, selector: string) {
  return page.locator(selector).evaluate((dialog) => {
    const own = getComputedStyle(dialog);
    const backdrop = getComputedStyle(dialog, "::backdrop");
    // The dialog's Web Animations (the expand-from), as the first keyframe each one starts from.
    const expandFrames = dialog
      .getAnimations()
      .filter((a) => !(a instanceof CSSAnimation) && !(a instanceof CSSTransition))
      .map((a) => String((a.effect as KeyframeEffect).getKeyframes()[0].transform));
    return {
      expandFrames,
      animationName: own.animationName,
      animationDuration: own.animationDuration,
      animationTimingFunction: own.animationTimingFunction,
      backdropName: backdrop.animationName,
      backdropDuration: backdrop.animationDuration,
    };
  });
}

const seconds = (value: string) => parseFloat(value) * (value.endsWith("ms") ? 1 : 1000);

async function driveSurfaces(page: Page, mode: Mode, theme: Theme, world: { dashboardId: string }) {
  const records: Record<string, MotionRecord[]> = {};
  const collect = async (key: string) => {
    records[key] = await log(page);
    await clearLog(page);
  };
  const shot = (name: string) =>
    page.screenshot({ path: evidencePath(TICKET, `${mode}-${theme}-${name}.png`) });

  // Cold load: the grid enters (Full), and the skeleton grid fades out in place.
  await page.mouse.move(5, 5);
  await page.goto(`/dashboards/${world.dashboardId}`);
  await page.waitForTimeout(250);
  await shot("1-grid-entrance-midflight");
  await expect(page.locator(".panel-grid-card")).toHaveCount(3);
  await expect(page.locator(".chart-panel__canvas canvas").first()).toBeVisible();
  await page.waitForTimeout(1500);
  await collect("load");

  // Drag: lift while held, settle on drop.
  await page.getByRole("button", { name: "Edit layout" }).click();
  await expect(page.locator(".panel-grid--editing")).toBeVisible();
  await page.waitForTimeout(600);
  const items = page.locator(".panel-grid > .react-grid-item");
  const item = items.filter({ hasText: "Metric" }).first();
  await item.scrollIntoViewIfNeeded();
  const card = item.locator(".panel-grid-card");
  const handle = item.locator(".panel-grid-card__handle");
  const box = (await handle.boundingBox())!;
  const hx = box.x + box.width / 2;
  const hy = box.y + box.height / 2;
  await page.mouse.move(hx, hy);
  await page.mouse.down();
  await page.mouse.move(hx + 30, hy + 8, { steps: 4 });
  await page.mouse.move(hx + 120, hy + 8, { steps: 6 });
  await page.waitForTimeout(450);
  const held = await card.evaluate((el) => {
    const transform = getComputedStyle(el).transform;
    return {
      scale: new DOMMatrix(transform === "none" ? undefined : transform).a,
      shadow: getComputedStyle(el).boxShadow,
      itemClass: el.parentElement!.className,
    };
  });
  await shot("2-grid-drag-lift");
  await clearLog(page);
  await page.mouse.up();
  await page.waitForTimeout(700);
  await collect("drag");
  await page.getByRole("button", { name: "Done" }).click();

  // Detail modal: click the card.
  await clearLog(page);
  await page
    .locator(".panel-grid-card", { hasText: "Table" })
    .first()
    .click({ position: { x: 20, y: 40 } });
  await expect(page.locator("dialog.panel-detail-modal[open]")).toBeVisible();
  const modalSample = await sampleDialog(page, "dialog.panel-detail-modal[open]");
  await page.waitForTimeout(80);
  await shot("3-modal-expanding");
  await page.waitForTimeout(500);
  await collect("modal");
  await page.keyboard.press("Escape");
  await expect(page.locator("dialog.panel-detail-modal[open]")).toHaveCount(0);

  // Command palette.
  await clearLog(page);
  await page.evaluate(() => {
    const w = window as unknown as { __gap: { worst: number; frames: number } };
    w.__gap = { worst: -1, frames: 0 };
    const started = performance.now();
    const tick = () => {
      document.querySelectorAll<HTMLElement>(".command-palette__group").forEach((group) => {
        const label = group.querySelector<HTMLElement>(".command-palette__group-label");
        const row = group.querySelector<HTMLElement>("li");
        if (!label || !row) return;
        const gap = Number(getComputedStyle(label).opacity) - Number(getComputedStyle(row).opacity);
        w.__gap.worst = Math.max(w.__gap.worst, gap);
        w.__gap.frames += 1;
      });
      if (performance.now() - started < 900) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  await page.keyboard.press("Control+k");
  await expect(page.locator("dialog.command-palette[open]")).toBeVisible();
  const paletteSample = await sampleDialog(page, "dialog.command-palette[open]");
  await page.waitForTimeout(100);
  await shot("4-palette-open");
  await page.waitForTimeout(600);
  await collect("palette");
  const gap = await page.evaluate(
    () => (window as unknown as { __gap: { worst: number; frames: number } }).__gap,
  );
  await page.keyboard.press("Escape");
  await expect(page.locator("dialog.command-palette[open]")).toHaveCount(0);

  if (mode === "full") {
    // Evidence frames: the same two entrances paused part-way, so a screenshot shows the middle of the motion (a live
    // screenshot lands after the 280ms entrance has finished).
    const freeze = (selector: string, at: number) =>
      page.evaluate(
        async ([sel, time]) => {
          const dialog = await new Promise<HTMLDialogElement>((resolve) => {
            const look = () => {
              const found = document.querySelector<HTMLDialogElement>(sel);
              if (found && found.getAnimations().length > 0) resolve(found);
              else requestAnimationFrame(look);
            };
            look();
          });
          dialog.getAnimations().forEach((a) => {
            a.pause();
            a.currentTime = Number(time);
          });
          document.getAnimations().forEach((a) => {
            const effect = a.effect as KeyframeEffect | null;
            if (effect && effect.pseudoElement === "::backdrop") {
              a.pause();
              a.currentTime = Number(time) / 2;
            }
          });
        },
        [selector, at] as const,
      );
    await page
      .locator(".panel-grid-card", { hasText: "Table" })
      .first()
      .click({ position: { x: 20, y: 40 } });
    await freeze("dialog.panel-detail-modal[open]", 110);
    await shot("5-modal-expand-mid-frame");
    await page.keyboard.press("Escape");
    await expect(page.locator("dialog.panel-detail-modal[open]")).toHaveCount(0);
    await page.keyboard.press("Control+k");
    await freeze("dialog.command-palette[open]", 90);
    await shot("6-palette-mid-frame");
    await page.keyboard.press("Escape");
  }
  return { records, held, modalSample, paletteSample, gap };
}

async function runMatrix(
  mode: Mode,
  theme: Theme,
  { page, request }: { page: Page; request: APIRequestContext },
) {
  test.setTimeout(180_000);
  const world = await start(page, request, mode, `${mode}-${theme}`, theme);
  const {
    records: r,
    held,
    modalSample,
    paletteSample,
    gap,
  } = await driveSurfaces(page, mode, theme, world);
  writeFileSync(
    evidencePath(TICKET, `motion-log-${mode}-${theme}.json`),
    JSON.stringify({ records: r, held, modalSample, paletteSample }, null, 2),
  );
  const all = Object.values(r).flat();

  if (mode === "full") {
    // Grid entrance: the three cards rise in reading order on the emphasized token, one stagger step apart.
    const enters = cardEnters(r.load);
    expect(enters.length, "card entrances recorded").toBeGreaterThanOrEqual(3);
    expect(enters.every((e) => e.moves && Math.abs(e.duration - 420) < 1)).toBe(true);
    expect([...new Set(enters.map((e) => Math.round(e.delay)))].sort((a, b) => a - b)).toEqual([
      0, 40, 80,
    ]);
    // Drag lift: scaled by the lift token and shadowed while held; the item itself has no animation class.
    expect(held.scale).toBeGreaterThan(1.005);
    expect(held.scale).toBeLessThan(1.02);
    expect(held.itemClass).toContain("react-draggable-dragging");
    expect(held.itemClass).not.toMatch(/motion-enter|motion-pop/);
    // Settle: the card's transform transitions back on the overshoot curve.
    const settle = r.drag.filter(
      (x) => x.target.includes("panel-grid-card") && x.name === "transform",
    );
    expect(settle.length, "card settle transition").toBeGreaterThanOrEqual(1);
    expect(settle.some((s) => Math.abs(s.duration - 280) < 1 && s.easing.includes("1.1"))).toBe(
      true,
    );
    // Modal: grows out of the card (one moving Web Animation on the dialog) and the backdrop fades over the quick token.
    const grow = r.modal.filter(
      (x) => x.kind === "waapi" && x.target.includes("ui-modal") && x.moves,
    );
    // One call in a production build; two under the dev server's StrictMode (the first is cancelled by the second).
    expect(grow.length, "expand-from animation").toBeGreaterThanOrEqual(1);
    expect(grow.length, "expand-from animation").toBeLessThanOrEqual(2);
    // Exactly one expansion, and it really starts from the card: scaled down and moved, not an identity (a repeat run of the
    // opening effect, as StrictMode does in dev, once measured the already-transformed dialog and replaced it with one).
    expect(modalSample.expandFrames).toHaveLength(1);
    const start = /translate\((-?[\d.]+)px, (-?[\d.]+)px\) scale\(([\d.]+)\)/.exec(
      modalSample.expandFrames[0],
    );
    expect(start, "a translate and scale start frame").not.toBeNull();
    const [, dx, dy, scale] = start!.map(Number);
    expect(scale, "starts scaled down to the card").toBeLessThan(0.9);
    expect(Math.abs(dx) + Math.abs(dy), "starts away from the dialog").toBeGreaterThan(20);
    expect(grow.every((g) => Math.abs(g.duration - 280) < 1)).toBe(true);
    expect(modalSample.animationName).toBe("ui-modal-fade-in");
    expect(modalSample.backdropName).toBe("ui-modal-backdrop-in");
    expect(seconds(modalSample.backdropDuration)).toBeCloseTo(160, 0);
    // Palette: drops in on the overshoot curve, backdrop fades, results stagger.
    expect(paletteSample.animationName).toBe("command-palette-in");
    expect(paletteSample.animationTimingFunction).toContain("1.1");
    expect(paletteSample.backdropName).toBe("ui-modal-backdrop-in");
    const rows = r.palette.filter((x) => x.name === "motion-enter");
    expect(rows.length, "result rows staggered").toBeGreaterThanOrEqual(4);
    expect(
      [...new Set(rows.map((x) => Math.round(x.delay)))].sort((a, b) => a - b).slice(0, 4),
    ).toEqual([0, 30, 60, 90]);
    // The step is the tight token and the cap bounds the whole list: the last row starts by about 210ms.
    expect(Math.max(...rows.map((x) => x.delay))).toBeLessThanOrEqual(215);
    // A group label is never more visible than its group's first row (no heading over rows that have not started).
    expect(gap.worst, "label opacity minus first-row opacity, worst frame").toBeLessThan(0.05);
    expect(gap.frames, "the sampler saw the entrance").toBeGreaterThan(5);
  } else if (mode === "subtle") {
    // Fades only: nothing that moves, no Web Animation, and the lift is a no-op.
    for (const key of Object.keys(r)) {
      const moving = r[key].filter((x) => onSurface(x) && x.moves && slow(x));
      expect(moving, `${mode}/${theme}/${key}: moving animations`).toEqual([]);
    }
    expect(all.filter((x) => x.kind === "waapi")).toEqual([]);
    expect(held.scale).toBe(1);
    const enters = cardEnters(r.load);
    expect(enters.length, "cards still fade in").toBeGreaterThanOrEqual(3);
    expect(enters.every((e) => !e.moves)).toBe(true);
    expect(modalSample.animationName).toBe("ui-modal-fade-in");
    expect(modalSample.backdropName).toBe("ui-modal-backdrop-in");
    expect(paletteSample.animationName).toBe("ui-modal-fade-in");
  } else {
    // Off and OS reduce with no saved choice: nothing that moves lasts longer than 0.01ms, no Web Animation.
    for (const key of Object.keys(r)) {
      const moving = r[key].filter((x) => onSurface(x) && x.moves && slow(x));
      expect(moving, `${mode}/${theme}/${key}: moving animations`).toEqual([]);
    }
    expect(all.filter((x) => x.kind === "waapi")).toEqual([]);
    expect(
      all.filter((x) => onSurface(x) && slow(x)),
      `${mode}/${theme}: surface animations longer than 0.01ms`,
    ).toEqual([]);
    expect(held.scale, "the lift token resolves to 1").toBe(1);
    expect(seconds(modalSample.backdropDuration)).toBeLessThan(0.1);
    expect(seconds(paletteSample.animationDuration)).toBeLessThan(0.1);
  }
}

for (const mode of ["full", "subtle", "off", "os-reduce"] as const) {
  for (const theme of ["light", "dark"] as const) {
    test(`HEL-1584 grid, modal and palette: ${mode} / ${theme}`, async ({ page, request }) => {
      await runMatrix(mode, theme, { page, request });
    });
  }
}

test.describe("HEL-1584 when the grid enters", () => {
  test("a warm tab switch, a Home round trip and an edit refetch play no entrance; an added panel pops", async ({
    page,
    request,
  }) => {
    test.setTimeout(180_000);
    const world = await start(page, request, "full", "warm");
    // First visit: network load, the cards enter.
    await openDashboard(page, world.dashboardId);
    // HEL-1658: poll the log (a positive assertion) rather than reading it once after a fixed wait.
    await expect
      .poll(async () => cardEnters(await log(page)).length, { message: "first visit enters" })
      .toBeGreaterThanOrEqual(3);
    await clearLog(page);

    // Warm switch: open a second dashboard as a tab (Control-click), then come back to the first tab within the TTL. The
    // tab's panels are restored from the warm copy, not fetched.
    const list = page.locator(".dashboard-list");
    await list
      .getByRole("button", { name: "M-warm Alpha", exact: true })
      .click({ modifiers: ["Control"] });
    await expect(page.getByRole("tab", { name: "M-warm Alpha" })).toBeVisible();
    await page.getByRole("tab", { name: "M-warm Alpha" }).click();
    await expect(page.getByText("No panels yet")).toBeVisible();
    await page.waitForTimeout(900);
    await clearLog(page);
    await page.getByRole("tab", { name: "M-warm Primary" }).click();
    await expect(page.locator(".panel-grid-card")).toHaveCount(3);
    await page.waitForTimeout(1200);
    expect(cardEnters(await log(page)), "warm switch plays no entrance").toEqual([]);
    expect(
      await page.locator("[data-entrance]").count(),
      "no entrance attribute on a warm restore",
    ).toBe(0);

    // Home round trip: leaving the dashboard view and coming back must not replay it.
    await page.getByRole("link", { name: "Helio home" }).click();
    await expect(page).toHaveURL(/\/home/);
    await page.waitForTimeout(500);
    await clearLog(page);
    await page.getByRole("link", { name: "Dashboards" }).first().click();
    await expect(page.locator(".panel-grid-card")).toHaveCount(3);
    await page.waitForTimeout(1200);
    expect(cardEnters(await log(page)), "Home round trip plays no entrance").toEqual([]);

    // Edit refetch: duplicate a panel through its card menu; the grid stays mounted, the new card pops once.
    await clearLog(page);
    const metric = page.locator(".panel-grid-card", { hasText: "M-warm Metric" }).first();
    await metric.hover();
    await metric.getByRole("button", { name: /panel actions/i }).click();
    await page.getByRole("menuitem", { name: "Duplicate" }).click();
    await expect(page.locator(".panel-grid-card")).toHaveCount(4);
    // Wait for the refetch behind the duplicate to land (the new card's data), not just the optimistic append.
    await page.waitForTimeout(2500);
    const entrance = await page
      .locator(".panel-grid > .react-grid-item")
      .evaluateAll((els) => els.map((el) => el.getAttribute("data-entrance")));
    expect(
      entrance.filter((e) => e === "pop"),
      "exactly the new panel pops",
    ).toHaveLength(1);
    expect(
      entrance.filter((e) => e === "enter"),
      "no one else re-enters",
    ).toHaveLength(0);
    const cardPops = async () =>
      (await log(page)).filter(
        (r) => r.name === "motion-enter" && r.target.includes("panel-grid-card"),
      );
    // HEL-1658: the pop's animationstart can land after the 2.5s wait on a slow runner; wait for it, then pin the count.
    await expect.poll(async () => (await cardPops()).length).toBeGreaterThanOrEqual(1);
    const pops = await cardPops();
    expect(pops, "the existing cards do not animate; the new one pops").toHaveLength(1);
    expect(pops[0].delay).toBe(0);
    // The pop runs on the overshoot curve (a CSS animation's curve lives on its keyframes, so read it from the cascade).
    const popCurve = await page
      .locator('.panel-grid > .react-grid-item[data-entrance="pop"] > .panel-grid-card')
      .evaluate((el) => getComputedStyle(el).animationTimingFunction);
    expect(popCurve).toContain("1.1");

    // The refetch happened under the mounted grid: leaving and coming back plays nothing.
    await page.getByRole("link", { name: "Helio home" }).click();
    await expect(page).toHaveURL(/\/home/);
    await page.waitForTimeout(500);
    await clearLog(page);
    await page.getByRole("link", { name: "Dashboards" }).first().click();
    await expect(page.locator(".panel-grid-card")).toHaveCount(4);
    await page.waitForTimeout(1200);
    expect(cardEnters(await log(page)), "add-panel then Home round trip plays no entrance").toEqual(
      [],
    );
  });
});

test.describe("HEL-1584 the new crossfade layers keep their container's width", () => {
  for (const width of [1440, 375] as const) {
    test(`grid root, phone stack and a lazily loaded route at ${width}px`, async ({
      page,
      request,
    }) => {
      test.setTimeout(120_000);
      await page.setViewportSize({ width, height: 900 });
      const world = await start(page, request, "full", `width${width}`);
      await openDashboard(page, world.dashboardId);
      await page.waitForTimeout(1500);
      const dims = await page.evaluate(() => {
        const width = (el: Element | null) => el?.getBoundingClientRect().width ?? -1;
        const zoom = document.querySelector(".panel-list__zoom-container");
        return {
          zoom: width(zoom),
          crossfade: width(zoom?.querySelector(":scope > .crossfade") ?? null),
          layer: width(zoom?.querySelector(":scope > .crossfade > .crossfade__layer") ?? null),
          grid: width(document.querySelector(".panel-grid")),
          stack: width(document.querySelector(".mobile-panel-stack")),
          shell: width(document.querySelector(".panel-grid-shell")),
        };
      });
      expect(dims.zoom).toBeGreaterThan(300);
      expect(Math.abs(dims.crossfade - dims.zoom)).toBeLessThan(1.5);
      expect(Math.abs(dims.layer - dims.zoom)).toBeLessThan(1.5);
      expect(Math.abs(dims.shell - dims.zoom)).toBeLessThan(1.5);
      if (width >= 768) expect(Math.abs(dims.grid - dims.zoom)).toBeLessThan(1.5);
      else expect(Math.abs(dims.stack - dims.zoom)).toBeLessThan(1.5);

      // A lazily loaded route (the proposal review page) is as wide as its outlet.
      await page.goto("/proposals/review");
      await expect(page.locator(".app-tabpanel > .crossfade")).toBeVisible();
      await page.waitForTimeout(800);
      const route = await page.evaluate(() => {
        const outlet = document.querySelector(".app-content") as HTMLElement;
        const width = (el: Element | null) => el?.getBoundingClientRect().width ?? -1;
        return {
          outlet: outlet.clientWidth,
          crossfade: width(outlet.querySelector(".app-tabpanel > .crossfade")),
          layer: width(outlet.querySelector(".app-tabpanel > .crossfade > .crossfade__layer")),
          skeletonStillMounted: !!outlet.querySelector(".crossfade__skeleton"),
        };
      });
      expect(Math.abs(route.crossfade - route.outlet)).toBeLessThan(1.5);
      expect(Math.abs(route.layer - route.outlet)).toBeLessThan(1.5);
      expect(route.skeletonStillMounted, "the fallback is gone once the route has loaded").toBe(
        false,
      );
      await page.screenshot({ path: evidencePath(TICKET, `route-width-${width}.png`) });
    });
  }
});

test.describe("HEL-1584 chart refresh", () => {
  test("a same-shape data refresh morphs the series in place under Full (bars never collapse to zero)", async ({
    page,
    request,
  }) => {
    test.setTimeout(150_000);
    const world = await start(page, request, "full", "refresh");
    await openDashboard(page, world.dashboardId);
    await expect(page.locator(".chart-panel__canvas canvas").first()).toBeVisible();
    await page.waitForTimeout(2500);

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
      .locator(".panel-grid-card", { hasText: "M-refresh Chart" })
      .getByRole("button", { name: "Refresh M-refresh Chart" })
      .click();
    // HEL-1658: wait on the chart's own state, not a wall-clock window. The morph is done once the zrender animation
    // clock has gone unfinished after the click and then finished again; a hard cut never makes it unfinished.
    const chartState = () =>
      page.evaluate(() => {
        const w = window as unknown as {
          __chartBars: Array<{ t: number; sum: number }>;
          __chartEdges: Array<{ t: number; unfinished: boolean }>;
        };
        return { bars: [...w.__chartBars], edges: [...w.__chartEdges] };
      });
    await expect
      .poll(
        async () => {
          const { edges } = await chartState();
          const started = edges.findIndex((e) => e.t >= refreshedAt && e.unfinished);
          return started >= 0 && edges.slice(started + 1).some((e) => !e.unfinished);
        },
        {
          message:
            "the chart animation clock ran (went unfinished, then finished) after the refresh",
        },
      )
      .toBe(true);
    const { bars: samples, edges } = await chartState();
    const started = edges.find((e) => e.t >= refreshedAt && e.unfinished)!;
    const finished = edges.find((e) => e.t > started.t && !e.unfinished)!;

    const settled = samples.filter((b) => b.t < refreshedAt).at(-1)?.sum ?? 0;
    // Frames from the click until one frame after the clock finished: the whole morph, however slow the runner is.
    const after = samples.filter((b) => b.t >= refreshedAt).filter((b) => b.t <= finished.t + 100);
    const final = samples.at(-1)?.sum ?? 0;
    expect(Math.abs(final - settled), "the data really changed").toBeGreaterThan(1);
    expect(
      Math.abs((after.at(-1)?.sum ?? 0) - final),
      "the morph reached the new bars when the clock finished",
    ).toBeLessThan(Math.abs(final - settled) * 0.05);
    const lo = Math.min(settled, final);
    const hi = Math.max(settled, final);
    const between = after
      .map((b) => b.sum)
      .filter((v) => v > lo + (hi - lo) * 0.05 && v < hi - (hi - lo) * 0.05);
    // A hard cut draws 0 frames between the old and the new bars and never starts the animation clock; a slow runner
    // draws fewer frames per tween, so one frame is the floor and the clock edges are the second, hard-cut-proof signal.
    expect(
      between.length,
      "intermediate frames between the old and the new bars (a morph)",
    ).toBeGreaterThanOrEqual(1);
    expect(
      Math.min(...after.map((b) => b.sum)) / settled,
      "bars never collapse toward zero",
    ).toBeGreaterThan(0.4);
    const ids = await page.evaluate(() => {
      const chart = (
        window as unknown as {
          __findChart: () => { getOption(): { series: Array<{ id?: string }> } };
        }
      ).__findChart();
      return chart.getOption().series.map((s) => s.id);
    });
    expect(ids).toEqual(["bar:amount"]);
    writeFileSync(
      evidencePath(TICKET, "chart-refresh-morph.json"),
      JSON.stringify(
        {
          settled,
          final,
          framesBetween: between.length,
          minRatio: Math.min(...after.map((b) => b.sum)) / settled,
          ids,
        },
        null,
        2,
      ),
    );
  });
});

test.describe("HEL-1584 save and run feedback", () => {
  for (const theme of ["light", "dark"] as const) {
    test(`a layout save pops a check beside the save state under Full (${theme})`, async ({
      page,
      request,
    }) => {
      test.setTimeout(150_000);
      const world = await start(page, request, "full", `save-${theme}`, theme);
      await openDashboard(page, world.dashboardId);
      await page.waitForTimeout(1500);
      await page.getByRole("button", { name: "Edit layout" }).click();
      await expect(page.locator(".panel-grid--editing")).toBeVisible();
      await page.waitForTimeout(600);
      const handle = page
        .locator(".panel-grid > .react-grid-item")
        .filter({ hasText: "Metric" })
        .locator(".panel-grid-card__handle");
      const box = (await handle.boundingBox())!;
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(box.x + 140, box.y + 30, { steps: 8 });
      await page.mouse.up();
      await expect(page.getByText("Unsaved changes").first()).toBeVisible();
      await clearLog(page);
      await page.getByRole("button", { name: "Save now" }).first().click();
      const check = page.getByRole("img", { name: "Saved" }).first();
      await expect(check).toBeVisible({ timeout: 10_000 });
      // HEL-1658: the recorder logs the pop on animationstart, which can land a frame after the check is visible.
      const pops = async () =>
        (await log(page)).filter(
          (r) => r.name === "motion-enter" && r.target.includes("motion-pop"),
        );
      await expect
        .poll(async () => (await pops()).length, { message: "the check pops" })
        .toBeGreaterThanOrEqual(1);
      const pop = await pops();
      const checkCurve = await check.evaluate((el) => getComputedStyle(el).animationTimingFunction);
      expect(checkCurve).toContain("1.1");
      await page.screenshot({ path: evidencePath(TICKET, `save-check-${theme}.png`) });
      writeFileSync(evidencePath(TICKET, `save-check-${theme}.json`), JSON.stringify(pop, null, 2));
    });
  }
});
