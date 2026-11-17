## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed commit: 4005276d92bb89568ddc1da99d0d614f4856d7b6. Base: 7d9b2ea2d47f9ed0c57dddfdaf4fcfb4dd90317d (resolved live).

### Independent evidence (fresh, this evaluator)

- Gates in the worktree: `npm run lint` 0, `npm run format:check` 0, `npm run typecheck` 0, `npm test` 0 (root 579/579,
  frontend 9416/9416), `npm --prefix frontend run build` 0. No backend changes.
- CI-like docker environment rebuilt from scratch: `mcr.microsoft.com/playwright:v1.55.1-noble` + `apt-get install
  fonts-dejavu` (Liberation kept; fc-list showed 22 DejaVu and 12 Liberation entries), `playwright run-server` driven
  by the host specs via `PW_TEST_CONNECT_WS_ENDPOINT` against this lane's dev server (7110/10017).
- **Head**, unmodified `hel1665-home-phone-stability.spec.ts`, 375x812 / 620x900 / 1280x900, light+dark, both orders:
  12/12 passed, `fontSwapSpread` 0 everywhere, `fontsAtFirstFrame: "loading"` in every run.
- **Base emulation** (red-first check of the new assertion): a throwaway detached worktree at HEAD where the spec's
  `setup()` routes `/src/theme/theme.css` and strips only the six fallback family names from the `--font-face-*` stacks
  (the only CSS difference from base; every route logged "stripped"). Same 12 tests: **12/12 failed on
  `cold-load font swap`**, received 8 (375), 22-24 (620), 24-26 (1280). This reproduces the ticket's base numbers and
  proves `expect(result.fontSwapSpread).toBeLessThanOrEqual(4)` is genuinely red without the fallback faces in the CI-like
  environment. (On the host, Liberation-only, base measures 3-4, so the assertion is red only under a DejaVu-class
  fallback, which is the environment the AC names.)
- **Width sweep** (light, dashboards-first, docker env), head vs base-emulation:
  560/590/600: 0 vs 8; 606: 30 vs 24; 610 (both themes, both orders): 30 vs 22-24; 615/630/660/700/768/900: 0 vs 22-24.
  The residual regression is confined to about 605-614px; everywhere else head is 0.
- Host, head: full `hel1665` + `hel1678` specs 56/56 passed. Docker, head: `hel1678-home-large-font.spec.ts` 4/4 passed.
- `scripts/fonts/fallback-metrics.py` re-run here (Liberation from the host, DejaVu copied out of the noble image):
  output byte-identical (except the fetch date) to `evidence/fallback-metrics-400.out`. The derivation is reproducible
  for the four non-tuned faces.
- Running app, 1280x900, dark and light (fonts loaded): web fonts render, no layout change, no console errors, no
  horizontal scroll at 768. Screens: `/home/matt/Development/helio/.concertino/runs/HEL-1678/evidence/e2e-evidence/HEL-1678/eval-home-dark-1280.png`,
  `/home/matt/Development/helio/.concertino/runs/HEL-1678/evidence/e2e-evidence/HEL-1678/eval-home-light-1280.png`.
- Throwaway e2e users created by my first (failed, missing-DB-env) base-emulation attempts were deleted by exact recorded
  id via `deleteRecordedUsers` (12 + 1); the throwaway worktree and docker container were removed.

### Phase 1: Spec Review — FAIL

Ticket AC (at most 4px at 375-540, 620, 1024, 1280, light and dark, CI-like fallback; 0px-after-load series green):
**met**, independently reproduced (0px), and red on base. Extras (aria-hidden, archive 22-26 -> 22-24, large-font e2e,
Serif confirmation 38px) done; placeholder polish deferred as a follow-up per design. Scope is clean.

Issues:

1. **The post-gate edit to the frontend-theme-system delta is not an honest contract as written: its own evidence
   breaks it.** The design gate approved per-size "within 2% at these sizes" (design.md D6a line 95, skeptic-design-2/3).
   After measuring, the executor rewrote the requirement and the "Fallback occupies the web font's box" scenario to
   "mean within 2% ... no single sample beyond 7%". In `evidence/boxmatch-ci.json` and `boxmatch-dv.json`,
   `Fraunces Fallback DejaVu`, weight 400, 16px, pangram: webW 336, fbW 311, ratio **0.9256 (7.4% off)**, and the opening
   sentence at 16px is 0.9347. measurements.md's own table lists min 0.926 for that face. So the "no single sample beyond
   7%" clause is false on the change's own data, and the 7% figure looks fitted to the data rather than derived. The
   mean-based form is defensible (Chromium's integer advances are not linear in size, and the user-facing AC, the 4px
   swap, is met with 0px). But only if the per-sample bound is true and the change is disclosed as a revision of the
   gate-approved contract.
2. **Planning artifacts disagree.** design.md D6a still says width ratio "must be within 2% at these sizes", while the spec
   delta now says mean 2% / single 7%. tasks.md 2.4b still says "ratios recorded, within 2%".
3. **"The override values SHALL be reproducible from a committed derivation"** (frontend-theme-system delta) is not met
   for the two Fraunces faces. theme.css has `size-adjust: 113.9%` / `89.7%` (and rescaled overrides 85.87/22.39,
   109.04/28.42), while the committed script prints 116.06% / 90.67% (84.27/21.97, 107.87/28.12). The tune is described
   only in measurements.md prose, and the theme.css header comment says the values "are derived by
   scripts/fonts/fallback-metrics.py".

### Phase 2: Code Review — FAIL

Gates: all green (see above). Code is small, token-compliant (fallbacks live only inside the `--font-face-*` values;
the `@font-face` `font-family` descriptors are not ad-hoc declarations), the unit test checks order, `local()`-only
`src` and all four overrides, and the e2e changes are minimal. The `hel1678` red precondition is real: it compares the
opening sentence's computed size at the 16px default (24px at 1280, 20px at 375) against the 24px default (36/30), so a
no-op `Page.setFontSizes` fails `toBeGreaterThan`.

Issues:

1. `openspec/changes/metric-matched-fallback-fonts/evidence/fallback-metrics.out` is a committed **Python traceback**
   from an older script version (`load(fetch(...), {"wght": a.sans_weight})`, `KeyError: 'Schibsted Grotesk'`, line
   numbers that don't match the committed 134-line script). It is misleading evidence-shaped non-evidence.
2. measurements.md line 44 cites `screens/home-head-blocked-*-1280.png`, but `*.png` is gitignored (`.gitignore:48`).
   None of `evidence/screens/` is in the commit, so the citation dangles once the worktree is cleaned up.

### Phase 3: UI Review — PASS

Happy path in light and dark at 1280 against the running app: no visual or layout change once fonts load, and no
console errors. No horizontal scroll at 768 (checked here), or at 375-1280 and under a 24px default font (e2e). The
cold-load swap is 0px at all AC widths in the CI-like and DejaVu-only environments (head-dv per executor evidence;
CI-like re-measured here). Fallback faces are `local()` only (the executor's blocked-fonts probes show no requests for
them). Subjective cohesion is left to the skeptic. The one observable quirk, out-of-subset glyphs, is noted below.

### Overall: FAIL

### Change Requests

1. `openspec/changes/metric-matched-fallback-fonts/specs/frontend-theme-system/spec.md` (requirement paragraph and the
   "Fallback occupies the web font's box" scenario): make the per-sample bound true on the committed data. Either
   state the measured worst case (for example "no single sample beyond 8% at weight 400"; the measured worst is 7.44%,
   Fraunces Fallback DejaVu at 16px), or narrow the sample/sizes and re-measure. Then update design.md D6a (line 95) and
   tasks.md 2.4b to the same contract, with a one-line note that this revises the gate-approved per-size 2% after
   measurement and why (non-linear hinted advances). measurements.md "up to ~7%" must match too. The PR body must call
   out the revision.
2. Make the Fraunces values reproducible from committed code. Add the empirical tune to
   `scripts/fonts/fallback-metrics.py` (for example a per-face `size-adjust` override table with the measured reason,
   and the vertical overrides rescaled from it) so the script prints the exact theme.css numbers. Alternatively, state
   the tuned values and their derivation in the theme.css header comment and soften the spec's "reproducible from a
   committed derivation" wording. Right now theme.css:14-19 claims the values are derived by the script, which is
   untrue for two faces.
3. Delete `openspec/changes/metric-matched-fallback-fonts/evidence/fallback-metrics.out`, the stale traceback, or
   replace it with a successful run. Keep `fallback-metrics-400.out`.
4. measurements.md:44: persist the cited blocked-fonts screenshots with
   `scripts/concertino/persist-evidence.sh HEL-1678 <path>` and cite the returned `ref=` paths, or drop the PNG citation
   and describe the observation with self-authenticating data (for example the probe JSON's sentence height or line
   count).

### Non-blocking Suggestions

- **605-615px band (owner question 2): acceptable and disclosed.** It is narrow. My sweep found 30px only at 606/610,
  and 0px at 600 and 615 and everywhere from 560 to 900 apart from that band, while base is 22-24px across the whole
  620-1280 range. It is disclosed in measurements.md, the e2e comment and the home-page delta's MAY clause (which
  records the 610 number). It is a real 6px local regression (24 -> 30), so the PR body must state it with these numbers
  and a follow-up ticket should be filed (cause: the 40ch cap follows the fallback's `0` advance; per measurements.md
  and `tools/chunit.mjs`).
- **Out-of-subset glyphs now use the matched fallback after load, not only before it.** In the running app
  `document.fonts` reports `Schibsted Grotesk Fallback Arial` and `JetBrains Mono Fallback Courier` as **loaded** after
  the web fonts settled. Google's `latin` subset omits U+2192 (it lists U+2191/U+2193 only), so the "All N ->" arrow
  (and any other non-subset glyph) now renders in size-adjusted Liberation or Arial instead of `system-ui`. design.md
  D1 says the Arial-family face is "only visible until the web font arrives", which is not quite true. It is likely
  harmless and arguably better matched, but disclose it in design.md D1 and let the skeptic judge it visually.
- The host-only run cannot go red for this assertion (base-host is 3-4px, so 4px passes). This is fine, since the AC
  names the CI-like environment, but say in the spec comment that the red proof is the DejaVu-class environment.
