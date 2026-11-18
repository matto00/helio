## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed at HEAD 530a22c96425d3520b7820c83de652837fdcdef7 (the change dir holds untracked planning artifacts only).
Probes: `.concertino/scratch/HEL-1757/skeptic2-probe/` (`probe.mjs`, `selfoverride/`), run with the repo's Playwright
1.55.1 and its default headless shell.

### What I verified (with evidence)

- **Round-1 CRs are addressed in substance, not just reworded.**
  - CR1 (interception cost): D1 no longer adds a Playwright route. A browser switch adds no `Fetch.enable` and does not
    disable the cache. The red-first spec is the only place that changes launch args.
  - CR2 (page routes that `continue()`): addressed by the mechanism itself. My probe case D (a `page.route("**/*")`
    that calls `continue()`, with the upstream stalled) loaded the page in 17 ms, the stalled hole got 0 connections,
    and the custom face rendered.
  - CR3: D6 (ii) now records `fontSwapSpread` on base and branch and requires the "0 by construction" statement.
  - CR4: unknown URLs now fail the run in teardown. D5 now checks all three faces, including JetBrains Mono 700.
  - Round-1 notes: the capture UA is pinned (D3) and logs go to scratch (task 3.2).
- **`--host-rules` works for real page subresources in the suite's Chromium.** I built my own page:
  - a `<link rel=preconnect>` to both hosts;
  - the app's `media="print"` + `onload` stylesheet pattern;
  - an `@font-face` pointing at a `fonts.gstatic.com` woff2.

  Results (`skeptic2-probe/probe.mjs`):

  | Case | Load result | Rendered face | Stalled hole | Other |
  | --- | --- | --- | --- | --- |
  | A. D1 switches only | 485 ms | custom face (`CSS.getPlatformFontsForNode` `isCustomFont`) | n/a | Host header preserved; css2 and woff2 both served locally |
  | B. Stall only | `goto` timed out at 8000 ms | n/a | 1 connection | Red control confirmed |
  | C. Stall + D1 | 11 ms | custom face | 0 connections | Composition holds |
  | D. C + page catch-all `continue()` | 17 ms | custom face | 0 connections | |
  | E. `--host-rules` without the SPKI switch | `goto` OK | fallback (Noto Sans Mono) | n/a | TLS failed fast and silently |

- **SPKI pin.** The probe cert's computed SPKI sha256 equals `spki.txt`. Its SANs are both fonts hosts.
- **Playwright webServer semantics (1.55.1, read from source).**
  - `plugins/webServerPlugin.js:75-79`: with `port`, the availability check is a bare TCP connect
    (`isPortUsed`, :144-154). With `reuseExistingServer: true`, any listener on the port is reused, and no
    `_killProcess` is set.
  - `teardown()` (:66-69) kills only a server that this run launched.
  - `:186-187`: a `port`-only webServer sets `process.env.PLAYWRIGHT_TEST_BASE_URL` to `http://localhost:<P>`.
    This is harmless here, because `use.baseURL` is set explicitly.
  - `runner/tasks.js:99-108`: output dirs are removed before the plugin starts. Global teardowns run before plugin
    teardown, so the server is still up when the hits file is read.
  - `runner/taskRunner.js:59-71,93-94`: a thrown teardown error marks the run `failed`, and the other teardown tasks
    still run (`_isTearDown` does not interrupt).
- **Self-override of `launchOptions` is feasible** (`skeptic2-probe/selfoverride/`). `test.use({ launchOptions: async
  ({ launchOptions }, use) => use({...launchOptions, args: [...launchOptions.args, X]}) })` gave
  `["--from-config-xyz","--from-spec-abc"]`: 1 passed.
- **No repo gate rejects the committed key.** The `check:no-credential-leak` surfaces exclude `e2e`, and there is no
  gitleaks or trufflehog. `.gitignore` ignores only `test-results/`.
- **CI.** `ci.yml:650` sets `DEV_PORT: 5173`, so the fonts port is 25173. Each shard leg is its own runner, so ports
  cannot collide there.

### Verdict: REFUTE

### Change Requests

1. **D2's "concurrent runs in one lane share it" is false as designed, and its failure is silent.**
   - **Run ending.** The run that launched the server kills it when it finishes (`webServerPlugin.js:66-69`). Any other
     run that reused it is still mid-suite.
   - **Foreign listener.** The `port` check is a bare TCP connect (`:144-154`). Any foreign listener on `DEV_PORT+20000`
     is "reused".
   - **Silent fallback.** In both cases every fonts request then fails fast (connection refused, or TLS; probe case E).
     Navigation still succeeds, and every page silently renders the fallback face. D4 cannot see this: it catches only
     404s that the server itself logs. This is the same vacuous-green class round-1 CR4 closed for missing files.
   - **Required:** make server identity and liveness fail loudly. For example:
     - (a) use `webServer.url` pointing at a marker health path (`https://localhost:<P>/__helio_web_fonts`,
       `ignoreHTTPSErrors: true`) instead of `port`, so a foreign listener is never reused;
     - (b) have the fonts global teardown also GET that path and fail the run if it is unreachable or lacks
       `x-helio-e2e-web-fonts: local`;
     - or drop sharing (`reuseExistingServer: false`, so a second concurrent run in the lane fails at start), and state
       it in Risks and in the README.

   Also say whether the fonts teardown is a separate `globalTeardown` array entry. It should be one, so a thrown error
   never skips the HEL-1301 `deleteRecordedUsers` cleanup.
2. **D5's red/green does not prove the *shared* config applies the mechanism.**
   - **The gap.** D5 builds its own `test.use({ launchOptions })` from the helper's D1 args. So the spec passes even if
     `playwright.config.ts` never wires the switches. The RED switch (`HELIO_E2E_WEB_FONTS_LOCAL=0`) is read by that same
     helper, so it disables both copies at once. The AC "one shared fixture applies to every spec" is then untested.
   - **Required:** the spec must append only the stall rule to the **inherited** `launchOptions` (the self-override
     pattern above, proven feasible) and must never call the helper for the D1 args. Record the RED run with the
     config's wiring disabled.
   - **Also required:** cover the two spec.md clauses that no scenario tests today. Both are cheap with the hole already
     in place:
     - a `browser.newContext()` context also gets the marker header with 0 hole connections;
     - a `page.route("**/*", r => r.continue())` page does the same (probe case D shows this works).

### Non-blocking notes

- D2: mirror Google's `cache-control` on the local responses. Google's css2 responses are `private, max-age=86400`; its
  gstatic files carry a long `max-age`. Without that, Chromium may refetch the fonts on every navigation, and "already-cached
  fonts give 0" (hel1665) behaves differently from the live hosts. D6 (ii) should show it either way.
- D2: prefer `url` over `port` (CR1 a) for another reason too: it avoids setting `PLAYWRIGHT_TEST_BASE_URL` to the fonts
  port. That is harmless today only because `use.baseURL` is explicit.
- css2 is requested twice per load: once for the print media and once after the `onload` media flip. Expect this when
  reading hit logs.
- A concurrent run in the same lane deletes `test-results/` at its start, and with it the other run's unknown-hits file.
  The README should say that concurrent runs in one lane are unsupported, or the hits file should live elsewhere.
