import { writeFileSync } from "node:fs";

import { expect, test, type APIRequestContext, type Page, type TestInfo } from "@playwright/test";

import { registerAndLogin } from "./support/auth";
import { evidencePath } from "./support/evidencePath";
import {
  clearLog,
  log,
  RECORDER,
  type Mode,
  type MotionRecord,
  type Theme,
} from "./support/motionRecorder";
import { seedWorld, setMotion, setTheme } from "./support/motionPrimitivesSeed";

// HEL-1573 -- the shared motion primitives in a REAL browser (jsdom reads every token as 0 and cannot prove motion
// timing): staggered entrance (dashboard list), layout slide (dashboard list FLIP), crossfade (panel body), indicator
// slide (app rail + segmented control), panel-grid reflow timing (HEL-1032; see hel1573-motion-grid-chart.spec.ts).
//
// Every test records, from inside the page, each animation/transition the browser actually starts (CSS animations,
// CSS transitions, Web Animations) with its resolved duration and whether it moves anything, then asserts per Motion
// mode: Full animates (the control that can go red), Subtle keeps fades but nothing moves, Off and OS-reduce-with-no-
// saved-choice run nothing longer than 0.01ms. Both themes are covered, with screenshots and a recording per mode.

test.describe.configure({ mode: "parallel" });
test.use({ video: "on", viewport: { width: 1900, height: 1000 } });

const TICKET = "HEL-1573";
const AUTH = { prefix: "hel1573", displayName: "HEL-1573" } as const;
const INSTANT_MS = 0.01;

const slow = (r: MotionRecord) => r.duration > INSTANT_MS;
/** The primitives' own elements. Other surfaces (the body colour fade before the saved preference is applied on a
 *  first load, a spinner, the actions-menu popover's translate entrance) are outside this ticket's primitives. */
const PRIMITIVE_TARGET =
  /dashboard-list__item|motion-indicator|react-grid-item|react-grid-layout|panel-grid|crossfade/;
const isPrimitive = (r: MotionRecord) => PRIMITIVE_TARGET.test(r.target);
const byName = (records: MotionRecord[], name: string) => records.filter((r) => r.name === name);
/** The dashboard list rows' stagger (this spec's subject). The panel cards enter on the emphasized token since HEL-1584 (their
 *  own spec, hel1584-motion-surfaces.spec.ts), which is a different `motion-enter` record on a different target. */
const rowEnters = (records: MotionRecord[]) =>
  byName(records, "motion-enter").filter((r) => r.target.includes("dashboard-list__item"));

function save(page: Page, mode: Mode, theme: Theme, shot: string) {
  return page.screenshot({ path: evidencePath(TICKET, `${mode}-${theme}-${shot}.png`) });
}

/** Drives every primitive once and returns what the browser animated, per primitive. */
async function drivePrimitives(page: Page, mode: Mode, theme: Theme, tag: string) {
  const records: Record<string, MotionRecord[]> = {};
  const collect = async (key: string) => {
    records[key] = await log(page);
    await clearLog(page);
  };

  // Stagger + crossfade + grid: load the app home (the primary dashboard is selected and its panels load).
  await page.goto("/dashboards");
  await expect(page.locator("li.dashboard-list__item")).toHaveCount(5);
  await page.waitForTimeout(120);
  await save(page, mode, theme, "1-stagger-midflight");
  await expect(page.locator(".panel-grid-card")).toHaveCount(3);
  await expect(page.locator(".chart-panel__canvas canvas").first()).toBeVisible();
  await page.waitForTimeout(1500);
  await save(page, mode, theme, "2-home-settled");
  await collect("load");

  // Rail indicator: navigate to another destination; the indicator must end on the active item.
  await page.getByRole("link", { name: "Data Pipelines" }).click();
  await expect(page.getByRole("link", { name: "Data Pipelines" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await page.waitForTimeout(600);
  const railFit = await page.evaluate(() => {
    const indicator = document
      .querySelector(".app-rail .motion-indicator")!
      .getBoundingClientRect();
    const active = document
      .querySelector(".app-rail [data-indicator-active]")!
      .getBoundingClientRect();
    return {
      dx: indicator.left - active.left,
      dy: indicator.top - active.top,
      dw: indicator.width - active.width,
    };
  });
  expect(Math.abs(railFit.dx)).toBeLessThan(1.5);
  expect(Math.abs(railFit.dy)).toBeLessThan(1.5);
  expect(Math.abs(railFit.dw)).toBeLessThan(1.5);
  await save(page, mode, theme, "3-rail-indicator");
  await collect("rail");

  // Segmented indicator: Settings > Appearance density radios (not the Motion group: that would change the mode).
  await page.goto("/settings");
  const density = page.getByRole("radiogroup", { name: /density/i });
  await expect(density).toBeVisible();
  await clearLog(page);
  await density.getByRole("radio", { name: /compact/i }).click();
  await page.waitForTimeout(600);
  const segFit = await density.evaluate((group) => {
    const indicator = group.querySelector(".motion-indicator")!.getBoundingClientRect();
    const active = group.querySelector("[data-indicator-active]")!.getBoundingClientRect();
    return { dx: indicator.left - active.left, dw: indicator.width - active.width };
  });
  expect(Math.abs(segFit.dx)).toBeLessThan(1.5);
  expect(Math.abs(segFit.dw)).toBeLessThan(1.5);
  await save(page, mode, theme, "4-segmented-indicator");
  await collect("segmented");
  await density.getByRole("radio", { name: /comfortable/i }).click();

  // Layout slide: delete a dashboard near the top (the list is newest first); the rows below move up.
  await page.goto("/dashboards");
  await expect(page.locator("li.dashboard-list__item")).toHaveCount(5);
  await page.waitForTimeout(1200);
  await clearLog(page);
  // The row actions are revealed on hover (collapsed at rest), as for a real pointer.
  await page.getByRole("button", { name: `${tag} Delta`, exact: true }).hover();
  await page.getByRole("button", { name: `${tag} Delta actions` }).click();
  await page.getByRole("menuitem", { name: "Delete" }).click();
  await page.getByRole("button", { name: "Confirm" }).click();
  await expect(page.locator("li.dashboard-list__item")).toHaveCount(4);
  await page.waitForTimeout(600);
  await save(page, mode, theme, "5-after-delete");
  await collect("layoutSlide");

  // Grid reflow: a lg -> md breakpoint change moves every item.
  await clearLog(page);
  await page.setViewportSize({ width: 1500, height: 1000 });
  await page.waitForTimeout(900);
  await save(page, mode, theme, "6-grid-md");
  await collect("grid");
  await page.setViewportSize({ width: 1900, height: 1000 });
  return records;
}

function expectInstantOrStill(all: MotionRecord[], what: string) {
  const records = all.filter(isPrimitive);
  const moving = records.filter((r) => r.moves && slow(r));
  expect(moving, `${what}: moving animations longer than 0.01ms`).toEqual([]);
  const waapi = all.filter((r) => r.kind === "waapi");
  expect(waapi, `${what}: no Web Animations call at all`).toEqual([]);
}

async function runMode(
  mode: Mode,
  theme: Theme,
  { page, request }: { page: Page; request: APIRequestContext },
  testInfo: TestInfo,
) {
  test.setTimeout(180_000);
  await page.addInitScript(RECORDER);
  await registerAndLogin(page, request, { ...AUTH, label: mode, isolate: true });
  await setMotion(request, mode);
  if (mode === "os-reduce") await page.emulateMedia({ reducedMotion: "reduce" });
  else await page.emulateMedia({ reducedMotion: "no-preference" });

  // One user per (mode, theme) test: the API rate-limits each user to 120 requests a minute (HEL-495), and one
  // pass is most of that.
  {
    const tag = `M-${mode}-${theme}`;
    await seedWorld(request, tag);
    await setTheme(page, theme);
    const r = await drivePrimitives(page, mode, theme, tag);
    testInfo.attach(`motion-log-${mode}-${theme}.json`, {
      body: JSON.stringify(r, null, 2),
      contentType: "application/json",
    });
    const all = Object.values(r).flat();
    writeFileSync(
      evidencePath(TICKET, `motion-log-${mode}-${theme}.json`),
      JSON.stringify(r, null, 2),
    );

    // The data-motion root attribute and the resolved tokens in this very browser.
    const tokens = await page.evaluate(() => {
      const s = getComputedStyle(document.documentElement);
      return {
        dataMotion: document.documentElement.getAttribute("data-motion"),
        move: s.getPropertyValue("--motion-duration-move").trim(),
        rise: s.getPropertyValue("--motion-rise-distance").trim(),
        standard: s.getPropertyValue("--motion-duration-standard").trim(),
      };
    });

    if (mode === "full") {
      // Stagger: rows rise and fade in (moves, token duration), index-delayed.
      const enter = rowEnters(r.load);
      expect(enter.length, "stagger entrances recorded").toBeGreaterThanOrEqual(5);
      expect(
        enter.some((e) => !e.inferred),
        "at least one real (not inferred) record",
      ).toBe(true);
      expect(enter.every((e) => e.moves && Math.abs(e.duration - 280) < 1)).toBe(true);
      // One stagger step (40ms) per row, in order, starting at 0 and capped near 400ms.
      const delays = [...new Set(enter.map((e) => Math.round(e.delay)))].sort((a, b) => a - b);
      expect(delays.slice(0, 5), "stagger delays").toEqual([0, 40, 80, 120, 160]);
      expect(Math.max(...delays)).toBeLessThanOrEqual(400);
      // Layout slide: a Web Animations FLIP over the move token.
      const slide = r.layoutSlide.filter((x) => x.kind === "waapi" && x.moves);
      expect(slide.length, "layout slide FLIPs after a delete").toBeGreaterThanOrEqual(2);
      expect(slide.every((s) => Math.abs(s.duration - 280) < 1)).toBe(true);
      // Indicators: transform transitions at the move token on the ease-out curve.
      for (const key of ["rail", "segmented"] as const) {
        const t = r[key].filter(
          (x) => x.target.includes("motion-indicator") && x.name === "transform",
        );
        expect(t.length, `${key} indicator transform transition`).toBeGreaterThanOrEqual(1);
        expect(Math.abs(t[0].duration - 280)).toBeLessThan(1);
        expect(t[0].easing).toContain("cubic-bezier(0.3, 0.9, 0.4, 1)");
      }
      // Crossfade: the content fades in over the standard token, opacity only.
      const fade = byName(r.load, "crossfade-in");
      expect(fade.length, "crossfade-in recorded").toBeGreaterThanOrEqual(1);
      expect(fade.every((f) => !f.moves && Math.abs(f.duration - 280) < 1)).toBe(true);
      // Grid: items reflow with the move token (HEL-1032), not 180ms / 200ms.
      const gridT = r.grid.filter(
        (x) => x.target.includes("react-grid-item") && x.name === "transform",
      );
      expect(gridT.length, "grid items transition their transform").toBeGreaterThanOrEqual(1);
      expect(new Set(gridT.map((g) => Math.round(g.duration)))).toEqual(new Set([280]));
      expect(gridT[0].easing).toContain("cubic-bezier(0.3, 0.9, 0.4, 1)");

      // The resolved tokens are the cause; the behaviour above is the effect that matters.
      expect(tokens).toMatchObject({
        dataMotion: "full",
        move: "280ms",
        rise: "6px",
        standard: "280ms",
      });
    } else if (mode === "subtle") {
      for (const key of Object.keys(r)) expectInstantOrStill(r[key], `${mode}/${theme}/${key}`);
      // Fades survive: the stagger still fades over the standard token (no displacement), and the crossfade runs.
      const enter = rowEnters(r.load);
      expect(enter.length).toBeGreaterThanOrEqual(5);
      expect(
        enter.some((e) => !e.inferred),
        "at least one real (not inferred) record",
      ).toBe(true);
      expect(enter.every((e) => !e.moves && Math.abs(e.duration - 280) < 1)).toBe(true);
      expect(byName(r.load, "crossfade-in").some((f) => Math.abs(f.duration - 280) < 1)).toBe(true);
      expect(tokens).toMatchObject({
        dataMotion: "subtle",
        move: "0.01ms",
        rise: "0px",
        standard: "280ms",
      });
    } else {
      for (const key of Object.keys(r)) expectInstantOrStill(r[key], `${mode}/${theme}/${key}`);
      // Off runs nothing visible at all: not even a fade longer than the instant.
      expect(
        all.filter((r) => isPrimitive(r) && slow(r)),
        `${mode}/${theme}: primitive animations longer than 0.01ms`,
      ).toEqual([]);
      expect(tokens).toMatchObject({
        dataMotion: mode === "off" ? "off" : null,
        move: "0.01ms",
        rise: "0px",
        standard: "0.01ms",
      });
    }
  }

  await page.close();
  const video = page.video();
  if (video) await video.saveAs(evidencePath(TICKET, `${mode}-${theme}.webm`));
}

for (const mode of ["full", "subtle", "off", "os-reduce"] as const) {
  for (const theme of ["light", "dark"] as const) {
    test(`HEL-1573 primitives under Motion = ${mode}, ${theme} theme`, async ({
      page,
      request,
    }, testInfo) => {
      await runMode(mode, theme, { page, request }, testInfo);
    });
  }
}

test("HEL-1573 the Motion group's own indicator snaps when Motion changes from Full to Subtle", async ({
  page,
  request,
}) => {
  test.setTimeout(120_000);
  await registerAndLogin(page, request, { ...AUTH, label: "motion-group", isolate: true });
  await setMotion(request, "full");
  await page.goto("/settings");
  const group = page.getByRole("radiogroup", { name: "Motion" });
  await expect(group.getByRole("radio", { name: "Full", checked: true })).toBeVisible();
  await page.waitForTimeout(800);
  // Click through the DOM and sample every frame from the same task, so the first frames cannot be missed.
  const trace = await page.evaluate(async () => {
    const radiogroup = document.querySelector(
      '[role="radiogroup"][aria-label="Motion"]',
    ) as HTMLElement;
    const indicator = radiogroup.querySelector(".motion-indicator") as HTMLElement;
    const frame = () => new Promise<number>((resolve) => requestAnimationFrame((t) => resolve(t)));
    (radiogroup.querySelectorAll('[role="radio"]')[1] as HTMLElement).click();
    const frames: Array<{ left: number; running: string[] }> = [];
    for (let i = 0; i < 6; i++) {
      await frame();
      frames.push({
        left: indicator.getBoundingClientRect().left,
        running: indicator
          .getAnimations()
          .filter((a) => a.playState === "running")
          .map((a) => (a as CSSTransition).transitionProperty),
      });
    }
    await new Promise((resolve) => setTimeout(resolve, 600));
    const final = (
      radiogroup.querySelector("[data-indicator-active]") as HTMLElement
    ).getBoundingClientRect().left;
    return { frames, final, motion: document.documentElement.getAttribute("data-motion") };
  });
  writeFileSync(
    evidencePath(TICKET, "motion-group-indicator.json"),
    JSON.stringify(trace, null, 2),
  );
  expect(trace.motion).toBe("subtle");
  // By the second frame the indicator is already where it ends up, with nothing still transitioning.
  expect(Math.abs(trace.frames[1].left - trace.final)).toBeLessThan(1.5);
  for (const f of trace.frames.slice(1)) expect(f.running).toEqual([]);
});
