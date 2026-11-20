import { writeFileSync } from "node:fs";

import { expect, test, type Page } from "@playwright/test";
import { registerAndLogin } from "./support/auth";
import { evidencePath } from "./support/evidencePath";

// HEL-1749 -- Home's opening-line loading placeholder shows one skeleton bar per rendered line of the hidden default
// sentence (it was one bar centred over two lines at 431-604px in Sans). The placeholder is held in its loading
// state by never fulfilling /api/home-summary. Geometry is read from a screenshot (mechanism independent), not from
// the CSS: bar thickness 0.8em +/-1px, gap between bars >= 8px (--space-2), rounded corners.

test.describe.configure({ mode: "parallel" });
test.setTimeout(120_000);

const BAR = ".home-opening__ghost .home-opening__ghost-bar";
const WIDTHS = [320, 375, 430, 431, 480, 540, 604, 605, 1024, 1280] as const;
const GEOMETRY_WIDTHS = [320, 375, 430, 431, 480, 500, 604] as const;
/** The bar vs the page background differ by about 7/255 in the flat fill, in both themes. */
const PIXEL_THRESHOLD = 2;

interface Frag {
  x: number;
  y: number;
  w: number;
  h: number;
}
interface Probe {
  fontSize: number;
  lineHeight: number;
  ghostHeight: number;
  ghostTop: number;
  frags: Frag[];
}

async function openPlaceholder(
  page: Page,
  request: Parameters<typeof registerAndLogin>[1],
  theme: "light" | "dark",
  width: number,
  label: string,
) {
  await page.setViewportSize({ width, height: 900 });
  await page.addInitScript((t) => window.localStorage.setItem("helio-theme", t), theme);
  await registerAndLogin(page, request, {
    prefix: "hel1749",
    displayName: "HEL-1749",
    domain: "example.com",
    label,
    isolate: true,
  });
  await page.route("**/api/home-summary**", () => {});
  await page.goto("/home", { waitUntil: "load" });
  await page.waitForSelector(".home-opening__ghost", { state: "attached" });
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  await page.waitForTimeout(300);
}

async function probe(page: Page): Promise<Probe> {
  return page.evaluate((barSel) => {
    const ghost = document.querySelector(".home-opening__ghost") as HTMLElement;
    const bar = document.querySelector(barSel);
    const cs = getComputedStyle(ghost);
    const rect = ghost.getBoundingClientRect();
    return {
      fontSize: parseFloat(cs.fontSize),
      lineHeight: parseFloat(cs.lineHeight),
      ghostHeight: rect.height,
      ghostTop: rect.top,
      frags: bar
        ? [...bar.getClientRects()].map((r) => ({ x: r.x, y: r.y, w: r.width, h: r.height }))
        : [],
    };
  }, BAR);
}

function lineCount(p: Probe): number {
  return Math.round(p.ghostHeight / p.lineHeight);
}

/** Decodes a PNG in a scratch page of the same context and returns a pixel reader's results. */
async function scanShot(
  page: Page,
  png: Buffer,
  columns: number[],
  bg: [number, number, number] | null,
  extra: Array<[number, number]>,
): Promise<{ bg: number[]; runs: Array<Array<[number, number]>>; pixels: number[][] }> {
  const helper = await page.context().newPage();
  try {
    return await helper.evaluate(
      async ({ b64, columns, bg, extra, threshold }) => {
        const img = new Image();
        img.src = `data:image/png;base64,${b64}`;
        await img.decode();
        const canvas = document.createElement("canvas");
        canvas.width = img.width;
        canvas.height = img.height;
        const g = canvas.getContext("2d")!;
        g.drawImage(img, 0, 0);
        const px = (x: number, y: number) =>
          [...g.getImageData(Math.round(x), Math.round(y), 1, 1).data].slice(0, 3);
        const back = bg ?? px(1, 1);
        const differs = (c: number[]) =>
          Math.max(...c.map((v, i) => Math.abs(v - back[i]))) >= threshold;
        const runs = columns.map((x) => {
          const col = g.getImageData(Math.round(x), 0, 1, img.height).data;
          const out: Array<[number, number]> = [];
          let start = -1;
          for (let y = 0; y <= img.height; y++) {
            const on = y < img.height && differs([col[y * 4], col[y * 4 + 1], col[y * 4 + 2]]);
            if (on && start < 0) start = y;
            if (!on && start >= 0) {
              out.push([start, y - 1]);
              start = -1;
            }
          }
          return out;
        });
        return {
          bg: back,
          runs,
          pixels: extra.map(([x, y]) => px(x, y)),
        };
      },
      { b64: png.toString("base64"), columns, bg, extra, threshold: PIXEL_THRESHOLD },
    );
  } finally {
    await helper.close();
  }
}

/** Per fragment: the painted bar's [top, bottom] in page y (the Home page's dot grid adds 1-2px specks, so a
 *  bar is a run of at least 8px; several columns are scanned and the thinnest run taken, so a speck touching
 *  the bar can only widen one column). Also the corner pixels for the rounding check. */
async function paintedBars(page: Page, p: Probe, width: number) {
  const top = Math.max(0, Math.floor(p.ghostTop) - 12);
  const height = Math.ceil(p.ghostHeight) + 24;
  const png = await page.screenshot({ clip: { x: 0, y: top, width, height } });
  const bars: Array<{
    top: number;
    bottom: number;
    thickness: number;
    cornerOutside: number[];
    edge: number[];
  }> = [];
  for (const frag of p.frags) {
    const columns = [0.3, 0.4, 0.5, 0.6, 0.7].map((f) => frag.x + frag.w * f);
    const lo = frag.y - top - 0.5;
    const hi = frag.y + frag.h - top + 0.5;
    const first = await scanShot(page, png, columns, null, []);
    const perColumn = first.runs.map((runs) =>
      runs.filter(([a, b]) => b - a + 1 >= 8 && a >= lo && b <= hi),
    );
    expect(
      perColumn.every((runs) => runs.length === 1),
      `one painted bar per fragment per column, got ${JSON.stringify(perColumn)}`,
    ).toBe(true);
    const thinnest = perColumn
      .map((runs) => runs[0])
      .sort((a, b) => a[1] - a[0] - (b[1] - b[0]))[0];
    const [barTop, barBottom] = thinnest;
    const corners = await scanShot(page, png, [], first.bg as [number, number, number], [
      [frag.x + 1, barTop + 1],
      [frag.x + 8, barTop + 1],
    ]);
    const differs = (c: number[]) =>
      Math.max(...c.map((v, i) => Math.abs(v - first.bg[i]))) >= PIXEL_THRESHOLD;
    bars.push({
      top: barTop + top,
      bottom: barBottom + top,
      thickness: barBottom - barTop + 1,
      cornerOutside: differs(corners.pixels[0]) ? [1] : [],
      edge: differs(corners.pixels[1]) ? [1] : [],
    });
  }
  return bars;
}

async function expectBarLook(page: Page, width: number) {
  const p = await probe(page);
  expect(p.frags.length, "the placeholder has bar fragments").toBeGreaterThan(0);
  const bars = await paintedBars(page, p, width);
  expect(bars.length).toBe(p.frags.length);
  for (const bar of bars) {
    expect(
      Math.abs(bar.thickness - 0.8 * p.fontSize),
      `thickness ${bar.thickness}`,
    ).toBeLessThanOrEqual(1);
    // Rounded ends: the very corner is page background, a few px along the top edge is bar.
    expect(bar.cornerOutside, "top-left corner pixel is the page, not the bar").toEqual([]);
    expect(bar.edge, "top edge, 8px in, is bar").toEqual([1]);
  }
  for (let i = 1; i < bars.length; i++) {
    expect(
      bars[i].top - bars[i - 1].bottom - 1,
      "gap between consecutive bars",
    ).toBeGreaterThanOrEqual(8);
  }
  return { p, bars };
}

for (const theme of ["light", "dark"] as const) {
  test.describe(`HEL-1749 home opening skeleton lines (${theme})`, () => {
    for (const width of WIDTHS) {
      test(`HEL-1749 ${theme} ${width}px: one painted bar fragment per line of the hidden sentence`, async ({
        page,
        request,
      }) => {
        await openPlaceholder(page, request, theme, width, `fr${width}${theme}`);
        const p = await probe(page);
        expect(p.frags.length, "bar fragments").toBe(lineCount(p));
        for (const f of p.frags) expect(f.w).toBeGreaterThan(0);
        if (width === 431 || width === 604) expect(p.frags.length).toBe(2);
        if (width === 605 || width === 1280) expect(p.frags.length).toBe(1);

        const style = await page.evaluate((barSel) => {
          const bar = document.querySelector(barSel) as HTMLElement;
          const cs = getComputedStyle(bar);
          const skeletons = document.querySelectorAll(".home-opening__loading .ui-skeleton");
          return {
            visibility: cs.visibility,
            color: cs.color,
            display: cs.display,
            clone: cs.getPropertyValue("box-decoration-break"),
            wclone: cs.getPropertyValue("-webkit-box-decoration-break"),
            backgroundImage: cs.backgroundImage,
            animationName: cs.animationName,
            maskImage: cs.maskImage,
            skeletons: skeletons.length,
            skeletonIsBar: skeletons[0] === bar,
            ghostHidden: getComputedStyle(bar.parentElement!).visibility,
            ghostAria: bar.parentElement!.getAttribute("aria-hidden"),
          };
        }, BAR);
        expect(style.visibility).toBe("visible");
        expect(style.color).toBe("rgba(0, 0, 0, 0)");
        expect(style.display).toBe("inline");
        expect(style.clone).toBe("clone");
        expect(style.wclone).toBe("clone");
        expect(style.backgroundImage).toContain("linear-gradient");
        expect(style.animationName).toBe("ui-skeleton-shimmer");
        expect(style.maskImage).not.toBe("none");
        expect(style.skeletons, "exactly one skeleton under the placeholder").toBe(1);
        expect(style.skeletonIsBar).toBe(true);
        expect(style.ghostHidden).toBe("hidden");
        expect(style.ghostAria).toBe("true");
      });
    }

    for (const width of GEOMETRY_WIDTHS) {
      test(`HEL-1749 ${theme} ${width}px: bars are 0.8em thick, >= 8px apart, with rounded ends`, async ({
        page,
        request,
      }) => {
        // A flat fill (reduced motion): in the light theme the shimmer gradient passes through the page background's
        // own colour (soft < page < raised), which a pixel scan cannot tell from "no bar". Geometry does not depend on it.
        await page.emulateMedia({ reducedMotion: "reduce" });
        await openPlaceholder(page, request, theme, width, `geo${width}${theme}`);
        await expectBarLook(page, width);
        if ([431, 500, 604, 1280].includes(width)) {
          writeFileSync(
            evidencePath("HEL-1749", `lines-${theme}-${width}.png`),
            await page.screenshot(),
          );
        }
      });
    }

    test(`HEL-1749 ${theme} 1280px: one bar spans the one-line sentence`, async ({
      page,
      request,
    }) => {
      await page.emulateMedia({ reducedMotion: "reduce" });
      await openPlaceholder(page, request, theme, 1280, `one${theme}`);
      const { p } = await expectBarLook(page, 1280);
      expect(p.frags.length).toBe(1);
      writeFileSync(evidencePath("HEL-1749", `lines-${theme}-1280.png`), await page.screenshot());
    });

    for (const mode of ["os", "off"] as const) {
      test(`HEL-1749 ${theme} reduced motion (${mode}): flat fill, still one bar per line`, async ({
        page,
        request,
      }) => {
        if (mode === "os") await page.emulateMedia({ reducedMotion: "reduce" });
        await openPlaceholder(page, request, theme, 500, `rm${mode}${theme}`);
        if (mode === "off") {
          await page.evaluate(() => {
            document.documentElement.dataset.motion = "off";
          });
        }
        // Let the page's colour transitions settle: the fill changes from the gradient (no colour) to the flat one.
        await page.waitForTimeout(800);
        const style = await page.evaluate(
          ([barSel]) => {
            const bar = document.querySelector(barSel) as HTMLElement;
            const cs = getComputedStyle(bar);
            const probeEl = document.createElement("div");
            probeEl.style.background = "var(--app-surface-soft)";
            document.body.append(probeEl);
            const soft = getComputedStyle(probeEl).backgroundColor;
            probeEl.remove();
            return {
              animationName: cs.animationName,
              image: cs.backgroundImage,
              color: cs.backgroundColor,
              soft,
            };
          },
          [BAR],
        );
        expect(style.animationName).toBe("none");
        expect(style.image).toBe("none");
        expect(style.color).toBe(style.soft);
        const { p } = await expectBarLook(page, 500);
        expect(p.frags.length).toBe(2);
        if (mode === "os") {
          writeFileSync(
            evidencePath("HEL-1749", `lines-${theme}-500-reduced.png`),
            await page.screenshot(),
          );
        }
      });
    }

    for (const style of ["serif", "mono"] as const) {
      test(`HEL-1749 ${theme} ${style} 1280px: one fragment per line`, async ({
        page,
        request,
      }) => {
        await page.emulateMedia({ reducedMotion: "reduce" });
        await openPlaceholder(page, request, theme, 1280, `${style}${theme}`);
        await page.evaluate((s) => {
          document.documentElement.dataset.typeStyle = s;
        }, style);
        await page.waitForTimeout(300);
        const p = await probe(page);
        expect(p.frags.length).toBe(lineCount(p));
        await expectBarLook(page, 1280);
      });
    }
  });
}
