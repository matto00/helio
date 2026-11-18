## Standing Constraints

- [C1] Never read, cat, grep, source or print any .env file; no env-dumping commands. scripts/concertino/.concertino.env may be read by scripts but never printed.
- [C2] Quoted heredocs only (<<'EOF') or Write/Edit; no backticks or $(...) inside echo strings.
- [C3] No pkill/pgrep/killall; kill only by exact PID; stop servers with stop-servers.sh; DB residue deleted only by exact id via buildUserDeleteSql.
- [C4] jest maxWorkers 3, Playwright workers 2, sbt -J-Xmx3g, nice -n 19.
- [C5] timeout: 600000 on long calls.
- [C6] Budget exhausted means escalate.
- [C7] Merge only through the auditor with gh pr merge --squash --match-head-commit; never --auto.
- [C8] No prod actions, no release cut, no concertino sync.
- [C9] No claude.ai session link in PR or commits.
- [C11] Known-flake rule: rerun only the failed job once and name it in the PR; second failure escalates. Known: hel1584:493, hel1583-glass-nav:554, hel1668-phone-sheet:184, hel1665-home-phone-stability:437, hel1573-motion-grid-chart:104.
- [C12] Red first with recorded runs; evaluator and skeptic run the full font-dependent spec set plus a sample of bare-goto specs.
- [C13] Scratch only in .concertino/scratch/HEL-1757/ (main checkout).

## 1. Fixture assets

- [x] 1.1 Write `e2e/fixtures/web-fonts/refresh.mjs` (capture UA = suite Chromium) and run it; verify `manifest.json` covers both css2 URLs and every gstatic URL they reference
- [x] 1.2 Commit each family's `OFL.txt`, plus a test-only key/cert (SAN both fonts hosts); verify three licence files and the cert SPKI hash
- [x] 1.3 Write `server.mjs` (D2/D4): local HTTPS, content-type + CORS + cache-control + marker header, marker path with in-memory unknownHits, 404 for unknown; verify with curl --resolve

## 2. Shared config

- [x] 2.1 Add `e2e/support/webFontsHost.ts` (D1 switch args, port, marker constants); the `HELIO_E2E_WEB_FONTS_LOCAL=0` diagnostic switch is read only in `playwright.config.ts`
- [x] 2.2 Wire `playwright.config.ts`: launchOptions args (keep executablePath), `webServer` via marker `url`, fonts globalSetup/globalTeardown as separate array entries (D4); verify `npm run check:e2e-types`, lint, `check:e2e-prod-build-projects` pass
- [x] 2.3 Document mechanism, port, key, refresh, diagnostic switch, and that concurrent runs in one lane are unsupported in `e2e/README.md`

## 3. Tests

- [x] 3.1 Add `e2e/hel1757-web-fonts-local.spec.ts` (D4 guard; D5 tests 1-3 appending only the stall rule to inherited launchOptions)
- [x] 3.2 RED with the config wiring disabled (`HELIO_E2E_WEB_FONTS_LOCAL=0`; test 1 fails at goto timeout); also show the teardown fails on a killed server and on an unknown URL and GREEN; logs in `.concertino/scratch/HEL-1757/`
- [x] 3.3 D6 evidence on base and branch: font-dependent set, font-timing assertion values (hel1665:164), renderedFaces, timing sample incl. @prod-build latency specs and C11 flakes; record under `.concertino/scratch/HEL-1757/`
