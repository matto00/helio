// HEL-1757: recapture the committed copy of the Google Fonts responses the app requests.
//
//   node e2e/fixtures/web-fonts/refresh.mjs
//
// Reads every https://fonts.googleapis.com/css2?... URL from frontend/app.html and frontend/index.html, fetches it
// with the user agent of the Playwright Chromium the suite runs, saves the CSS response verbatim, then fetches
// every https://fonts.gstatic.com/... file those stylesheets reference. manifest.json maps the decoded css2 URL
// (path + query) and the gstatic path to the committed file and records the cache-control Google sent. The copy is
// a deliberate pin: it only changes when this script is re-run. Never hand-edit the captured files.
import { chromium } from "@playwright/test";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "../../..");
const filesDir = path.join(here, "files");

export function appFontUrls() {
  const urls = new Set();
  for (const html of ["frontend/app.html", "frontend/index.html"]) {
    const text = fs.readFileSync(path.join(repo, html), "utf8");
    for (const m of text.matchAll(/https:\/\/fonts\.googleapis\.com\/css2\?[^"'\s]+/g)) {
      urls.add(m[0].replaceAll("&amp;", "&"));
    }
  }
  return [...urls];
}

async function capture() {
  const browser = await chromium.launch();
  const ua = await (await browser.newPage()).evaluate(() => navigator.userAgent);
  await browser.close();
  const headers = { "user-agent": ua };

  fs.rmSync(filesDir, { recursive: true, force: true });
  fs.mkdirSync(filesDir, { recursive: true });
  const manifest = { captureUserAgent: ua, css: {}, fonts: {} };

  let n = 0;
  for (const url of appFontUrls()) {
    const res = await fetch(url, { headers });
    if (!res.ok) throw new Error(`css fetch ${res.status}: ${url}`);
    const body = Buffer.from(await res.arrayBuffer());
    const file = `css-${++n}-${crypto.createHash("sha256").update(body).digest("hex").slice(0, 12)}.css`;
    fs.writeFileSync(path.join(filesDir, file), body);
    const u = new URL(url);
    manifest.css[decodeURIComponent(u.pathname + u.search)] = {
      file,
      cacheControl: res.headers.get("cache-control"),
    };
  }
  for (const entry of Object.values(manifest.css)) {
    const css = fs.readFileSync(path.join(filesDir, entry.file), "utf8");
    for (const m of css.matchAll(/https:\/\/fonts\.gstatic\.com(\/[^)\s'"]+)/g)) {
      const gpath = m[1];
      if (manifest.fonts[gpath]) continue;
      const res = await fetch(`https://fonts.gstatic.com${gpath}`, { headers });
      if (!res.ok) throw new Error(`font fetch ${res.status}: ${gpath}`);
      const file = path.basename(gpath);
      if (Object.values(manifest.fonts).some((f) => f.file === file)) {
        throw new Error(`font file name collision: ${file}`);
      }
      fs.writeFileSync(path.join(filesDir, file), Buffer.from(await res.arrayBuffer()));
      manifest.fonts[gpath] = { file, cacheControl: res.headers.get("cache-control") };
    }
  }
  fs.writeFileSync(path.join(here, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`captured ${Object.keys(manifest.css).length} stylesheets, ${Object.keys(manifest.fonts).length} fonts`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await capture();
