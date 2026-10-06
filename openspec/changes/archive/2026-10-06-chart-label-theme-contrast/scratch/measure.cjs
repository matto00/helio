// usage: node measure.cjs <before|after>
const { chromium } = require("/home/matt/Development/helio/node_modules/@playwright/test");
const fs = require("fs");
const phase = process.argv[2];
const ids = JSON.parse(fs.readFileSync("ids.json"));
const outDir = "..";
const lum = ([r, g, b]) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
const hex = (c) => "#" + c.map((v) => v.toString(16).padStart(2, "0")).join("");
const parseColor = (s) => { if (typeof s !== "string") return null; const m = /^#([0-9a-f]{6})$/i.exec(s); return m ? [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16)) : null; };

(async () => {
  const browser = await chromium.launch();
  const results = [];
  for (const theme of ["light", "dark"]) {
    const ctx = await browser.newContext({ storageState: "state.json", viewport: { width: 1500, height: 1000 }, deviceScaleFactor: 2 });
    await ctx.addInitScript((t) => localStorage.setItem("helio-theme", t), theme);
    const page = await ctx.newPage();
    await page.goto(`http://localhost:6695/dashboards/${ids.dashboard}`);
    await page.waitForFunction(() => document.querySelectorAll(".chart-panel__canvas canvas").length >= 5, null, { timeout: 30000 });
    await page.waitForTimeout(2500);
    if ((await page.locator("html").getAttribute("data-theme")) !== theme) throw new Error("theme not applied");
    for (const [kind, pid] of Object.entries(ids.panels)) {
      const card = page.locator(".react-grid-item", { hasText: `HEL-1263 ${kind}` }).first();
      await card.scrollIntoViewIfNeeded();
      await page.waitForTimeout(800);
      const canvasWrap = card.locator(".chart-panel__canvas").first();
      const info = await canvasWrap.evaluate(async (el) => {
        const m = await import("/src/features/panels/ui/echartsCore.ts");
        const ec = m.default;
        let inst = null;
        for (const n of [el, ...el.querySelectorAll("div")]) { inst = ec.getInstanceByDom(n); if (inst) break; }
        if (!inst) return { error: "no instance" };
        const box = el.getBoundingClientRect();
        const list = inst.getZr().storage.getDisplayList(true);
        const texts = [];
        for (const d of list) {
          const st = d.style;
          if (!st || typeof st.text !== "string" || !st.text.trim()) continue;
          if (d.ignore || d.invisible) continue;
          const r = d.getBoundingRect().clone();
          if (d.transform) r.applyTransform(d.transform);
          texts.push({ text: st.text, fill: st.fill, fontSize: st.fontSize, font: st.font, x: box.left + r.x, y: box.top + r.y, w: r.width, h: r.height, cx: r.x, cy: r.y });
        }
        const opt = inst.getOption();
        return { texts, canvasH: box.height, canvasW: box.width, optText: { textStyle: opt.textStyle, axisLabelX: opt.xAxis?.[0]?.axisLabel?.color, axisLabelY: opt.yAxis?.[0]?.axisLabel?.color, legend: opt.legend?.[0]?.textStyle?.color } };
      });
      if (info.error) throw new Error(`${kind}/${theme}: ${info.error}`);
      for (const t of info.texts) {
        const clip = { x: Math.max(0, Math.floor(t.x) - 1), y: Math.max(0, Math.floor(t.y) - 1), width: Math.ceil(t.w) + 2, height: Math.ceil(t.h) + 2 };
        if (clip.y < 0 || clip.y + clip.height > 1000) { t.skipped = "outside viewport"; continue; }
        const buf = await page.screenshot({ clip });
        const px = await page.evaluate(async (b64) => {
          const blob = await (await fetch("data:image/png;base64," + b64)).blob();
          const bmp = await createImageBitmap(blob);
          const c = document.createElement("canvas"); c.width = bmp.width; c.height = bmp.height;
          const g = c.getContext("2d"); g.drawImage(bmp, 0, 0);
          const d = g.getImageData(0, 0, c.width, c.height).data;
          const counts = new Map();
          for (let i = 0; i < d.length; i += 4) { const k = d[i] + "," + d[i + 1] + "," + d[i + 2]; counts.set(k, (counts.get(k) || 0) + 1); }
          let bgK = null, bc = -1; for (const [k, v] of counts) if (v > bc) { bc = v; bgK = k; }
          const bg = bgK.split(",").map(Number);
          let far = null, fd = -1;
          for (let i = 0; i < d.length; i += 4) { const dd = (d[i] - bg[0]) ** 2 + (d[i + 1] - bg[1]) ** 2 + (d[i + 2] - bg[2]) ** 2; if (dd > fd) { fd = dd; far = [d[i], d[i + 1], d[i + 2]]; } }
          return { bg, far };
        }, buf.toString("base64"));
        t.bg = hex(px.bg); t.painted = hex(px.far);
        t.paintedRatio = +ratio(px.far, px.bg).toFixed(2);
        const f = parseColor(t.fill);
        t.fillRatio = f ? +ratio(f, px.bg).toFixed(2) : null;
        t.fillValid = !!f;
        delete t.x; delete t.y;
      }
      await card.screenshot({ path: `${outDir}/${phase}-${theme}-${kind}.png` });
      results.push({ theme, kind, optText: info.optText, texts: info.texts, canvasH: info.canvasH });
    }
    await page.screenshot({ path: `${outDir}/${phase}-${theme}.png`, fullPage: true });
    await ctx.close();
  }
  fs.writeFileSync(`measure-${phase}.json`, JSON.stringify(results, null, 1));
  await browser.close();
  // summary
  for (const r of results) {
    console.log(`\n== ${r.theme} ${r.kind} opt=${JSON.stringify(r.optText)}`);
    for (const t of r.texts) console.log(`  "${t.text}" fill=${t.fill} valid=${t.fillValid} bg=${t.bg} painted=${t.painted} paintedRatio=${t.paintedRatio} fillRatio=${t.fillRatio} cy=${Math.round(t.cy)} ${t.skipped || ""}`);
  }
})().catch((e) => { console.error(e); process.exit(1); });
