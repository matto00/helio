// usage: node probe.cjs <ws|host> <label> ; env BASE
const { chromium } = require("/home/matt/Development/helio/node_modules/playwright-core");
const fs = require("fs");
const base = process.env.BASE || "http://localhost:7181";
const css = fs.readFileSync(__dirname + "/bar.css", "utf8");
const [ws, label] = process.argv.slice(2);
const out = process.env.OUT || __dirname + "/probe-out";
fs.mkdirSync(out, { recursive: true });
async function scan(helper, png, x, y0, y1, bg) {
  return helper.evaluate(async ({ b64, x, bg }) => {
    const img = new Image(); img.src = "data:image/png;base64," + b64; await img.decode();
    const c = document.createElement("canvas"); c.width = img.width; c.height = img.height;
    const g = c.getContext("2d"); g.drawImage(img, 0, 0);
    const col = g.getImageData(Math.round(x), 0, 1, img.height).data;
    const rows = [];
    for (let y = 0; y < img.height; y++) {
      const d = Math.max(Math.abs(col[y*4]-bg[0]), Math.abs(col[y*4+1]-bg[1]), Math.abs(col[y*4+2]-bg[2]));
      rows.push(d >= 2);
    }
    const runs = []; let s = -1;
    rows.forEach((v, y) => { if (v && s < 0) s = y; if (!v && s >= 0) { runs.push([s, y - 1]); s = -1; } });
    if (s >= 0) runs.push([s, rows.length - 1]);
    return runs;
  }, { b64: png.toString("base64"), x, bg });
}
(async () => {
  const browser = ws === "host" ? await chromium.launch() : await chromium.connect(ws);
  console.log(label, "browser", browser.version());
  const results = [];
  for (const theme of ["light", "dark"]) for (const mode of ["web", "blocked"]) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: "reduce" });
    const page = await ctx.newPage();
    const login = await page.request.post(base + "/api/auth/login", { data: { email: "hel1749sweep@example.test", password: "correcthorsebattery1" }, headers: {"X-Helio-Requested-With":"1"} });
    if (!login.ok()) throw new Error("login " + login.status());
    await page.addInitScript((t) => localStorage.setItem("helio-theme", t), theme);
    if (mode === "blocked") await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
    await page.route("**/api/home-summary**", () => {});
    await page.goto(base + "/home", { waitUntil: "load" });
    await page.waitForSelector(".home-opening__ghost", { state: "attached" });
    await page.evaluate(() => document.fonts.ready); await page.waitForTimeout(800);
    const cdp = await ctx.newCDPSession(page); await cdp.send("DOM.enable"); await cdp.send("CSS.enable");
    const { root } = await cdp.send("DOM.getDocument", { depth: 0 });
    const { nodeId } = await cdp.send("DOM.querySelector", { nodeId: root.nodeId, selector: ".home-opening__ghost" });
    const face = (await cdp.send("CSS.getPlatformFontsForNode", { nodeId })).fonts.map((f) => f.familyName + (f.isCustomFont ? "[custom]" : "")).join("+");
    await page.evaluate((css) => {
      const st = document.createElement("style"); st.textContent = css; document.head.append(st);
      const g = document.querySelector(".home-opening__ghost");
      const sp = document.createElement("span"); sp.className = "ui-skeleton home-opening__ghost-bar"; sp.textContent = g.textContent; g.textContent = ""; g.append(sp);
      document.querySelector(".home-opening__skeleton-line")?.remove();
    }, css);
    const helper = await ctx.newPage();
    for (const w of [320, 375, 430, 431, 500, 604, 605, 1280]) {
      await page.setViewportSize({ width: w, height: 900 });
      await page.waitForTimeout(150);
      const m = await page.evaluate(() => {
        const g = document.querySelector(".home-opening__ghost"), b = g.querySelector(".home-opening__ghost-bar");
        const cs = getComputedStyle(b), gs = getComputedStyle(g);
        const rects = [...b.getClientRects()].map((r) => ({ x: r.x, y: r.y, w: r.width, h: r.height }));
        const gr = g.getBoundingClientRect();
        return { fs: parseFloat(gs.fontSize), lh: parseFloat(gs.lineHeight), gh: gr.height, gx: gr.x, gy: gr.y, gw: gr.width, rects,
          bdb: cs.boxDecorationBreak, wbdb: cs.webkitBoxDecorationBreak, disp: cs.display, vis: cs.visibility, mask: cs.maskImage.slice(0, 20), radius: cs.borderRadius };
      });
      const lines = Math.round(m.gh / m.lh);
      const clip = { x: 0, y: Math.max(0, m.gy - 10), width: 1280 > w ? w : w, height: m.gh + 20 };
      const png = await page.screenshot({ clip: { x: 0, y: clip.y, width: w, height: clip.height } });
      const bgPix = await helper.evaluate(async (b64) => { const img = new Image(); img.src = "data:image/png;base64," + b64; await img.decode(); const c = document.createElement("canvas"); c.width = img.width; c.height = img.height; const g = c.getContext("2d"); g.drawImage(img, 0, 0); return [...g.getImageData(1, 1, 1, 1).data].slice(0, 3); }, png.toString("base64"));
      const bars = [];
      for (const r of m.rects) {
        const runs = await scan(helper, png, r.x + r.w / 2, 0, 0, bgPix);
        const lo = r.y - clip.y - 0.5, hi = r.y + r.h - clip.y + 0.5;
        bars.push(runs.filter(([a, b]) => a >= lo && b <= hi).map(([a, b]) => [a + clip.y, b + clip.y]));
      }
      const thick = bars.map((rs) => rs.map(([a, b]) => b - a + 1));
      const gap = bars.length > 1 ? bars.slice(1).map((rs, i) => rs[0][0] - bars[i][bars[i].length - 1][1] - 1) : [];
      results.push({ rects: m.rects, bars, theme, mode, face, w, fs: m.fs, lines, frags: m.rects.length, gh: m.gh, thick, gap, bdb: m.bdb, wbdb: m.wbdb, disp: m.disp, vis: m.vis, mask: m.mask });
      if ([320, 431, 604, 1280].includes(w)) fs.writeFileSync(`${out}/${label}-${theme}-${mode}-${w}.png`, await page.screenshot({ clip: { x: 0, y: clip.y - 30, width: w, height: clip.height + 60 } }));
    }
    await ctx.close();
  }
  for (const r of results) console.log(JSON.stringify(r));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
