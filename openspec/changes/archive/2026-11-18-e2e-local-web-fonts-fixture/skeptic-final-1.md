## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD `05b060ff9ae0ca1a289b4c37da641d6d88302a4f`. The diff base was resolved live with `resolve-review-base.sh` and is `530a22c96`. The change is frontend e2e infrastructure only. There is no UI change, so there is no design-judgment step.

### What I verified (with evidence)

**Spawn guard.** `assert-cwd.sh` printed `READY ambient=/home/matt/Development/helio branch=task/e2e-local-web-fonts/hel-1757`.

**AC1: one shared mechanism, no per-spec edits.**
- `git diff --stat 530a22c96...HEAD` touches no existing spec or support file. The changes are:
  - `playwright.config.ts`
  - `.prettierignore`
  - `e2e/README.md`
  - new files: `e2e/support/webFontsHost.ts`, `webFonts.globalSetup.ts`, `webFonts.globalTeardown.ts`, `e2e/fixtures/web-fonts/**` and the new spec
- How it is wired in `playwright.config.ts`:
  - The top-level `use.launchOptions.args` carries `--host-rules` (both fonts hosts mapped to the local server) and an SPKI pin.
  - A `webServer` is checked by its marker `url`.
  - The fonts setup and teardown are separate array entries.
- Nothing can bypass this. I grepped `e2e/` and the configs for `launchOptions`, `chromium.launch`, `launchPersistentContext` and `connectOverCDP`. The only hit is `playwright.config.ts:214`, so no project or spec overrides launch options.
- `playwright.regression.config.ts` spreads the base config, so it inherits the mechanism.
- CI's shard runner spawns one Playwright child per leg (`scripts/e2e-shard.mjs:265`), so there is no fonts-port collision within a runner.

**AC2: RED before, GREEN after. I reproduced both myself.**
- **RED** (`HELIO_E2E_WEB_FONTS_LOCAL=0`), log `.concertino/scratch/HEL-1757/skeptic-final-red.log`:
  - Test 1 (bare `page.goto("/login")`) fails with `page.goto: Test timeout of 30000ms exceeded ... waiting until "load"` at spec line 108.
  - Tests 2 and 3 also fail at the 30 s timeout. Test 2's reported error is in `context.close` after the goto hang.
  - The guard tests 4-6 pass. Exit 1.
- **GREEN** (default config), log `skeptic-final-green.log`: 6 passed in 5.3 s, exit 0.
- The stall is real: in RED, the black hole attached through `--host-resolver-rules` held `load` open.
- The spec gets the stall rule by appending it to the inherited launch options. It never imports the config's switch args, so it can only pass if `playwright.config.ts` wires them.
- GREEN is not vacuous. The spec asserts all of these:
  - zero connections to the hole;
  - every fonts response carries `x-helio-e2e-web-fonts: local`;
  - CDP `renderedFaces` reports `isCustomFont: true` for Schibsted Grotesk, Fraunces and JetBrains Mono at weight 700.
- `isCustomFont` separates a downloaded web face from a system font. That matters on this host, which has JetBrains Mono Nerd Font installed (`fc-list`).

**AC3: effect on visual and font-measuring specs (C12).**
- I enumerated the font-dependent set independently by grepping font APIs and the font-related support helpers (37 files).
- The executor's 22-spec set misses some specs that use those helpers. I added `hel1582-mobile-pipeline`, `hel1668-schema-panel-copy` and `hel1668-phone-sheet`.
- I also added 8 randomly chosen bare-goto specs: hel958, hel1305, hel1392, hel1065, hel908, hel1085, hel1260 and hel1510.
- Result, log `skeptic-final-set.log`: 463 passed, 0 failed, exit 0, wall 1542 s, workers 2, nice 19. No C11 rerun was needed.
- The fonts global teardown ran and did not throw, so no fonts URL went unanswered by the committed copy.
- hel1665:164 `fontSwapSpread`, from the `HEL1665-SHIFT` lines of my run:
  - `fontSwapSpread` is 0 in all 60 cases.
  - `fontsAtFirstFrame` is `"loading"` and `fontsAtLastFrame` is `"loaded"` in all 60 cases.
  - So the swap still happens after first paint, but the assertion is 0 by construction on this Liberation host. The spec's own comment (hel1665:161-163) says it cannot go red here.
  - The executor's base-tree measurement also shows 0 on base. I took that as a claim and did not re-run base. It is consistent with the spec comment.
- The remaining swap coverage at hel1665:508-560 (`holdFonts`) is live and not vacuous. My run's `HEL1737-DATAFIRST` lines show `facesBefore: Liberation Sans, isCustomFont: false`, and the poll at :545 then requires `Schibsted Grotesk`. A held fonts request that is later `continue()`d therefore reaches the local server through the browser switches, and the real face rasterises.
- The AC-3 statement in `design.md` D6(ii) and in `evaluation-1.md` matches what I measured.

**Static gates (fresh):**
- `npm run check:e2e-types`: exit 0.
- `eslint --max-warnings 0` on every changed TS and MJS file: exit 0.
- `prettier --check` on the changed formatted files: clean.
- `check:e2e-prod-build-projects`: clean.

**Licences.** `OFL-{fraunces,schibstedgrotesk,jetbrainsmono}.txt` are committed next to the bytes. The fonts are SIL OFL 1.1, which allows bundled redistribution with notice.

**Servers.** Started and stopped with the canonical scripts (`STOPPED ports=7189,10096`). No listener was left on 7189, 10096 or 27189.

### Verdict: CONFIRM

### Non-blocking notes
- The PR body's AC-3 statement must say that `fontSwapSpread` is 0 by construction on this host on both base and branch, and name hel1665:508-560 as the remaining swap coverage, as design D6(ii) requires. The PR does not exist yet, so the orchestrator should check this at delivery.
- The executor's "font-dependent set" (22 specs) leaves out most specs that use the `hel1582Phone`, `rowDeleteGesture` and `typeStyle` helpers. Those helpers call `document.fonts.ready` or `getComputedStyle().fontFamily`; they do not measure web-face geometry. The evaluator's sample and my extra specs cover them, and all pass.
- `reuseExistingServer: true` means a fonts server left running on the same port by another worktree's run would be reused, and it would serve that worktree's copy. The marker only checks identity, not the copy's version. This is low risk, because ports derive from each lane's DEV_PORT.
