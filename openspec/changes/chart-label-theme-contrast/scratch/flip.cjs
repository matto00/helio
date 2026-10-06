const { chromium } = require("/home/matt/Development/helio/node_modules/@playwright/test");
(async () => {
  const b = await chromium.launch(); const p = await b.newPage();
  await p.goto("http://localhost:6695/login");
  const r = await p.evaluate(async () => {
    const m = await import("/src/theme/appearance.ts");
    const out = [];
    const cols = ["#ffffff","#ffff00","#00ffff","#ff0000","#00ff00","#0000ff","#000000","#808080","#ff8800","#ff00ff","#7fffd4","#ffd700"];
    for (const t of ["light","dark"]) for (const c of cols) {
      out.push([t,c,m.resolvePanelTextColor(t,c,0,"inherit"), m.themeAppearancePalette?.[t]?.defaultText]);
    }
    return out;
  });
  console.log(JSON.stringify(r)); await b.close();
})();
