// HEL-1737 4.1: settled (web fonts loaded) screenshots + sentence geometry. usage: node shots.mjs <root> <base> <ws> <outdir>
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
const [root, base, ws, out] = process.argv.slice(2);
const require = createRequire(root + "/");
const { chromium } = require("playwright-core");
mkdirSync(out, { recursive: true });
const browser = await chromium.connect(ws);
const cases = [];
for (const theme of ["light", "dark"]) {
  for (const w of [375, 602, 604, 610, 1024, 1280]) cases.push({ theme, style: "sans", w, h: 900 });
  for (const style of ["serif", "mono"]) cases.push({ theme, style, w: 1280, h: 900 });
}
const geo = {};
for (const c of cases) {
  const ctx = await browser.newContext({ viewport: { width: c.w, height: c.h } });
  const page = await ctx.newPage();
  const login = await page.request.post(base + "/api/auth/login", { data: { email: "matt@helio.dev", password: "heliodev123" } });
  if (!login.ok()) throw new Error("login " + login.status());
  await page.addInitScript(([t, s]) => { localStorage.setItem("helio-theme", t); }, [c.theme, c.style]);
  await page.goto(base + "/home", { waitUntil: "load" });
  await page.waitForSelector(".home-opening__sentence", { timeout: 30000 });
  if (c.style !== "sans") await page.evaluate((s) => { document.documentElement.dataset.typeStyle = s; }, c.style); // no server-preference write on the dev account
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(1500);
  const g = await page.evaluate(() => { const e = document.querySelector(".home-opening__sentence"); const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, text: e.textContent, ts: document.documentElement.dataset.typeStyle ?? null }; });
  const key = `${c.style}-${c.w}-${c.theme}`;
  geo[key] = g;
  await page.screenshot({ path: `${out}/${key}.png` });
  await ctx.close();
}
writeFileSync(`${out}/geometry.json`, JSON.stringify(geo, null, 2));
await browser.close();
