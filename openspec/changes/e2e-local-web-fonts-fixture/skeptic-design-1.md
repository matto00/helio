## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed at HEAD 530a22c96425d3520b7820c83de652837fdcdef7. The change dir is untracked planning artifacts only.

### What I verified (with evidence)

- **D1 alias holds. Reproduced independently, with a negative control.** I re-ran the planner probe (`aliasprobe/`, 1 passed).
  I also built my own probe at `.concertino/scratch/HEL-1757/skeptic-probe/`. It closes the gaps the planner's probe left:
  - the tsconfig sits in `e2e/` with **no `baseUrl`**, as in the real `e2e/tsconfig.json`;
  - the config sits in the parent directory, as the real one does;
  - a **support helper** imports `expect` from `@playwright/test`;
  - a nested `test.describe` uses `test.use`.

  With the paths entry: 2 passed. With `"paths":{}`: 2 failed. So the alias is load-bearing, not an accident. The root
  `tsconfig.json` has no `paths`, so `playwright.config.ts` keeps the real module.
  `node_modules/@playwright/test/index.js` is exactly `module.exports = require('playwright/test')` (1.55.1), so there is a
  single module instance. ESLint has no import plugin (`eslint.config.cjs:1-5`), so the transitive `playwright/test`
  import will not be flagged.
- **Context claims hold.**
  - 7 spec files call `browser.newContext`.
  - No `toHaveScreenshot`/`toMatchSnapshot`.
  - 360 `page.goto(` calls in 114 files.
  - `holdFonts` (`e2e/support/homeLoadProbe.ts:194-210`) uses `route.continue()`.
  - `app.html:48` and `index.html:63` carry two distinct css2 URLs.
  - New spec files get a median shard weight automatically (`scripts/e2e-shard.mjs:56`), so CI sharding does not break.
- **A context route turns on Fetch interception for every request and disables the HTTP cache.** Source:
  `playwright-core/lib/server/chromium/crNetworkManager.js:150-161`. Any route sends
  `Network.setCacheDisabled {cacheDisabled: true}` plus `Fetch.enable` with `urlPattern: "*"`.

  I measured it against this worktree's dev server, started with `start-servers.sh` and stopped with `stop-servers.sh`.
  Probe: `.concertino/scratch/HEL-1757/skeptic-cost/cost.spec.ts`, 6 `goto("/login")` per context, 2 rounds, reproduced.

  | Context | Round 1 times (ms) | Round 2 times (ms) | Zero-transfer resources |
  | --- | --- | --- | --- |
  | No route | 763, 810, 680, 721, 782 | 756, 746, 671, 634, 741 | 14 of 250 |
  | No-op fonts-only `context.route` | 1023, 985, 938, 1023, 945 | 1095, 1019, 993, 908, 895 | 0 of 250 |

  Every warm navigation got about 30-40% slower, and the cached resources disappeared. Today most specs run with no
  route at all. Under D2, every page in every spec runs this way.
- **A catch-all `page.route` bypasses the fixture.** `e2e/hel1572-appearance-preferences.spec.ts:275` registers
  `page.route("**/*")` and calls `route.continue()` for every non-document request (line 277). Page routes run before
  context routes, and `continue()` goes straight to the network, so that spec's fonts requests skip the fixture. D2 says
  only that page routes win "so holdFonts keeps working". It never lists the other page routes that can match the fonts
  hosts.
- **The cold-load swap assertion.** `e2e/hel1665-home-phone-stability.spec.ts:159-164` asserts
  `fontSwapSpread <= 4` for a "cold-load web-font swap". Its own comment says "Already-cached fonts give 0". If fonts come
  from a local fulfil in milliseconds, the swap may never happen. That assertion would then pass without measuring a swap
  (vacuously green), both before and after. D7 only asks for a before/after pass plus face evidence on one spec, so it
  would not catch this. The deterministic swap coverage at `:508-560` uses `holdFonts`, and only at 1024-1440 widths.
- **The spec's checks are not fully covered.**
  - D6 checks only that "Schibsted Grotesk" rasterises.
  - The app css2 URL also brings Fraunces and JetBrains Mono (weight 700 is app-only).
  - D4's drift guard checks that each css2 **URL** has a manifest entry. It does not check that each referenced woff2 is
    served.
  - An unknown-URL hit is only "logged".

  So a missing woff2 falls back silently in every spec except where the face is measured.
- **D6 is feasible.** The red run is "alias removed", which is the right control, because it proves the shared mechanism
  rather than a spec-local one. The file-level `launchOptions` override is worker-scoped and allowed.

### Verdict: REFUTE

### Change Requests

1. **D2/D7 must weigh the suite-wide interception cost.** Evidence above, from `crNetworkManager.js:150-161` and the
   measured +30-40% per warm navigation with the HTTP cache disabled. The design currently claims fonts "arrive sooner"
   and is silent on the fact that every request in every spec now goes through Fetch interception.
   - **Required:** record this in Risks.
   - **Required:** add a measured suite-level timing comparison to the evidence plan (base vs. branch). Cover a CI-shard-sized
     sample, the timing-sensitive specs (the `@prod-build` latency tests `hel1631-draft-mode:183` and
     `hel1632-live-output:262` via `HELIO_E2E_PROD_BUILD=1`), and the known-flake list in C11.
   - **Required:** either accept the cost explicitly with those numbers, or re-evaluate alternative (b). Alternative (b)
     is `--host-resolver-rules` to a local HTTPS server with a committed test certificate. It needs no request
     interception. D1(b) rejected it as "needs certificates" without weighing this cost.
2. **D2 must handle page routes that `continue()` fonts requests.** At least `hel1572-appearance-preferences.spec.ts:275-277`
   does this.
   - Either change that handler to `fallback()` and list it as a named exception to "no per-spec edits": it fixes the
     shared mechanism and leaves the spec's behaviour unchanged.
   - Or state it as a known gap and narrow the spec requirement's "No such request SHALL reach the network".
   - Add a fs-level guard to the new spec: any `page.route`/`context.route` whose pattern can match the fonts hosts (`**/*`,
     a bare regex, or a fonts pattern) and that calls `route.continue()` should fail and name the file:line. Otherwise
     the next catch-all reopens the hole.
3. **D7 must state the effect on assertions about font arrival timing, not only on rendering.** Enumerate every assertion
   that depends on fonts arriving late or on a swap happening, at least `hel1665-home-phone-stability.spec.ts:164`
   `fontSwapSpread`. For each one:
   - record the measured value on base and on the branch;
   - say whether it still exercises a swap;
   - if it now measures 0 by construction, say so in the AC-3 statement and name the coverage that remains (the
     `holdFonts` cases at `:508-560`).

   A before/after green run is not evidence here. This is the AC "check visual specs are not affected, or state why".
4. **Make an unknown fonts URL fail the test, not just log it.** In the shared fixture, assert at test teardown that there
   were zero unknown-URL hits (D4). Also extend D6's rasterised-face assertion to all three families on an `app.html`
   page: Fraunces, Schibsted Grotesk, and JetBrains Mono including weight 700, using `renderedFaces` / `isCustomFont`.
   Do not rely on `document.fonts.check`: it returns true when no matching face is registered.

   Without this, a woff2 missing from the manifest goes silently to the fallback face in every spec that does not measure
   that face. That is exactly the vacuous-green case the driver asked about.

### Non-blocking notes

- D2: a worker-scoped auto fixture that depends on `browser` launches a browser in API-only workers too. This is negligible,
  but it is worth a comment.
- D3: Google varies the css2 body by User-Agent. `refresh.mjs` should capture with the UA string of the Playwright Chromium
  build the suite actually runs, and record it in `manifest.json`.
- D6: the red run must fail **at the `page.goto` timeout**, not at a counter assertion. Have the spec import `test` from
  `@playwright/test`, not from `./support/test`, so removing the alias really removes the fixture.
- Tasks 1.1 and 3.2 should say where the RED/GREEN logs land: `.concertino/scratch/HEL-1757/`, per C13. The probes I used
  are in `skeptic-probe/` and `skeptic-cost/`.
