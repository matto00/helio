// THROWAWAY (HEL-1580). Launches its OWN headless Chromium via the repo's playwright-core; never the shared MCP browser.
// Usage: PLAYWRIGHT_CORE=/abs/path/to/node_modules/playwright-core nice -n 19 node measure.cjs [--headless-shell|--full]
const path = require("path");
const core = process.env.PLAYWRIGHT_CORE || "/home/matt/Development/helio/node_modules/playwright-core";
const resolved = require.resolve(core);
const { chromium } = require(core);
const pkg = require(path.join(core, "package.json"));
const WARM = 50, MEASURED = 500;
(async () => {
  const useFull = process.argv.includes("--full");
  const browser = await chromium.launch({ headless: true, ...(useFull ? { channel: "chromium" } : {}) });
  const out = { playwrightCore: { version: pkg.version, resolved }, browserVersion: browser.version(), binary: useFull ? "chromium (new headless)" : "chromium_headless_shell", node: process.version, runs: {} };
  for (const rate of [1, 4]) {
    const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
    const page = await ctx.newPage();
    await page.goto("file://" + path.resolve(__dirname, "index.html"));
    const cdp = await ctx.newCDPSession(page);
    if (rate !== 1) await cdp.send("Emulation.setCPUThrottlingRate", { rate });
    const r = { info: await page.evaluate(() => window.proto.info()) };
    r.verify = await page.evaluate(() => window.proto.verify(500));
    for (const kind of ["filter-drag", "expr-edit"]) {
      r["recompute:" + kind] = await page.evaluate(([k, w, m]) => window.proto.recompute(k, w, m), [kind, WARM, MEASURED]);
      r["render:" + kind] = await page.evaluate(([k, w, m]) => window.proto.recomputeRender(k, w, m), [kind, WARM, MEASURED]);
    }
    // Scaling probe (recompute only, filter-drag, 50 warm + 200 measured): where the CSV row cap sits (CSV_MAX_ROWS default 50,000).
    r.scaling = {};
    for (const n of [1000, 10000, 50000]) {
      await page.evaluate((x) => window.proto.setRows(x), n);
      const s = await page.evaluate(() => window.proto.recompute("filter-drag", 50, 200));
      r.scaling[n] = { median: s.median, p95: s.p95, max: s.max, mean: s.mean };
    }
    out.runs["cpuThrottle" + rate + "x"] = r;
    await ctx.close();
  }
  await browser.close();
  console.log(JSON.stringify(out, null, 2));
})().catch((e) => { console.error(e); process.exit(1); });
