# Files modified — HEL-1046

## Cycle 2 (evaluation-1.md change requests)

- `frontend/src/features/dashboards/ui/DashboardList.css` — 4 sites (lines 292, 330, 488, 730)
- `frontend/src/features/dashboards/ui/DashboardAppearanceEditor.css` — line 112, found during the sweep
  rather than in the evaluator's enumerated 15
- `frontend/src/features/panels/ui/detailModal/PanelDetailModal.css` — lines 57, 164
- `frontend/src/features/panels/ui/detailModal/PanelDetailModal.sections.css` — lines 39, 128, 160
- `frontend/src/features/panels/ui/detailModal/PanelDetailModal.binding.css` — lines 89, 116, 138, 314
  (138 is a bare `:focus` rule, `.panel-detail-modal__type-search`, not `:focus-visible`)
- `frontend/src/features/panels/ui/detailModal/PanelDetailModal.appearance.css` — line 199
- `frontend/src/features/panels/ui/editors/TableDisplayFields.css` — line 106
- `frontend/src/features/panels/ui/OutputPicker.css` — line 74, a state class
  (`.output-picker__card--focused`) rather than a `:focus-visible` rule, but still a real focus
  indicator — converted, not exempted

CR1: **all 17** hand-copied `outline: 2px solid var(--app-accent);` sites across **8** stylesheets,
verified by `git grep -n "outline: 2px solid var(--app-accent);" abcbc2a9 -- '*.css'` at the pre-fix commit
rather than transcribed from a prior tally — two earlier counts (15, then 16) both undercounted.

  both undercounted) repointed to `outline: var(--app-focus-ring);`,
  keeping each site's pre-existing `outline-offset` unchanged (still not
  part of the token). A full repo grep after the fix
  (`grep -rn "outline:.*var(--app-accent" src/`) returns zero hits.
- `frontend/src/theme/focusRingTokenGuard.css.test.ts` — CR2: added a
  second, independent guard (`focus-ring token adoption guard`) that walks
  every `.css` file under `frontend/src` and fails on any `outline`
  declaration whose value is not `var(--app-focus-ring)`, `none`, or a
  named, pinned exception (`App.css:43`'s deliberate `var(--app-text)`
  skip-link ring, HEL-772). Confirmed failable by mutation: reintroduced
  `DashboardList.css:292`'s pre-fix literal by hand, re-ran, watched it go
  red (`Found 1 unguarded outline declaration(s)`), restored, re-ran green.
- `frontend/src/theme/appearance.test.ts` — dropped the discarded `label`
  destructure/stale comment the evaluator flagged as a non-blocking
  readability nit; the concrete per-preset pins now live unambiguously in
  the adjacent "darkens the presets that need it" test.
- `DESIGN.md` — CR4: corrected the overstated claim ("every component
  references one token instead of hand-copying the literal") with an
  explicit note that it was false when HEL-1046 was first written (16
  hand-copied sites across 9 stylesheets), is true now that CR1 landed,
  and names the one deliberate exception (`App.css:43`) rather than leaving
  the sentence unqualified.

## Cycle 1

- `frontend/src/theme/appearance.ts` — adds `deriveFocusRingColor(hex)`
  (task 1.1/1.2): re-derives the MINIMUM darkening (toward black, computed
  in TypeScript, not CSS `color-mix`) of `hex` that clears 3:1 against every
  literal surface (`--app-bg`/`--app-surface*`) declared in BOTH theme
  blocks — the binding surfaces are re-read from a comment-synced list, not
  the palette extremes. Wires the result into `buildAccentTokens` as a
  third `--app-focus-ring-color` token, alongside the existing
  `--app-accent`/`--app-accent-ink` (`--app-accent` itself is left
  untouched — task 2.2). Adds `toHexColor` helper.
- `frontend/src/theme/appearance.test.ts` — updates the
  `buildAccentTokens` token-count assertion for the new third token; adds a
  `deriveFocusRingColor` describe block covering all 8 `ACCENT_PRESETS`
  (measured-need regression pins for Orange/Pink/Cyan/Green/Yellow, and the
  Red/Purple/Blue 0%-darkening/unchanged case), the unparseable-hex `null`
  fallback (task 1.2), and the anti-drift assertion that the static
  `theme.css` value equals `deriveFocusRingColor(DefaultAccentColorByTheme.dark)`
  (task 4b.1).
- `frontend/src/theme/theme.css` — declares `--app-focus-ring-color: #db6513`
  once at `:root` (task 4b.1, the derivation of `DefaultAccentColorByTheme.dark`
  `#f97316`, so it clears 3:1 in both themes as the pre-hydration/unparseable-
  fallback static value) and repoints `--app-focus-ring` at it instead of
  `var(--app-accent)` (task 2.1 — width/style/`outline-offset` unchanged).
  Adds comments to both theme blocks' dead per-theme `--app-accent`/
  `--app-accent-ink` defaults explaining why they never render (task 3.1/3.2)
  rather than removing them, since Flyway-free frontend tokens still need a
  parseable static value and deleting them would leave the two
  `:root[data-theme=...]` blocks with an undefined-looking gap.
- `frontend/src/theme/focusRingTokenGuard.css.test.ts` (new) — the guard
  (task 4.1/4.2/4.3): re-reads and re-derives every literal surface from
  `theme.css` at test time (never a hardcoded `#efece6`/`#262320` pair, and
  never the palette extremes), asserts the static value and all 8 presets'
  derived ring colors clear 3:1 against every one of them, asserts the
  static-value anti-drift property, and asserts (as a positive check,
  confirmed red by a live manual mutation during implementation — see the
  in-file comment) that the pre-fix undarkened Orange value fails the same
  assertion. States in-file what it proves and what it cannot (task 4.3).
- `DESIGN.md` — §8 entry recording the DERIVATION (not just the token):
  that `--app-focus-ring-color` is the minimum darkening clearing 3:1
  against every surface in both themes, why it's theme-independent by
  construction, and why hand-tuning it toward brand would silently
  re-couple the two obligations this token separates (task 6.1).

## Answering task 7.4's two-axes question

**What does no source text carry** (i.e. what fact only exists as a runtime
computation, not as a literal anywhere in the diff): the actual per-preset
darkened hex values (`#db6513`, `#ea4797`, `#0595ae`, `#1b9c4a`, `#a88106`)
appear ONLY as regression-pin literals in the two test files — the
production code (`appearance.ts`) never hardcodes them; it computes them
from `hex` + `FOCUS_RING_SURFACES` at call time via `deriveFocusRingColor`.
If someone deleted the two test files, nothing in the source tree would
assert or even display these seven concrete values — the guard files are
the only place the "what does the fix actually produce, numerically" fact
is pinned down at all, which is exactly why both were written as
mutation-confirmed guards rather than left as design.md prose.

**What path did the gates not exercise:** neither `npm test` (jsdom) nor
`focusRingTokenGuard.css.test.ts` can observe an ACTUAL PAINTED
`:focus-visible` outline on a real focused DOM node (HEL-1005 — jsdom does
not compute style). That gap is covered only by the real-browser Playwright
measurement recorded separately (below), not by any file in this diff or
by the automated gate suite — a future regression in, e.g., a component
overriding `outline-color` directly (bypassing the token) would go
undetected by every gate in this list and would need either a real-browser
CI check or a static "no literal `outline-color`" guard (not built here;
candidate spinoff, not absorbed into this ticket's scope).

## Real-browser evidence (task 5)

Recorded via a scratch Playwright driver (not committed — task said
screenshots only, evidence dir only) against the running dev server
(port 6478, backend 9385), logged in as matt@helio.dev, driving the actual
Settings-page UI controls (theme toggle + `AccentPicker` swatches), not
localStorage injection (accent is server-preference-backed and localStorage
writes get overridden on reload). Content self-authenticated first via
`curl localhost:6478/src/theme/theme.css` for the branch-only string
`db6513` (200, string present). `location.href` re-checked after every
navigation/reload to discard a hijacked tab (none observed). Measured the
two adversarial presets (Yellow — largest 28% adjustment, thinnest margin;
Orange — the shipped default), both themes, waiting 2s post-change for
`ThemeProvider`'s effect to settle before reading (avoiding the
too-fast-read trap that would show the dead `#ea580c`/undarkened default).

| theme | preset | painted `outline-color` | contrast vs. focused element's surface |
| -- | -- | -- | -- |
| light | Orange | `rgb(219, 101, 19)` (`#db6513`) | 3.19 |
| light | Yellow | `rgb(168, 129, 6)` (`#a88106`) | 3.23 |
| dark | Orange | `rgb(219, 101, 19)` (`#db6513`) | 5.28 |
| dark | Yellow | `rgb(168, 129, 6)` (`#a88106`) | 5.22 |

All four clear 3:1. Screenshots at
`.concertino/runs/HEL-1046/evidence/{light,dark}-{orange,yellow}.png`.

## Cycle 2 real-browser re-measurement (CR3)

Re-measured, light theme, Yellow accent (the ratio the evaluator's report
measured at **1.87** pre-fix), after the CR1 fix, driven through the real
UI (Settings page accent/theme controls, then Tab-navigating the real
Dashboards list and a real `PanelDetailModal` opened via a panel's
"Customize" action), 2s settle, `location.href` re-checked:

| site | selector class | painted `outline-color` | ratio |
| -- | -- | -- | -- |
| `DashboardList.css:292` | `.actions-menu__trigger` (the exact selector the evaluator measured at 1.87) | `rgb(168, 129, 6)` (`#a88106`) | **3.53** |
| `PanelDetailModal.binding.css:89` | `.panel-detail-modal__output-link` | `rgb(168, 129, 6)` (`#a88106`) | **3.62** |

Both painted the derived Yellow ring colour exactly (not the raw
`#eab308`) and clear 3:1. Screenshots at
`.concertino/runs/HEL-1046/evidence/cr3-dashboardlist-light-yellow.png` and
`cr3-paneldetailmodal-light-yellow.png` (the latter visibly shows a legible
bronze-gold ring around the "Projections 2026" output link).

## Cycle 4 (skeptic-final-1.md CR1, comment-only)

- `frontend/src/theme/theme.css` — the header comment on `--app-focus-ring`
  said "Never used for `:focus` (bare)", which went stale the moment cycle-2
  repointed `PanelDetailModal.binding.css:138`'s bare-`:focus`
  `.panel-detail-modal__type-search:focus` at the token — the whitelist
  guard now *requires* that site to stay a token consumer, so the
  stylesheet was asserting the opposite of what the guard enforces.
  Corrected to name the one bare-`:focus` consumer explicitly and note that
  every OTHER consumer is `:focus-visible`.
- `DESIGN.md` — added a §8 note alongside the corrected comment. Before
  writing a justification for why this site "qualifies" as the deliberate
  persistent-indicator carve-out, investigated whether it is actually live:
  `grep -rn "type-search"` / `"type-list"` across `frontend/src` returns
  zero hits outside the two CSS declarations in
  `PanelDetailModal.binding.css` — no component in the current tree renders
  this class. `git log` traces the file to HEL-909 (#509), which removed
  `BindingEditor.tsx` — almost certainly the component that rendered it.
  So the honest finding is that this is most plausibly **orphaned CSS**,
  not a live, deliberately-chosen instance of the §8 carve-out. DESIGN.md
  records this finding rather than asserting the site is a live carve-out
  it is not — it records what the carve-out WOULD require if the rule ever
  renders again, not a claim that a user currently experiences it.
  Removing dead CSS is outside this ticket's scope (a focus-ring colour
  fix) and no existing ticket owns a dead-CSS sweep of this file, so the
  rule is left in place, honestly described.
