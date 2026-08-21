## 1. Frontend — seam tokens (theme.css)

- [x] 1.1 `:root`: `--app-safe-top: env(safe-area-inset-top, 0px)`
- [x] 1.2 `:root`: `--app-command-bar-height: var(--space-9)` (48px; token, not a literal)
- [x] 1.3 `:root`: `--app-top-chrome-height: calc(var(--app-command-bar-height) + var(--app-safe-top))`
- [x] 1.4 `@media (max-width: 768px) { :root { --app-command-bar-height: calc(var(--control-lg) + var(--space-4)) } }`
- [x] 1.5 The 768px override MUST target `:root`, not `.app-command-bar` (design.md Decision 4 — probed twice)
- [x] 1.6 Comment the seam as HEL-773's consumption point; state the no-BottomNav-coupling rule

## 2. Frontend — viewport sizing

- [x] 2.1 `.app-shell` (`App.css:5`): replace `height: 100vh` with the pair `height: 100vh; height: 100dvh;`
- [x] 2.2 `theme.css:196-200`: `html, body, #root` -> `min-height: 100vh; min-height: 100dvh;` (drop the `100%`)
- [x] 2.3 `theme.css:204`: delete `body`'s now-redundant `min-height: 100vh`
- [x] 2.4 Confirm `.app-content` still owns `overflow-y: auto`; add no scrolling to the shell
- [x] 2.5 Do NOT add `position: sticky`/`fixed` to the bar — non-scrolling must stay structural

## 3. Frontend — command bar geometry

- [x] 3.1 Base `.app-command-bar` (`App.css:40`): `height: var(--app-top-chrome-height)` replacing `height: 48px`
- [x] 3.2 Base rule: add `padding-top: var(--app-safe-top)`
- [x] 3.3 Base rule: split `padding: 0 var(--space-5)` into `padding-left`/`padding-right`/`padding-bottom` longhands
- [x] 3.4 Mobile block (`App.css:384`): split `padding: 0 var(--space-3)` into left/right longhands; no shorthand remains
- [x] 3.5 Mobile block: remove `height: var(--space-10)` entirely (height derives only from the token) AND rewrite the HEL-745 comment above it (`App.css:377-382`), which documents the deleted 64px declaration and "10px clearance per side" — both untrue after this change
- [x] 3.6 Keep the mobile `@media` block after the base rule, with `.app-command-bar` first inside it
- [x] 3.7 Do NOT touch `App.css:424` or any `BottomNav.*` file (HEL-774's fence)

## 4. Frontend — tap targets: 28px painted box, 44px hit area (design.md Decisions 8/8a/8b/8c)

- [x] 4.1 Unpainted controls take `min-height: 44px` in the mobile block: `.app-command-bar__mobile-title` (19px today) and `.app-command-bar__logo` (59.25x16px today; a real home link, measured visually free to grow)
- [x] 4.2 Put 4.1's `min-height` on the EXISTING `.app-command-bar__mobile-title` rule (`App.css:391`) or before it — `findRuleBody` takes the first match (same hazard as 6.11)
- [x] 4.3 Painted controls keep a 28px box + sized `::after` at `<=768px`: `content:""; position:absolute; width:44px; height:44px; top:50%; left:50%; transform:translate(-50%,-50%)`, with `position: relative` on the control
- [x] 4.4 Apply 4.3 to `.user-menu__trigger` INSIDE `UserMenu.css`'s EXISTING `<=768px` block (line ~137) — do not add a second media block
- [x] 4.5 Apply 4.3 to the bar's `IconButton`s, overriding `IconButton.css:98-105`'s `min-width/min-height: 44px` back to `var(--control-sm)` SCOPED TO `.app-command-bar` only — NEVER edit `IconButton.css` itself (a global change would undo HEL-308/314/319 everywhere else)
- [x] 4.6 4.5 deliberately floors the `size="xs"` `.app-command-bar__mobile-new-chat` (24px) to 28px too — intended, see Decision 8c
- [x] 4.7 `.app-command-bar__right` gap `var(--space-2)` -> `var(--space-4)` at `<=768px` so 44px hit regions abut instead of overlapping EACH OTHER by 8px (measured: without this, real hit extent is 35.75px)
- [x] 4.8 Do NOT use `inset: -8px` — measured 42x42px (pseudo resolves `inset` against the PADDING box; these controls have `border: 1px`)
- [x] 4.9 No `.tsx` file is edited by this change
- [x] 4.10 Add one line to `DESIGN.md`'s Control-metrics section naming the sized-`::after` expander as the sanctioned alternative for painted chrome controls that must not grow

## 5. Frontend — PWA meta and full-viewport surface audit

- [x] 5.1 `index.html:14` `apple-mobile-web-app-status-bar-style` -> `black-translucent`
- [x] 5.2 Leave `viewport-fit=cover` and both `theme-color` entries unchanged
- [x] 5.3 `PanelDetailModal.mobile.css` `<=430px`: `padding-top: calc(var(--app-safe-top) + var(--space-4))` (ADDITIVE — a bare `var(--app-safe-top)` overrides `Modal.css:116`'s `padding` shorthand and drops the header's 16px top padding to 0 with no inset) on `.ui-modal.panel-detail-modal .ui-modal__header, .ui-modal.panel-detail-modal--view .ui-modal__header` — a bare `.ui-modal__header` pads EVERY modal at that width; out-specificity `Modal.css:111`, do not rely on order
- [x] 5.4 Audit `auth.css:6`/`:242`, `App.css:432`, `RefinementChatDrawer.css:28-33`, and `.app-skip-link` (`App.css:17-36`, whose focused `top: var(--space-3)` sits under the glyphs — treat with `top: calc(var(--app-safe-top) + var(--space-3))`)
- [x] 5.5 Record an explicit treat-or-exempt verdict for `Modal.css:11`'s `.ui-modal { max-height: 90vh }` (measured top 46.59 at 430x932)
- [x] 5.6 Record each audited surface as treated-with-the-seam or exempt-with-a-reason in the commit message

## 6. Tests

- [x] 6.1 New `theme.css.test.ts` CSS-lock: `:root` defines all three seam tokens
- [x] 6.2 Same lock: a `max-width: 768px` block overrides `--app-command-bar-height` to `calc(var(--control-lg) + var(--space-4))`
- [x] 6.3 `App.css.test.ts`: replace the `var(--space-10)` assertion (line 92) — it pins a rule that no longer exists
- [x] 6.4 `App.css.test.ts`: base `.app-command-bar` carries `height: var(--app-top-chrome-height)` and `padding-top: var(--app-safe-top)`
- [x] 6.5 `App.css.test.ts`: neither the base nor the mobile `.app-command-bar` rule uses a `padding:` shorthand
- [x] 6.6 `App.css.test.ts`: mobile block declares no `height` for `.app-command-bar` — must be declaration-aware: NOT match `min-height:`, and NOT match `height: 48px` inside a comment
- [x] 6.7 `App.css.test.ts`: the mobile media block appears after the base rule (inert-cascade guard); `.app-shell` declares a `dvh` height, and `theme.css.test.ts` the same for the ancestor chain
- [x] 6.8 `App.css.test.ts`: mobile block declares `min-height: 44px` for BOTH `.app-command-bar__mobile-title` and `.app-command-bar__logo`
- [x] 6.9 `App.css.test.ts`: mobile block scopes `.ui-icon-btn` back to `var(--control-sm)` and declares the 44px `::after`
- [x] 6.10 `App.css.test.ts`: mobile block declares `gap: var(--space-4)` for `.app-command-bar__right` — the ONLY static guard on task 4.7
- [x] 6.11 New `UserMenu.css.test.ts`: the `<=768px` block gives `.user-menu__trigger` `position: relative` and an `::after` declaring `width: 44px`/`height: 44px` — that file ALREADY has a `<=768px` block, so a first-match helper reads the wrong one
- [x] 6.12 `npm --prefix frontend test` and `npm run lint` clean, zero new warnings

## 7. Browser verification (own headless Chromium — NOT the shared MCP Playwright session)

- [x] 7.0 RULE FOR THIS WHOLE SECTION: before trusting any check green, run it against a deliberately broken variant and confirm it goes red. Four consecutive design rounds found a guard that could not fail.
- [x] 7.1 Repro probe (note in the report: Chromium collapses `100vh == 100dvh == 100svh == 100lvh`, so a naive before/after proves nothing): inject `.app-shell { height: calc(100dvh + 60px) }`; show it DETECTS (document scrolls, bar `rect.top` negative, controls cross y=0), then remove it
- [x] 7.2 Assert the LAST-declared height/min-height in `.app-shell`/`html`/`body`/`#root` uses `dvh` and no rule declares `vh` alone (the `100vh` fallback is mandated — do not assert its absence)
- [x] 7.3 Simulate the inset by overriding `--app-safe-top` on `:root` at 47px and 59px
- [x] 7.4 Content box (`clientHeight - paddingTop - paddingBottom`) is 55px at mobile, 47px at desktop
- [x] 7.5 Border-box height equals `--app-command-bar-height` + simulated inset, and bar `rect.top` is 0
- [x] 7.6 Every control in the bar: `rect.top >= simulated inset` AND `rect.bottom <= bar bottom edge`
- [x] 7.7 ENUMERATE FROM THE DOM: `bar.querySelectorAll("a, button")`, filtered by `el.getClientRects().length > 0` (NOT `display !== "none"` — that keeps 0x0 buttons inside hidden ancestors, e.g. "Save now" only when the dashboard is dirty)
- [x] 7.8 For each enumerated control assert a >=44px tap dimension per axis as `max(border-box, sized ::after)` — so painted controls satisfy it via their `::after` (7.9) while their box stays 28px (7.10), with no contradiction
- [x] 7.9 Painted controls: `parseFloat(getComputedStyle(el, "::after").width) >= 44` and same for height; never by reading the rule (the 42px version passed a read-the-CSS review once)
- [x] 7.10 SEPARATE assertion, same set (including `.app-command-bar__mobile-new-chat`): the PAINTED box is still 28px by `getBoundingClientRect` — satisfying 7.9 by violating this is a regression against an explicit product decision
- [x] 7.11 Bisect each painted control's REAL hit extent with `elementFromPoint`; assert `>= 44 - samplingStep` (NOT a literal 44 — abutting regions read ~43.75 at a 0.25px step on a CORRECT build), and prove it discriminates by re-running with the gap forced to `var(--space-2)` (must read ~35.75 and go red). NEVER widen the gap past `var(--space-4)` to push the number over 44 — that breaks the exact tiling; the threshold takes the epsilon, not the gap
- [x] 7.12 Scroll trace: bar `rect.top` identical at every step; scrolling root `scrollHeight <= clientHeight`
- [x] 7.13 Screenshots at 430 and 375, light and dark, so the final gate has something to judge visually
- [x] 7.14 Do NOT attempt to verify iOS status-bar glyph legibility; record it as accepted-unverified
