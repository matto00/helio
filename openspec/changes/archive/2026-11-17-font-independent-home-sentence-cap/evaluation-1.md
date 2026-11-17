## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed HEAD `5fc20cd7edc0df9deef4efbff5bc1dc6ecc6916f` against the live-resolved base `6432e69e015fcde437d26262f15601fb59e069af` (origin/main merge-base).

### Evidence I produced myself
- Gates, run in this worktree: `npm run lint` 0, `npm run format:check` 0, `npm --prefix frontend run typecheck` 0, `npm --prefix frontend run build` 0, `npm test` 0 (root 66 suites / 579 tests; frontend 778 suites / 9534 tests).
- e2e `hel1665-home-phone-stability.spec.ts` + `hel1678-home-large-font.spec.ts`, 2 workers:
  - CI-like browser (`helio1678-ci`: noble 1.55.1 + fonts-dejavu, Liberation kept; fc-list showed 12 Liberation and 22 DejaVu): **94 passed**.
  - Host: **94 passed**.
  - DejaVu-only browser (`helio1678-dv`; fc-list showed 0 Liberation): the band, 1440 and data-before-font cases, **34 passed**.
- Owner condition 1, the 320-1300px placeholder sweep (`vsweep2.cjs`, web font vs fonts blocked): zero differing widths of 981 in light and dark, in both environments. CDP faces were Liberation Sans (CI-like) and DejaVu Sans (dv) for the fallback, and Schibsted Grotesk [custom] for the web font.
  - Refs: `/home/matt/Development/helio/.concertino/runs/HEL-1737/evidence/.concertino/scratch/HEL-1737/eval-vsweep-ci.out` and `.../eval-vsweep-dv.out`.
- Mutation check that the sweep is not vacuous. I injected `.home-opening__ghost{white-space:normal !important}` and swept 595-625px.
  - Differences reappeared at 605-613 (CI-like) and at 605 (dv), in light and dark. The sweep would catch the defect.
  - Ref: `.../eval-vsweep-mut.cjs`.
- Red on base: `evidence/base-band-red-ci.txt` is raw Playwright output (24 failed, received 30). `evidence/base-ci/data-before-font-*.json` holds runsTopSpread 30, lines 2->1 and the Liberation Sans face for all 6 desktop cases.
- Real loaded sentence, data before the web font, CI-like browser, 595-625px (my probe):
  - Heights differ at **every width 605-613px: 30px with the web font against 60px in the fallback**. This is a 30px reflow when the font arrives.
  - Refs: `.../eval-realsentence.out` (transcribed from tool output) and `.../eval-realsentence.cjs`.
- Running app (host Chromium, web fonts loaded) at 375 / 610 / 1100:
  - No horizontal scroll. The sentence is one line at 610 and 1100. Computed max-width is 600px at 1100.
  - No app console errors. The only errors were the pre-login `/api/auth/me` 401 and my own CSRF-less probe's 403.

### Phase 1: Spec Review — FAIL
- **Spec delta contradicts the implementation.** `specs/home-page/spec.md:76`, scenario "Data before the web font does not reflow the sentence", lists **610**px. The requirement's own SHALL text lists only 1024/1280/1440 for this case. No 610 data-before-font test exists. The 610 behaviour measures a 30px reflow (`evidence/measurements.md` "Not covered by the ruling", confirmed by my probe at 605-613). The scenario states behaviour the code does not have.
- **Task marked done but not done.** `tasks.md:17` (2.3) is `[x]` "add ... the 610 data-before-web-font case". No such case was added. `tasks.md:43` (7.2) silently dropped it.
- **Residual not ruled on by the owner.** The 605-613px data-before-font residual (30px) was not part of the escalation the owner answered (events.jsonl #21 asked only about the cold-load band). design.md D4 had planned a 610 data-before-font case. Under C1 ("never narrow the AC unilaterally"), whether this residual is acceptable is the owner's call, not the executor's or mine.
  - One reading of the AC is gap 1 = placeholder cold-load at 605-613 and gap 2 = desktop data-first. Under that reading the AC as written is met.
  - The other reading is "the cold-load swap at 605-613px" including data-first. Under that reading the AC is not met.
- Otherwise: desktop data-first is fixed (30 -> 0 px, light and dark, CI-like and dv). The band cold-load is fixed (30 -> 0). The 0px series and the HEL-1678 <=4px assertions stay green. The new checks were red on base. C1's sweep condition is met. The placeholder polish was deferred and recorded in tasks 5.1. No scope creep.

### Phase 2: Code Review — FAIL
- **DESIGN.md "Type styles (HEL-1572)" (DESIGN.md:390-392)** says every style is "a token override in `theme.css`, never a component branch". The diff adds type-style branches in feature CSS:
  - `frontend/src/features/home/ui/HomePage.css:36` and `:40`, the `:root[data-type-style=...]` measure overrides.
  - `HomePage.css:82`, the Sans-only `:root:not([data-type-style="serif"]):not([data-type-style="mono"]) .home-opening__ghost`.
  - Base enforced this rule mechanically with `expect(css).not.toMatch(/data-type-style/)` (base `HomePage.css.test.ts:49`). This change deletes that guard instead of meeting it.
  - The rule is not tagged [mechanical] in DESIGN.md. It is a plain rule of the binding standard, and the repo had made it a test. The design gates never discussed it.
- Everything else is sound:
  - The em values match the measured web 40ch within 0.5px (Sans 600/600, Serif 640.001/640, Mono 559.999/560; settled-render pixel diff zero per `evidence/measurements.md` 4.1, which I did not re-shoot).
  - `holdFonts`/`renderedFaces` are small and typed, `cdp.detach` is in `finally`, and the non-vacuity checks are present (fonts held count, fallback face before, web face after).
  - The comments explain why. No dead code, no `any`.

### Phase 3: UI Review — PASS
- Happy path: the sentence renders. The placeholder is `aria-hidden` and `visibility: hidden`, so `nowrap` + `overflow: hidden` has no accessibility or visible effect.
- No breakage at 375/610/1100. The full hel1665/hel1678 suites, which include 1440/1280/1024/768-range and short-phone cases, pass in three font environments.
- No console errors from the app.
- Visual cohesion and subjective look are left to the skeptic. The settled pixel diff in the executor's evidence is zero, and my 610 dark screenshot looks as before.

### Overall: FAIL

### Change Requests
1. `openspec/changes/font-independent-home-sentence-cap/specs/home-page/spec.md:76`: remove `610, ` from the "Data before the web font does not reflow the sentence" scenario's widths, so it matches the SHALL text and the tests (1024, 1280, 1440). Alternatively, if the owner rules per CR3 that the residual must be closed, keep 610, add the case and fix it. Re-run `openspec validate font-independent-home-sentence-cap --type change`.
2. `tasks.md:17` (2.3): correct the checked item so it no longer claims "the 610 data-before-web-font case" was added. State that it was dropped and why (the real sentence wraps at 589/581px in the fallback against a 581-589px content box; the owner's ghost-nowrap ruling covers only the placeholder). Also reconcile design.md D4's "and 610 once D3 passes" in the Owner-ruling section, so the planning artifacts reflect the shipped scope.
3. Before this can PASS, the orchestrator must get an explicit owner ruling on the measured residual: with data arriving before the web font, the real default sentence still reflows 30px at 605-613px (light and dark, CI-like env). The options are to accept and disclose it, or to require a fix. The ruling should be recorded in design.md's Owner-ruling section. This is not a call the executor or evaluator can make under C1.
4. `frontend/src/features/home/ui/HomePage.css:32-42` and `:77-86`: move the per-type-style branching out of Home CSS into `theme.css` token overrides (DESIGN.md:390-392).
   - Example: define `--home-sentence-measure` (25em) in theme.css's `:root`, with the serif and mono values in the existing `:root[data-type-style="serif"|"mono"]` blocks (theme.css:265-270).
   - Example: express the Sans-only band as a token, e.g. `--home-ghost-band-white-space: nowrap` by default and `normal` in the serif and mono blocks. The media rule becomes `.home-opening__ghost { white-space: var(--home-ghost-band-white-space); overflow: hidden; }`, with no `data-type-style` selector in HomePage.css. If `overflow: hidden` alone is harmless in Serif/Mono the token covers only `white-space`; that is the executor's call, verified by the existing Serif/Mono 0px style cases.
   - Restore the `HomePage.css.test.ts` guard `expect(css).not.toMatch(/data-type-style/)`.
   - Re-run the placeholder sweep (both environments, light and dark) and the hel1665/hel1678 suites. This must stay behaviour-identical, so the sweep must still show zero differences.

### Non-blocking Suggestions
- `evidence/base-red.txt` is a hand-written summary (it contains "..."), not raw runner output. The raw JSON in `base-ci/` backs it. Next time, keep the raw Playwright output beside the summary, as `base-band-red-ci.txt` does.
- The PR body should carry the 605-613 data-first residual whichever way CR3 is ruled.
