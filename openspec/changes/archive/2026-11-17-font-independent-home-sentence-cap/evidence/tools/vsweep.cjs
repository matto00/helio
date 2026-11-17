const { chromium } = require(process.argv[2] + "/node_modules/playwright-core");
const base = process.argv[4];
(async () => {
  const browser = await chromium.connect(process.argv[3]);
  const res = {};
  for (const mode of ["web", "blocked", "blocked-basestack"]) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    const login = await page.request.post(base + "/api/auth/login", { data: { email: "matt@helio.dev", password: "heliodev123" } });
    if (!login.ok()) { console.log("login failed", login.status()); process.exit(1); }
    if (mode !== "web") await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
    await page.route("**/api/home-summary**", () => {}); // hold forever: ghost stays
    if (mode === "blocked-basestack") await page.addInitScript(() => {
      document.addEventListener("DOMContentLoaded", () => { const s = document.createElement("style"); s.textContent = ':root{--font-face-sans:"Schibsted Grotesk",system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif !important;--font-face-mono:"JetBrains Mono",ui-monospace,"Cascadia Code","Fira Code",monospace !important}'; document.head.append(s); });
    });
    await page.goto(base + "/home", { waitUntil: "load" });
    await page.waitForSelector(".home-opening__ghost", { timeout: 30000, state: "attached" });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(1500);
    const m = {};
    for (let w = 320; w <= 1300; w += 1) {
      await page.setViewportSize({ width: w, height: 900 });
      m[w] = await page.evaluate(() => { const g = document.querySelector(".home-opening__ghost"); return g ? Math.round(g.getBoundingClientRect().height) : -1; });
    }
    res[mode] = m;
    await ctx.close();
  }
  const ranges = (xs) => { const r = []; for (const x of xs) { if (r.length && r[r.length-1][1] === x - 1) r[r.length-1][1] = x; else r.push([x, x]); } return r.map(([a,b]) => a===b? `${a}`:`${a}-${b}`).join(","); };
  for (const k of ["blocked", "blocked-basestack"]) {
    const bad = Object.keys(res.web).filter((w) => res.web[w] !== res[k][w]).map(Number);
    console.log(k, "ghost height differs from web-font ghost at viewports:", ranges(bad) || "none", bad.length ? "e.g. " + bad.slice(0,1).map(w=>`${w}: web ${res.web[w]} vs ${res[k][w]}`) : "");
  }
  await browser.close();
})();
