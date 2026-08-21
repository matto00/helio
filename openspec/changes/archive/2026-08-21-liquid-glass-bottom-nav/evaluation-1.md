## Evaluation Report — Cycle 1 (evaluation-1.md)

Commit reviewed: `591aaa78` on `feature/liquid-glass-bottom-nav/hel-774` (base `origin/main` `2eaf1d26`).
All gates and all UI measurements below were re-run by the evaluator; none of the executor's reported
output was taken on trust. UI verification ran in an evaluator-owned headless Chromium
(`~/.cache/ms-playwright/chromium-1208`, driven via `playwright-core`), never the shared MCP session.

### Phase 1: Spec Review — PASS

Every acceptance criterion is addressed, and each was checked against rendered behaviour rather than
against the executor's claims.

| AC | Verdict | Evidence |
| --- | --- | --- |
| 1. `DESIGN.md` carve-out + floor; `BottomNav.css` comment updated | PASS | `DESIGN.md:37-44` (§0.2 principle), `DESIGN.md:106-111` (`[mechanical]` clause), `DESIGN.md:123-167` (carve-out with both floors, the `var(--app-text)` border justification, and the honest accent statement); `BottomNav.css:35-37` now cites the carve-out, not the retired invariant. |
| 2. Inset floating capsule, semicircular ends, clear of three edges | PASS | Rendered at 375px: nav box `351x56` at `x=12`, insets L12/R12/B12; identical at 320/375/390/430/768. Pill ends confirmed from pixels (bbox corner = backdrop; `(left + h/4, top)` still backdrop; left-edge mid-height = capsule material). |
| 3. Content recognisable through the material | PASS (mechanically) | Tint `--app-surface` @ 0.55 + `blur(12px)`; photo backdrop reads clearly through the capsule in the retained screenshots. Aesthetic judgment deferred to the skeptic. |
| 4. Active item is an inner lozenge | PASS | `48x32` bordered lozenge nested in the capsule, `--app-surface`@0.95 fill + opaque `--app-text` hairline; not an accent block, not an underline. |
| 5. Icon contrast over photo/white/black/accent, both themes, measured | PASS | Worst inactive icon **3.43:1** (dark over pure white); all 40 governed cells ≥ 3.43. Full matrix below. |
| 6. Labels decision recorded | PASS | Recorded in `design.md` D4 + `proposal.md` with the 4.5:1-vs-3:1 basis, the transmissivity cost, and HEL-554 as the accepted-risk mitigation. Icon-only, so the "six labelled items fit" clause is moot; tabs still render 55.5px wide at 375px. |
| 7. Safe area + ≥44px targets + content scrolls clear | PASS | With CDP `Emulation.setSafeAreaInsetsOverride` bottom=34: `env()` reads 34, capsule height stays **56** (uncrushed), gap below capsule **46** (= 12 + 34), tabs 54px tall, `.app-content` padding-bottom **102px**. At inset 0: padding 68px, `/pipelines` scrolled to its end leaves the lowest content bottom at 723.5 vs capsule top 744 — 0 leaf elements overlap. |
| 8. Reduced motion + scroll performance | PASS | Under emulated `prefers-reduced-motion: reduce` the **rendered** `.bottom-nav__lozenge` reports `transition-property: none` (not merely a shortened duration). 4× CPU-throttled scroll of a long list behind the bar: 0/151 long frames, p95 16.7-16.8ms — indistinguishable from the same scroll with the bar forced opaque (0/151, p95 16.7-16.8ms). |
| 9. Verified at 430 and 375, both themes | PASS | Geometry at 320/375/390/430/768; contrast matrix at 375 in both themes; focus/lozenge/glyph checks in both themes. |
| 10. `npm run lint` / `npm test` pass | PASS for those two, but see Phase 2 CR1 | lint and the 239-suite/2568-test frontend jest run are clean; the repo's `format:check` gate is not (CR1). |

Other Phase 1 checks:

- No AC silently reinterpreted. The two deliberate re-scopes (icon-only, and the active icon being
  excluded from the glyph floor because it sits on a near-opaque lozenge) are both stated up front in
  `design.md` D1/D4/D6 and reflected in the spec delta.
- All 46 task items are marked done and each spot-checked item matches what shipped, including the
  negative ones: no `@supports` block, no `background-clip` declaration anywhere, `z-index: 5`
  unchanged, no invented motion, lozenge styling on the `<span>` carrier rather than the `<svg>`.
- Scope: the only reach beyond the bar is `sections.ts`'s `BookOpen -> Shapes` (D11, also changes the
  desktop sidebar — deliberate and recorded) and `PanelList.css`'s zoom-widget clearance (D10). Both
  are argued in `design.md` and confirmed necessary: at 500px and 768px the widget now rests at
  `rect.bottom 732` against a capsule top of `744`.
- Fences respected, verified independently: `frontend/src/shared/ui/toast.css` and
  `toast.css.test.ts` are byte-identical to `origin/main` (empty diff) and `toast.css.test.ts` passes;
  the `App.css` diff contains zero `.app-shell` / `.app-command-bar` hunks; `index.html` is untouched.
  The toast viewport reaches the new geometry through the token alone — computed `bottom: 84px` at
  inset 0, putting its lower edge 16px above the capsule.
- `--bottom-nav-height` is declared exactly once (`theme.css:103`), redefined in place; the two new
  primitives sit beside it, and `grep` finds no second declaration anywhere.
- Planning artifacts match the implemented behaviour.
- No regressions to neighbouring specs: bottom-anchored overlays (`MobileNavSheet`,
  `RefinementChatDrawer`, toasts) remain at z-index 99/100/1000 against the bar's unchanged 5, and a
  fixed/sticky-overlap scan across all six routes found 0 elements resting on the capsule.
- `shortLabel` removal is clean: no surviving consumers anywhere in `frontend/src`, `docs`, or
  `notes`; no `.bottom-nav__label` references remain; the one surviving "F-080" mention
  (`BottomNav.tsx:14`) deliberately describes the retired surface as *former*, which is accurate.
- Pre-existing off-by-one confirmed as pre-existing, not this change's: `@media (max-width: 768px)`
  and the spec's "768px or wider" scenario both exist verbatim on `origin/main`
  (`git show origin/main:frontend/src/shared/chrome/BottomNav.css` line 9). The bar does render at
  exactly 768px. **Spinoff, not a change request** — the executor's claim is verified true.

### Phase 2: Code Review — FAIL

**Gates, re-run by the evaluator in `WORKTREE_PATH`:**

| Gate | Result |
| --- | --- |
| `npm run lint` (frontend) | PASS |
| `npm run format:check` (frontend) | PASS |
| `npm test` (frontend, worktree's own) | PASS — 239 suites, 2568 tests |
| `npm --prefix frontend run build` | PASS |
| `npm run lint` (root, `eslint .`) | PASS |
| `npm run format:check` (root, `prettier .`) | **FAIL — `DESIGN.md`** |
| `npm run check:schemas` | PASS |
| `npm run check:scala-quality` | PASS (128 pre-existing soft warnings) |
| `npm run check:openspec` | FAIL — only the known HEL-657 "complete but not archived" false positive |
| `npx jest --passWithNoTests` (root) | PASS (no tests found in worktree — expected, HEL-768) |
| `backend/**` | N/A — no backend files changed |

The disclosed `git commit -n` bypass was checked rather than re-litigated, and the disclosure is
**inaccurate**: the commit skipped *two* failing hook gates, not one. `check:openspec`'s failure is
the pre-approved HEL-657 false positive, but `npm run format:check` also fails, on `DESIGN.md`, with
the repo's own pinned Prettier (3.8.1, matching `package.json`'s `^3.8.1`). `origin/main`'s
`DESIGN.md` is Prettier-clean, so this change introduced the violation. That is CR1.

Positive findings:

- **DRY / single seam.** The three inlined copies of the old height expression are genuinely
  consolidated: `grep -rn "control-lg) + var(--space-4)"` now returns exactly one hit, the primitive's
  own definition at `theme.css:91`. Four consumers (`BottomNav.css`, `App.css`, `PanelList.css`,
  `toast.css`) all read the token family.
- **Readable / modular.** Naming is clear and every non-obvious value carries a *why* comment naming
  the rejected alternative and its measurement. No magic values beyond the documented literals (`1px`
  hairlines, the pre-existing `44px` tap floor, `2px` optical padding, `blur(12px)`).
- **Type safety.** `shortLabel` removed from both the interface and the derived type with no `any`,
  no casts, no escape hatches. `tsc` via `npm run build` passes.
- **Security / error handling.** N/A for this change; verified separately that forcing every data
  endpoint to 500 leaves the bar rendered and the pages showing real error states (see Phase 3).
- **Tests meaningful.** `BottomNav.css.test.ts` pins exactly the recipe decisions that a future edit
  could silently undo (tint token + alpha, `-webkit-` prefix, opaque-not-`color-mix` border,
  always-present transparent border, absence of `background-clip`, the reduced-motion override's
  source-order position, and the single unshadowed 44px declaration). The comment-stripping step
  before negative matching is correct and necessary. `BottomNav.test.tsx`'s replacement assertion is
  stronger than what it replaced (accessible name per destination, via `getByRole`).
- **No dead code.** No unused imports, no TODO/FIXME, no stale comments describing the removed
  labelled-tab surface.
- **No over-engineering.** No premature abstractions; the two new primitives each have real consumers.
- **Design-standard [mechanical] rules.** Tokens throughout (no raw hex/rgba where a token applies —
  the two translucent values are `color-mix()` over `--app-surface`); all spacing from `--space-*`
  except the documented ≤4px optical `padding: 0 2px`; canonical breakpoints only (768 in both
  `BottomNav.css` and the new `PanelList.css` block); no new `font-size`/`font-weight` literals; no
  hand-rolled component that a `shared/ui` primitive already covers. **One exception is out of
  compliance — CR2.**

Issues:

1. **CR1 — `DESIGN.md` fails the repo's `format:check` gate** (see Change Requests).
2. **CR2 — the `-3px` focus offset deviates from a `[mechanical]` rule, and the code comment claims a
   `DESIGN.md` exception that `DESIGN.md` does not contain** (see Change Requests).

### Phase 3: UI Review — PASS

Triggers matched (`frontend/**`). Servers started with the canonical script
(`start-servers.sh` reused already-healthy servers; `assert-phase.sh servers` → `PASS servers`).
All measurements are from rendered pixels / `getComputedStyle` / the computed accessibility tree —
never from CSS source.

**Contrast, measured from composited pixels (floor 3:1, WCAG 1.4.11).** 375px, both themes, over four
backdrops. Glyph ink sampled as the extreme in the ink direction inside each icon's rendered box;
material sampled adjacent to the glyph.

| backdrop | dark theme (inactive icons) | light theme (inactive icons) |
| --- | --- | --- |
| theme `--app-bg` | 16.00 | 15.66 |
| pure white | **3.43** (worst cell overall) | 16.48 |
| pure black | 16.92 | **4.86** |
| accent | 6.89 | 10.27 |
| synthesised photo | 6.37 – 10.90 | 7.05 – 11.21 |

Worst governed cell **3.43:1** — clears the floor with ~0.43 of headroom, and matches both the design's
predicted 3.44 and the executor's reported 3.43. The two theme-mismatched extremes are the binding
cases, as designed.

**Active lozenge boundary vs adjacent capsule material** (sampled on the straight top edge, 18px in
from each rounded end — never the curve apex):

| case | border vs capsule |
| --- | --- |
| dark / white (theme-mismatched) | **3.43** strict single row, 4.26 best-row-per-column |
| light / black (theme-mismatched) | **4.86** |
| dark / accent | 6.89 |
| light / accent | 10.27 |
| dark / photo | 10.90 |
| light / photo | 7.05 |
| dark / `--app-bg` | 16.00 |
| light / `--app-bg` | 15.66 |

Worst **3.43:1** — clears 3:1. Reproduces the executor's 3.43 / 4.86 figures.

**`backdrop-filter`-unsupported fallback** (spec scenario "Legibility survives without
backdrop-filter support"): with `backdrop-filter: none` forced, the same matrix is unchanged —
worst inactive icon still 3.43, worst lozenge border still 3.43. The unconditional tint carries it.

**The active icon actually renders** (the defect class an earlier draft shipped): on all six routes,
in both themes, the active tab's `<svg>` measures **22×22** inside a 48×32 lozenge, and 94–237 glyph
pixels are present inside the lozenge in the screenshot. Exactly one tab is active per route.

**Accessible names, from the computed accessibility tree** (CDP `Accessibility.getFullAXTree`, not
markup): all six links expose their full labels — Dashboards, Data Sources, Data Pipelines, Data
Types, Metrics, Assistant — each with `name.sources` resolving to the `attribute` (`aria-label`)
source. No empty AX names anywhere in the tree.

**Touch targets, from `getComputedStyle`/rects on rendered elements:**

| viewport | nav | smallest tab dimension | ≥44×44 | h-overflow |
| --- | --- | --- | --- | --- |
| 320 | 296×56, insets 12/12/12 | 46.33 | yes | none |
| 375 | 351×56, insets 12/12/12 | 54 | yes | none |
| 390 | 366×56 | 54 | yes | none |
| 430 | 406×56 | 54 | yes | none |
| 768 | 744×56 | 54 | yes | none |
| 769 / 1100 / 1440 | `display: none` | — | — | none |

**Safe area, re-run with a non-zero simulated inset (34px):** `env(safe-area-inset-bottom)` reads 34;
capsule offset resolves to `calc(inset + env())` — gap below the capsule is 46 = 12 + 34; the capsule
height stays 56 and tabs stay 54 (i.e. the removed `padding-bottom: env(...)` genuinely did not
survive to crush the content box); `.app-content` padding-bottom becomes 102px.

**Focus-ring containment** at the first and last tabs (the only ones that can overhang), both themes:
ring renders as `2px solid` accent at `outline-offset: -3px`, `:focus-visible` matched, and **0 ring
pixels fall outside the capsule's rounded pill shape** (tested against the pill equation, not just the
bounding box).

**prefers-reduced-motion**, asserted on the rendered element under emulation: `transition-property`
is `none` (baseline run without the emulation reports `background, border-color` at 0.16s), so the
transition is removed rather than shortened.

**Flows:**

- Happy path: tapping each of the six tabs navigates to the right route with exactly one active tab.
  (`Data Types` lands on `/registry` and the registry then auto-selects a type — pre-existing routing
  behaviour, unrelated to this change; the active tab stays correct.)
- Keyboard: the bar is reachable by `Tab` (8 presses from load, after skip-link/header), all six tabs
  are in order, and `Enter` on Assistant navigates to `/chat` and updates the active state.
- Unhappy paths: with every non-auth `/api/**` request forced to 500, the bar still renders at full
  `351×56` with the correct active tab on every route, pages show real error states ("Couldn't load
  sources" + Retry, "Failed to load metrics"), no blank screens, and **0 uncaught page errors**.
- Console: **0 errors** across all normal flows (six routes × two themes, all four breakpoints, the
  keyboard flow and the tap flow). The only console errors observed were the deliberate 500s.
- Breakpoints 1440 / 1100 / 768 / 320: no horizontal overflow anywhere, bar correctly hidden ≥769 and
  present ≤768, no console errors.
- Loading/empty-state components: unchanged by this diff; no shared-component regressions observed.

### Overall: FAIL

Both change requests are small and localised. Nothing measured in Phase 3 fails, and no behavioural
defect was found — the failure is a broken repo gate plus one documentation/standard inconsistency in
the very document this ticket exists to correct.

### Change Requests

1. **`DESIGN.md` breaks `npm run format:check` (root Prettier gate) — fix the two whitespace
   violations this change introduced.** `origin/main`'s `DESIGN.md` is clean, so this is new, and the
   pre-commit hook runs exactly this gate (`.husky/pre-commit` line 5). Reproduce with
   `cd <worktree> && npm run format:check` → `[warn] DESIGN.md`. Two edits, both inside the new
   carve-out:
   - **Delete the blank line at `DESIGN.md:130`** (between `judgment call:` on line 129 and the
     `  - **Material.**` sub-bullet on line 131). Prettier removes the separator before a nested list.
   - **Insert a blank line before `DESIGN.md:168`** (`- The dot-grid texture is painted only on canvas
     areas ...`), separating it from the carve-out's closing paragraph that ends on line 167.

   `npx prettier --write DESIGN.md` produces exactly these two changes and nothing else — verified by
   diffing its output against the committed file. Then re-run the full hook sequence and re-disclose
   the bypass accurately: after this fix only `npm run check:openspec` should fail (the HEL-657
   false positive).

2. **Either document the bottom nav's `-3px` focus offset in `DESIGN.md`, or stop claiming
   `DESIGN.md` documents it.** `DESIGN.md:346-349` is `[mechanical]` and sanctions exactly two values
   — `outline-offset: 2px`, or `-2px` "only where the ring would clip (flush list items)".
   `BottomNav.css:150` ships `outline-offset: -3px` (the only `-3px` in the entire codebase), and the
   comment at `BottomNav.css:147-149` justifies it as *"(DESIGN.md's documented exception for this
   element)"* — but no such exception exists in `DESIGN.md`; the new carve-out covers translucency,
   contrast and the `var(--app-text)` border only. `design.md` D12 anticipated this ("a documented
   exception rather than a rule violation") and task 3.18 asked for it to be noted, but the note
   landed only in the CSS comment, so the shipped state is a `[mechanical]` rule the code contradicts
   plus a comment asserting documentation that isn't there — the exact rule/code contradiction this
   ticket exists to eliminate, and the confidently-false-documentation pattern this repo has been
   bitten by before.

   Preferred fix (this change is already amending `DESIGN.md`, and the deviation is real and
   measured): add one bullet to §8's focus rule, or one line to the HEL-774 carve-out, along the lines
   of *"Documented exception (HEL-774): the phone bottom tab bar's pill-shaped tabs use
   `outline-offset: -3px` so the inset ring clears the capsule's own hairline as well as following its
   curve; verified contained at the first and last tabs."* Then make the `BottomNav.css` comment point
   at the real text. Acceptable alternative: leave `DESIGN.md` alone and reword `BottomNav.css:147-149`
   so it no longer claims a documented exception — but that leaves a live `[mechanical]` deviation
   undocumented, which is weaker.

   Note for the fix: do **not** change the value to `-2px` on my account. Measurement says `-3px`
   works (0 ring pixels outside the pill at both end tabs, both themes); this request is about the
   standard and the comment agreeing with the code, not about the number.

### Non-blocking Suggestions

- `BottomNav.css:83-85`: the focus-ring rationale comment sits at the end of the `.bottom-nav__tab`
  rule, ~60 lines above the `:focus-visible` rule it explains, and immediately after an unrelated
  `border-radius` declaration. Moving it next to `.bottom-nav__tab:focus-visible` (or merging it into
  that rule's existing comment) would make the `border-radius`/offset pairing self-evident.
- `App.css:422` attributes `--bottom-nav-height` to HEL-774; the token was introduced by HEL-535 and
  only *redefined* here. `theme.css:86-89` already states this correctly — worth matching the wording.
- DESIGN.md §5's `[mechanical]` guidance says pairing `title` with `aria-label` is "the default
  expectation" for every icon-only interactive element. The bar now qualifies as icon-only and carries
  `aria-label` alone (the hard requirement is met). That is defensible for a touch-only, phone-width
  surface where a native tooltip never fires — but since the bar is deliberately built as a shared,
  promotable component, a one-line note in `design.md`/`BottomNav.tsx` recording *why* `title` is
  omitted would close the loop.
- Spinoff candidate (pre-existing, confirmed against `origin/main`, **not** this change's to fix): the
  spec's "Hidden at desktop widths — WHEN the viewport is 768px or wider" scenario contradicts
  `@media (max-width: 768px)`, which includes exactly 768px. Verified live: the bar renders at 768 and
  is hidden at 769.
- Task 5.5's retained screenshots live at
  `openspec/changes/liquid-glass-bottom-nav/evidence/screenshots/` but are unversioned — `.gitignore:42`
  ignores `*.png` repo-wide. They are readable now (and the final-gate skeptic can read them from the
  worktree), but they will not survive Phase-4 worktree teardown. Repo policy, not an executor
  oversight; flagging only so the final gate reads them before cleanup.
