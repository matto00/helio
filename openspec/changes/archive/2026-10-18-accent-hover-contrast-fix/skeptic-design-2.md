## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed HEAD d8387507734f8e74bbf62df8880923791ec7c08d. The planning artifacts are untracked in the change directory. All ratios below were recomputed with the WCAG formula from sRGB hex, using 8-bit rounded mixes. The script is in the session scratchpad (`c.py`).

### What I verified (with evidence)

- **D1 table (recomputed, matches the design).** Light hover today, using 24% black with the dark ink `#181511`:

  | Preset | Ratio |
  | --- | --- |
  | Orange | 3.93 |
  | Red | 3.06 |
  | Pink | 3.22 |
  | Purple | 2.95 |
  | Blue | 3.13 |
  | Cyan | 4.47 |
  | Green | 4.76 |
  | Yellow | 5.56 |

  With the new derivation (24% toward white in light, 22% toward white in dark), every preset clears 4.5 in both themes:

  | Preset | New light | New dark |
  | --- | --- | --- |
  | Orange | 8.21 | 8.03 |
  | Red | 6.42 | 6.25 |
  | Pink | 6.82 | 6.62 |
  | Purple | 6.51 | 6.29 |
  | Blue | 6.93 | 6.77 |
  | Cyan | 9.14 | 8.94 |
  | Green | 9.58 | 9.45 |
  | Yellow | 11.04 | 10.95 |

  - The dark theme is unchanged, which is expected because the mix is the same.
  - The light default accent `#ea580c` (`theme.ts:12-15`, not a preset) picks the dark ink (rest 5.11). Its new light strong is 6.80.
  - `ThemeProvider.tsx:119` always calls `applyAccentTokens`, so the runtime value is what renders.
- **D2 numbers (recomputed, correct).**
  - Light: hover `#ffffff` vs rest `#efece6` is 1.179. Hover vs backdrop `#f4f2ed` is 1.119. Rest vs backdrop is 1.054.
  - Dark: hover vs rest is 1.133. Hover vs backdrop is 1.234.
  - Today's light hover vs rest is 1.025.
  - Token values were taken from `theme/theme.css:254-258` and `343-347`.
- **D2b: is `--app-focus-ring-color` a sound chart-emphasis source?** Yes.
  - `deriveFocusRingColor` (`appearance.ts:428-452`) returns a hex that clears 3:1 against all ten literal theme surfaces in `FOCUS_RING_SURFACES` (`appearance.ts:353-366`, both themes). The colour is theme-independent and written inline by `buildAccentTokens` (`:631`). The static `:root` fallback is the hex `#db6513` (`theme.css:527`).
  - Both values pass `PARSEABLE_COLOR` (`chartAppearance.ts:76`). Today's `accentStrong` read returns an unresolved `color-mix()` string.
  - User-chosen panel backgrounds are not covered. That gap is pre-existing and documented at `appearance.ts:420-427`, so it is not new risk.
  - Renaming the field touches about 10 `ChartThemeTokens` fixtures. `buildChartOption.*.test.ts`, `timeAxisTestSupport.ts`, `PanelCard.aggregatePieChart.test.tsx` and others list `accentStrong:`. Typecheck will force these updates.
- **R3 (D5a retarget).** It is now firm in D1 and task 1.4.
  - The existing D5a assertion (`focusRingTokenGuard.css.test.ts:877-905`) is "Yellow fails 3:1 in at least one theme". It still holds against the runtime value: new light Yellow strong vs `#ffffff` is 1.65.
- **R4 (stale text).** DESIGN.md has §8 at line 922 and A.7 at line 1734. The comments are at `chartAppearance.ts:33-36, 54-58` and `useChartOption.ts:88-90`. All are now in task 4.1.
- **R5 (red-first).** Both red transcripts are now required in D3 and task 3.2. The exception code to delete exists at `e2e/hel1582-mobile-pipeline.spec.ts:1087-1112`.
- **Specificity of the D2 rule (checked against `PipelineMobile.css:393-431`).** See CR1. As specified, the rule does outrank `.mobile-pill--primary`.
- **Reachability of D1's step-up loop.** See CR2. The loop is unreachable for every sRGB accent.

### Verdict: REFUTE

### Change Requests

1. **D2 / task 2.1: specify the selectors. As written, the light-scoped rule outranks the primary pill and ties the hover.**
   - Current rules:
     - `.mobile-pill--primary` sets the Run pill's rest accent fill at specificity (0,1,0) (`PipelineMobile.css:417-422`).
     - `.mobile-pill:hover:not(:disabled)` is (0,3,0) (`:413`).
     - `.mobile-pill--primary:hover:not(:disabled)` is (0,3,0) (`:424`).
   - D2's planned `:root[data-theme="light"]`-scoped `.mobile-pill` rest rule is (0,3,0). That has two effects:
     - (a) It beats `.mobile-pill--primary`. In light, the Run pipeline pill at rest would paint `--app-surface-soft` instead of `--app-accent`.
     - (b) It ties both hover rules, so whether either hover applies depends on source order.
   - The e2e state probe measures hover, focus and pressed, not the primary's rest fill. Defect (a) could therefore ship green.
   - Required:
     - State the exact selectors in the design. One working shape uses the existing `HomePage.css:246` modifier-scoped pattern:
       - Rest: `:root[data-theme="light"] .mobile-pill:not(.mobile-pill--primary) { background: var(--app-surface-soft) }`, at (0,4,0).
       - Hover: `:root[data-theme="light"] .mobile-pill:not(.mobile-pill--primary):hover:not(:disabled) { background: var(--app-surface-strong) }`, at (0,6,0). This is needed because the (0,4,0) rest rule would otherwise beat the (0,3,0) base hover.
     - Include a specificity line for each.
     - Add a rendered assertion, in both themes, that the Run pipeline pill's rest `background-color` equals the resolved `--app-accent`. Show it red against the naive `:root[data-theme="light"] .mobile-pill` rule.
     - Delete "executor verifies specificity" in favour of this.
2. **D1 / D3 / tasks 1.1 and 1.3: the step-up loop is dead code, and the required test that exercises it cannot be written.**
   - I swept the sRGB cube in steps of 3 per channel and applied the design's ink selection and away-from-ink mix. The minimum ink-on-strong ratio at the starting mix is 4.96 in light and 4.86 in dark, both at `#f60000`. No accent needs a step-up.
   - The suggested `#767676` picks the light ink `#fdfcfa` (rest 4.43, mixed toward black). It already reaches 6.73 at 24% and 6.52 at 22%. It does not exercise the loop. (This came from my predecessor's round-1 non-blocking note, which was wrong.)
   - D3 requires "an accent that exercises the step-up loop", and no valid hex can do that. An executor would either fail the task or claim a test that proves nothing.
   - Required, one of:
     - (a) Remove the loop and use a fixed mix (22% dark, 24% light). Replace the loop test with a dense sweep guard asserting ink-on-strong >= 4.5 across the accent cube, or a documented grid. Keep the mutation red: the old "toward black in light" behaviour must fail.
     - (b) Keep the loop, but state that it is a defensive bound, unreachable under current inks and mix starts. Test it only through an injected start mix (for example, a lower start parameter) and say so honestly.
   - Either way, correct the D3 and task 1.3 text, and drop the `#767676` "exercises the step-up loop" claim. The `#767676` light-ink case is still worth keeping as the light-ink (toward-black) sweep point.

### Non-blocking notes

- Add `DefaultAccentColorByTheme` (`#f97316` / `#ea580c`) to the unit guard alongside the 8 presets. `#ea580c` is what a fresh light-theme user renders.
- D2's design choice puts a floating, shadowed pill on `--app-surface-soft`, which DESIGN.md §3 describes as the "recessed wells/inputs" rung. It works numerically. Record the semantic oddity in the PR body's "UI decisions taken overnight" entry, so the owner can judge the reversible call.
- Task 1.5 should say "update every `ChartThemeTokens` fixture" rather than naming only two test files. Typecheck will enforce it anyway.
