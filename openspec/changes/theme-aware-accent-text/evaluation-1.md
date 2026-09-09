## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed `3c81c7c3..764a5903`. All findings below were produced by my own runs; nothing
is taken from the executor's report.

### Priority 1 — residual document-consistency check (read from the files, not commit messages)

- **(a) D3/D5 agree — PASS.** `design.md` D3: *"`tasks.md` task 2.0a owns the re-derivation"*, and
  its tables are labelled explicitly non-final. D5: *"Orange's actual light adjustment ... is
  re-derived by `tasks.md` task 2.0a — not stated in this document at all, per D3."* Both name
  task 2.0a, both disclaim `design.md` as the source. `tasks.md` 2.0a matches ("This task owns the
  numbers"). Consistent as landed; no no-op edit.
- **(b) D9 names the script directly — PASS.** D9 reads *"the script `skeptic3-accent-text-closure.py`
  in this run's evidence directory"*, with the parenthetical recording the earlier task-pointer defect.
  `tasks.md` 1.1 invokes it by absolute path. No indirection remains.

### Phase 1: Spec Review — FAIL

- AC-1 / AC-4 / AC-5: addressed in substance. The closure-derived inventory, the five background
  classes, and the HEL-1057 scope boundary (never HEL-1051) are all correctly carried.
- AC-2: **independently confirmed.** My own contrast implementation gives `#98460d` on `#fdfcfa`
  = **6.367** and `#fa8737` on `#1a1816` = **7.238** — matching the executor's 6.37 / 7.24.
- AC-3: `deriveFocusRingColor` untouched; `--app-focus-ring-color` still theme-independent, still
  `#db6513` in `:root`. No regression.
- **Failing item — task 2.0 (the D4 gate) is marked `[x]` but its stated trigger is met.** See
  Phase 3 / BLOCKER.
- **Failing item — tasks 2.2 and 5.1 are marked `[x]` but were not done as written.** See CR-2.

### Phase 2: Code Review — FAIL

Gates, all re-run by me in the worktree (`CLEAN_WORKTREE` not set):

- `npm --prefix frontend test` — **294 suites / 3067 tests passed**. I ran the frontend suite
  explicitly, not root `npm test`; the executor's figures are genuine, not a `--passWithNoTests`
  silence.
- `npm run lint` clean; `npm run format:check` clean; `npm run typecheck` clean;
  `npm run build` succeeds; root `npm run check:tokens` OK (it is a root script, not a
  `frontend/` one — `tasks.md` 9.1 says "from `frontend/`", a harmless inaccuracy).

**Producibility (D5) — the executor's argument is SOUND.** `deriveAccentTextColor` searches
`percent = 1..100` and returns `toHexColor(adjust(rgb, percent))` — the emitted value is by
construction an output of the derivation, so a separately-asserted producibility pass cannot fail.
The three non-search exits are also producible: the unadjusted early return is 0%, and
`#000000`/`#ffffff` are 100% of `darkenTowardBlack`/`lightenTowardWhite`. D5's concern was a
hand-picked value table checked on ratio alone (`#ae500f`); there is no such table here. This is
genuinely stronger than the plan required. The redundant `appearance.test.ts` producibility test
is harmless.

**D7 `::selection` — correct.** `theme.css` sets **both** `background: var(--app-selection-bg)` and
`color: var(--app-text)`. Neither rejected shape is reintroduced: it is not colour-only, and it is
not the `--app-bg`/`--app-text` pair (`--app-selection-bg` is a *tinted* opaque hex, 26%/30% over
the mix base, resolved in TS via `buildSelectionBackground`). The selection hex is correctly kept
out of D2's scored set. I re-derived the fixed pair independently: `--app-text` against the opaque
selection background clears 4.5:1 for all 8 presets in both themes.

**D2 scored set — correct.** `accentTextBackgrounds` scores exactly the three included items: five
neutral surfaces per theme, the two token tints (`0.11/0.08` light, `0.15/0.10` dark), and the two
inline tints (`0.22`, `0.20`). I verified each figure against `theme.css:174-175/227-228`,
`BottomNav.css:126` and `AddSourceModal.css:85/95`. The 10% `InlineConnectorSetup` tint is
correctly omitted (bounded per D6), `::selection` and user-chosen surfaces correctly excluded.
The inline-tint class **is** included, so the shipped default is not below the floor.

**D8 exceptions.** `AddSourceModal.css:85/95` left on `--app-accent-strong` as the documented false
positive — correct. `SidebarBody.css:62`: the hover keeps `--app-accent-strong` and gains
`text-decoration-thickness: 2px`. I judge this a **real affordance, not a cosmetic gesture** — the
link is already underlined, so thickness is the one channel that carries a visible state change
independent of the two colours converging, which is exactly the failure mode D8 named. Accept.

Change requests: **CR-1, CR-2, CR-3** below.

### Phase 3: UI Review — BLOCKER

Servers reused via `start-servers.sh` (6480/9387). Worktree identity self-authenticated by the
`/@fs` root-restriction proof: this worktree's guard file **200**, sibling main checkout's
`theme.css` **403**. I drove the **real `AccentPicker`** through all eight presets in dark theme
with a 1200ms settle per change, reading `--app-accent` / `--app-accent-text` / `--app-selection-bg`
from computed style on `<html>`.

Live values match my independent Python derivation exactly (one 1-unit rounding difference on Pink's
blue channel, both clearing): dark adjustments Orange 14%, Red 28%, Pink 25%, Purple 28%, Blue 25%,
Cyan 3%, Green 0%, Yellow 0%; light 29–47%. **The executor's figures are correct.** Its
*judgement* about them is not.

**D4 gate: the trigger is met.** Contact sheet rendered by me on the running app, 14px semibold on
the live `--app-surface` (`#1a1816`), raw accent beside derived text token, all eight presets:
`/home/matt/Development/helio/.concertino/runs/HEL-1048/evidence/evaluator-d4-dark-perceptibility.png`

My independent read of that sheet:

| preset | dark adj | verdict at 14px, side by side |
|---|---|---|
| Orange (default) | 14% | essentially unchanged — executor's claim holds |
| Cyan / Green / Yellow | 3% / 0% / 0% | indistinguishable |
| Blue | 25% | **plainly distinguishable** — solid blue vs. a distinctly paler blue |
| Purple | 28% | **plainly distinguishable** — saturated violet vs. pale lavender |
| Red | 28% | **plainly distinguishable** |
| Pink | 25% | **plainly distinguishable** |

The executor's justification — *"same hue family, Orange essentially unchanged"* — answers a
different question than the one D4 asks. D4's trigger is not hue-family preservation; it is
verbatim *"if any is distinguishable from its raw accent at 14px on `--app-surface`"*. Four of eight
are, unmistakably. The owner's `accept-hue-shift` ruling was made against sheets in which the
dark-theme changes were characterised as **imperceptible**; at Purple 10%→28% and Blue 5%→25% that
characterisation no longer describes what ships. Per D4 and `tasks.md` 2.0 this is escalate-before-
implementing, and per my instructions it is a **BLOCKER to surface, not for me to resolve.**

Note this is not a defect in the derivation — the numbers are right, and they are right *because*
D2's set was correctly widened. The gate is doing exactly what it was built to do: the correct fix
moved the dark values past the evidence the brand ruling rested on.

Other UI checks: no console errors during the eight accent changes; light/dark both render; the
AC-2 login-footer link passes by computed measurement.

### Overall: BLOCKER

### Required: human intervention

**Question for the owner:** the dark-theme half of `accept-hue-shift` now visibly changes Red, Pink,
Purple and Blue (25–28% lightening), where the contact sheets the ruling was made against
characterised dark changes as imperceptible. Orange, the shipped default, is unaffected (14%, reads
unchanged). Does the ruling stand on the actual shipped values? Evidence:
`.concertino/runs/HEL-1048/evidence/evaluator-d4-dark-perceptibility.png`.

Nothing in this ticket should be re-derived to dodge the gate — reducing the dark adjustments means
dropping a background class from D2's set, which is the exact defect D6's tombstone records.

### Change Requests

1. **The closure guard is vacuous with respect to the two-hop chain — the one defect it exists to
   prevent.** `frontend/src/theme/accentTextClosureGuard.css.test.ts`. Its only positive mutation arm
   (`"the closure logic detects a synthetic one-hop alias"`, ~line 137) wires
   `--mutation-alias: var(--app-accent)` — **one** hop. Since `toast.css:75` was repointed at
   `--app-accent-text`, the live corpus no longer contains any two-hop chain either, so the fixpoint
   loop's second iteration is exercised by nothing. **I proved this:** I patched the
   `while (changed)` loop to `while (changed && rounds++ < 1)`, crippling it to a single hop, and the
   whole suite stayed green — 5/5 passed. `tasks.md` 5.2 states the requirement exactly: *"A one-hop
   list passes the two-hop chain green — which is the defect the closure exists to prevent."*
   Fix: add a mutation arm whose synthetic corpus is genuinely two-hop
   (`--hop2: var(--app-accent); --hop1: var(--hop2); color: var(--hop1);`) and assert it is flagged;
   then re-run my one-hop crippling patch and confirm that arm now **fails**, so the arm is shown to
   land for the stated reason rather than passing incidentally.

2. **`tasks.md` 2.2 and 5.1 say "Do not hardcode copies of either"; both are hardcoded copies.**
   `frontend/src/theme/appearance.ts` — `ACCENT_TEXT_NEUTRAL_SURFACES`, `ACCENT_TEXT_TOKEN_TINT_STRENGTHS`,
   `ACCENT_TEXT_INLINE_TINT_STRENGTHS`, `SELECTION_TINT_STRENGTH`, `SELECTION_BASE_HEX` are all
   literal transcriptions, self-described in comment as *"copied from theme.css"*. I confirmed every
   value is **currently correct**, so this is not a live contrast defect — it is the drift hazard the
   task named. It is compounded by `appearance.test.ts`, whose comment claims the set is
   *"reconstructed independently ... so this test can't be fooled by a bug shared with production"*
   — but `ACCENT_TEXT_NEUTRALS` / `ACCENT_TEXT_TOKEN_TINTS` / `ACCENT_TEXT_INLINE_TINTS` are
   character-identical to the production constants. A `theme.css` surface or tint edit changes
   neither copy, and both the derivation and its guard stay green while shipping below the floor.
   Fix: parse the five surface hexes and the two `color-mix` percentages out of `theme.css`, and the
   two inline tints out of `BottomNav.css` / `AddSourceModal.css`, at test time — as tasks 2.2/5.1
   direct. If production must keep literals for runtime cost, add a test asserting the literals equal
   the parsed values, and say so in the comment instead of claiming an independence the code
   does not have.

3. **A false comment claims a pin that does not exist, and the static fallbacks are unpinned.**
   `frontend/src/theme/theme.css`, the D14 `:root` block, states the value is
   `deriveAccentTextColor(DefaultAccentColorByTheme.dark, "dark")` *"(`#f97316` -> `#fa8737`, dark's
   14% lightening — see `appearance.test.ts`'s anti-drift pin)"*. **There is no such pin.**
   `grep -rn "fa8737\|98460d\|572e12\|f1cab2" frontend/src --include=*.ts` returns **zero hits** —
   the four hardcoded derived values in `theme.css` (`:root` `--app-accent-text` / `--app-selection-bg`
   and the two per-theme dead defaults) are asserted by nothing. The value is correct today (I
   re-derived `#fa8737` independently). Fix: either add the anti-drift assertion the comment promises
   (`expect(deriveAccentTextColor(DefaultAccentColorByTheme.dark, "dark")).toBe("#fa8737")` plus the
   selection-background equivalent), or delete the claim. Do not leave a comment citing a test that
   was never written — this repo has a documented history of confidently-false documentation, and a
   citation is the one thing a reader will not re-verify.

### Non-blocking Suggestions

- `tasks.md` 9.1 lists `npm run check:tokens` as a `frontend/`-directory command; it is a root
  script. It passes from the root.
- `appearance.test.ts`'s producibility test is dead weight given the search-based derivation (see
  Phase 2). Harmless, but its comment could record *why* it is now tautological rather than implying
  it is load-bearing.
