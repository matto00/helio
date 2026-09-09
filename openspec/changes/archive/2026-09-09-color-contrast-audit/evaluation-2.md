## Evaluation Report — Cycle 2 (evaluation-2.md)

Commit reviewed: `6149dc00` on top of `f563daab`. Every claim below is my own
re-derivation or my own mutation run; nothing is taken from the executor's report.

### Phase 1: Spec Review — PASS

AC1 is now met: the committed table is numerically correct (verified cell by cell
below) and no longer claims more for itself than it can deliver. AC2, AC3 and AC4
were already met in cycle 1 and are unregressed. Diff is confined to the four
files the CRs named plus the cycle-1 report; no scope creep.

### Phase 2: Code Review — PASS

#### Gates — all re-run by me, all green

| gate | result |
| --- | --- |
| `npm run lint` | pass |
| `npm run typecheck` | pass |
| `npm run format:check` | pass |
| `npm test` (root) | 25 suites / 248 tests |
| `npm test` (frontend) | **299 suites / 3141 tests** |
| `src/theme/*` (7 pre-existing guards + new) | **12 suites / 156 tests** — `themeParityGuard` and `accentTextSourceSyncGuard` included and green |
| `npm --prefix frontend run build` | pass |

#### CR3 — RESOLVED, and my cycle-1 refutation now goes red

The block imports `buildAccentTokens` from `./appearance` and asserts
`buildAccentTokens(hex, theme)["--app-accent-ink"]` for all 8 presets in **both**
themes (cycle 1 only covered one). I re-ran the exact mutation that was my
concrete refutation last cycle, plus a logic mutation:

| mutation | result |
| --- | --- |
| `appearance.ts:60` `readableDarkText` `#181511` → `#6a6a6a` | **RED** — "every preset's buildAccentTokens-selected accent-ink clears 4.5:1 …" fails |
| `buildAccentTokens` tie-break inverted (swap the two ink branches) | **RED** — same test fails |
| `appearance.ts:59` `readableLightText` `#fdfcfa` → `#8a8a8a` | green (see non-blocking note 2) |

The drift the CR named is closed: the guard now breaks when the real selection
logic or its constants move.

#### CR4 — RESOLVED, and the replacement is correct in both directions

This was flagged as the one most likely to be wrong in a new way, so I tested it
three ways with real on-disk mutations rather than reading it:

| direction | mutation | required | actual |
| --- | --- | --- | --- |
| **gets better** | dark `--app-error` → `#ffb3a3`, lifting every cross-intent cell to ≥ 6.68 | must stay green | **green** |
| **coverage mis-derived** | drop `--app-error-surface` from `TINT_TO_BASE` | must fail | **RED** — "Expected: 30, Received: 20" |
| **vacuity** | break the `--app-success-surface` `color-mix` parse in `theme.css` | must throw, not pass | **throws** — "could not parse … as a color-mix(...) tint" |

The inverted assertion's defect is gone: an improvement no longer turns the guard
red. The count is not a bare restatement of loop bounds — it is gated behind
`readThemeCss()` (so a parse failure is loud, not a silent pass) and it fails if
the tint/foreground set is mis-derived. Its scope is honestly labelled in the test
name and comment ("coverage, not a pinned failure").

#### CR5 — RESOLVED, and the scoped claim is true

The comment now says `#f17b67` clears ≥ 4.63 "against every neutral surface and
against its OWN intent-tint composite … over every neutral parent", explicitly
concedes 4.24 on `--app-warning-surface` over `--app-surface-strong`, and points
at §4 for why that is an exception. Re-derived: neutral surfaces min **5.78**;
own-tint composites min **4.63** (exact); the conceded cross-intent figure
**4.24**. Every clause is true as written.

#### Guard failability — unregressed from cycle 1

Re-ran the cycle-1 mutation battery on the current tree: reverting light
`--app-success` → 7 sub-AA pairs (RED), dark `--app-error` → 1 (RED), light
`--app-text-muted` → 6 (RED), renaming a surface token → loud parse throw. Worktree
restored clean after every mutation (`git status --porcelain` empty).

### Phase 3: UI Review — PASS

No token *values* changed this cycle (only a comment), so cycle 1's rendered
findings carry forward; I re-confirmed the load-bearing ones live rather than
assuming:

* Live computed tokens on the running app match the committed source exactly:
  `--app-error #f17b67`, `--app-success #4cc38a`, `--app-warning #f5b944`,
  `--app-text-muted #aaa49c` (dark, self-authenticated via `data-theme`).
* `.ui-status-chip--success` / `--error` still render at **12px / weight 500**
  (normal-size text) on their own tints, measuring **6.79** and **5.74**.
* Zero console errors.

The cycle-1 verified-good state is intact: token values unchanged, light theme
0 sub-4.5 cells, the three residual dark cross-intent cells unchanged and still
improved over baseline, 0 regressed passing pairs, 0 further-degraded failing
pairs.

### CR1 — every number re-derived independently

I re-derived the full cross-product from `theme.css` source with my own parser and
my own WCAG implementation (float compositing, matching the guard's
`compositeMix`, which does not round), and checked every corrected block:

| block | doc now says | my derivation | verdict |
| --- | --- | --- | --- |
| §1 dark `--app-error` row | 6.98 / 6.55 / 6.75 / 6.01 / 5.78 | 6.98 / 6.55 / 6.75 / 6.01 / 5.78 | ✅ |
| §2 dark `--app-error` "after" | 5.74 / 5.30 / 5.50 / 4.81 / 4.63 | 5.74 / 5.30 / 5.50 / 4.81 / 4.63 | ✅ |
| §3 dark error-tint "after" | 6.28 / 5.80 / 6.01 / 5.27 / 5.06 | 6.28 / 5.80 / 6.01 / 5.27 / 5.06 | ✅ |
| §4 cross-intent | 4.47 / 4.42 / 4.24 | 4.47 / 4.42 / 4.24 | ✅ |
| §4 removed cell | 4.66, "PASSes, no exception needed" | 4.66 | ✅ |

**§4 completeness check (the part most worth getting wrong).** I enumerated all
30 dark cross-intent cells, not just the ones listed. Exactly three fall below
4.5 — `--app-error` on the success tint over `-strong` (4.47) and on the warning
tint over `-raised` (4.42) and `-strong` (4.24). The doc lists exactly those
three, with post-remediation values, under a heading that now reads "below 4.5:1
**post-remediation**". Nothing is missing and nothing extra is listed.

**Is the reworded header true?** Yes. It states plainly that no emitter exists,
that the numbers were hand-transcribed, that four blocks were wrong at commit
time, that the file *can* drift, and that the guard — not this file — is what
catches a regression. That is an accurate description of what a hand-transcribed
table with reproduction steps can deliver, and it claims nothing more. Not
building the emitter is an acceptable resolution of CR1 because CR1 offered
exactly this alternative, and the substantive half (correct numbers) is
independently verified above.

**CR2 — HEL-1061 is real, not a dangling reference.** I pulled the ticket: it
exists, is in Backlog on Helio Platform, and its title matches the doc's quoted
title verbatim ("Light-theme accent-on-surface fails WCAG 3:1 across all neutral
surfaces for the default accent"). Its own AC3 even closes the loop back to this
table. Cited in all three doc spots plus `DESIGN.md:192`.

### Overall: PASS

All five change requests are resolved, each verified by re-derivation or by a
mutation run rather than by reading the diff. The two riskiest fixes (CR3's real-
function assertion and CR4's replacement assertion) were tested in the failing
*and* the passing direction and behave correctly in both. Nothing regressed from
cycle 1's verified-good state.

### Non-blocking Suggestions

1. **The regeneration recipe's "or any sibling `*.test.ts` in this directory" is
   wrong.** `tintComposites`, `assertedMatrix` and `crossIntentCells` are
   module-private (`tokenContrastGuard.css.test.ts:168,191,331` — no `export`), so
   only a temporary block *inside that file* can call them. Drop the "or any
   sibling" clause. A maintainer would hit this in seconds, but the whole point of
   a written recipe is that it works as written.
2. **The ink guard never exercises `readableLightText`.** All 8 shipped presets
   select the dark ink, so mutating `appearance.ts:59` leaves the guard green (I
   verified). This is inherent to asserting the real function's output over the
   shipped preset set — which is what CR3 asked for, so it is not a defect. Worth
   one line in the block's comment so a future reader does not assume both
   candidates are covered.
3. **CR4's count assertion cannot fail from any `theme.css` *value* change** — only
   from a parse failure or an edit to this file's own constant sets. That is
   correct for a set with no threshold obligation, and it is labelled as such;
   noting it so the coverage is not later mistaken for a ratio guard.
4. Task 3.4b's PR-body callout for the `--app-text-muted` change (it reopens
   F-049's deliberate tuning, `theme.css:216-218`) is still owed at delivery.
