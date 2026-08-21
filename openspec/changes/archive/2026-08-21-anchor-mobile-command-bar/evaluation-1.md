## Evaluation Report — Cycle 1 (evaluation-1.md)

Commit evaluated: `16eb3fcae5149a7963a8ad7d11f0b2beb6581c0d`
All geometry below was re-derived independently in a standalone headless Chromium
(required from `/home/matt/Development/helio/node_modules`, **not** the shared MCP
Playwright session) against the live dev server on 6204/9111. Every gate was re-run
fresh; nothing in the executor's report was taken on trust.

### Phase 1: Spec Review — PASS

- **AC1 (bar never moves on scroll; no overprint at any scroll position)** — verified.
  Scroll trace at 375/430/768/1100/1440, steps `0 → 100 → 300 → 600 → 1200 → 99999`
  on both `.app-content` and the scrolling root: bar `rect.top` is **0 at every step**
  in every configuration. Scrolling root `scrollHeight <= clientHeight` everywhere
  (e.g. 932/932 at 430x932).
- **AC2 (surface reaches the physical top; no inert band)** — verified with the inset
  simulated by overriding `--app-safe-top` on `:root` (inline style, so it beats any
  author rule): at 47px and 59px the bar's `rect.top` is **0**, `padding-top` equals
  the inset exactly, and border-box height equals `--app-command-bar-height` + inset
  (56+47=103, 56+59=115 mobile; 48+47=95, 48+59=107 desktop).
- **AC3 (shell matches the visible viewport)** — structurally correct
  (`height: 100vh; height: 100dvh` on `.app-shell`; `min-height: 100vh/100dvh` on
  `html, body, #root`, percentage removed). Chromium collapses
  `100vh == 100dvh == 100svh == 100lvh`, so this cannot be *behaviourally* proven
  here; the executor's compensating probe is sound and I reproduced it — injecting
  `.app-shell { height: calc(100dvh + 60px) }` makes the document scroll, drives bar
  `rect.top` to **-60**, and puts controls above y=0; removing it returns the bar to 0.
  The probe demonstrably detects the defect class.
- **AC4 (height reduced from 64px, every control still >=44px in its tap dimension)** —
  verified. Content box **55px** at mobile / **47px** at desktop (from
  `clientHeight - paddingTop - paddingBottom`), unchanged across simulated insets.
  DOM-enumerated controls (`bar.querySelectorAll("a, button")` filtered by
  `getClientRects().length > 0`) at 320/360/375/430/768, both themes, on `/` and
  `/chat`: every control's `max(border-box, sized ::after)` is >= 44px per axis, and
  every control's **real** hit extent by `elementFromPoint` bisection at a 0.25px step
  is >= 43.75px per axis. See Phase 3 for the numbers.
- **AC5 (re-scoped legibility)** — correctly handled. I grepped the diff, the code
  comments, `files-modified.md`, and the commit message: **no legibility claim is made
  anywhere**, and the commit message explicitly records it as accepted-unverified per
  ticket.md D2. No defect.
- **AC6 (verified at 430 and 375 in both themes, measured not eyeballed)** — done by
  the executor and independently re-derived here.
- **AC7 (lint/test, zero new warnings)** — re-run fresh, clean (Phase 2).
- **Tasks** — all 61 items marked `[x]`; I spot-verified the load-bearing ones
  (1.5 `:root`-targeted override, 2.5 no `sticky`/`fixed` added, 3.5 stale HEL-745
  comment rewritten, 3.7 fence, 4.4 existing UserMenu media block reused, 4.5 scoped
  override with `IconButton.css` untouched, 4.8 explicit 44px not `inset: -8px`,
  4.9 zero `.tsx` files touched, 4.10 DESIGN.md line). All match the implementation.
- **Scope creep** — none. No `.tsx` file is touched, consistent with Decision 10.
- **File fences — clean, verified rather than assumed.**
  `git diff --name-only main...HEAD` matches nothing in
  `BottomNav|DashboardList|SourcesPage|PipelinesPage|TypeRegistryBrowser|PanelCreationModal|EmptyState|IconButton`.
  `App.css`'s `.app-content { padding-bottom: calc(...env(safe-area-inset-bottom)) }`
  bottom-clearance rule (old line 424, now 505-507) is **byte-identical to `main`** —
  the third diff hunk covers old lines 373-401 only, and I diffed the rule text directly.
- **Planning artifacts reflect the implementation** — with one exception, see CR-1:
  tasks.md §5.3 prescribes the exact declaration that produces the regression, so the
  task text needs the same correction as the code.

### Phase 2: Code Review — PASS

**Gates, re-run by me in `WORKTREE_PATH` (fresh, not the executor's report):**

| Gate | Result |
| --- | --- |
| `npm run lint` | PASS (clean, `--max-warnings=0`) |
| `npm run format:check` | PASS ("All matched files use Prettier code style!") |
| `npm test` | PASS — 238 suites / **2517 tests**, 0 failures |
| `npm --prefix frontend run build` | PASS (built; only the pre-existing chunk-size advisory) |
| `npm run check:schemas` | PASS (66 checked / 47 protocol files) |
| `npm run check:scala-quality` | PASS ("clean", 128 pre-existing soft warnings) |
| `npm run check:openspec` | FAIL — **one** issue, and it is exactly the documented HEL-657 false positive |

No `backend/**` file changed, so `sbt test` is not in scope.

**`git commit -n` disclosure — confirmed genuine.** `check:openspec` emits exactly one
line: `change "anchor-mobile-command-bar" is complete (61/61) but not archived`. That
is the documented HEL-657 implementation-commit false positive and nothing else. The
other five hook checks all pass on my own fresh run, matching the commit message's
disclosure. Legitimate bypass, correctly and explicitly disclosed.

**Canonical standards:**

- `CONTRIBUTING.md` — no inline-FQN surface (CSS-only change). No dead code, no
  `TODO`/`FIXME` introduced. File-size budgets: see the non-blocking note on `App.css`.
- `DESIGN.md` **[mechanical]** token discipline — clean. The only literals introduced
  are the sanctioned mobile `44px` tap floor, viewport units (`100vh`/`100dvh`, which
  the design mandates), `50%`/`-50%` centering offsets, and `0`. Zero hardcoded colors,
  zero hardcoded spacing, zero hardcoded type. Height comes from
  `calc(var(--control-lg) + var(--space-4))`, gaps/padding from `--space-*`, painted
  boxes from `--control-sm`.
- **The DESIGN.md line added (Control metrics, lines 131-137) is accurate.** It
  describes `width: 44px; height: 44px; top/left: 50%; transform: translate(-50%, -50%)`
  on a `position: relative` control — which is exactly what
  `App.css:459-467` and `UserMenu.css:150-158` declare. The `**[mechanical]**
  No other control heights.` sentinel still terminates the paragraph correctly.
- **The `IconButton.css` fence is honoured properly** — the floor is turned back off
  via `.app-command-bar .ui-icon-btn` (0,2,0 beats 0,1,0), inside the same
  `max-width: 768px` breakpoint. `IconButton.css` itself is untouched, so
  HEL-308/314/319 hold everywhere else. Verified in-browser: at 430 a `.ui-modal__close`
  outside the bar still measures 44px while the bar's buttons measure 28px.

**Inert-cascade (the HEL-535 trap) — checked by measurement, not by reading CSS.**
`App.css` has exactly one `@media (max-width: 768px)` block and it sits at line 399,
after the base `.app-command-bar` rule at line 60. All mobile values were confirmed by
`getComputedStyle`/`getBoundingClientRect` in a live browser at 430, 375, 320 and 768,
never from source.

**Tests are meaningful, and I proved it.** The three CSS-lock suites are pure
regex-over-source, so I replicated their helper functions and assertions verbatim in a
standalone script and ran **14 targeted mutations** of the real CSS in memory (no repo
file was modified). Every one flips a lock red:

| Mutation | Lock that catches it |
| --- | --- |
| `.app-command-bar__right` gap `--space-4` → `--space-2` | gap lock |
| `height: var(--app-top-chrome-height)` → `56px` | seam-derivation lock |
| mobile longhands → `padding: 0 var(--space-3)` shorthand | shorthand lock |
| `height: var(--space-10)` re-added to the mobile bar rule | no-mobile-height lock |
| `.ui-icon-btn::after` 44px → 42px | `::after` lock |
| `.app-command-bar__mobile-title` `min-height` removed | title lock |
| `.app-command-bar__logo` rule removed | logo lock (throws) |
| scoped `min-*: var(--control-sm)` → `44px` | scoped-floor lock |
| theme.css mobile override moved off `:root` onto `.app-command-bar` | `notOnBar` lock |
| `--app-top-chrome-height` stops adding the inset | derived-token lock |
| ancestor chain reverted to `min-height: 100%` | chain lock |
| `.user-menu__trigger::after` 44px → 42px | UserMenu `::after` lock |
| `.user-menu__trigger` `position: relative` removed | UserMenu relative lock |
| mobile `@media` moved above the base rule | ordering lock |

The `not.toMatch(/(?<!min-)height\s*:/)` guard is correctly declaration-aware, and the
first-match `findRuleBody` hazards flagged in design.md are all avoided: the mobile
block's leading comment contains `--app-command-bar-height` but never `.app-command-bar`
(no dot-prefixed match), `.app-command-bar__logo` precedes `.app-command-bar__mobile-title`
without shadowing it, and `UserMenu.css`'s pre-existing `.user-menu__item` 44px lock is
preserved untouched.

**Behaviour-preserving where expected — desktop is unchanged from `main`.** Verified at
1440x900 and 1100x800: content box 47px, `padding-top` 0, `rect.top` 0, painted controls
28px with no `::after` (mobile-only), full control set (`Undo`/`Redo`/appearance editor)
present and intact. The only unconditional non-mobile edits are
`height: var(--app-top-chrome-height)` → `calc(48px + 0px)` = 48px (identical),
the padding shorthand → longhand split (identical computed values), the skip-link's
`calc(0px + var(--space-3))` = 12px (identical), the drawer's
`calc(0px + var(--space-5))` = 20px (identical), and `position: relative` on
`.user-menu__trigger` — which does **not** create a stacking context at `z-index: auto`
and has no absolutely-positioned children, so it is inert on desktop.

**Full-viewport surface audit — every treat/exempt verdict independently checked.** I
re-enumerated `position: fixed` / `top: 0` / `inset: 0` / `sticky` / viewport-unit rules
across `frontend/src/**/*.css` myself; the audit list is complete and correct:

| Surface | Verdict | My check |
| --- | --- | --- |
| `PanelDetailModal.mobile.css` `<=430px` header | treated | Correct that it needed treatment — but see **CR-1** for how |
| `RefinementChatDrawer` (`top: 0`, portalled) | treated | Correct. Measured `padding-top: 67px` at a 47px inset (= 47 + `--space-5`), first child at y=67 |
| `.app-skip-link:focus-visible` | treated | Correct. Measured focused top **59px** at a 47px inset (= 47 + `--space-3`); still first in tab order |
| `auth.css` `.auth-page` / `.auth-loading` | exempt | Defensible — see non-blocking note 3 |
| `.app-not-found` | exempt | Correct: `min-height: 100dvh`, centered, no top-anchored control |
| `Modal.css` `.ui-modal { max-height: 90vh }` | exempt | Correct: native `<dialog>` self-centers; only the `<=430px` full-screen override reaches y=0 |
| `MobileNavSheet` | exempt | Correct: `__panel` is `bottom: 0` (measured top 279.6 at 430x932), `__backdrop` is an inert `inset: 0` scrim |
| `toast.css`, `PanelList.css` zoom widget | exempt | Correct: both `bottom`/`right` anchored |
| `Popover.css`, `inputs.css` dropdowns | exempt | Correct: JS-positioned relative to the trigger; their `inset: 0` rules are transparent scrims |
| `DataGrid.css` `position: sticky; top: 0` | exempt | Correct: sticky within a scrolling table container, not the viewport |

### Phase 3: UI Review — FAIL

Triggers matched (`frontend/**`). Dev servers already healthy;
`assert-phase.sh servers` printed `PASS servers`.

**Everything below passed except the panel-detail modal header.**

- **Geometry, re-derived (matches the executor's claims exactly):**
  - Content box **55px** mobile / **47px** desktop; border-box = `--app-command-bar-height` + inset; bar `rect.top` **0** at simulated insets 0/47/59.
  - Painted controls: **28.0 x 28.0** box with a **44 x 44** computed `::after` — the two `variant="secondary" size="sm"` IconButtons, the `.user-menu__trigger`, and (on `/chat`) the `size="xs"` `.app-command-bar__mobile-new-chat`, which measures 28x28 as Decision 8c intends.
  - Unpainted controls by rect: `.app-command-bar__logo` **65.81 x 44**, `.app-command-bar__mobile-title` **44** tall at every width tested.
  - Real hit extent by `elementFromPoint` bisection @ 0.25px: **43.75** horizontal for the abutting icon buttons, **44.5** for the last-in-row user menu and for every vertical axis. Consistent at 320 / 360 / 375 / 430 / 768.
  - **Discriminator confirmed:** forcing `.app-command-bar__right`'s gap back to `var(--space-2)` drops the icon buttons to **35.75** while their `::after` still computes 44 — so the check genuinely discriminates, and a literal `>= 44` threshold would indeed be the wrong test.
  - Every control's `rect.top >= inset` and `rect.bottom <= bar bottom` at insets 0/47/59.
  - No painted-box overlaps in the bar and no horizontal overflow at 320/375/430.
- **Unhappy paths:** aborting all `/api/**` requests degrades to the sign-in page with real content — no blank screen, no unhandled exception. `/settings` renders its empty state; `/no-such-route-xyz` renders `.app-not-found` (correctly outside the shell).
- **Console:** zero errors post-login across `/`, `/chat`, `/settings`, `/sources`, `/pipelines`, the nav sheet, the refinement drawer and the panel-detail modal, in both themes. (Pre-login `401`s on the auth-probe are pre-existing and expected.)
- **Accessibility:** all five bar controls are focusable (`tabIndex 0`) with non-empty accessible names; skip-link is still first in tab order and clears the inset; nav sheet and modal both close on `Escape`. No transition was added, so `prefers-reduced-motion` is unaffected.
- **Breakpoints:** 1440 / 1100 / 768 / 430 / 375 / 360 / 320 all render without layout breakage.

**The failure:**

At `<=430px` the new rule
`PanelDetailModal.mobile.css:29-31` sets `padding-top: var(--app-safe-top)` — a bare
substitution, not additive. It **overrides** `Modal.css:116`'s
`padding: var(--space-4) var(--space-5)`, so where the browser reports no top inset
(`--app-safe-top` resolves to its `0px` fallback: every Android device, every desktop
browser at that width, an iPhone in any context without a top inset) the header's top
padding goes **16px → 0px**. Measured at 430x932 with no inset override:

```
padTop: "0px",  titleTop: 0,  "Edit panel" top: 0,  "Close" top: 0
```

The modal title and both header buttons render flush against y=0 — visually confirmed
in a screenshot, both themes. On `main` this header had 16px. Restoring the additive
form in-browser returns `padTop: "16px"`, `titleTop: 16`.

This also degrades the inset case: at a 47px inset the title sits at exactly y=47, i.e.
touching the status-bar glyphs' lower edge with zero separation — where the same change's
two sibling treatments (`RefinementChatDrawer.css:48`, `App.css:43`) both correctly use
the additive `calc(var(--app-safe-top) + var(--space-N))` idiom.

### Overall: FAIL

One blocking change request. Everything else — the seam, the anchoring, the height
reduction, the tap-target scheme, the fences, the gates, the test locks — is correct and
independently verified.

### Change Requests

1. **`frontend/src/features/panels/ui/PanelDetailModal.mobile.css:31` — make the inset
   additive so the header keeps its base padding.**
   Change:
   ```css
   padding-top: var(--app-safe-top);
   ```
   to:
   ```css
   padding-top: calc(var(--app-safe-top) + var(--space-4));
   ```
   `--space-4` is the top value of `Modal.css:116`'s `padding: var(--space-4) var(--space-5)`
   that this rule overrides. This matches the additive idiom this same change already
   uses at `RefinementChatDrawer.css:48` (`calc(var(--app-safe-top) + var(--space-5))`)
   and `App.css:43` (`calc(var(--app-safe-top) + var(--space-3))`).
   Verify by measurement, not by reading the CSS: at 430x932 with **no** inset override,
   the header's computed `padding-top` must be `16px` and its title/buttons must have
   `rect.top === 16`; with `--app-safe-top` forced to `47px`, `padding-top` must be
   `63px` and title/buttons `rect.top === 63` (still at or below the inset's lower edge,
   so the spec delta's scenario still holds).

2. **Correct `tasks.md` §5.3 to match**, so the archived artifact doesn't preserve the
   declaration that caused the regression. It currently prescribes
   `padding-top: var(--app-safe-top)`; it should prescribe
   `calc(var(--app-safe-top) + var(--space-4))` with a one-clause note that the bare
   form would drop `Modal.css`'s base 16px header padding at zero inset. Add the
   corresponding scenario to
   `specs/mobile-app-shell-anchoring/spec.md`'s "Full-viewport mobile surfaces account
   for the top inset" requirement: a treated surface must **add** the inset to its
   existing padding, not replace it, so it degrades to its pre-change spacing where no
   inset exists. (The existing test suite cannot catch this — consider adding it to the
   `PanelDetailModal.mobile.css` lock if one is added, but a CSS-lock is not required
   for the fix to land.)

### Non-blocking Suggestions

- `frontend/src/app/App.css` is now **520 lines** (437 on `main`). `CONTRIBUTING.md`
  asks that a file crossing ~400 lines get a split proposed in the PR description rather
  than being grown. It was already over budget before this change and the additions are
  mostly load-bearing comments, so this is not a blocker — but the PR description should
  name it, or a follow-up ticket should split the command-bar rules out of `App.css`.
- `UserMenu.css`'s `::after` hit expander is scoped to the file's `<=768px` block, not to
  `.app-command-bar`. I verified `UserMenu` has exactly one render site
  (`CommandBar.tsx:254`), so this is correct today and the code comment says as much. If
  the trigger is ever reused on another mobile surface the expander follows it there —
  worth remembering rather than fixing now.
- The `auth.css` **exempt** verdict is right, but the stated reason ("vertically
  centered ... never renders content flush against the physical top edge") is weaker than
  it reads: at a short viewport (measured 430x420) the auth card's top is **24px**, inside
  a 47px inset. The exemption still holds because iOS reports
  `safe-area-inset-top: 0` in landscape (the insets move to left/right), which is the
  only way to reach a viewport that short on a notched device. Consider recording *that*
  as the reason.
- Task 7.11's gap-overlap discriminator is only meaningful on routes where
  `.app-command-bar__right` holds two or more controls. On `/chat` it holds only the user
  menu (the `size="xs"` new-chat button lives in `__left`), so forcing the gap back to
  `--space-2` there correctly changes nothing. Whoever re-runs the check should use `/`
  (dashboard view) as the discriminating route.
- `.app-command-bar__right`'s `gap: var(--space-4)` is now load-bearing for hit-region
  tiling and is guarded only by a source-string lock. The in-code comment already says
  "do not widen this further"; that is the right mitigation, no change needed.
