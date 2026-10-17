import { writeFileSync } from "node:fs";

import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { currentUserId, registerAndLogin } from "./support/auth";
import { evidencePath } from "./support/evidencePath";
import { setUserTierForTest } from "./support/historySeed";
import { settleTransitions } from "./support/settleTransitions";

// Every test registers its own user and seeds its own data, so tests are independently schedulable.
test.describe.configure({ mode: "parallel" });

// HEL-1583 Phase B -- the five-tab glass bottom nav (Home, Dashboards, Data, Pipelines, Me), the expanding labelled
// active tab, the opaque active pill, and the phone "refreshed" line, measured from RENDERED pixels (jsdom evaluates no
// layout, no media queries and no backdrop-filter). Contrast is sampled from screenshots of the nav over each backdrop
// the spec names, after `document.fonts.ready`.

const AUTH = { prefix: "hel1583b", displayName: "HEL-1583 B", domain: "example.com" } as const;
const CSRF = { "X-Helio-Requested-With": "1" };
const THEMES = ["light", "dark"] as const;
const NAV = "nav[aria-label='Primary']";

async function setTheme(page: Page, theme: string) {
  await page.addInitScript((t) => window.localStorage.setItem("helio-theme", t), theme);
}

async function openAt(
  page: Page,
  request: APIRequestContext,
  width: number,
  theme: string,
  label: string,
  path = "/dashboards",
) {
  await page.setViewportSize({ width, height: 800 });
  await setTheme(page, theme);
  await registerAndLogin(page, request, { ...AUTH, label });
  await page.goto(path);
  await expect(page.locator(".bottom-nav")).toBeVisible();
  await settleNav(page);
}

async function settleNav(page: Page) {
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  await settleTransitions(page, 2000);
}

interface Box {
  left: number;
  right: number;
  top: number;
  bottom: number;
  width: number;
  height: number;
}

/** Geometry of the nav, its tabs, lozenges, labels and icons, all from rendered boxes. */
async function navGeometry(page: Page) {
  return page.evaluate(() => {
    const box = (el: Element): Box => {
      const r = el.getBoundingClientRect();
      return {
        left: r.left,
        right: r.right,
        top: r.top,
        bottom: r.bottom,
        width: r.width,
        height: r.height,
      };
    };
    const nav = document.querySelector<HTMLElement>(".bottom-nav")!;
    const style = getComputedStyle(nav);
    const navBox = box(nav);
    const inset = {
      left: parseFloat(style.borderLeftWidth) + parseFloat(style.paddingLeft),
      right: parseFloat(style.borderRightWidth) + parseFloat(style.paddingRight),
    };
    const tabs = Array.from(nav.querySelectorAll<HTMLElement>(".bottom-nav__tab")).map((t) => {
      const label = t.querySelector<HTMLElement>(".bottom-nav__label")!;
      const labelStyle = getComputedStyle(label);
      return {
        name: t.getAttribute("aria-label")!,
        active: t.classList.contains("bottom-nav__tab--active"),
        current: t.getAttribute("aria-current"),
        tab: box(t),
        lozenge: box(t.querySelector(".bottom-nav__lozenge")!),
        label: box(label),
        icon: box(t.querySelector(".bottom-nav__icon")!),
        labelOpacity: parseFloat(labelStyle.opacity),
        labelScrollWidth: label.scrollWidth,
        labelClientWidth: label.clientWidth,
        labelColor: labelStyle.color,
      };
    });
    return {
      nav: navBox,
      content: { left: navBox.left + inset.left, right: navBox.right - inset.right },
      tabs,
    };
  });
}

// ---- pixels ---------------------------------------------------------------------------------------------------------

type Rgb = [number, number, number];
interface Grab {
  data: number[];
  width: number;
  height: number;
  originX: number;
  originY: number;
}

/** Screenshot of the nav (plus a margin) decoded to RGBA in the page. */
async function grabNav(page: Page, margin = 8): Promise<Grab> {
  const nav = await page.locator(".bottom-nav").boundingBox();
  if (nav === null) throw new Error("no nav box");
  const originX = Math.max(0, Math.floor(nav.x - margin));
  const originY = Math.max(0, Math.floor(nav.y - margin));
  const clip = {
    x: originX,
    y: originY,
    width: Math.ceil(nav.width + 2 * margin),
    height: Math.ceil(nav.height + 2 * margin),
  };
  const png = (await page.screenshot({ clip })).toString("base64");
  const data = await page.evaluate(async (b64) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const canvas = document.createElement("canvas");
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(img, 0, 0);
    return {
      data: Array.from(ctx.getImageData(0, 0, img.width, img.height).data),
      w: img.width,
      h: img.height,
    };
  }, png);
  return { data: data.data, width: data.w, height: data.h, originX, originY };
}

function px(grab: Grab, x: number, y: number): Rgb {
  const cx = Math.min(grab.width - 1, Math.max(0, Math.round(x - grab.originX)));
  const cy = Math.min(grab.height - 1, Math.max(0, Math.round(y - grab.originY)));
  const i = (cy * grab.width + cx) * 4;
  return [grab.data[i], grab.data[i + 1], grab.data[i + 2]];
}

function lum([r, g, b]: Rgb): number {
  const f = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

function contrast(a: Rgb, b: Rgb): number {
  const la = lum(a);
  const lb = lum(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

function mean(colors: Rgb[]): Rgb {
  const n = colors.length;
  return [0, 1, 2].map((k) => Math.round(colors.reduce((s, c) => s + c[k], 0) / n)) as Rgb;
}

/** Ink of a glyph/label inside `box`: the pixel farthest (by contrast) from the background, which is the box's
 *  corner-region mean (the surface the glyph sits on). Returns the glyph-vs-surface contrast. */
function inkContrast(grab: Grab, box: Box): number {
  const corners: Rgb[] = [];
  for (const [x, y] of [
    [box.left + 1, box.top + 1],
    [box.right - 2, box.top + 1],
    [box.left + 1, box.bottom - 2],
    [box.right - 2, box.bottom - 2],
  ]) {
    corners.push(px(grab, x, y));
  }
  const surface = mean(corners);
  let best = 1;
  for (let y = Math.floor(box.top); y < Math.ceil(box.bottom); y += 1) {
    for (let x = Math.floor(box.left); x < Math.ceil(box.right); x += 1) {
      best = Math.max(best, contrast(px(grab, x, y), surface));
    }
  }
  return best;
}

/** The active pill's ring against the capsule material just outside it, on the straight top and bottom segments (never
 *  the curved ends). Both rows are located by scanning, since the 1px ring can land on a fractional pixel. */
function ringContrast(grab: Grab, pill: Box): { top: number; bottom: number } {
  const xs: number[] = [];
  for (let i = 0; i < 9; i += 1) xs.push(pill.left + pill.width * (0.35 + 0.3 * (i / 8)));
  const edge = (yEdge: number, outwardSign: 1 | -1) => {
    const outside = mean(xs.map((x) => px(grab, x, yEdge + outwardSign * 4)));
    let best = 1;
    for (const dy of [-1, 0, 1]) {
      const ring = mean(xs.map((x) => px(grab, x, yEdge + dy)));
      best = Math.max(best, contrast(ring, outside));
    }
    return best;
  };
  return { top: edge(pill.top + 0.5, -1), bottom: edge(pill.bottom - 0.5, 1) };
}

// ---- backdrops ------------------------------------------------------------------------------------------------------

const BACKDROPS = ["default", "white", "black", "accent", "photo"] as const;
type Backdrop = (typeof BACKDROPS)[number];

/** A fixed layer behind the nav (z-index 4 < the nav's 5) painting the named hostile backdrop. */
async function setBackdrop(page: Page, backdrop: Backdrop) {
  await page.evaluate((kind) => {
    document.getElementById("hel1583-backdrop")?.remove();
    if (kind === "default") return;
    const layer = document.createElement("div");
    layer.id = "hel1583-backdrop";
    const accent = getComputedStyle(document.documentElement)
      .getPropertyValue("--app-accent")
      .trim();
    const fills: Record<string, string> = {
      white: "#ffffff",
      black: "#000000",
      accent,
      // A high-frequency black/white checker: the worst case for a blur-backed material (no flat region to sample).
      photo: "repeating-conic-gradient(#ffffff 0 25%, #000000 0 50%) 0 0 / 6px 6px",
    };
    layer.style.cssText = `position:fixed;inset:0;z-index:4;pointer-events:none;background:${fills[kind]}`;
    // A sibling placed just before the nav, in the nav's own stacking context, so the nav's blur samples it.
    const nav = document.querySelector(".bottom-nav")!;
    nav.parentElement!.insertBefore(layer, nav);
  }, backdrop);
  await page.evaluate(
    () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
  );
}

interface ContrastRow {
  backdrop: Backdrop;
  active: string;
  edgeTop: number;
  edgeBottom: number;
  label: number;
  activeGlyph: number;
  minInactiveGlyph: number;
}

const FLOORS = { edge: 3, label: 4.5, glyph: 3 } as const;

// ---- specs ----------------------------------------------------------------------------------------------------------

for (const theme of THEMES) {
  test.describe(`HEL-1583 glass nav, ${theme} theme`, () => {
    test("five tabs, the active label visible, exactly one current tab per route; Connectors via Data", async ({
      page,
      request,
    }) => {
      await openAt(page, request, 375, theme, `tabs${theme}`, "/home");
      await expect(page.locator(".bottom-nav__tab")).toHaveCount(5);
      await expect(page.locator(".user-menu__trigger")).toHaveCount(0);
      const names = await page
        .locator(".bottom-nav__tab")
        .evaluateAll((els) => els.map((e) => e.getAttribute("aria-label")));
      expect(names).toEqual(["Home", "Dashboards", "Data", "Pipelines", "Me"]);

      const expectations: [string, string][] = [
        ["/home", "Home"],
        ["/dashboards", "Dashboards"],
        ["/connectors", "Data"],
        ["/settings", "Me"],
      ];
      for (const [path, expected] of expectations) {
        await page.goto(path);
        await expect(page.locator(".bottom-nav")).toBeVisible();
        await settleNav(page);
        const geometry = await navGeometry(page);
        const current = geometry.tabs.filter((t) => t.current !== null);
        expect(
          current.map((t) => t.name),
          path,
        ).toEqual([expected]);
        for (const t of geometry.tabs) {
          if (t.name === expected) {
            expect(t.labelOpacity, `${path}: active label visible`).toBe(1);
            expect(t.label.width, `${path}: active label has width`).toBeGreaterThan(20);
          } else {
            expect(t.labelOpacity, `${path}: ${t.name} label hidden`).toBe(0);
            expect(t.label.width, `${path}: ${t.name} label collapsed`).toBe(0);
          }
        }
      }
      // Me is a menu button, so its current state is "true", never "page".
      await expect(
        page.locator(NAV).getByRole("button", { name: "Me", exact: true }),
      ).toHaveAttribute("aria-current", "true");

      // Connectors via Data: Data -> the Sources | Connectors sub-row -> Connectors; Data stays the one current tab.
      await page.goto("/dashboards");
      await page.getByRole("link", { name: "Data", exact: true }).click();
      await expect(page).toHaveURL(/\/sources$/);
      const row = page.getByRole("navigation", { name: "Data sections" });
      await expect(row).toBeVisible();
      await row.getByRole("link", { name: "Connectors" }).click();
      await expect(page).toHaveURL(/\/connectors$/);
      await expect(page.getByRole("link", { name: "Data", exact: true })).toHaveAttribute(
        "aria-current",
        "page",
      );
      await expect(row.getByRole("link", { name: "Connectors" })).toHaveAttribute(
        "aria-current",
        "page",
      );
    });

    for (const width of [320, 375, 768]) {
      test(`tap targets are at least 44px and do not overlap at ${width}px`, async ({
        page,
        request,
      }) => {
        await openAt(page, request, width, theme, `tap${width}${theme}`);
        for (const active of ["Dashboards", "Pipelines"]) {
          await page.getByRole("link", { name: active, exact: true }).click();
          await expect(page.getByRole("link", { name: active, exact: true })).toHaveAttribute(
            "aria-current",
            "page",
          );
          await settleNav(page);
          const g = await navGeometry(page);
          for (const t of g.tabs) {
            expect(t.tab.width, `${active} active: ${t.name} width`).toBeGreaterThanOrEqual(
              44 - 0.5,
            );
            expect(t.tab.height, `${active} active: ${t.name} height`).toBeGreaterThanOrEqual(
              44 - 0.5,
            );
          }
          for (let i = 1; i < g.tabs.length; i += 1) {
            expect(
              g.tabs[i].tab.left,
              `${active} active: ${g.tabs[i].name} overlaps`,
            ).toBeGreaterThanOrEqual(g.tabs[i - 1].tab.right - 0.5);
          }
          // The painted hit really is the tab: the element at each tab's centre belongs to that tab.
          for (const t of g.tabs) {
            const owner = await page.evaluate(
              ([x, y]) =>
                document
                  .elementFromPoint(x, y)
                  ?.closest(".bottom-nav__tab")
                  ?.getAttribute("aria-label") ?? null,
              [(t.tab.left + t.tab.right) / 2, (t.tab.top + t.tab.bottom) / 2],
            );
            expect(owner, `${active} active: centre of ${t.name}`).toBe(t.name);
          }
        }
      });
    }

    test("at 320px nothing crosses the capsule, the lozenge stays in its tab, and a long label truncates", async ({
      page,
      request,
    }) => {
      await openAt(page, request, 320, theme, `fit320${theme}`);
      const report: Record<string, unknown> = {};
      for (const active of ["Dashboards", "Pipelines"]) {
        await page.getByRole("link", { name: active, exact: true }).click();
        await expect(page.getByRole("link", { name: active, exact: true })).toHaveAttribute(
          "aria-current",
          "page",
        );
        await settleNav(page);
        const g = await navGeometry(page);
        for (const t of g.tabs) {
          expect(
            t.tab.left,
            `${active}: ${t.name} tab inside the capsule content box (left)`,
          ).toBeGreaterThanOrEqual(g.content.left - 0.5);
          expect(
            t.tab.right,
            `${active}: ${t.name} tab inside the capsule content box (right)`,
          ).toBeLessThanOrEqual(g.content.right + 0.5);
          expect(
            t.label.right,
            `${active}: ${t.name} label inside the capsule content box`,
          ).toBeLessThanOrEqual(g.content.right + 0.5);
          expect(
            t.lozenge.left,
            `${active}: ${t.name} lozenge inside its own tab (left)`,
          ).toBeGreaterThanOrEqual(t.tab.left - 0.5);
          expect(
            t.lozenge.right,
            `${active}: ${t.name} lozenge inside its own tab (right)`,
          ).toBeLessThanOrEqual(t.tab.right + 0.5);
        }
        const activeTab = g.tabs.find((t) => t.active)!;
        report[active] = {
          tabWidth: activeTab.tab.width,
          labelClientWidth: activeTab.labelClientWidth,
          labelScrollWidth: activeTab.labelScrollWidth,
          truncated: activeTab.labelScrollWidth > activeTab.labelClientWidth,
          contentWidth: g.content.right - g.content.left,
        };
        if (active === "Dashboards") {
          expect(
            activeTab.labelScrollWidth,
            "Dashboards label really truncates at 320px",
          ).toBeGreaterThan(activeTab.labelClientWidth);
        }
        await page.screenshot({
          path: evidencePath("HEL-1583", `glass-nav-320-${active.toLowerCase()}-${theme}.png`),
        });
      }
      writeFileSync(
        evidencePath("HEL-1583", `truncation-320-${theme}.json`),
        JSON.stringify(report, null, 2),
      );
      console.log(`HEL1583-TRUNCATION ${theme} ${JSON.stringify(report)}`);
    });

    test("the icon box and its vertical position do not change on activation", async ({
      page,
      request,
    }) => {
      await openAt(page, request, 375, theme, `icon${theme}`);
      const iconOf = async (name: string) =>
        (await navGeometry(page)).tabs.find((t) => t.name === name)!.icon;
      const before = await iconOf("Pipelines");
      const tabBefore = (await navGeometry(page)).tabs.find((t) => t.name === "Pipelines")!.tab;
      await page.getByRole("link", { name: "Pipelines", exact: true }).click();
      await expect(page.getByRole("link", { name: "Pipelines", exact: true })).toHaveAttribute(
        "aria-current",
        "page",
      );
      await settleNav(page);
      const after = await iconOf("Pipelines");
      const tabAfter = (await navGeometry(page)).tabs.find((t) => t.name === "Pipelines")!.tab;
      expect(after.width).toBe(before.width);
      expect(after.height).toBe(before.height);
      expect(Math.abs(after.top - before.top)).toBeLessThanOrEqual(0.5);
      expect(Math.abs(tabAfter.top - tabBefore.top)).toBeLessThanOrEqual(0.5);
    });

    for (const width of [430, 768]) {
      test(`the active pill is content-sized and tabs are evenly spaced at ${width}px`, async ({
        page,
        request,
      }) => {
        await openAt(page, request, width, theme, `size${width}${theme}`);
        const g = await navGeometry(page);
        const active = g.tabs.find((t) => t.active)!;
        const contentWidth = g.content.right - g.content.left;
        expect(active.tab.width, "active tab is not the bar's leftover width").toBeLessThan(
          contentWidth / 2,
        );
        expect(active.lozenge.width).toBeLessThanOrEqual(active.tab.width + 0.5);
        const gaps = [g.tabs[0].tab.left - g.content.left];
        for (let i = 1; i < g.tabs.length; i += 1)
          gaps.push(g.tabs[i].tab.left - g.tabs[i - 1].tab.right);
        gaps.push(g.content.right - g.tabs[g.tabs.length - 1].tab.right);
        const spread = Math.max(...gaps) - Math.min(...gaps);
        console.log(
          `HEL1583-SPACING ${width} ${theme} gaps=${JSON.stringify(gaps.map((x) => Math.round(x * 10) / 10))}`,
        );
        expect(spread, `gaps ${JSON.stringify(gaps)}`).toBeLessThanOrEqual(1.5);
      });
    }

    // The owner's opaque-pill-text-ring ruling: edge >= 3:1 (the ring), label >= 4.5:1, glyphs >= 3:1, measured from
    // rendered pixels over every backdrop the spec names. A shortfall is REPORTED with its numbers (the console line and
    // the JSON evidence), never papered over by changing the treatment.
    for (const width of [320, 375, 768]) {
      test(`active pill contrast from rendered pixels at ${width}px over every backdrop`, async ({
        page,
        request,
      }) => {
        test.setTimeout(120_000);
        await openAt(page, request, width, theme, `ctr${width}${theme}`);
        const rows: ContrastRow[] = [];
        const activeTabs = width === 320 ? ["Dashboards", "Pipelines"] : ["Dashboards"];
        for (const activeName of activeTabs) {
          await page.getByRole("link", { name: activeName, exact: true }).click();
          await expect(page.getByRole("link", { name: activeName, exact: true })).toHaveAttribute(
            "aria-current",
            "page",
          );
          await settleNav(page);
          for (const backdrop of BACKDROPS) {
            await setBackdrop(page, backdrop);
            const g = await navGeometry(page);
            const grab = await grabNav(page);
            const activeTab = g.tabs.find((t) => t.active)!;
            const ring = ringContrast(grab, activeTab.lozenge);
            const inactive = g.tabs.filter((t) => !t.active).map((t) => inkContrast(grab, t.icon));
            rows.push({
              backdrop,
              active: activeName,
              edgeTop: Math.round(ring.top * 100) / 100,
              edgeBottom: Math.round(ring.bottom * 100) / 100,
              label: Math.round(inkContrast(grab, activeTab.label) * 100) / 100,
              activeGlyph: Math.round(inkContrast(grab, activeTab.icon) * 100) / 100,
              minInactiveGlyph: Math.round(Math.min(...inactive) * 100) / 100,
            });
            if (backdrop === "default" || backdrop === "photo") {
              await page.screenshot({
                path: evidencePath(
                  "HEL-1583",
                  `glass-nav-${width}-${activeName.toLowerCase()}-${backdrop}-${theme}.png`,
                ),
              });
            }
          }
          await setBackdrop(page, "default");
        }
        writeFileSync(
          evidencePath("HEL-1583", `contrast-${width}-${theme}.json`),
          JSON.stringify(rows, null, 2),
        );
        console.log(`HEL1583-CONTRAST ${width} ${theme} ${JSON.stringify(rows)}`);
        for (const row of rows) {
          const where = `${width}px ${theme} ${row.active}/${row.backdrop}`;
          expect(
            Math.min(row.edgeTop, row.edgeBottom),
            `${where}: ring edge >= 3:1`,
          ).toBeGreaterThanOrEqual(FLOORS.edge);
          expect(row.label, `${where}: label >= 4.5:1`).toBeGreaterThanOrEqual(FLOORS.label);
          expect(row.activeGlyph, `${where}: active glyph >= 3:1`).toBeGreaterThanOrEqual(
            FLOORS.glyph,
          );
          expect(row.minInactiveGlyph, `${where}: inactive glyphs >= 3:1`).toBeGreaterThanOrEqual(
            FLOORS.glyph,
          );
        }
      });
    }

    test("a free-tier user reaches the assistant overlay in one tap; the header has no avatar", async ({
      page,
      request,
    }) => {
      await openAt(page, request, 375, theme, `free${theme}`);
      await expect(page.getByRole("button", { name: "User menu" })).toHaveCount(0);
      await page.getByRole("button", { name: "Open assistant" }).click();
      const dialog = page.getByRole("dialog", { name: "Assistant conversation" });
      await expect(dialog).toBeVisible();
      await expect(
        dialog.getByRole("button", { name: "Request access in Settings" }),
      ).toBeVisible();
      await expect(dialog.getByRole("link", { name: /Browse all conversations/ })).toHaveCount(0);
    });

    test("a beta user reaches /chat in two taps: Open assistant, then Browse all conversations", async ({
      page,
      request,
    }) => {
      await openAt(page, request, 375, theme, `beta${theme}`);
      setUserTierForTest(await currentUserId(page.request), "beta");
      await page.reload();
      await expect(page.locator(".bottom-nav")).toBeVisible();
      await page.getByRole("button", { name: "Open assistant" }).click();
      await page.getByRole("link", { name: /Browse all conversations/ }).click();
      await expect(page).toHaveURL(/\/chat$/);
      // /chat belongs to no tab.
      const g = await navGeometry(page);
      expect(g.tabs.filter((t) => t.current !== null)).toEqual([]);
    });

    test("an owner reaches Usage through the Me menu, which opens above the nav", async ({
      page,
      request,
    }) => {
      await openAt(page, request, 375, theme, `owner${theme}`);
      setUserTierForTest(await currentUserId(page.request), "owner");
      await page.reload();
      await expect(page.locator(".bottom-nav")).toBeVisible();
      await page.locator(NAV).getByRole("button", { name: "Me", exact: true }).click();
      const menu = page.getByRole("menu");
      await expect(menu).toBeVisible();
      await expect(menu.getByRole("menuitem")).toHaveText([
        "Settings",
        "Usage",
        "Getting started",
        "Sign out",
      ]);
      const geometry = await page.evaluate(() => {
        const menuEl = document
          .querySelector<HTMLElement>("[role='menu']")!
          .getBoundingClientRect();
        const navEl = document.querySelector<HTMLElement>(".bottom-nav")!.getBoundingClientRect();
        const cx = menuEl.left + menuEl.width / 2;
        const cy = menuEl.top + menuEl.height / 2;
        return {
          menuBottom: menuEl.bottom,
          navTop: navEl.top,
          menuRight: menuEl.right,
          viewWidth: document.documentElement.clientWidth,
          topIsMenu: document.elementFromPoint(cx, cy)?.closest("[role='menu']") !== null,
        };
      });
      expect(geometry.menuBottom).toBeLessThanOrEqual(geometry.navTop);
      expect(geometry.menuRight).toBeLessThanOrEqual(geometry.viewWidth);
      expect(geometry.topIsMenu).toBe(true);
      await menu.getByRole("menuitem", { name: "Usage" }).click();
      await expect(page).toHaveURL(/\/admin\/usage$/);
      await expect(
        page.locator(NAV).getByRole("button", { name: "Me", exact: true }),
      ).toHaveAttribute("aria-current", "true");
    });

    test("the refreshed line sits above the chip row on a dashboard whose pipeline has run", async ({
      page,
      request,
    }) => {
      await openAt(page, request, 375, theme, `refresh${theme}`);
      const api = page.request;
      const post = async <T>(url: string, data: unknown): Promise<T> => {
        const res = await api.post(url, { data, headers: CSRF });
        expect(res.status(), `${url}: ${await res.text()}`).toBeLessThan(300);
        return (await res.json()) as T;
      };
      const dash = await post<{ id: string }>("/api/dashboards", { name: "HEL-1583 Refresh" });
      const source = await post<{ id: string }>("/api/data-sources", {
        name: "HEL-1583 refresh source",
        type: "static",
        columns: [
          { name: "region", type: "string" },
          { name: "revenue", type: "integer" },
        ],
        rows: [["East", 100]],
      });
      const pipeline = await post<{ id: string }>("/api/pipelines", {
        name: "HEL-1583 refresh pipeline",
        roots: [{ sourceId: source.id }],
      });
      const output = await post<{ id: string }>(`/api/pipelines/${pipeline.id}/outputs`, {
        kind: "table",
        name: "HEL-1583 refresh output",
        config: {},
      });
      await post(`/api/pipelines/${pipeline.id}/run`, {});
      await post("/api/panels", {
        dashboardId: dash.id,
        title: "Refresh table",
        type: "output",
        config: { outputId: output.id },
      });
      await post("/api/panels", {
        dashboardId: dash.id,
        title: "Refresh note",
        type: "markdown",
        config: { content: "note" },
      });
      await page.goto(`/dashboards/${dash.id}`);
      const line = page.locator(".dashboard-refresh-line");
      await expect(line).toBeVisible();
      await expect(line).toHaveText(/^refreshed /);
      const geometry = await page.evaluate(() => {
        const lineEl = document.querySelector<HTMLElement>(".dashboard-refresh-line")!;
        const row = document.querySelector<HTMLElement>(".dashboard-chip-row")!;
        const header = document.querySelector<HTMLElement>(".app-command-bar")!;
        return {
          first: lineEl.parentElement!.firstElementChild === lineEl,
          lineBottom: lineEl.getBoundingClientRect().bottom,
          rowTop: row.getBoundingClientRect().top,
          lineLeft: lineEl.getBoundingClientRect().left,
          headerHeight: header.getBoundingClientRect().height,
          // The token resolves to calc(40px + 1rem); measure what it paints through a probe, not its source text.
          tokenHeight: (() => {
            const probe = document.createElement("div");
            probe.style.cssText =
              "position:absolute;visibility:hidden;height:var(--app-command-bar-height)";
            document.body.appendChild(probe);
            const h = probe.getBoundingClientRect().height;
            probe.remove();
            return h;
          })(),
        };
      });
      expect(geometry.first).toBe(true);
      expect(geometry.lineBottom).toBeLessThanOrEqual(geometry.rowTop);
      expect(geometry.lineLeft).toBe(12);
      expect(geometry.headerHeight).toBe(geometry.tokenHeight);
      expect(geometry.headerHeight, "the 56px phone command bar is unchanged").toBe(56);
      // The desktop meta row's facts are `--font-mono` (HANDOFF: "slim mono meta row"); the phone caption resolves the same stack.
      const fonts = await page.evaluate(() => {
        const probe = document.createElement("span");
        probe.style.fontFamily = "var(--font-mono)";
        document.body.appendChild(probe);
        const mono = getComputedStyle(probe).fontFamily;
        probe.remove();
        const line = getComputedStyle(
          document.querySelector(".dashboard-refresh-line")!,
        ).fontFamily;
        return { line, mono };
      });
      expect(fonts.line, "refreshed line uses the --font-mono stack").toBe(fonts.mono);
      await page.screenshot({ path: evidencePath("HEL-1583", `refreshed-line-375-${theme}.png`) });
    });
  });
}
