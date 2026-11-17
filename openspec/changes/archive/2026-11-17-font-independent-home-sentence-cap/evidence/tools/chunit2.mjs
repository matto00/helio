// HEL-1737: with the REAL computed style (weight 400, letter-spacing -0.01em) measure, per type style and size:
//   the web font's 40ch, the default sentence's width in the web font and in each Sans/serif/mono fallback face,
//   and the .home-opening content-box width at 605..613 (ghost on screen, summary held).
// usage: node chunit2.mjs <repoRoot> <baseURL> <ws>
import { createRequire } from "node:module";
const [root, base, ws] = process.argv.slice(2);
const require = createRequire(root + "/");
const { chromium } = require("playwright-core");
const browser = await chromium.connect(ws);
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage();
const login = await page.request.post(base + "/api/auth/login", { data: { email: "matt@helio.dev", password: "heliodev123" } });
if (!login.ok()) { console.log("login failed", login.status()); process.exit(1); }
await page.route("**/api/home-summary**", () => {});
await page.goto(base + "/home", { waitUntil: "load" });
await page.waitForSelector(".home-opening__ghost", { state: "attached", timeout: 30000 });
await page.evaluate(async () => {
  await Promise.all(['400 24px "Schibsted Grotesk"', '400 24px "JetBrains Mono"', '400 24px "Fraunces"'].map((f) => document.fonts.load(f, "All quiet 0")));
});
const out = await page.evaluate(() => {
  const text = "All quiet: nothing has changed, failed or been missed.";
  const faces = {
    sans: ["Schibsted Grotesk", "Schibsted Grotesk Fallback Arial", "Schibsted Grotesk Fallback DejaVu"],
    serif: ["Fraunces", "Fraunces Fallback Times", "Fraunces Fallback DejaVu"],
    mono: ["JetBrains Mono", "JetBrains Mono Fallback Courier", "JetBrains Mono Fallback DejaVu"],
  };
  const res = [];
  for (const [style, list] of Object.entries(faces)) for (const size of [24, 36, 20]) for (const f of list) {
    const css = `position:absolute;visibility:hidden;font:400 ${size}px "${f}";letter-spacing:-0.01em`;
    const s = document.createElement("span"); s.style.cssText = css + ";white-space:nowrap"; s.textContent = text;
    const c = document.createElement("div"); c.style.cssText = css + ";width:40ch";
    document.body.append(s, c);
    res.push({ style, size, f, sentenceW: s.getBoundingClientRect().width, ch40: c.getBoundingClientRect().width, em40: c.getBoundingClientRect().width / size });
    s.remove(); c.remove();
  }
  return res;
});
for (const r of out) console.log(JSON.stringify(r));
for (const w of [604, 605, 606, 608, 610, 612, 613]) {
  await page.setViewportSize({ width: w, height: 900 });
  const m = await page.evaluate(() => {
    const o = document.querySelector(".home-opening"); const cs = getComputedStyle(o);
    const g = document.querySelector(".home-opening__ghost");
    return { content: o.getBoundingClientRect().width - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight), ghostW: g.getBoundingClientRect().width, ghostH: g.getBoundingClientRect().height, max: getComputedStyle(g).maxWidth };
  });
  console.log(JSON.stringify({ viewport: w, ...m }));
}
await browser.close();
