import { expect, test, type Locator, type Page } from "@playwright/test";

import { attachApiRequestCounter, MAX_WINDOW_TARGET } from "./apiRequestCounter";
import { registerAndLogin } from "./auth";
import { evidencePath } from "./evidencePath";
import { spineRows } from "./pipelineSpine";
import { settleTransitions } from "./settleTransitions";

// HEL-1774: a hidden (`.sr-only`, `position: absolute`) element inside a modal's scrolling body must not stretch the
// dialog's own scroll extent. Absolute children with no positioned ancestor inside `.ui-modal__body` resolve to the
// fixed dialog, so they escape the body's clip. Everything here is measured geometry: the content bottom is taken from
// the in-flow inner column and the body's last in-flow child, never a max over every descendant (that would include
// the absolutely positioned escapees). The spec has two kinds of case per modal:
//  - NATURAL: the modal as shipped. Green in the red run means GUARD (that modal has no escapee today), not a
//    discriminator.
//  - INJECTED: the body is made to overflow (an in-flow spacer of 2x the body's clientHeight) and one `.sr-only`
//    span is appended as the body's LAST child, body scrolled to the top. This is the discriminator for the shared
//    rule: it is red on unfixed CSS for every modal whose body can scroll,
//    except the two GUARD-only palettes (step-palette, command-palette), whose flex-column body absorbs the spacer.

const CSRF = { "X-Helio-Requested-With": "1" };
const AUTH = { prefix: "hel1774", displayName: "HEL-1774", domain: "example.test" } as const;
const OUTPUT_NAME = "hel1774 chart";
const PANEL_TITLE = "hel1774 chart panel";
const EPS = 2;

type Theme = "light" | "dark";

async function post<T>(page: Page, url: string, data: unknown): Promise<T> {
  const res = await page.request.post(url, { data, headers: CSRF });
  expect(res.status(), `${url} ${await res.text()}`).toBeLessThan(300);
  return (await res.json()) as T;
}

interface Seed {
  pipelineId: string;
  dashboardId: string;
  stepId: string;
}

async function seed(page: Page): Promise<Seed> {
  const source = await post<{ id: string }>(page, "/api/data-sources", {
    name: "hel1774-src",
    type: "static",
    columns: [
      { name: "date", type: "string" },
      { name: "duration_s", type: "integer" },
    ],
    rows: Array.from({ length: 8 }, (_, i) => [
      `2026-09-${String(i + 10).padStart(2, "0")}`,
      260 + i * 7,
    ]),
  });
  const pipeline = await post<{ id: string }>(page, "/api/pipelines", {
    name: "hel1774-pipe",
    roots: [{ sourceId: source.id }],
  });
  const sort = await post<{ id: string }>(page, `/api/pipelines/${pipeline.id}/steps`, {
    type: "sort",
    config: { sortBy: [{ field: "date", direction: "asc" }] },
  });
  const output = await post<{ id: string }>(page, `/api/pipelines/${pipeline.id}/outputs`, {
    kind: "chart",
    name: OUTPUT_NAME,
    nodeStepId: sort.id,
    config: { chartType: "line", fieldMapping: { xAxis: "date", yAxis: "duration_s" } },
  });
  await post(page, `/api/pipelines/${pipeline.id}/run`, {});
  const dashboard = await post<{ id: string }>(page, "/api/dashboards", { name: "hel1774-board" });
  await post(page, "/api/panels", {
    dashboardId: dashboard.id,
    title: "hel1774 total",
    type: "text",
  });
  await post(page, "/api/panels", {
    dashboardId: dashboard.id,
    title: PANEL_TITLE,
    type: "output",
    config: { outputId: output.id },
  });
  return { pipelineId: pipeline.id, dashboardId: dashboard.id, stepId: sort.id };
}

async function gotoThemed(page: Page, path: string, theme: Theme): Promise<void> {
  await page.evaluate((t) => window.localStorage.setItem("helio-theme", t), theme);
  await page.goto(path);
  await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
  await page.evaluate(() => document.fonts.ready);
}

interface ModalCase {
  id: string;
  /** Phone tiers move Share into a kebab that did not offer it to this owner in the probe (inventory.md). */
  desktopOnly?: boolean;
  /** Only reachable on the phone tiers (the phone-only sheet). */
  phoneOnly?: boolean;
  /** Opens the modal and returns its dialog locator once it is settled. */
  open: (page: Page, seed: Seed, theme: Theme) => Promise<Locator>;
}

/** Opens the pipeline page's actions menu (desktop spine header or phone header) and clicks one item. */
async function openPipelineMenuItem(
  page: Page,
  s: Seed,
  theme: Theme,
  item: string | RegExp,
): Promise<void> {
  await gotoThemed(page, `/pipelines/${s.pipelineId}`, theme);
  await expect(spineRows(page).first()).toBeVisible();
  await page
    .getByRole("button", { name: /^Pipeline actions/ })
    .first()
    .click();
  await page.getByRole("menuitem", { name: item }).click();
}

/** An action that is a button on the desktop spine and an item of the header menu on the phone. */
async function openSpineAction(page: Page, s: Seed, theme: Theme, name: string): Promise<void> {
  if ((page.viewportSize()?.width ?? 0) >= 1000) {
    await gotoThemed(page, `/pipelines/${s.pipelineId}`, theme);
    await expect(spineRows(page).first()).toBeVisible();
    await page.getByRole("button", { name, exact: true }).first().click();
  } else {
    await openPipelineMenuItem(page, s, theme, name);
  }
}

const openDialog = (page: Page) => page.locator("dialog[open]").last();

const CASES: ModalCase[] = [
  {
    id: "output-editor",
    open: async (page, s, theme) => {
      await gotoThemed(page, `/pipelines/${s.pipelineId}`, theme);
      await expect(spineRows(page).first()).toBeVisible();
      await page.getByRole("button", { name: `Open ${OUTPUT_NAME} output` }).click();
      const d = page.getByRole("dialog", { name: /^(New output|Edit )/ });
      await expect(d.getByLabel("Name")).toBeVisible();
      await expect(d.getByText("Checking column types")).toHaveCount(0);
      const canvas = d.locator(".output-preview-pane__chart canvas").first();
      await expect(canvas).toBeVisible();
      await expect.poll(async () => (await canvas.boundingBox())?.height ?? 0).toBeGreaterThan(20);
      return d;
    },
  },
  {
    id: "create-pipeline",
    open: async (page, _s, theme) => {
      await gotoThemed(page, "/pipelines", theme);
      await page
        .locator("#app-main-content")
        .getByRole("button", { name: "New pipeline" })
        .first()
        .click();
      const d = page.getByRole("dialog", { name: "Create pipeline" });
      await expect(d).toBeVisible();
      return d;
    },
  },
  {
    id: "add-source",
    open: async (page, _s, theme) => {
      await gotoThemed(page, "/sources", theme);
      await page.getByRole("button", { name: "Add source" }).first().click();
      const d = openDialog(page);
      await expect(d).toBeVisible();
      return d;
    },
  },
  {
    id: "dashboard-share",
    desktopOnly: true,
    open: async (page, s, theme) => {
      await gotoThemed(page, `/dashboards/${s.dashboardId}`, theme);
      await page.getByRole("button", { name: "Share dashboard" }).first().click();
      const d = page.getByRole("dialog", { name: /^Share / });
      await expect(d).toBeVisible();
      return d;
    },
  },
  {
    id: "pipeline-share",
    open: async (page, s, theme) => {
      await openPipelineMenuItem(page, s, theme, "Share");
      const d = page.getByRole("dialog", { name: /^Share / });
      await expect(d).toBeVisible();
      return d;
    },
  },
  {
    id: "pipeline-schedule",
    open: async (page, s, theme) => {
      await openPipelineMenuItem(page, s, theme, /(Set|Edit) schedule/);
      const d = page.getByRole("dialog", { name: /schedule/i });
      await expect(d).toBeVisible();
      return d;
    },
  },
  {
    id: "panel-detail-edit",
    open: async (page, s, theme) => {
      await gotoThemed(page, `/dashboards/${s.dashboardId}`, theme);
      await page.getByText("hel1774 total").first().click();
      await page.getByRole("button", { name: "Edit panel" }).click();
      const d = page.locator("dialog.panel-detail-modal");
      await expect(d.getByLabel("Panel title")).toBeVisible();
      return d;
    },
  },
  {
    id: "run-history",
    desktopOnly: true, // the phone pipeline header menu has no Run history item
    open: async (page, s, theme) => {
      await openPipelineMenuItem(page, s, theme, "Run history");
      const d = page.getByRole("dialog", { name: /^Run history/ });
      await expect(d).toBeVisible();
      return d;
    },
  },
  {
    id: "output-history",
    open: async (page, s, theme) => {
      await gotoThemed(page, `/pipelines/${s.pipelineId}`, theme);
      await expect(spineRows(page).first()).toBeVisible();
      await page.getByRole("button", { name: `Output actions for ${OUTPUT_NAME}` }).click();
      await page.getByRole("menuitem", { name: /History/ }).click();
      const d = page.getByRole("dialog", { name: `${OUTPUT_NAME} history` });
      await expect(d).toBeVisible();
      return d;
    },
  },
  {
    id: "step-palette", // GUARD only: its flex-column body absorbs the spacer, injected case is green on unfixed CSS
    open: async (page, s, theme) => {
      await gotoThemed(page, `/pipelines/${s.pipelineId}`, theme);
      await expect(spineRows(page).first()).toBeVisible();
      await page.getByRole("button", { name: /^\+ Add (transformation )?step/ }).click();
      const d = page.getByRole("dialog", { name: "Add step" });
      await expect(d).toBeVisible();
      return d;
    },
  },
  {
    id: "shape-picker",
    open: async (page, s, theme) => {
      await openSpineAction(page, s, theme, "Add Outputs from a shape");
      const d = page.getByRole("dialog", { name: /Add Outputs from a shape/ });
      await expect(d).toBeVisible();
      return d;
    },
  },
  {
    id: "add-root",
    open: async (page, s, theme) => {
      await openSpineAction(page, s, theme, "Add source");
      const d = page.getByRole("dialog", { name: "Add a source" });
      await expect(d).toBeVisible();
      return d;
    },
  },
  {
    id: "command-palette", // GUARD only: same body as step-palette
    open: async (page, _s, theme) => {
      await gotoThemed(page, "/home", theme);
      await expect(page.locator("#app-main-content")).toBeVisible();
      const d = page.getByRole("dialog", { name: "Command palette" });
      await expect(async () => {
        await page.keyboard.press("Control+k");
        await expect(d).toBeVisible({ timeout: 1500 });
      }).toPass({ timeout: 12_000 });
      return d;
    },
  },
  {
    id: "mobile-step-sheet",
    phoneOnly: true,
    open: async (page, s, theme) => {
      await gotoThemed(page, `/pipelines/${s.pipelineId}?step=${s.stepId}`, theme);
      const d = page.getByRole("dialog", { name: "Step editor" });
      await expect(d).toBeVisible();
      return d;
    },
  },
  {
    id: "panel-fullscreen",
    desktopOnly: true, // the phone dashboard is a MobilePanelStack with no card menu, fullscreen button or Add panel here
    open: async (page, s, theme) => {
      await gotoThemed(page, `/dashboards/${s.dashboardId}`, theme);
      await page.getByRole("button", { name: `Fullscreen ${PANEL_TITLE}` }).click();
      const d = page.locator("dialog.panel-fullscreen-overlay[open]").last();
      await expect(d).toBeVisible();
      return d;
    },
  },
  {
    id: "panel-inspect",
    desktopOnly: true, // the phone dashboard is a MobilePanelStack with no card menu, fullscreen button or Add panel here
    open: async (page, s, theme) => {
      await gotoThemed(page, `/dashboards/${s.dashboardId}`, theme);
      await page
        .getByRole("button", { name: new RegExp(`${PANEL_TITLE}.*(actions|menu)`, "i") })
        .first()
        .click();
      await page.getByRole("menuitem", { name: "Inspect" }).click();
      const d = page.getByRole("dialog", { name: `Inspect ${PANEL_TITLE}` });
      await expect(d).toBeVisible();
      return d;
    },
  },
  {
    id: "output-picker",
    desktopOnly: true, // the phone dashboard is a MobilePanelStack with no card menu, fullscreen button or Add panel here
    open: async (page, s, theme) => {
      await gotoThemed(page, `/dashboards/${s.dashboardId}`, theme);
      await page.getByRole("button", { name: "Add panel" }).first().click();
      const d = page.getByRole("dialog").last();
      await expect(d).toBeVisible();
      return d;
    },
  },
  {
    id: "create-connector",
    open: async (page, _s, theme) => {
      await gotoThemed(page, "/connectors", theme);
      await page.getByRole("button", { name: "Add connector" }).first().click();
      const d = page.getByRole("dialog", { name: "Add connector" });
      await expect(d).toBeVisible();
      return d;
    },
  },
  {
    id: "quick-launcher",
    open: async (page, _s, theme) => {
      await gotoThemed(page, "/home", theme);
      await expect(page.locator("#app-main-content")).toBeVisible();
      const d = page.getByRole("dialog", { name: "Assistant conversation" });
      await expect(async () => {
        await page.keyboard.press("Control+j");
        await expect(d).toBeVisible({ timeout: 1500 });
      }).toPass({ timeout: 12_000 });
      return d;
    },
  },
  {
    id: "mfa-enroll",
    open: async (page, _s, theme) => {
      await gotoThemed(page, "/settings", theme);
      await page.getByRole("button", { name: "Enable two-factor authentication" }).click();
      const d = page.getByRole("dialog", { name: "Set up two-factor authentication" });
      await expect(d).toBeVisible();
      return d;
    },
  },
  {
    id: "ask-drawer",
    desktopOnly: true,
    open: async (page, s, theme) => {
      await gotoThemed(page, `/dashboards/${s.dashboardId}`, theme);
      await page
        .getByRole("button", { name: /Ask about this dashboard/ })
        .first()
        .click();
      const d = page.getByRole("dialog", { name: "Ask about this dashboard" });
      await expect(d).toBeVisible();
      return d;
    },
  },
  {
    id: "help-overlay",
    open: async (page, _s, theme) => {
      await gotoThemed(page, "/home", theme);
      await page.locator("body").click({ position: { x: 5, y: 5 } });
      await expect(page.locator("#app-main-content")).toBeVisible();
      const d = page.getByRole("dialog", { name: "Keyboard shortcuts" });
      // The global key handler attaches after the shell mounts; press until it answers.
      await expect(async () => {
        await page.keyboard.press("?");
        await expect(d).toBeVisible({ timeout: 1500 });
      }).toPass({ timeout: 12_000 });
      return d;
    },
  },
];

interface Geometry {
  dialog: { scrollHeight: number; clientHeight: number; contentBottom: number };
  body: { scrollHeight: number; clientHeight: number; contentBottom: number };
}

/** Waits for every finite animation (the modal's open animation scales the dialog, which skews rects mid-flight). */
async function settleAnimations(dialog: Locator): Promise<void> {
  await dialog.page().evaluate(async () => {
    const finite = document
      .getAnimations()
      .filter((a) => a.effect?.getComputedTiming().iterations !== Infinity);
    await Promise.all(finite.map((a) => a.finished.catch(() => undefined)));
  });
}

async function measure(dialog: Locator): Promise<Geometry> {
  await settleAnimations(dialog);
  return dialog.evaluate((dlg: HTMLElement) => {
    const inner = dlg.querySelector(".ui-modal__inner") as HTMLElement;
    const body = dlg.querySelector(".ui-modal__body") as HTMLElement;
    const last = body.lastElementChild as HTMLElement | null;
    const dr = dlg.getBoundingClientRect();
    const br = body.getBoundingClientRect();
    const inFlowBottom = (el: HTMLElement | null) => {
      // The last child that is in flow (the injected span is absolute, so it is skipped).
      let e = el;
      while (e && getComputedStyle(e).position === "absolute") {
        e = e.previousElementSibling as HTMLElement | null;
      }
      return e ? e.getBoundingClientRect().bottom : br.top;
    };
    return {
      dialog: {
        scrollHeight: dlg.scrollHeight,
        clientHeight: dlg.clientHeight,
        contentBottom: inner.getBoundingClientRect().bottom - dr.top + dlg.scrollTop,
      },
      body: {
        scrollHeight: body.scrollHeight,
        clientHeight: body.clientHeight,
        contentBottom:
          inFlowBottom(last) -
          br.top +
          body.scrollTop +
          parseFloat(getComputedStyle(body).paddingBottom),
      },
    };
  });
}

interface AbsChild {
  el: string;
  position: string;
  containingBlock: string;
  hidden: boolean;
  rect: { top: number; left: number; width: number; height: number };
}

/** Every `position: absolute|fixed` descendant of the body, with its containing block and whether it is hidden. */
async function listPositioned(dialog: Locator): Promise<AbsChild[]> {
  return dialog.evaluate((dlg: HTMLElement) => {
    const body = dlg.querySelector(".ui-modal__body") as HTMLElement;
    const out: AbsChild[] = [];
    for (const e of Array.from(body.querySelectorAll<HTMLElement>("*"))) {
      if (e.hasAttribute("data-hel1774-hidden") || e.hasAttribute("data-hel1774-spacer")) continue;
      const cs = getComputedStyle(e);
      if (cs.position !== "absolute" && cs.position !== "fixed") continue;
      let cb = "dialog";
      for (let a = e.parentElement; a && a !== dlg; a = a.parentElement) {
        if (getComputedStyle(a).position === "static") continue;
        cb =
          a === body ? "body" : `${a.tagName.toLowerCase()}.${String(a.className).split(" ")[0]}`;
        break;
      }
      const r = e.getBoundingClientRect();
      const clipped = cs.clip !== "auto" && cs.clip !== "";
      out.push({
        el: `${e.tagName.toLowerCase()}.${String(e.className).split(" ")[0]}`,
        position: cs.position,
        containingBlock: cb,
        hidden: clipped || (r.width <= 1 && r.height <= 1) || cs.opacity === "0",
        rect: { top: r.top, left: r.left, width: r.width, height: r.height },
      });
    }
    return out;
  });
}

/** Makes the body overflow with an in-flow spacer, then appends one `.sr-only` span as its LAST child. */
async function injectHidden(dialog: Locator): Promise<void> {
  await dialog.evaluate((dlg: HTMLElement) => {
    const body = dlg.querySelector(".ui-modal__body") as HTMLElement;
    const spacer = document.createElement("div");
    spacer.setAttribute("data-hel1774-spacer", "");
    spacer.style.height = `${Math.max(body.clientHeight, window.innerHeight) * 2}px`;
    body.appendChild(spacer);
    const span = document.createElement("span");
    span.className = "sr-only";
    span.setAttribute("data-hel1774-hidden", "");
    span.textContent = "hidden helper text";
    body.appendChild(span);
    body.scrollTop = 0;
    dlg.scrollTop = 0;
  });
}

function expectBounded(g: Geometry, what: string): void {
  // A box that fills its container (the phone step sheet's body) legitimately has scrollHeight == clientHeight above
  // its content, so the bound is the larger of the content bottom and the box's own height.
  expect(
    g.dialog.scrollHeight,
    `${what}: dialog scrollHeight ${g.dialog.scrollHeight} vs content bottom ${g.dialog.contentBottom}`,
  ).toBeLessThanOrEqual(Math.max(g.dialog.contentBottom, g.dialog.clientHeight) + EPS);
  expect(
    g.body.scrollHeight,
    `${what}: body scrollHeight ${g.body.scrollHeight} vs content bottom ${g.body.contentBottom}`,
  ).toBeLessThanOrEqual(Math.max(g.body.contentBottom, g.body.clientHeight) + EPS);
}

const VIEWPORTS = [
  { width: 375, height: 812 },
  { width: 390, height: 844 },
  { width: 1280, height: 800 },
];

/** Logs the user's /api traffic and fails the test when it nears the per-user rate limit (CI defaults, no overrides). */
function expectUnderRateLimit(counter: ReturnType<typeof attachApiRequestCounter>, label: string) {
  const r = counter.report();
  console.log(`[HEL-1774 api] ${label} ${counter.describe()}`);
  expect(r.count429, `${label}: ${counter.describe()}`).toBe(0);
  expect(r.maxWindow, `${label}: ${counter.describe()}`).toBeLessThanOrEqual(MAX_WINDOW_TARGET);
}

/**
 * One spec file per modal group (HEL-1778 precedent: no single heavy file; each test registers its own user and
 * stays far under the per-user /api rate limit, which is never raised for this guard).
 * Per viewport and theme, every listed case is measured natural and with an injected hidden element.
 */
export function registerModalScrollSuite(group: string, ids: string[], withPopover = false): void {
  const cases = CASES.filter((c) => ids.includes(c.id));
  if (cases.length !== ids.length) throw new Error(`unknown modal case id in ${group}`);
  for (const vp of VIEWPORTS) {
    for (const theme of ["light", "dark"] as const) {
      test.describe(`HEL-1774 modal scroll extent (${group}): ${vp.width}x${vp.height}, ${theme}`, () => {
        test.use({ viewport: vp, actionTimeout: 15_000 });
        test.setTimeout(180_000);

        test("every modal in the group ends at its content, natural and with an injected hidden element", async ({
          page,
          request,
        }) => {
          const applicable = cases.filter((c) =>
            vp.width >= 1000 ? !c.phoneOnly : !c.desktopOnly,
          );
          test.skip(
            applicable.length === 0,
            `no modal of group ${group} is reachable at ${vp.width}px (desktop-only cases)`,
          );
          const counter = attachApiRequestCounter(page);
          await registerAndLogin(page, request, {
            ...AUTH,
            label: `${group}-${vp.width}-${theme}`,
          });
          const s = await seed(page);
          const failures: string[] = [];
          for (const c of cases) {
            if (c.desktopOnly && vp.width < 1000) continue;
            if (c.phoneOnly && vp.width >= 1000) continue;
            const label = `${c.id} ${vp.width}x${vp.height} ${theme}`;
            await test.step(`${c.id} natural`, async () => {
              const d = await c.open(page, s, theme);
              await settleTransitions(page);
              const g = await measure(d);
              console.log(`[HEL-1774 natural] ${label} ${JSON.stringify(g)}`);
              try {
                expectBounded(g, `${label} natural`);
              } catch (e) {
                failures.push((e as Error).message.split("\n")[0]);
              }
              await settleAnimations(d);
              await page.evaluate(
                () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
              );
              console.log(`[HEL-1774 abs] ${label} ${JSON.stringify(await listPositioned(d))}`);
              await injectHidden(d);
              const gi = await measure(d);
              console.log(`[HEL-1774 injected] ${label} ${JSON.stringify(gi)}`);
              await page.screenshot({
                path: evidencePath("HEL-1774", `${c.id}-${vp.width}-${theme}.png`),
              });
              try {
                expectBounded(gi, `${label} injected`);
              } catch (e) {
                failures.push((e as Error).message.split("\n")[0]);
              }
            });
          }
          expectUnderRateLimit(counter, `${group} ${vp.width} ${theme}`);
          expect(failures, failures.join("\n")).toEqual([]);
        });
      });
    }
  }

  if (!withPopover) return;
  // GUARD, not a discriminator (green with and without the rule). A popover portalled out of a modal (Select's
  // `position: fixed` listbox) must open exactly where it did before the body became positioned: `position: relative`
  // is not a containing block for fixed descendants. Measured at rest as the listbox's gap to its trigger; the same
  // rects are logged on unfixed CSS and under the fix (design.md Resolution).
  for (const vp of [VIEWPORTS[0], VIEWPORTS[2]]) {
    test.describe(`HEL-1774 popover inside a modal: ${vp.width}x${vp.height}`, () => {
      test.use({ viewport: vp, actionTimeout: 15_000 });
      test.setTimeout(120_000);

      test("the Select listbox opens adjacent to its trigger", async ({ page, request }) => {
        const counter = attachApiRequestCounter(page);
        await registerAndLogin(page, request, { ...AUTH, label: `popover-${vp.width}` });
        const s = await seed(page);
        const schedule = CASES.find((c) => c.id === "pipeline-schedule")!;
        const d = await schedule.open(page, s, "light");
        await settleAnimations(d);
        const trigger = d.getByRole("combobox").first();
        await trigger.click();
        const listbox = page.getByRole("listbox").first();
        await expect(listbox).toBeVisible();
        await settleAnimations(d);
        const t = (await trigger.boundingBox())!;
        const l = (await listbox.boundingBox())!;
        console.log(`[HEL-1774 popover] ${vp.width} ${JSON.stringify({ trigger: t, listbox: l })}`);
        const gap = Math.min(Math.abs(l.y - (t.y + t.height)), Math.abs(l.y + l.height - t.y));
        expect(gap, "listbox is adjacent to its trigger").toBeLessThanOrEqual(12);
        expectUnderRateLimit(counter, `popover ${vp.width}`);
      });
    });
  }
}
