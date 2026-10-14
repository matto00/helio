// Captures each example dashboard (light and dark, 1440x720 at 2x), measures the panel rectangles, and cuts the OG
// image from the launch capture. Runs inside run.mjs with a logged-in Playwright context; refuses to save a page that
// is not the expected dashboard.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { resolve } from "node:path";

import { APP_BASE_URL, OG_FILE, RECTS_FILE, SHOTS_DIR } from "./lib/config.mjs";
import { sleep } from "./lib/api.mjs";

const VIEWPORT = { width: 1440, height: 720 };
// 120 req/min API limit, and HEL-1577 logs the session out under rapid navigation: stay well clear.
const PACE_MS = 20_000;
// News photos belong to their publishers: blurred in the capture, and the page credits the sources.
const BLUR_CSS = ".image-panel img, .image-panel__img { filter: blur(26px) saturate(.8); }";

const CASES = [
  ["launch", "Launch week"],
  ["revenue", "Revenue"],
  ["oss", "Open source"],
  ["fantasy", "Fantasy league"],
  ["news", "News Overview"],
  ["helio", "Building Helio"],
];

async function assertDashboard(page, id, name, label) {
  await page
    .waitForSelector(
      ".panel-grid-card canvas, .panel-grid-card img, .panel-grid-card .markdown-panel",
      { timeout: 30_000 },
    )
    .catch(() => {});
  const cards = await page.$$(".panel-grid-card");
  const named = (await page.locator("body").innerText()).includes(name);
  if (!page.url().includes(`/dashboards/${id}`) || cards.length < 4 || !named) {
    throw new Error(
      `${label}: not on the "${name}" dashboard (url ${page.url()}, ${cards.length} panels); refusing to save a wrong capture`,
    );
  }
}

async function measure(page) {
  const rects = await page.$$eval(".panel-grid-card", (els) =>
    els.map((e) => {
      const r = e.getBoundingClientRect();
      return [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)];
    }),
  );
  return rects.sort((a, b) => a[1] - b[1] || a[0] - b[0]);
}

export async function captureAll(browser, sessionCookie, ids) {
  mkdirSync(SHOTS_DIR, { recursive: true });
  const measured = {};
  for (const theme of ["light", "dark"]) {
    const ctx = await browser.newContext({
      viewport: VIEWPORT,
      deviceScaleFactor: 2,
      colorScheme: theme,
    });
    await ctx.addCookies([sessionCookie]);
    await ctx.addInitScript((t) => {
      try {
        localStorage.setItem("helio-theme", t);
      } catch {
        // storage unavailable: the capture would be in the wrong theme, which the screenshot would show
      }
    }, theme);
    const page = await ctx.newPage();
    for (const [i, [key, name]] of CASES.entries()) {
      const label = `${key}/${theme}`;
      await page.goto(`${APP_BASE_URL}/dashboards/${ids[key]}`);
      await assertDashboard(page, ids[key], name, label);
      await sleep(3000);
      if (key === "news") {
        await page.addStyleTag({ content: BLUR_CSS });
        const loaded = await page.$$eval(
          ".image-panel img",
          (imgs) => imgs.length > 0 && imgs.every((img) => img.complete && img.naturalWidth > 0),
        );
        if (!loaded) throw new Error(`${label}: the news photo did not load; refusing to save it`);
        await sleep(300);
      }
      await page.mouse.move(VIEWPORT.width - 10, VIEWPORT.height - 20);
      if (theme === "light") measured[key] = await measure(page);
      await page.screenshot({
        path: resolve(SHOTS_DIR, `uc-${key}-${theme}.jpg`),
        type: "jpeg",
        quality: 82,
      });
      console.log(`  captured ${label}`);
      if (!(theme === "dark" && i === CASES.length - 1)) await sleep(PACE_MS);
    }
    await ctx.close();
  }
  return measured;
}

/** All six dashboards share one layout, so every case must measure identically (within 1px). */
export function writeRects(measured) {
  const [first, ...rest] = Object.values(measured);
  if (first.length !== 4) throw new Error(`expected 4 panel rectangles, measured ${first.length}`);
  for (const other of rest) {
    const same =
      other.length === first.length &&
      other.every((r, i) => r.every((v, j) => Math.abs(v - first[i][j]) <= 1));
    if (!same)
      throw new Error(`panel rectangles differ between dashboards: ${JSON.stringify(measured)}`);
  }
  // Written in Prettier's own layout so the committed file passes `format:check` untouched.
  const rows = first.map((r) => `    [${r.join(", ")}]`).join(",\n");
  const body = `{\n  "width": ${VIEWPORT.width},\n  "height": ${VIEWPORT.height},\n  "panels": [\n${rows}\n  ]\n}\n`;
  writeFileSync(RECTS_FILE, body);
  return first;
}

/** 1200x630 centre crop of the launch capture, rendered by Playwright (no image dependency). */
export async function writeOgImage(browser) {
  const { readFileSync } = await import("node:fs");
  const shot = readFileSync(resolve(SHOTS_DIR, "uc-launch-light.jpg")).toString("base64");
  const page = await browser.newPage({
    viewport: { width: 1200, height: 630 },
    deviceScaleFactor: 1,
  });
  await page.setContent(
    `<body style="margin:0;overflow:hidden"><img style="height:630px;width:auto;position:absolute;left:50%;transform:translateX(-50%)" src="data:image/jpeg;base64,${shot}"></body>`,
  );
  mkdirSync(dirname(OG_FILE), { recursive: true });
  await page.screenshot({ path: OG_FILE, type: "jpeg", quality: 85 });
  await page.close();
}
