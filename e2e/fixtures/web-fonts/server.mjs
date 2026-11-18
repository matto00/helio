// HEL-1757: local HTTPS server that answers fonts.googleapis.com / fonts.gstatic.com for every e2e browser
// (playwright.config.ts maps both hosts to it with Chromium --host-rules). It serves the committed copy captured
// by refresh.mjs, byte for byte, so web fonts render exactly as with the live hosts and nothing leaves the machine.
//
//   node e2e/fixtures/web-fonts/server.mjs <port>
//
// Any path with no committed copy gets an immediate 404 and is remembered; the fonts global teardown fails the
// run naming those URLs. GET /__helio_web_fonts is the identity marker (body + header) the config's webServer
// check and the global setup/teardown read.
import fs from "node:fs";
import https from "node:https";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const MARKER_PATH = "/__helio_web_fonts";
const MARKER_HEADER = "x-helio-e2e-web-fonts";
const SERVER_ID = "helio-e2e-web-fonts";

const port = Number(process.argv[2]);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error(`usage: node server.mjs <port>; got "${process.argv[2]}"`);
  process.exit(2);
}

const manifest = JSON.parse(fs.readFileSync(path.join(here, "manifest.json"), "utf8"));
const read = (file) => fs.readFileSync(path.join(here, "files", file));
const routes = new Map();
for (const [key, entry] of Object.entries(manifest.css)) {
  routes.set(key, { body: read(entry.file), type: "text/css; charset=utf-8", cache: entry.cacheControl });
}
for (const [key, entry] of Object.entries(manifest.fonts)) {
  routes.set(key, { body: read(entry.file), type: "font/woff2", cache: entry.cacheControl });
}

const unknownHits = [];

const server = https.createServer(
  { key: fs.readFileSync(path.join(here, "test-key.pem")), cert: fs.readFileSync(path.join(here, "test-cert.pem")) },
  (req, res) => {
    const url = req.url ?? "/";
    const base = { "access-control-allow-origin": "*", [MARKER_HEADER]: "local" };
    if (url === MARKER_PATH) {
      res.writeHead(200, { ...base, "content-type": "application/json", "cache-control": "no-store" });
      res.end(JSON.stringify({ server: SERVER_ID, unknownHits }));
      return;
    }
    if (req.method === "OPTIONS") {
      res.writeHead(204, { ...base, "access-control-allow-methods": "GET, HEAD" });
      res.end();
      return;
    }
    let key = url;
    try {
      key = decodeURIComponent(url);
    } catch {
      // keep the raw path; it will not match and is reported as unknown
    }
    const hit = routes.get(key);
    if (!hit || (req.method !== "GET" && req.method !== "HEAD")) {
      unknownHits.push(`${req.headers.host ?? "?"}${url}`);
      res.writeHead(404, { ...base, "content-type": "text/plain" });
      res.end(`no committed copy of ${url}`);
      return;
    }
    const headers = { ...base, "content-type": hit.type, "content-length": hit.body.length };
    if (hit.cache) headers["cache-control"] = hit.cache;
    res.writeHead(200, headers);
    res.end(req.method === "HEAD" ? undefined : hit.body);
  },
);
server.listen(port, "127.0.0.1", () => console.log(`[${SERVER_ID}] listening on https://127.0.0.1:${port}`));
for (const sig of ["SIGTERM", "SIGINT"]) process.on(sig, () => server.close(() => process.exit(0)));
