## Context

See proposal.md (Why). Ground truth at 530a22c96:
- `frontend/app.html:48` and `frontend/index.html:63` load a non-blocking Google Fonts stylesheet (`media="print"`,
  flipped in `onload`); it still delays `load`. Two distinct css2 URLs (app adds Fraunces and JetBrains Mono 700).
- 114 specs import `test` from `@playwright/test`; no `test.extend` in `e2e/`. 7 spec files call
  `browser.newContext(...)`. `playwright.config.ts:191` sets `launchOptions` (only `executablePath`, conditional) in the
  top-level `use`; projects do not override `launchOptions`. No `webServer` entry today.
- Font-dependent specs/helpers (grep `getPlatformFontsForNode|document.fonts|waitForWebFonts|Schibsted|JetBrains|
  Fraunces|40ch|fontFamily`): 22 specs plus `support/{webFonts,homeLoadProbe,hel1582Phone,rowDeleteGesture,typeStyle}`.
  `holdFonts` (`support/homeLoadProbe.ts:194`) and the catch-all at `hel1572-appearance-preferences.spec.ts:275` both
  `route.continue()` fonts requests to the network. No `toHaveScreenshot`/`toMatchSnapshot` anywhere.
- Licence: google/fonts `ofl/{fraunces,schibstedgrotesk,jetbrainsmono}/OFL.txt` are SIL OFL 1.1 (redistribution
  bundled with software allowed with notice + licence). Size: 22 woff2, 608 KB; index.html's set is a subset.
- Design-gate round 1 (skeptic-design-1.md) measured that ANY Playwright route (page or context) turns on Fetch
  interception for every request and disables the HTTP cache: warm `/login` navigations about 30-40% slower.

## Goals / Non-Goals

**Goals:** no e2e navigation can wait on the third-party fonts hosts; identical web-font rendering; no request
interception added to any spec; no per-spec edit.
**Non-Goals:** production font self-hosting; any `waitUntil`/assertion change in specs; hel1665:437.

## Decisions

**D1. Redirect the fonts hosts at the browser, in the shared config (revised after round 1).** `playwright.config.ts`
adds two Chromium switches to the top-level `use.launchOptions.args`, built by one helper
(`e2e/support/webFontsHost.ts`; the new spec may import only its port/marker constants, never the switch args):
`--host-rules=MAP fonts.googleapis.com 127.0.0.1:<P>,MAP fonts.gstatic.com 127.0.0.1:<P>` and
`--ignore-certificate-errors-spki-list=<sha256 of the committed test cert's SPKI>`. Every browser the suite launches
gets them, so every context (the built-in one and the 7 spec-created ones) and every page route that `continue()`s
(`holdFonts`, hel1572's catch-all) reaches the local server. No Playwright route, so no Fetch interception and the HTTP
cache is untouched; no spec file changes. Probe (scratch `spkiprobe/probe.mjs`, `probe2.mjs`): with both switches a
page `fetch` to `https://fonts.googleapis.com/...` is answered by a local HTTPS server in two separate contexts;
without the SPKI switch it fails. Rejected: (a) a `test.extend` route fixture via a tsconfig alias of
`@playwright/test` (works, round-1 skeptic reproduced it, but adds interception to every spec, and page routes that
`continue()` bypass it); (b') `ignoreHTTPSErrors` (per context, misses spec-created contexts); (c) empty stub
(changes what font-measuring specs measure).

**D2. Local server as a Playwright `webServer`, identity-checked (revised round 2).**
`e2e/fixtures/web-fonts/server.mjs` (node `https`, committed test-only key + cert, SAN `fonts.googleapis.com`,
`fonts.gstatic.com`, long validity) serves the copy. Port `<P>` = `HELIO_E2E_WEB_FONTS_PORT` or `DEV_PORT + 20000`
(below the 32768 ephemeral range; CI `DEV_PORT=5173` gives 25173, one runner per shard). `webServer: { command,
url: "https://127.0.0.1:<P>/__helio_web_fonts", ignoreHTTPSErrors: true, reuseExistingServer: true }`: `url`, not
`port`, so a foreign listener is unlikely to pass Playwright's check (any 200-403 counts as available), and the fonts
global setup throws at start unless the marker body AND header are present (a real conflict fails at start) and
`PLAYWRIGHT_TEST_BASE_URL` is not set to the fonts port. The marker path returns
`{server:"helio-e2e-web-fonts", unknownHits:[...]}` with the marker header. Responses: `content-type`
(`text/css; charset=utf-8` / `font/woff2`), `access-control-allow-origin: *`, `x-helio-e2e-web-fonts: local`, and the
`cache-control` Google sent for that file (recorded in the manifest), so caching behaves like the live hosts. The key
grants nothing: trusted only by SPKI pin, only fonts hosts mapped to it. Concurrent Playwright runs in one lane are
unsupported (the launching run kills the server at its end); README says so, and D4's teardown makes it loud.

**D3. Real bytes.** `e2e/fixtures/web-fonts/` holds `manifest.json` (decoded css2 URL -> css file; gstatic path ->
woff2 file; the capture UA), the css responses, the woff2 files and each family's `OFL.txt`. `refresh.mjs` captures
with the UA of the Playwright Chromium the suite runs and pins the font version until re-run.

**D4. Missing fonts and a dead or foreign server fail loud.** An unknown path gets an immediate 404 and is
kept in the server's in-memory `unknownHits`. A fonts global setup reads the marker (throws if body/header missing) and stores the baseline hit count in
`process.env.HELIO_E2E_WEB_FONTS_BASELINE` (setup and teardown both run in the runner process); a fonts
global teardown, its OWN entry in a `globalTeardown` array (so a throw never skips HEL-1301's user cleanup), GETs the
marker again and fails the run, naming URLs, if the server is unreachable, lacks the marker header, or has new
unknown hits. The new spec's fs guard fails when (i) an app/index css2 URL (`&amp;` decoded) has no manifest entry,
(ii) a gstatic URL inside any committed css has no committed file, or (iii) an e2e file calls `route.fetch`/
`request.*` with a fonts-host URL (Node-side requests do not see browser switches; the 9 existing `route.fetch` calls
are document/API only).

**D5. Red-first spec `e2e/hel1757-web-fonts-local.spec.ts` tests the SHARED config (revised round 2).** It starts a
TCP black hole (accepts, never answers) and appends ONLY
`--host-resolver-rules=MAP fonts.googleapis.com <hole>,MAP fonts.gstatic.com <hole>` (a stalled upstream; the resolver
layer sits below `--host-rules`) to the INHERITED launch options:
`test.use({ launchOptions: async ({ launchOptions }, use) => use({ ...launchOptions, args: [...(launchOptions.args
?? []), stall] }) })`. It never imports the D1 args from the helper, so it passes only if `playwright.config.ts`
wires them. Tests, each asserting the hole got zero connections and the marker header on a fonts response:
(1) bare `page.goto("/login")` (default `load`) completes, and `renderedFaces` reports `isCustomFont` for Schibsted
Grotesk, Fraunces and JetBrains Mono at weight 700; (2) the same in a `browser.newContext()` context; (3) the same
with `page.route("**/*", (r) => r.continue())` installed. RED control: the config's wiring disabled
(`HELIO_E2E_WEB_FONTS_LOCAL=0`, read only in `playwright.config.ts`, documented as a diagnostic; it drops the D1
switches, the `webServer` and the fonts setup/teardown together, so the RED log fails only at the `goto` timeout)
must fail (1) at the `goto` timeout. Both runs recorded under `.concertino/scratch/HEL-1757/`.

**D6. AC 3 evidence: rendering AND timing (round-1 CR3).** Base vs branch, recorded:
(i) the whole font-dependent set (Context); (ii) every assertion that depends on font arrival timing, with its value
on both, at least `hel1665-home-phone-stability.spec.ts:164` `fontSwapSpread`; if it is 0 by construction on the
branch, say so in the PR's AC-3 statement and name the remaining swap coverage (`holdFonts` cases `:508-560`);
(iii) `renderedFaces` on one font-measuring spec both times; (iv) wall time of a CI-shard-sized sample, the
`@prod-build` latency specs (`hel1631-draft-mode:183`, `hel1632-live-output:262`, `HELIO_E2E_PROD_BUILD=1`) and the
C11 known-flake specs.

## Risks / Trade-offs

- [Flag removed from Chromium] -> the new spec goes red (fonts not served locally) rather than silently passing.
- [Port collision on `DEV_PORT + 20000`] -> `url` marker check, so start fails loudly; `HELIO_E2E_WEB_FONTS_PORT` override.
- [Server dies or is killed mid-run] -> pages fall back silently for the rest of that run, but D4's teardown fails it.
- [Committed private key] -> test-only, pinned by SPKI, only fonts hosts mapped; README says so.
- [Copy goes stale vs live Google] -> deliberate pin; `refresh.mjs` + D4 guard.
- [Font swap now near-instant] -> D6 (ii) measures and states it; no hidden vacuous assertion.

## Planner Notes

- Shared e2e files changed (for HEL-1744): `playwright.config.ts` (launchOptions args, `webServer`, teardown),
  `e2e/support/webFontsHost.ts` (new), `e2e/support/webFonts.globalSetup.ts` and `webFonts.globalTeardown.ts` (new, D4),
  `e2e/fixtures/web-fonts/**` (new), `.prettierignore` (one entry: `e2e/fixtures/web-fonts/`, the verbatim CSS must not be
  reformatted), `e2e/README.md`,
  `e2e/hel1757-web-fonts-local.spec.ts` (new). No spec or other support file changes.
- Licence verified (OFL 1.1, all three); no escalation needed.
