// HEL-1737 7.4: every-width (320-1300) placeholder sweep, ghost height with web fonts vs fonts blocked (fallback), per theme,
// with the rendered face proven by CDP. usage: node vsweep2.cjs <root> <ws> <base>
const { chromium } = require(process.argv[2] + "/node_modules/playwright-core");
const base = process.argv[4];
(async () => {
  const browser = await chromium.connect(process.argv[3]);
  const ranges = (xs) => { const r = []; for (const x of xs) { if (r.length && r[r.length-1][1] === x - 1) r[r.length-1][1] = x; else r.push([x, x]); } return r.map(([a,b]) => a===b? `${a}`:`${a}-${b}`).join(","); };
  for (const theme of ["light", "dark"]) {
    const res = {}; const faces = {};
    for (const mode of ["web", "blocked"]) {
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
      const page = await ctx.newPage();
      const login = await page.request.post(base + "/api/auth/login", { data: { email: "matt@helio.dev", password: "heliodev123" } });
      if (!login.ok()) { console.log("login failed", login.status()); process.exit(1); }
      await page.addInitScript((t) => localStorage.setItem("helio-theme", t), theme);
      if (mode !== "web") await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
      await page.route("**/api/home-summary**", () => {});
      await page.goto(base + "/home", { waitUntil: "load" });
      await page.waitForSelector(".home-opening__ghost", { timeout: 30000, state: "attached" });
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(1500);
      const cdp = await ctx.newCDPSession(page);
      await cdp.send("DOM.enable"); await cdp.send("CSS.enable");
      const { root } = await cdp.send("DOM.getDocument", { depth: 0 });
      const { nodeId } = await cdp.send("DOM.querySelector", { nodeId: root.nodeId, selector: ".home-opening__ghost" });
      faces[mode] = (await cdp.send("CSS.getPlatformFontsForNode", { nodeId })).fonts.map((f) => `${f.familyName}${f.isCustomFont ? " [custom]" : ""}`);
      const m = {};
      for (let w = 320; w <= 1300; w += 1) {
        await page.setViewportSize({ width: w, height: 900 });
        m[w] = await page.evaluate(() => { const g = document.querySelector(".home-opening__ghost"); return g ? Math.round(g.getBoundingClientRect().height) : -1; });
      }
      res[mode] = m;
      await ctx.close();
    }
    const bad = Object.keys(res.web).filter((w) => res.web[w] !== res.blocked[w]).map(Number);
    console.log(`theme=${theme} faces web=${JSON.stringify(faces.web)} blocked=${JSON.stringify(faces.blocked)} differing widths: ${ranges(bad) || "none"} (of ${Object.keys(res.web).length})`);
  }
  await browser.close();
})();
