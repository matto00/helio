## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed HEAD d8387507734f8e74bbf62df8880923791ec7c08d (planning artifacts untracked in the change dir).

### What I verified (with evidence)

- **Root cause for the accent pair is correct.** `buildAccentTokens` (`frontend/src/theme/appearance.ts:611-635`) writes only `--app-accent`, `--app-accent-ink`, `--app-focus-ring-color`, `--app-accent-text` and `--app-selection-bg`. `--app-accent-strong` is static `theme.css:300` (dark: `78%, white`) and `theme.css:380` (light: `76%, black`). The ink is the better of `#181511`/`#fdfcfa` for the accent and does not depend on the theme, so every preset gets the dark ink. In light, the hover therefore darkens the accent toward the ink. D1's diagnosis holds.
- **D1's direction is sound for the button pair.** I recomputed with the WCAG formula: lightening 24% toward white gives ink/strong ratios of 8.21 (Orange), 6.42, 6.82, 6.51 (Purple), 6.93, 9.14, 9.58 and 11.04, all at least 4.5. Mixing away from the ink can only raise contrast, so the "hover >= rest" claim holds. The runtime-write pattern matches the existing focus-ring, accent-text and selection derivations, and no new token name is added. I accept the token-level fix and the light-theme "hover becomes lighter" change as a reversible overnight UI decision, as long as it is recorded in the PR body.
- **Consumers.** I grepped `accent-strong|accentStrong` in non-test frontend source. 35 CSS sites use it only as a hover `background`. The one exception is `utils/chartAppearance.ts:299-300`, where `accentStrong` is used as a chart emphasis `borderColor`/`lineStyle.color`. Nothing paints it as text.
- **Dry run backdrop, measured.** HEL-1582's own rendered evidence (`/home/matt/Development/helio/.concertino/runs/HEL-1582/evidence/e2e-evidence/HEL-1582/phone-state-contrast.json`) records Dry run pill hover `surfaceRatio` 1.1188 (light) and 1.2339 (dark). These match `#ffffff` vs `#f4f2ed` (1.119) and `#262320` vs `#0f0e0d` (1.234) to three places. So the probe's backdrop (`readBackdrop` in `e2e/hel1582-mobile-pipeline.spec.ts:922-935`, a walk up the ancestor backgrounds) is `--app-bg`, not `--app-surface`. The pill's rest fill is `--app-surface`, but it floats over the page canvas.
- **D2 contrast numbers (computed):** `#efece6` vs `#f4f2ed` = 1.054; `#efece6` vs `#fdfcfa` = 1.150; `#ffffff` vs `#fdfcfa` = 1.025; `#262320` vs `#1a1816` = 1.133.
- **D5a guard:** `focusRingTokenGuard.css.test.ts:839-905` parses the static `theme.css` `color-mix` declaration and models the rendered strong colour from it.
- **DESIGN.md:** the §8 text near line 922 (and A.7, around line 1734) describes `--app-accent-strong` as `color-mix(... 76-78%, black|white)`. Task 4.1 only plans edits to §3/§5.
- **Chart emphasis.** For light theme I computed the new light strong against white panels: 2.22 (Orange), 2.83, 2.67, 2.79, 2.63, 1.99 (Cyan), 1.90 (Green) and 1.65 (Yellow). The old 24%-black values were 4.63, 5.95, 5.65, 6.18, 5.81, 4.07, 3.82 and 3.27, all at least 3:1.

### Verdict: REFUTE

### Change Requests

1. **D2 / task 2.1 / spec "Dry run hover is distinct from rest": the chosen rung fails the existing backdrop floor in light.**
   - DESIGN.md §3's rung table (lines 146-156, A.2) is keyed on the real backdrop. The Dry run pill's real backdrop is `--app-bg` (measured 1.1188 = `#fff`/`#f4f2ed`, see above), not `--app-surface`.
   - With D2's `--app-surface-soft` hover, light hover-vs-backdrop is `#efece6`/`#f4f2ed` = **1.054 < 1.10**. That fails the same test's `classifyState` 1.10 floor, which the spec keeps.
   - For an `--app-bg` backdrop, the table's rung is `--app-surface-raised`, which in light is `#ffffff`. That is what ships today, and it is exactly the 1.025-vs-rest problem.
   - No single existing neutral token clears 1.10 against both the backdrop (`#f4f2ed`) and the rest fill (`#fdfcfa`) in light, because those two are only about 1.07 apart. The design has to change something else. One worked example that uses only existing tokens: in light only, set the rest fill to `--app-surface-soft` (`#efece6`) and keep the hover at `--app-surface-strong`/`#fff`. That gives hover vs rest 1.179 and hover vs backdrop 1.119. Dark stays unchanged (1.133 / 1.234).
   - Whatever the design picks must state both ratios (vs backdrop and vs rest) for both themes, and name the rung's justification honestly. If the only viable answer is a new state token, raise an escalation; do not build it. Fix the "1.150:1" claim in D2 and the "Rationale" that calls this the documented rung.
2. **D1 / chart consumer: say what happens to chart hover emphasis.**
   - "Chart hover emphasis (`accentStrong`) follows" is presented as harmless. In light it drops every preset's emphasis border/line from at least 3:1 to below 3:1 against white panel surfaces (Yellow 1.65, Green 1.90).
   - Also, `getComputedStyle` currently returns the unresolved `color-mix(...)` string for this unregistered custom property (`chartAppearance.ts:76-78` documents zrender rejecting such strings elsewhere). Writing a hex inline therefore changes what the chart actually paints. Do not assume the chart "already shows a darker accent".
   - The design must choose one of two options. (a) Decouple the chart emphasis from `--app-accent-strong` (for example, `--app-focus-ring-color`, which is already derived to 3:1 on theme surfaces). (b) Measure the before and after emphasis in the running app and record a deliberate, numbered acceptance as an overnight UI decision.
   - Add a task for whichever is chosen.
3. **D1 / task 1.4: remove the "if" from the D5a guard decision.**
   - After this change, the `theme.css` `--app-accent-strong` declaration is a dead pre-hydration fallback. `focusRingTokenGuard`'s D5a test (lines 839-905) would then assert a property of a value that is never rendered, and keep passing without proving anything.
   - Required: extend D5a to assert against `buildAccentTokens(preset, theme)["--app-accent-strong"]` for both themes. Keep the static parse only as a fallback sanity check. Spell this out in the design and tasks instead of "if the claim depends on the runtime value".
4. **Task 4.1: DESIGN.md has more stale statements than §3/§5.**
   - §8 (around line 922, the D5a bullet quoting the `color-mix` recipe) and A.7 (around line 1734) describe `--app-accent-strong` as a static mix. Add both to the task.
   - Also add the code comments that state the same: `chartAppearance.ts:33-36, 39, 54-58` and `useChartOption.ts:88-90`.
   - Update `FALLBACK_CHART_THEME.accentStrong` (`#fa9249`, dark theme) only if the derivation changes the dark value. D1 says it does not.
5. **Tasks 3.2 / 1.3: show the new e2e assertion red first.**
   - The Dry-run hover-vs-rest >= 1.10 assertion must be shown failing on the current CSS (expected light value 1.025) before the fix, and passing after.
   - The removed-exception path must be shown failing with the old light "toward black" strong. Without this, the Run pill 4.5 check is unproven at the rendered level.

### Non-blocking notes

- For every shipped preset, the D1 step-up loop never runs (24% clears 4.5 already), so only custom accents exercise it. The unit sweep should include an accent where 24% is not enough. A mid-grey with near-equal ink contrasts, such as `#767676`, is a good candidate. The sweep should also include a dark custom accent that takes the light ink.
- The static light fallback (`#ea580c`, white ink, 76% black) is internally consistent (white ink on a darkened accent). Leaving it is fine.
- Sibling lanes HEL-1620 and HEL-1608 edit `e2e/hel1579-pipeline-spine-layout.spec.ts`. A grep found no `accent-strong` or hover-colour pin in `e2e/` outside hel1582, so the collision risk is low.
