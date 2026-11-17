// HEL-1737 D3 1.3: sweep a sentence-only size-adjust for one fallback face; report the default sentence's nowrap width
// at 24px and 20px with the real computed style, next to the web font's. usage: node adjsweep.mjs <root> <base> <ws> <arial|dejavu> <from> <to> <step>
import { createRequire } from "node:module";
const [root, base, ws, kind, from, to, step] = process.argv.slice(2);
const require = createRequire(root + "/");
const { chromium } = require("playwright-core");
const browser = await chromium.connect(ws);
const page = await (await browser.newContext()).newPage();
await page.goto(base + "/", { waitUntil: "load" });
await page.evaluate(() => document.fonts.load('400 24px "Schibsted Grotesk"', "All quiet"));
const src = kind === "arial" ? 'local("Arial"), local("ArialMT"), local("Liberation Sans"), local("LiberationSans"), local("Arimo")' : 'local("DejaVu Sans"), local("DejaVuSans")';
const rows = await page.evaluate(async ({ src, from, to, step }) => {
  const text = "All quiet: nothing has changed, failed or been missed.";
  const w = (f, size) => { const s = document.createElement("span"); s.style.cssText = `position:absolute;visibility:hidden;white-space:nowrap;font:400 ${size}px "${f}";letter-spacing:-0.01em`; s.textContent = text; document.body.append(s); const x = s.getBoundingClientRect().width; s.remove(); return x; };
  const out = { web24: w("Schibsted Grotesk", 24), web20: w("Schibsted Grotesk", 20), rows: [] };
  for (let a = +from; a <= +to + 1e-9; a += +step) {
    const name = "Sweep" + Math.round(a * 1000);
    const st = document.createElement("style"); st.textContent = `@font-face{font-family:"${name}";src:${src};size-adjust:${a}%}`; document.head.append(st);
    await document.fonts.load(`400 24px "${name}"`, "A");
    out.rows.push({ a: +a.toFixed(3), w24: w(name, 24), w20: w(name, 20) });
  }
  return out;
}, { src, from, to, step });
console.log("web24", rows.web24, "web20", rows.web20);
for (const r of rows.rows) console.log(r.a, r.w24.toFixed(2), r.w20.toFixed(2), r.w24 > 580 && r.w24 <= 581 ? "MATCH24" : "");
await browser.close();
