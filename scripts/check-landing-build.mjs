#!/usr/bin/env node
// check-landing-build: asserts the two-entry production build (frontend/dist) is what hosting expects, because
// nothing else sees it: jest never builds, e2e runs the dev server, and CI never ran `vite build` before HEL-1562.
//   - dist/index.html is the static landing page: hero, meta/OG/Twitter tags, canonical, no React root, no app
//     entry, no leftover %PLACEHOLDER%, the plan number from planNumbers.ts, and no React or axios in any chunk
//     reachable from it.
//   - dist/app.html is the SPA shell, and the service worker falls back to it.
//   - firebase.json rewrites to a file that exists; `/`, `/home` and deep links are `no-cache`, `/assets/**` is not.
// Usage: node scripts/check-landing-build.mjs [distDir]   (CI: after `npm --prefix frontend run build`)
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const REQUIRED_TAGS = [
  /<title>[^<]+<\/title>/,
  /<meta[^>]+name="description"[^>]+content="[^"]+"/,
  /<link[^>]+rel="canonical"[^>]+href="https:\/\/helioapp\.dev\/"/,
  /<meta[^>]+property="og:title"/,
  /<meta[^>]+property="og:description"/,
  /<meta[^>]+property="og:url"/,
  /<meta[^>]+property="og:type"/,
  /<meta[^>]+property="og:image"[^>]+content="https:\/\/[^"]+"/,
  /<meta[^>]+name="twitter:card"[^>]+content="summary_large_image"/,
  /<meta[^>]+name="twitter:title"/,
  /<meta[^>]+name="twitter:description"/,
  /<meta[^>]+name="twitter:image"[^>]+content="https:\/\/[^"]+"/,
];

const FORBIDDEN_IN_LANDING_CHUNKS = [
  ["axios", /axios|AxiosError/i],
  ["React", /react\.transition\.element|react\.element|ReactCurrentDispatcher|__SECRET_INTERNALS/],
];

const read = (p) => readFileSync(p, "utf8");

/** Same matching as Firebase Hosting: a glob `source` (`**` any, `*` within a segment) or an RE2 `regex`. */
export function headerRuleMatches(rule, path) {
  if (rule.regex !== undefined) return new RegExp(rule.regex).test(path);
  const body = rule.source
    .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, "__ANY__")
    .replace(/\*/g, "[^/]*")
    .replace(/__ANY__/g, ".*");
  return new RegExp(`^${body}$`).test(path);
}

const cacheControlsFor = (headers, path) =>
  headers
    .filter((rule) => headerRuleMatches(rule, path))
    .flatMap((rule) =>
      rule.headers.filter((h) => h.key.toLowerCase() === "cache-control").map((h) => h.value),
    );

/** Chunk files reachable from an HTML file: its script/modulepreload targets and their static and dynamic imports. */
function reachableChunks(distDir, html) {
  const seen = new Set();
  const queue = [...html.matchAll(/(?:src|href)="\/(assets\/[^"]+\.js)"/g)].map((m) => m[1]);
  while (queue.length) {
    const file = queue.pop();
    if (seen.has(file) || !existsSync(join(distDir, file))) continue;
    seen.add(file);
    const code = read(join(distDir, file));
    for (const m of code.matchAll(/(?:from|import)\s*\(?\s*["']\.\/([^"']+\.js)["']/g)) {
      queue.push(join(dirname(file), m[1]));
    }
  }
  return [...seen];
}

export function checkLandingBuild({ distDir, firebaseJson, planNumbersSource }) {
  const errors = [];
  const fail = (m) => errors.push(m);

  const indexPath = join(distDir, "index.html");
  const appPath = join(distDir, "app.html");
  if (!existsSync(indexPath)) return [`${indexPath} is missing`];
  if (!existsSync(appPath)) fail("app.html is missing (the SPA shell)");
  const index = read(indexPath);

  if (!index.includes("Give me a dashboard for")) fail("index.html lacks the hero text");
  for (const tag of REQUIRED_TAGS)
    if (!tag.test(index)) fail(`index.html lacks a tag matching ${tag}`);
  if (/id="root"/.test(index)) fail("index.html has the React root");
  if (/%[A-Z][A-Z0-9_]*%/.test(index)) fail("index.html has an unsubstituted %PLACEHOLDER%");
  const number = /BETA_DAILY_MESSAGE_LIMIT\s*=\s*(\d+)/.exec(planNumbersSource)?.[1];
  if (!number) fail("could not read BETA_DAILY_MESSAGE_LIMIT from planNumbers.ts");
  else if (!index.includes(`${number} messages a day`))
    fail(`index.html does not quote "${number} messages a day"`);

  for (const m of index.matchAll(/property="og:image"[^>]+content="https:\/\/[^/]+(\/[^"]+)"/g)) {
    if (!existsSync(join(distDir, m[1]))) fail(`og:image ${m[1]} is not in the build`);
  }

  const chunks = reachableChunks(distDir, index);
  if (chunks.length === 0)
    fail("no script reachable from index.html (the landing behaviour is missing)");
  for (const chunk of chunks) {
    const code = read(join(distDir, chunk));
    for (const [name, pattern] of FORBIDDEN_IN_LANDING_CHUNKS) {
      if (pattern.test(code)) fail(`${chunk} (reachable from index.html) contains ${name}`);
    }
  }

  if (existsSync(appPath) && !/id="root"/.test(read(appPath)))
    fail("app.html lacks the React root");
  const swPath = join(distDir, "sw.js");
  if (!existsSync(swPath)) fail("sw.js is missing");
  else {
    const sw = read(swPath);
    if (!/createHandlerBoundToURL\(\s*["']\/?app\.html["']\s*\)/.test(sw))
      fail("sw.js does not use app.html as its navigation fallback");
    // Without these a new worker waits behind the previous build's, which keeps serving the old shell at `/`.
    if (!/skipWaiting\(\)/.test(sw) || !/clientsClaim\(\)/.test(sw))
      fail("sw.js does not skipWaiting and clientsClaim");
  }

  const hosting = JSON.parse(firebaseJson).hosting;
  const destinations = hosting.rewrites.map((r) => r.destination);
  if (!destinations.includes("/app.html")) fail('firebase.json has no rewrite to "/app.html"');
  for (const d of destinations)
    if (!existsSync(join(distDir, d)))
      fail(`firebase.json rewrites to ${d}, which is not in the build`);
  for (const path of ["/", "/home", "/dashboards/abc"]) {
    if (!cacheControlsFor(hosting.headers, path).includes("no-cache"))
      fail(`firebase.json does not mark ${path} no-cache`);
  }
  if (cacheControlsFor(hosting.headers, "/assets/x.js").includes("no-cache"))
    fail("firebase.json marks /assets/** no-cache");
  if (!cacheControlsFor(hosting.headers, "/assets/x.js").some((v) => v.includes("immutable"))) {
    fail("firebase.json does not mark /assets/** immutable");
  }
  return errors;
}

function main() {
  const distDir = resolve(process.argv[2] ?? join(REPO_ROOT, "frontend/dist"));
  const errors = checkLandingBuild({
    distDir,
    firebaseJson: read(join(REPO_ROOT, "frontend/firebase.json")),
    planNumbersSource: read(join(REPO_ROOT, "frontend/src/landing/planNumbers.ts")),
  });
  if (errors.length > 0) {
    console.error("check-landing-build: FAILED\n");
    for (const e of errors) console.error(`  - ${e}`);
    process.exit(1);
  }
  console.log(`check-landing-build: OK (${distDir})`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
