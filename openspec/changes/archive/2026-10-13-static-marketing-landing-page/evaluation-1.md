## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed commit: `1496762dacc82b21c5758058f7c2142e824923c3` (base `2c1ab0326fe6c171152bc59ff2918f433558296f`, resolved live via `resolve-review-base.sh`).

### Phase 1: Spec Review — PASS

Issues: none blocking.

- AC1, static HTML at `/`: PASS. Dev-server curl of `/` and `/?ref=x` returns the hero and OG tags with no `#root`. `check-landing-build` passes against a fresh `vite build`.
- AC2, signed-in `/` goes to `/home`: PASS. The hint redirect works, and a stale hint bounces once through `/home` to `/login` and clears itself. Covered by the e2e spec, which I re-ran.
- AC3, deep links: PASS. `/home`, `/dashboards/:id`, `/pipelines/:id`, `/login`, `/register`, `/auth/callback` and `/dashboards/:id/panels` all get `app.html`, both from curl and from the e2e spec.
- AC4, PWA: PASS on config and tests (`pwaConfig.test.ts`, `check-landing-build`). The old-service-worker run is executor evidence that I did not re-run; the mechanism (denylist plus `skipWaiting`/`clientsClaim`) is pinned by tests I did run.
- AC5 (restated) / C1: PASS. I measured a real signed-out 401. It sends POST with `X-Helio-Requested-With: 1` and shows "Create a free account first. Start free." linking `/register`. Mocked 204/409/429/503/500 each show distinct copy. There is no validation state.
- AC6, light/dark at 375 and desktop with no horizontal scroll: PASS. `scrollWidth - clientWidth` is 0 at 375, 768, 1100 and 1440 in both themes, checked across the full scroll.
- AC7, plan number: PASS. `planNumbers.sourceScan.test.ts` parses `DefaultBetaDailyMessageLimit`, and the HTML carries only the placeholder.
- AC8, real captures from a checked-in, re-runnable script: PASS, verified independently (executor uncertainty (a)). I ran the committed `scripts/landing-captures/run.mjs` end-to-end in a clean detached worktree at the reviewed commit, against :9901/:6994. It exited 0, the dashboard check (the edited `innerText` path) passed for all 12 captures, and `writeRects` ran. All 12 shots, `rects.json` and `og.jpg` came out byte-identical (sha256) to the committed files. The throwaway user is gone (0 rows). Evidence: `/home/matt/Development/helio/.concertino/runs/HEL-1562/evidence/eval-evidence/hel1562-eval1-capture-rerun.txt`.
- C2: the news photo is blurred and the sources note matches the mockup verbatim. C3: no hand-drawn dashboard markup. C4: computed fonts are Fraunces only on the brand, h1, h2 and closing line, and Schibsted on body, h3, step h3 and `.ask`. C5: no eyebrows. C7: all 24 hints are byte-identical to the mockup (diffed). C8: `.ask` uses `--font-sans`. C9: tiers are folded into the h3s.
- Tasks are all ticked and match the diff. The spec deltas are present, and `check:openspec` is clean.

### Phase 2: Code Review — FAIL

Gates, fresh runs in WORKTREE_PATH:

- `npm run lint`: exit 0.
- `npm run format:check`: exit 0.
- `npm --prefix frontend run typecheck`: exit 0.
- `npm test`: 595 suites, 7130 tests, all passing; plus 51 suites / 469 tests passing in the second project.
- `npm --prefix frontend run build`: exit 0.
- `check:landing-build` and its selftest: OK.
- `check:tokens`, `check:e2e-types` and `check:e2e-user-cleanup`: OK.
- e2e: `hel1562-landing-page.spec.ts` passed 21/21. A sample of 7 retargeted specs passed 53/53: hel666, hel519, hel773, auth-cookie-migration, focus-presence-guard, hel503, hel516. Static probes for leftover `goto("/")`, `waitForURL("/")` and `toHaveURL` app-home forms in `e2e/` found nothing.

Issues:

1. **Dead spacing rules, measured.** `frontend/src/landing/landing.css:38` `.landing p { margin: 0; }` has specificity (0,1,1). That beats the single-class rules declared later, so these computed to `0px` at 1440×900:
   - `.closing-sub { margin: var(--space-5) 0 var(--space-7); }` (`landing.css:569`): computed 0/0.
   - `.caption2 { margin-top: var(--space-3); }` (`landing.css:352`): computed 0.

   As a result, the closing sub-line sits flush under the tagline and the CTAs sit flush under it, and the build caption touches the frame. The mockup had 20px/32px and 14px here. The mockup's reset was the bare `p` selector, which is why these rules worked there. `.center p` and `.cols p` survive only because of source order.
2. **DESIGN.md [mechanical] 44px touch floor (§Control metrics, "A sized `::after` hit expander for every compact PAINTED control — any button", gated `@media (max-width: 768px), (pointer: coarse)`).** At 375px:
   - The landing example pills `.case` (`landing.css` `.case` rule, buttons created in `reel.ts`) measure 32px tall with no expander (`::after` content `none`).
   - The nav `.btn-sm` "Start free" (`index.html` header, `landing.css` `.btn-sm`) measures 32px tall.
   - The pills wrap into three rows with an 8px row gap (`.cases { gap: var(--space-2) }`). Expander tiling needs a gap of at least 12px for 32px controls ((44-32)/2 × 2), or adjacent hit regions overlap.

Checked and acceptable:

- Token usage passes `check:tokens`.
- No numeric font-weight values or literal font-sizes outside the named `--landing-*` clamps.
- The landing bundle has no React or axios (`check-landing-build`).
- The CSRF header is shared through a dependency-free module.
- The hint listener has a single choke point and its storage calls are guarded.
- Type safety is fine: `as HTMLElement` casts are on ids that exist in the static HTML.
- No dead code or TODOs found.

### Phase 3: UI Review — FAIL

Run on the live dev server (:6994/:9901) with headless Playwright. The shared MCP browser was locked by another session, so I used a scratch script instead.

- Happy path: PASS.
  - The reel pills swap the frame, the headline ending, the note and the progress bar.
  - Hotspots are `<button>`s named "<Case> panel N: show a follow-up prompt". Enter opens the correct hint, which sits over the panel; Escape closes it.
  - In the build section at 1440, scrolling to step 3 lights only panel 3 (veils `[on,on,off,on]`).
- Console errors: none in any tested flow, in either theme.
- Keyboard: the tab order runs nav → pills → CTAs → hotspots, and every item shows a 2px solid focus outline.
- Reduced motion: the reel is static (968px tall), and the pills crossfade by switching visibility.
- Breakpoints 375/768/1100/1440, light and dark: no breakage and no horizontal scroll.
- Fails: the same two defects as Phase 2, both visible.
  - Collapsed closing-section spacing: `/home/matt/Development/helio/.concertino/runs/HEL-1562/evidence/eval-evidence/sec-start-light-1440.png`.
  - 32px touch targets at 375: `/home/matt/Development/helio/.concertino/runs/HEL-1562/evidence/eval-evidence/first-light-375.png` and `.../first-dark-375.png`.

Verdicts on the executor's self-reported uncertainties:

- (a) Resolved, PASS. The committed script runs end-to-end and reproduces every artifact byte-for-byte (see AC8 above).
- (b) `npm ci` only when `helio-mcp/node_modules` is absent. Accepted as a documented deviation (README and files-modified). Running `npm ci` against a delivery worktree's linked `node_modules` would rewrite the main checkout's copy. A stale install would fail the `npm run build` step loudly, not silently.
- (c) The `firebase.json` regex no-cache rule is checked only by its own matcher. Accepted. `^[^.]*$` has identical RE2 and JS semantics, and the matcher mirrors Firebase's glob/regex rule. Only a Firebase emulator or deploy would prove the header end-to-end, which is not a gate here.
- (d) I independently ran 7 more retargeted specs (53 tests, all passing) and found zero leftover app-home URL forms by static probe. CI's full e2e run remains the final word.
- (e) `.hot` hover uses the focus-ring outline (`outline-offset: -2px`, an inset ring) instead of the mockup's inset box-shadow. It is token-based and visually equivalent. Visual judgment is deferred to the skeptic. Not a finding.
- (f) The build section collapses at 1100px instead of the mockup's 900px. This follows D7's canonical-breakpoints-only rule (900 is not canonical). It renders cleanly as a stacked page at 1100 and 768. Not a finding.

### Overall: FAIL

### Change Requests

1. `frontend/src/landing/landing.css:38-40`: make the paragraph reset lose to class rules. Change `.landing p { margin: 0; }` to `:where(.landing) p { margin: 0; }`, and do the same for the `h1, h2` and `h3` resets at :30-37 for consistency. Then `.closing-sub` (`landing.css:569`, `margin: var(--space-5) 0 var(--space-7)`) and `.caption2` (`landing.css:352`, `margin-top: var(--space-3)`) apply. Verify with computed styles: `.closing-sub` 20px top / 32px bottom and `.caption2` 12px top at 1440. Add an assertion for this in `e2e/hel1562-landing-page.spec.ts`, for example that `.closing-sub` has a non-zero `marginTop`.
2. Landing touch targets (DESIGN.md §Control metrics, [mechanical]). Under `@media (max-width: 768px), (pointer: coarse)`, give each compact painted control a 44px `::after` hit expander. Either import `../shared/ui/tapTarget.css` in `landing.ts` and add `tap-expand-44` to the `.case` buttons (`reel.ts`, `b.className = "case tap-expand-44"`) and to the nav `.btn-sm` (`index.html`), or replicate the recipe in `landing.css` under the same gate. Raise `.cases`' gap to at least `var(--space-3)` (12px) inside that gate so the expanders tile without overlap. Add an e2e check at 375px that bisects a pill's real hit height with `elementFromPoint`, as `hel813-mobile-touch-target-floor.spec.ts` does, or reuse `expectTapExpander()`.

### Non-blocking Suggestions

- Without JS, the reel keeps its `6 × 110vh + 20vh` height, so a no-JS reader scrolls about six screens past one static frame. The `landing.css` header comment says the layout is "also the complete no-JS ... presentation". Either gate the tall height on a `.js` class that `landing.ts` adds, or soften the comment. Crawlers and AC1 are unaffected.
- The clickable `.step` `<li>`s (desktop scroll shortcut) have no keyboard access. Scrolling reaches the same state, so this is minor, but `tabindex="0"` plus Enter handling, or plain non-interactive markup, would be cleaner.
- The built landing page loads a shared CSS chunk named `csrfHeader-*.css` (the theme CSS shared by both entries, named after the first shared module). It is harmless but confusing; consider a `rolldownOptions.output` chunk-name hint.
