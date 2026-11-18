## Skeptic Report — design gate (round 3, skeptic-design-3.md)

Reviewed at HEAD 530a22c96425d3520b7820c83de652837fdcdef7. The change dir holds only untracked planning artifacts.
Playwright 1.55.1 source read from `/home/matt/Development/helio/node_modules/playwright{,-core}/lib`.

### What I verified (with evidence)

- **Spawn-cwd guard:** READY, branch `task/e2e-local-web-fonts/hel-1757`.
- **Round-2 CR1 (server identity, liveness, teardown isolation) is addressed in substance.**
  - **`url` + `ignoreHTTPSErrors` is supported.** `webServerPlugin.js:56` passes `!!ignoreHTTPSErrors` to
    `getIsAvailableFunction`. A url-only config sets `_checkPortOnly = false` (`:188`), so availability is an HTTP GET
    (`network.js:174-202`, `rejectUnauthorized: !ignoreHTTPSErrors`). Because `url` is set, `PLAYWRIGHT_TEST_BASE_URL`
    is not overwritten (`:185`).
  - **A plain-TCP or non-TLS foreign listener is not reused.** The TLS request errors, the check resolves 0 and returns
    "unavailable", and the server launch then fails on EADDRINUSE. That failure is loud.
  - **Global setup runs after the webServer starts.** `tasks.js` `createGlobalSetupTasks` orders the tasks as: remove
    output dirs, plugin setup (webServer), global teardowns (reversed), global setups. So the baseline marker read in
    global setup sees a live server. Global teardowns run before plugin teardown, so the server is still up for the
    final marker GET.
  - **`globalTeardown` arrays are supported.** `common/config.js:69-70` accepts an array for both `globalSetup` and
    `globalTeardown`. Each entry is its own task, so a fonts-teardown throw does not skip
    `userRegistry.globalTeardown.ts`. Round 2 had already read this in `taskRunner.js`.
  - **The remaining CR1 items are in the design.** In-memory `unknownHits` with a baseline (this survives the
    `test-results/` wipe), mirrored `cache-control`, and concurrent same-lane runs declared unsupported are all in D2
    and D4, and in tasks 1.3, 2.2 and 3.2.
- **Round-2 CR2 is addressed in the revised D5 (design.md:66-77) and tasks 3.1/3.2.**
  - The spec appends only the `--host-resolver-rules` stall to the inherited `launchOptions`.
  - The RED run disables the config's wiring.
  - Tests (2) `browser.newContext()` and (3) a catch-all `continue()` are added.
  - `launchOptions` is a worker-scoped option, so the spec gets its own browser, and test (2)'s context shares it.
- **Ground-truth context claims checked:**
  - `app.html:48` and `index.html:63` carry the two css2 URLs.
  - `playwright.config.ts:50-51` has a single-string globalSetup/globalTeardown (HEL-1301) and no `webServer`.
  - `:191` has the conditional `executablePath`.

### Verdict: REFUTE

The round-2 CRs are addressed, but the revision left the refuted design text in place. design.md now has two
contradictory D5 sections, and the stale one reinstates exactly what round-2 CR2 rejected.

### Change Requests

1. **Delete the stale second D5 (design.md:79-89), and reconcile the text that still follows it.**
   - **Two D5 sections.** The second "**D5. Red-first spec ...**" block was not removed. It says the spec uses "the D1
     helper's config args plus" the stall. It also says `HELIO_E2E_WEB_FONTS_LOCAL=0` is "read only by the helper".
     Both directly contradict the revised D5 (:66-77), which says the spec "never imports the D1 args from the helper"
     and the switch is "read only in `playwright.config.ts`". An implementer reading top-down meets the refuted
     version last.
   - **Same inconsistency elsewhere:**
     - D1 (design.md:~35) still says the helper is "also used by the new spec".
     - tasks.md 2.1 puts the `HELIO_E2E_WEB_FONTS_LOCAL=0` diagnostic switch in `e2e/support/webFontsHost.ts` (the
       helper), not in `playwright.config.ts`.
   - **Required:**
     - Make D1, D5 and task 2.1 agree on one statement. The spec may import the helper only for the port/marker
       constants, never for the D1 switch args.
     - The diagnostic switch is read where only the config's wiring is affected.

     Either placement of the switch is workable (if the helper reads it, the spec must not call the args builder).
     Whichever you choose, state it once, without contradiction.

### Non-blocking notes

- **D2 overclaims "a foreign listener (no marker 2xx) is never reused".** `isURLAvailable` (`network.js:181`) treats
  any status from 200 to 403 as available. A foreign HTTPS listener answering 3xx, 401 or 403 on that path would be
  reused. D4 backstops this, because the teardown requires the marker header. Have the fonts global setup also throw
  when the marker body or header is missing, so the failure comes at start rather than after the whole suite. Reword
  the D2 claim to match.
- **Global setup and global teardown are separate modules.** Say how the baseline count gets from setup to teardown
  (for example a `process.env` value set in setup; both run in the runner process).
- **README.** Task 2.3 should list the "concurrent runs in one lane unsupported" note that D2 promises.
- **RED run.** If `HELIO_E2E_WEB_FONTS_LOCAL=0` also drops the `webServer` and the fonts teardown, say so. That way the
  RED log fails only at the `goto` timeout and not also in teardown.
