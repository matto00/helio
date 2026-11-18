## Skeptic Report — design gate (round 4, skeptic-design-4.md)

Reviewed at HEAD 530a22c96425d3520b7820c83de652837fdcdef7. The change dir holds only untracked planning artifacts:
proposal.md, design.md, tasks.md, specs/e2e-web-font-isolation/spec.md, ticket.md, workflow-state.md.

### What I verified (with evidence)

- **Spawn-cwd guard:** `assert-cwd.sh` printed READY, branch `task/e2e-local-web-fonts/hel-1757`.
- **Round-3 CR1 is resolved.**
  - design.md has exactly one D5 (`grep -n "D5\."` returns only line 68).
  - D1 (:27-28) now says the new spec "may import only its port/marker constants, never the switch args".
  - D5 (:73) says the spec "never imports the D1 args from the helper", and (:78) says the switch is
    `HELIO_E2E_WEB_FONTS_LOCAL=0`, "read only in `playwright.config.ts`".
  - tasks.md 2.1 (:24) agrees: "the diagnostic switch is read only in `playwright.config.ts`".
  - D1, D5 and task 2.1 now agree with each other.
- **Round-3 non-blocking notes are addressed.**
  - D2: global setup throws at start unless the marker body and header are present. The overclaim is reworded to
    "unlikely to pass".
  - D4: the baseline is handed over through `process.env.HELIO_E2E_WEB_FONTS_BASELINE`.
  - Task 2.3: the README now carries the concurrency note.
  - D5: the RED switch drops the switches, the `webServer` and the setup/teardown together.
- **Ground truth re-checked:**
  - `playwright.config.ts:50-51` has single-string HEL-1301 hooks and no `webServer`.
  - `:191` has the conditional `launchOptions`.
  - The only projects are `dev` and `prod-build` (+guard), all Chromium. No spec uses `devices[`, `browserName`,
    webkit or firefox, and no e2e file overrides `launchOptions` (grep returns 0 hits). So "Chromium switches reach
    every browser" holds.
  - `playwright.regression.config.ts` spreads the base config, so it inherits the wiring.
  - `app.html:48` and `index.html:63` carry the two css2 URLs.
- **Mechanism re-probed live.** I reran the round-2 probe as scratch `skeptic4-probe/probe.mjs` (Playwright Chromium).
  - A (fixture only): `goto` ok, custom face, 0 hole connections.
  - B (stall only): `goto` timed out at 8000 ms, with 1 hole connection. The RED reproduces.
  - C (stall + fixture): ok, custom face, 0 hole connections.
  - E (no SPKI switch): silent fallback, as designed. D5 asserting the marker header covers this.
  - D (stall + fixture + `page.route("**/*")` continue): `goto` ok and 0 hole connections in 3 of 3 runs.
  - D's FACE reading was a fallback (Noto Sans Mono) in 2 of 3 runs. The woff2 was fetched each time, so this is
    the vacuous `document.fonts.ready` wait that `e2e/support/webFonts.ts:9-11` documents, not a routing failure. See
    note 2.
- **Prettier gate vs the committed CSS copy:**
  - I piped the captured `app.css` through `npx prettier --stdin-filepath e2e/fixtures/web-fonts/css/app.css`.
    Prettier rewrites `'Fraunces'` to `"Fraunces"` and re-wraps the `src`/`unicode-range` lines.
  - `prettier --file-info` reports both `.css` and `manifest.json` under `e2e/fixtures/web-fonts/` as not ignored.
  - `format:check` runs in `.husky/pre-commit:9` and `ci.yml:54`.
  - See note 1.

### Verdict: CONFIRM

The round-3 CR is resolved. I found nothing that blocks implementation. The mechanism, the RED control, the teardown
isolation and the AC coverage all hold against ground truth. The notes below are concrete and should be done during
execution. None of them needs another design round.

### Non-blocking notes

1. **Prettier will fail the commit of the CSS copy (task 1.1).**
   - Repo-wide `prettier . --check` (pre-commit and CI) covers `e2e/fixtures/web-fonts/*.css`. It rejects Google's
     verbatim responses (single quotes, long lines).
   - Reformatting them would break the spec's "exact stylesheet responses" requirement, and `refresh.mjs` would
     re-break them on every run.
   - Add `e2e/fixtures/web-fonts/` to `.prettierignore`, and add `.prettierignore` to the Planner Notes'
     shared-files list for HEL-1744.
2. **Font-face assertions must wait for settled faces, not `document.fonts.ready`.**
   - Under a catch-all route (D5 test 3), a `fonts.ready`-gated `getPlatformFontsForNode` read showed a fallback face
     in 2 of 3 probe runs, even though the font was served locally.
   - Use `waitForWebFonts` or an `expect.poll` over `renderedFaces` before asserting `isCustomFont`. Otherwise
     test 3 will be flaky.
3. **JetBrains Mono 700 and Fraunces only rasterise if some laid-out text uses them.**
   - If `/login` has no such text, D5 must render its own probe elements (family + weight) before reading
     `renderedFaces`.
   - State which elements it reads, so the assertion is not vacuous.
4. **The committed private key.** No secret scanner is configured in the repo (none in `.github`/`.husky`/scripts),
   but GitHub push protection may still flag a PEM. Keep the README note explicit that it is a test-only key pinned
   by SPKI.
