// Width of 40ch and of the default opening sentence at 24px, web font vs each fallback face (the Home opening
// sentence is capped at 40ch, so the ch unit's digit advance matters, not only the letter-average size-adjust).
import { createRequire } from "node:module";
const require = createRequire(process.cwd() + "/");
const { chromium } = require("playwright-core");
const [baseURL, ws] = process.argv.slice(2);
const browser = ws && ws !== "-" ? await chromium.connect(ws) : await chromium.launch();
const page = await (await browser.newContext()).newPage();
await page.goto(baseURL + "/", { waitUntil: "load" });
await page.evaluate(() => Promise.all([document.fonts.load('400 24px "Schibsted Grotesk"', "All quiet")]));
const rows = await page.evaluate(() => {
  const text = "All quiet: nothing has changed, failed or been missed.";
  return ["Schibsted Grotesk", "Schibsted Grotesk Fallback Arial", "Schibsted Grotesk Fallback DejaVu"].map((f) => {
    const s = document.createElement("span");
    s.style.cssText = `position:absolute;white-space:nowrap;font:400 24px "${f}"`;
    s.textContent = text;
    const c = document.createElement("div");
    c.style.cssText = `position:absolute;width:40ch;font:400 24px "${f}"`;
    document.body.append(s, c);
    return { f, sentenceW: s.getBoundingClientRect().width, ch40: c.getBoundingClientRect().width };
  });
});
console.log(JSON.stringify(rows));
await browser.close();
