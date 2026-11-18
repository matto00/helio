## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed HEAD: 05b060ff9ae0ca1a289b4c37da641d6d88302a4f. The diff base was resolved live to 530a22c96. My own run logs are in
`/home/matt/Development/helio/.concertino/scratch/HEL-1757/eval-*.log`.

### Phase 1: Spec Review — PASS
Issues: none

- AC1 (one shared fixture, no per-spec edits): met. `playwright.config.ts` adds the top-level `use.launchOptions.args`
  (Chromium `--host-rules` and an SPKI pin), a `webServer`, and the fonts global setup and teardown. No existing spec or
  support file changes. The only `test.use`/`launchOptions` override in `e2e/` is the new spec's own. No spec launches
  its own browser (`chromium.launch`, `launchPersistentContext` and `connectOverCDP` all have zero hits in `e2e/`).
  `playwright.regression.config.ts` spreads the base config, so it inherits the mechanism too.
- AC2 (red first, both runs recorded): reproduced. See Phase 2.
- AC3 (visual and font-measuring specs): the statement is supportable. See Phase 2.
- Tasks 1.1–3.3 are all checked and match the diff. Scope matches the Planner Notes list exactly: config,
  `.prettierignore`, `e2e/README.md`, 3 new support files, `e2e/fixtures/web-fonts/**` and the new spec.
- Licences: OFL-1.1 texts are committed for all three families.
- CONSTRAINTS C1–C13: no violations in the diff.

### Phase 2: Code Review — PASS
Issues: none blocking

Gates I ran fresh in WORKTREE_PATH. No `frontend/**` or `backend/**` files changed, so the frontend and backend gate
lists do not trigger. I ran the root and e2e gates instead:
- `npm run lint`: clean.
- `npm run format:check`: clean. The fixture CSS is excluded by the new `.prettierignore` entry
  `e2e/fixtures/web-fonts/`. The entry is scoped to the fixture directory only and needed for verbatim captured CSS.
- `check:e2e-types`, `check:e2e-prod-build-projects`, `check:e2e-shard:selftest` (18 cases),
  `check:e2e-user-cleanup` and `check:e2e-evidence-paths` (159 files): all clean.

New spec results:
- GREEN (`eval-green.log`): 6/6 passed. Tests 1–3 each check four things:
  - `CSS.getPlatformFontsForNode` reports `isCustomFont=true` for Schibsted Grotesk, Fraunces and JetBrains Mono at
    weight 700.
  - The black hole received zero connections.
  - Every fonts response carries the local marker header.
  - At least one fonts response was seen.

  So the web faces really rasterise, and the test is not vacuous.
- RED (`eval-red.log`, `HELIO_E2E_WEB_FONTS_LOCAL=0`): tests 1–3 fail at 30.0s and guard tests 4–6 pass.
  - Tests 1 and 3 report `page.goto: Test timeout ... waiting until "load"`.
  - Test 2's reported error is the `finally` `context.close()`. Its trace (`0-trace.trace`) shows a `goto` with
    `waitUntil: "load"` that has a `before` event and no `after`. So it also hung at the goto `load` wait.

Playwright teardown semantics, read in node_modules 1.55.1 `runner/tasks.js` and `taskRunner.js`:
- Teardowns run in the declared order (fonts, then user cleanup).
- A teardown runner does not interrupt on error, so a fonts throw never skips the HEL-1301 cleanup.
- The `webServer` plugin teardown runs last, so the fonts teardown can still read the marker.
- The executor's teardown logs (unknown URL, killed server) each end with "1 error was not a part of any test", which
  means a failed run.

C12 full font-dependent set on the branch (`eval-fontset.log`):
- Scope: all 22 specs that match the design.md Context grep. My grep found exactly 22 plus hel1757, the same list as
  the executor's `d6-set.txt`.
- Result: 385 passed, 0 failed, 1161 s.
- The fonts teardown passed, so there were no unknown fonts URLs.

C12 bare-goto and helper-consumer sample (`eval-sample.log`):
- hel1574-shell-rail, hel1582-sweep-375, hel1605-row-delete-confirm, hel1668-header-meta, hel1675-shared-hover,
  hel1750-actions-menu-viewport-fit, hel1759-popover-keyboard-focus, state-surface-contrast-guard,
  hel912-lanes-rejoin, hel1351-aggregated-chart-overlay, hel1633-panel-grid-ready,
  hel773-top-anchored-mobile-nav-sheet and hel1757.
- Result: 95 passed, 4 skipped, 0 failed. The 4 skips are hel1759's own declared phone skips.

AC3 / hel1665:164 `fontSwapSpread`:
- On the branch, all 60 cases record `fontSwapSpread=0`, `fontsAtFirstFrame="loading"`, `fontsAtLastFrame="loaded"`
  and `framesBeforeLoadSeries>0`. So the font swap still happens after first paint with the local server; it is not
  pre-cached and not instant.
- The executor reports the same 0 on base. The spec's own comment at hel1665:157-160 says it "cannot go red" on a
  Liberation-only host.
- So "0 by construction on this host, before and after, with remaining swap coverage in holdFonts hel1665:508-560" is
  an accurate statement.

Committed key and certificate:
- EC P-256. The key matches the certificate.
- CN `helio-e2e-web-fonts (test only)`, SANs `fonts.googleapis.com` and `fonts.gstatic.com`, valid until 2126.
- Trusted only through the SPKI list switch in e2e browsers. No secret scanner in `.github`/`.husky` would flag it.

Stray files:
- No `zz-*` or probe specs in `e2e/`.
- `git status` is clean after all runs. No fonts server is left listening on 27189.

Code quality: small single-purpose modules (host constants and args, setup, teardown, server, refresh). There is no
`any`, and failures carry clear messages naming URL, port and remedy.

### Phase 3: UI Review — N/A
No Phase 3 trigger path changed (`frontend/**`, ApiRoutes, `schemas/**`, `openspec/specs/**`). The browser-level
verification the orchestrator asked for (C12) is reported in Phase 2.

### Overall: PASS

### Change Requests
none

### Non-blocking Suggestions
- `e2e/hel1757-web-fonts-local.spec.ts:113-121`: in the RED control, test 2 reports the `context.close()` error rather
  than the goto timeout, because the hang is masked by the `finally` block. Adding a `goto` timeout shorter than the
  test timeout would make all three RED messages name `page.goto ... waiting until "load"` directly.
- `e2e/fixtures/web-fonts/test-cert.pem` has `CA:TRUE` (the openssl `req -x509` default). The SPKI pin makes this
  mostly moot. Still, regenerating with `basicConstraints=critical,CA:FALSE` and `extendedKeyUsage=serverAuth` would
  match the README's "grants nothing" wording more tightly.
- The README says the key "grants nothing anywhere else". More precisely, any certificate with this SPKI would be
  accepted by e2e browsers for any host; the protection is that only the two fonts hosts are mapped to the local
  server. Consider rewording.
