// D6a box-match + platform-font proof. usage: node boxmatch.mjs <baseURL> <wsEndpoint|-> <label> [--weights 400,600]
// Renders a fixed sample in each web font and in each matched fallback face forced via inline font-family, with
// line-height: normal, and reports width ratio, box height delta and the platform font Chromium really used (CDP).
import { createRequire } from "node:module";
const require = createRequire(process.cwd() + "/");
const { chromium } = require("playwright-core");
const [baseURL, ws, label, ...rest] = process.argv.slice(2);
const weights = (rest.includes("--weights") ? rest[rest.indexOf("--weights") + 1] : "400").split(",").map(Number);
const FONTS_CSS =
  "https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,400..700;1,9..144,400..700&family=Schibsted+Grotesk:ital,wght@0,400..900;1,400..900&family=JetBrains+Mono:ital,wght@0,400;0,500;0,600;0,700;1,400&display=swap";
const GROUPS = [
  { kind: "sans", web: "Schibsted Grotesk", fallbacks: ["Schibsted Grotesk Fallback Arial", "Schibsted Grotesk Fallback DejaVu"] },
  { kind: "mono", web: "JetBrains Mono", fallbacks: ["JetBrains Mono Fallback Courier", "JetBrains Mono Fallback DejaVu"] },
  { kind: "serif", web: "Fraunces", fallbacks: ["Fraunces Fallback Times", "Fraunces Fallback DejaVu"] },
];
const SAMPLES = ["All quiet: nothing has changed, failed or been missed.", "The quick brown fox jumps over the lazy dog"];
const SIZES = [16, 20, 28];
const browser = ws && ws !== "-" ? await chromium.connect(ws) : await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
await page.goto(baseURL + "/", { waitUntil: "load" });
await page.evaluate(
  (href) =>
    new Promise((res) => {
      const l = document.createElement("link");
      l.rel = "stylesheet";
      l.href = href;
      l.onload = () => res();
      l.onerror = () => res();
      document.head.appendChild(l);
    }),
  FONTS_CSS,
);
for (const g of GROUPS) for (const w of weights) await page.evaluate(([f, w]) => document.fonts.load(`${w} 20px "${f}"`, "All quiet"), [g.web, w]);
const cdp = await page.context().newCDPSession(page);
await cdp.send("DOM.enable");
await cdp.send("CSS.enable");
const rows = [];
for (const g of GROUPS)
  for (const w of weights)
    for (const size of SIZES)
      for (const text of SAMPLES) {
        const measure = async (family) => {
          const id = await page.evaluate(
            ([family, w, size, text]) => {
              document.getElementById("bm")?.remove();
              const s = document.createElement("span");
              s.id = "bm";
              s.textContent = text;
              s.style.cssText = `position:absolute;left:0;top:0;white-space:nowrap;display:inline-block;font-family:${family};font-weight:${w};font-size:${size}px;line-height:normal;font-optical-sizing:auto`;
              document.body.appendChild(s);
              const r = s.getBoundingClientRect();
              return { w: r.width, h: r.height };
            },
            [`"${family}"`, w, size, text],
          );
          const { root } = await cdp.send("DOM.getDocument", { depth: 0 });
          const { nodeId } = await cdp.send("DOM.querySelector", { nodeId: root.nodeId, selector: "#bm" });
          const { fonts } = await cdp.send("CSS.getPlatformFontsForNode", { nodeId });
          return { ...id, platform: fonts.map((f) => f.familyName + (f.isCustomFont ? "[custom]" : "")).join("+") };
        };
        const web = await measure(g.web);
        for (const fb of g.fallbacks) {
          const m = await measure(fb);
          rows.push({ kind: g.kind, weight: w, size, text: text.slice(0, 12), fallback: fb, platform: m.platform, webPlatform: web.platform, webW: +web.w.toFixed(2), fbW: +m.w.toFixed(2), widthRatio: +(m.w / web.w).toFixed(4), webH: +web.h.toFixed(2), fbH: +m.h.toFixed(2), dH: +(m.h - web.h).toFixed(2) });
        }
      }
console.log(JSON.stringify({ label, rows }, null, 1));
await browser.close();
