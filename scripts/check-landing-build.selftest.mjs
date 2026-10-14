// Selftest for check-landing-build.mjs: a clean fixture build passes, and each mutation turns the check red.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { checkLandingBuild, headerRuleMatches } from "./check-landing-build.mjs";

const INDEX = `<!doctype html><html><head><title>Helio</title>
<meta name="description" content="d"><link rel="canonical" href="https://helioapp.dev/">
<meta property="og:title" content="t"><meta property="og:description" content="d"><meta property="og:url" content="https://helioapp.dev/">
<meta property="og:type" content="website"><meta property="og:image" content="https://helioapp.dev/landing/og.jpg">
<meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="t">
<meta name="twitter:description" content="d"><meta name="twitter:image" content="https://helioapp.dev/landing/og.jpg">
<script type="module" src="/assets/landing-abc.js"></script></head>
<body><h1>Give me a dashboard for</h1><p>50 messages a day.</p></body></html>`;
const FIREBASE = {
  hosting: {
    headers: [
      { source: "/index.html", headers: [{ key: "Cache-Control", value: "no-cache" }] },
      { regex: "^[^.]*$", headers: [{ key: "Cache-Control", value: "no-cache" }] },
      {
        source: "/assets/**",
        headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }],
      },
    ],
    rewrites: [{ source: "**", destination: "/app.html" }],
  },
};
const PLAN = "export const BETA_DAILY_MESSAGE_LIMIT = 50;";

function fixture(mutate = {}) {
  const dir = mkdtempSync(join(tmpdir(), "landing-build-selftest-"));
  mkdirSync(join(dir, "assets"));
  mkdirSync(join(dir, "landing"));
  writeFileSync(join(dir, "landing/og.jpg"), "x");
  writeFileSync(join(dir, "index.html"), mutate.index ?? INDEX);
  writeFileSync(join(dir, "app.html"), '<div id="root"></div>');
  writeFileSync(
    join(dir, "assets/landing-abc.js"),
    mutate.chunk ?? 'import "./shared-def.js";console.log(1);',
  );
  writeFileSync(join(dir, "assets/shared-def.js"), mutate.shared ?? "export const x = 1;");
  writeFileSync(
    join(dir, "sw.js"),
    mutate.sw ??
      'self.skipWaiting();workbox.clientsClaim();registerRoute(new NavigationRoute(workbox.createHandlerBoundToURL("app.html")))',
  );
  return dir;
}
const run = (mutate = {}, firebase = FIREBASE) => {
  const dir = fixture(mutate);
  try {
    return checkLandingBuild({
      distDir: dir,
      firebaseJson: JSON.stringify(firebase),
      planNumbersSource: PLAN,
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};
const expectRed = (errors, fragment) =>
  assert.ok(
    errors.some((e) => e.includes(fragment)),
    `expected an error containing "${fragment}", got ${JSON.stringify(errors)}`,
  );

assert.deepEqual(run(), [], "a clean fixture must pass");

expectRed(
  run({ index: INDEX.replace("50 messages", "%BETA_DAILY_MESSAGE_LIMIT% messages") }),
  "%PLACEHOLDER%",
);
expectRed(
  run({ index: INDEX.replace("50 messages a day", "40 messages a day") }),
  "50 messages a day",
);
expectRed(run({ shared: 'import axios from "axios"; const e = new AxiosError();' }), "axios");
expectRed(run({ shared: 'const k = "react.transition.element";' }), "React");
expectRed(run({ index: INDEX.replace("<body>", '<body><div id="root"></div>') }), "React root");
expectRed(run({ index: INDEX.replace(/<meta property="og:image"[^>]*>/, "") }), "og:image");
expectRed(
  run({ sw: 'skipWaiting();clientsClaim();createHandlerBoundToURL("index.html")' }),
  "app.html as its navigation fallback",
);
expectRed(run({ sw: 'createHandlerBoundToURL("app.html")' }), "skipWaiting and clientsClaim");
expectRed(
  run(
    {},
    {
      hosting: {
        ...FIREBASE.hosting,
        headers: [FIREBASE.hosting.headers[0], FIREBASE.hosting.headers[2]],
      },
    },
  ),
  "/home no-cache",
);
expectRed(
  run(
    {},
    { hosting: { ...FIREBASE.hosting, rewrites: [{ source: "**", destination: "/index.html" }] } },
  ),
  '"/app.html"',
);

assert.equal(headerRuleMatches({ regex: "^[^.]*$" }, "/dashboards/abc"), true);
assert.equal(headerRuleMatches({ regex: "^[^.]*$" }, "/assets/x.js"), false);
assert.equal(headerRuleMatches({ source: "/assets/**" }, "/assets/a/b.js"), true);

console.log("check-landing-build selftest: OK");
