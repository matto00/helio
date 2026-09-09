## Evaluation Report — Cycle 2 (evaluation-2.md)

Scope: the three cycle-1 change requests only, over `764a5903..88096648`. Everything verified sound
in cycle 1 (producibility-by-construction, D2's scored set, D7 `::selection`, the `SidebarBody`
hover affordance, AC-2) was untouched by this diff and is not re-checked.

**The D4 dark-perceptibility BLOCKER from cycle 1 remains open with the owner and is out of scope
here. This report does not clear it and must not be read as clearing it.** The executor correctly
did not touch it.

Gates, all re-run by me: frontend suite explicit — **295 suites / 3077 tests passed** (up from
294/3067; the +1 suite is `accentTextSourceSyncGuard.css.test.ts` and the +10 tests are
closure-guard +2, source-sync 3, D14 pins 5 — accounted for exactly, no removal masked). `npm run
lint`, `npm run typecheck`, `npm run format:check`, root `npm run check:tokens` all clean. Working
tree left clean after my mutation probes.

### CR-1 — the vacuous closure guard — RESOLVED

The deeper root cause the executor reports is **correct, and it fully explains my cycle-1 result**.
The old loop mutated `reach` while iterating `defs` and tested membership against the live set, so a
chain whose intermediate hop happened to be visited earlier in the same pass resolved in one round.
`Map` iteration is insertion order and `--hop2` is declared before `--hop1`, so my crippled-loop
patch stayed green for that reason rather than because the corpus lacked a two-hop case. Snapshotting
`reach` at round start (`reachAtRoundStart`) makes round count mean hop count.

I re-ran my own mutations against the new guard. **Both go red, and each for its stated reason:**

- Reverting the fix (`[...reachAtRoundStart]` → `[...reach]`): the **crippled-fixpoint counter-check**
  fails — `Expected Array [] / Received Array [ ... ]` — i.e. the 1-round run once again finds the
  two-hop chain. The counter-check therefore detects precisely the mid-round-mutation bug, and is
  **not itself vacuous**: it fails when, and only when, the mechanism it describes is broken.
- Crippling the real fixpoint (`maxRounds = Infinity` → `1`): the **two-hop mutation arm** fails,
  `Expected length: 1 / Received length: 0`. So that arm genuinely requires the fixpoint's second
  iteration; it cannot pass incidentally.

The two arms are mutually non-vacuous — each is the other's falsifier. This is a better answer than
CR-1 asked for.

### CR-2 — hardcoded copies — RESOLVED

`accentTextSourceSyncGuard.css.test.ts` genuinely parses: `extractThemeBlock` + `parseNeutralSurfaces`
pull the five hexes out of each `:root[data-theme=...]` block, `parseTokenTintStrengths` pulls the
two `color-mix` percentages, and `parseFirstAccentBackgroundTint` pulls the inline tints out of
`BottomNav.css` and `AddSourceModal.css` themselves. Comments are stripped before parsing, so a
percentage mentioned in prose cannot be picked up.

I did not take the self-description on trust — I drifted three real source values and confirmed red:

| mutation | result |
|---|---|
| `theme.css` dark `--app-surface-soft` `#161514`→`#161515` | drift-detection test **fails** |
| `theme.css` light `--app-accent-surface` `11%`→`12%` | drift-detection test **fails** |
| `BottomNav.css` inline tint `22%`→`24%` | drift-detection test **fails**, *and* the source-parsed 4.5:1 sweep also fails |

That second failure in the last row is the important one: it proves the contrast sweep is scored
against the **parsed** set, not against a copy. The cycle-1 failure mode (a "reconstructed
independently" comment on a character-identical copy) is gone, and `appearance.test.ts`'s comment
has been honestly corrected to say it is a literal mirror and *not* the drift mechanism.

Residual, non-blocking: `parseNeutralSurfaces` matches by declaration order and the assertion takes
`.slice(0, 5)`, so inserting a new literal-hex `--app-surface-*` token ahead of the existing five
would shift the comparison rather than fail it loudly. Low risk (the `--app-bg-accent`/`-secondary`
tokens are `color-mix`, so they don't match), and not worth blocking on.

### CR-3 — the D14 anti-drift pin — NOT RESOLVED

The bug the executor surfaced while adding the pin is real and its **corrected values are right** —
I re-derived both independently against the implementation's rounding: `deriveAccentTextColor("#ea580c",
"light")` = 33% → **`#9d3b08`**, and the light selection background = `#f4f2ed` blended 26% with
`#ea580c` = **`#f1cab3`**. `DefaultAccentColorByTheme.light` is indeed `#ea580c`. Good catch.

One accuracy note on the diagnosis: the wrong-accent story fits `--app-accent-text` exactly
(`darkenTowardBlack(#f97316, 39%)` = `#98460d`, the old value) but **not** `--app-selection-bg` — the
old `#f1cab2` came from the *right* accent with a one-unit difference in the blue channel
(178.5 rounds to 179 under `Math.round`, to 178 under half-to-even). So that literal was
hand-computed rather than taken from the code. Same lesson, slightly different mechanism, and it
sharpens why the pin matters.

**But the pin does not pin the thing that was wrong.** Every assertion in the "D14 static fallback
anti-drift pins" block compares the live derivation against **a literal written in the test file**.
Nothing reads `theme.css`. So the guard constrains the derivation, never the stylesheet — and the
stylesheet is where the defect was.

I proved this. I replaced **all four** `theme.css` values with garbage — `:root` `--app-accent-text`
→ `#ff0000` and `--app-selection-bg` → `#0000ff`, the dark dead default → `#ff0000`/`#0000ff`, the
light dead defaults → `#00ff00`/`#ff00ff` — and ran the whole theme directory:

```
Test Suites: 10 passed, 10 total
Tests:       141 passed, 141 total
```

Fully green with every pinned value corrupted. The pin would not have caught the very bug that
motivated it; that bug was found by a human writing the pin, not by the pin failing.

This also makes the `theme.css` comment false a second time, in a narrower way. It now claims the
literal is *"pinned by `accentTextSourceSyncGuard.css.test.ts`'s ... describe block, which asserts
this literal against the live derivation so an edit to either one without the other goes red."* An
edit to `theme.css` alone does **not** go red. Cycle 1 flagged a comment citing a test that did not
exist; this is a comment overstating what the test that now exists actually does.

Two of the three D14 pins are also literally the same assertion
(`deriveAccentTextColor(DefaultAccentColorByTheme.dark, "dark")` → `#fa8737`) under two different
names, one of which claims to pin "the dark `:root[data-theme]` dead default" while asserting nothing
about it.

### Overall: FAIL

CR-1 and CR-2 are resolved and were proven so by my own mutations. CR-3 is not: one change request
below.

### Change Requests

1. **Make the D14 pin read `theme.css`.** `frontend/src/theme/accentTextSourceSyncGuard.css.test.ts`,
   the "D14 static fallback anti-drift pins" describe block. Parse the four literals out of
   `theme.css` — the file already has `extractThemeBlock`/`stripComments` and reads that exact file
   a few lines above — and assert each parsed value equals the live derivation:
   - `:root`'s `--app-accent-text` / `--app-selection-bg` (outside both theme blocks) against
     `deriveAccentTextColor(DefaultAccentColorByTheme.dark, "dark")` and
     `buildAccentTokens(DefaultAccentColorByTheme.dark, "dark")["--app-selection-bg"]`;
   - the `:root[data-theme="light"]` pair against the `"light"` derivations, if those declarations
     are kept (see CR-2's ruling below).

   Verify the fix the way I falsified the current one: corrupt a value in `theme.css` and confirm
   red. Then correct the `theme.css` comment to describe what the pin actually checks — if it says
   "an edit to either one without the other goes red", that must be true of an edit to `theme.css`.
   Drop or differentiate the duplicated dark pin.

   **Ruling on the D12 question you raised** (dead-but-now-correct per-theme declarations):
   D12 permits either branch, so correcting them is defensible — but **removal is the better call for
   the two `:root[data-theme=...]` pairs**, and this cycle is the evidence for it. Those declarations
   never render (inline style on `<html>` outranks them the moment the effect runs), so a wrong value
   there is invisible in every environment; that invisibility is exactly why the wrong-accent value
   survived to be found by hand. Keeping them correct-but-dead preserves a drift surface whose only
   possible detector is a test — whereas deleting them removes the surface outright. **`:root`'s
   single D14 fallback must stay** (it genuinely paints pre-effect) and must be pinned per the above.
   That takes four unpinned literals down to one pinned literal. Either branch is acceptable if, and
   only if, whatever remains in `theme.css` is pinned to `theme.css`.
