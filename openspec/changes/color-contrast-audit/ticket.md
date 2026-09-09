# HEL-533: Color-contrast audit (light + dark)

## Description

The app ships light and dark themes with tokenized colors in `frontend/src/theme/theme.css` (two `data-theme` blocks). There are already contrast helpers in `frontend/src/theme/appearance.ts` (`getContrastRatio`, `getRelativeLuminance`, `getDashboardBgContrastRatio`) and the panel text color is contrast-resolved (`resolvePanelTextColor`, targeting 4.5:1). But there is no systematic audit that every text/UI token pair meets WCAG AA in both themes, and user-chosen accents (`--app-accent-ink` is computed but the accent-on-surface combinations are not audited).

## Scope

* Audit foreground/background token pairs in both `data-theme` blocks against WCAG AA (4.5:1 normal text, 3:1 large text / UI boundaries). Produce a documented pass/fail table (reuse `getContrastRatio` in a test/script harness).
* Fix failing pairs by adjusting the offending tokens in `theme.css` (keep the design language; adjust lightness within the existing token scheme), being careful not to regress the opacity/surface invariants (DESIGN.md §3).
* Cover accent usage: verify `--app-accent` text/background usages and `--app-accent-ink` computed pairs meet contrast for the default and preset accents; document any accent whose derived tokens fail and constrain or adjust.
* Add a guard test that computes contrast for the core token pairs so future token edits that break AA fail CI.

## Acceptance criteria

* **AC1** — A documented contrast table for both themes; all core text/UI pairs meet WCAG AA (or a justified, documented exception).
* **AC2** — Any fixes preserve the surface/opacity invariants and overall design language.
* **AC3** — Accent-on-surface and accent-ink pairs verified for default + presets.
* **AC4** — A repeatable contrast guard test exists and passes in CI.

## Out of scope

* Introducing new themes (the high-contrast theme is a separate ticket).
* Non-color accessibility (roles/labels/focus — separate tickets).

## Premise validation (2026-09-09, base aea1e0cf) — READ THIS FIRST

Full evidence: `.concertino/runs/HEL-533/evidence/premise-validation.md` in the MAIN checkout.

**Verdict: minor-staleness.** The central premise holds, but five sibling tickets merged in the preceding 24h and they remove a large part of this ticket's original scope. What is ALREADY DONE and must NOT be rebuilt:

* **AC4 is already satisfied**, and well: `focusRingTokenGuard.css.test.ts` (3.0:1, 8 presets x 2 themes, surfaces parsed from source, mutation arms), `accentTextSourceSyncGuard.css.test.ts` (4.5:1, 8 presets x 2 themes, garbage-value selftest), `accentTextClosureGuard.css.test.ts` (transitive `var()` closure proving no `color:` reaches `--app-accent`), `appearance.test.ts`. CI: job `frontend` runs `npm test`; job `e2e` runs the playwright glob; both feed the required `ci-complete` check.
* **AC3 is partially satisfied**: `--app-accent-text` (>=4.5), `--app-focus-ring-color` (>=3.0) and `--app-selection-bg` are each already covered for all 8 presets in both themes.
* HEL-1046 (736a8cbb) focus ring, HEL-1050 (35d8e5e9) border/shadow indicators, HEL-1048 (153f6714) theme-aware accent-text token, HEL-866 (f20ea8f6) rendered state-surface guard, HEL-444 (aea1e0cf) token parity + parity walk.

## What actually remains (the real scope of this ticket)

1. **AC1 is entirely unmet.** No contrast table exists in any committed form. `grep -rln contrast docs/` is empty. HEL-444's matrix lives in `.concertino/runs/HEL-444/evidence/` which is **gitignored** (`.gitignore:87`), so it is not a durable artifact.
2. **Five light-theme pairs miss AA-4.5 for normal text** (measured twice, independently, plain hex WCAG formula):
   * `--app-success` `#1a7f4e` on `--app-surface-soft` `#efece6` = **4.25**; on `--app-bg` `#f4f2ed` = **4.48**
   * `--app-warning` `#99621e` on `--app-surface-soft` = **4.32**
   * `--app-error` `#c73a2a` on `--app-surface-soft` = **4.38**
   All clear 3:1, so they are fine as UI boundaries/fills and fail only as normal-size text. Dark theme is clean throughout (worst: `--app-text-muted` on `--app-surface-strong` = 5.21).
3. **AC3 gap:** no ratio assertion on `--app-accent-ink` for the 8 presets. `buildAccentTokens` picks it by `max(contrast(dark), contrast(light))` — a max-of-two pick **with no floor**. Separately, `DESIGN.md:150-190` records a known pre-existing light-theme accent-on-surface shortfall of **1.78-3.71:1** for several presets.

## Binding constraints for whoever builds this

* **Enumerate by what RENDERS, not by what is declared** (MISTAKES.md). Items 2 and 3 above are declared-value measurements. Before changing any token, confirm on the running app that the pair actually renders as normal-size text on that surface. A declared failure on a pair that never renders is not a defect — say so and record it as an exception instead of "fixing" it.
* **A token's declared value is not its rendered value.** `applyAccentTokens` writes `--app-accent`/`--app-accent-ink`/`--app-focus-ring-color`/`--app-accent-text`/`--app-selection-bg` as INLINE style on `<html>`, outranking both `:root[data-theme=...]` blocks. Measure computed style, never `theme.css` declarations.
* **Measurement trap (HEL-444/HEL-1048):** a probe that settles in 800-1200ms intermittently reads the light accent as the dead `#ea580c`, because `ThemeProvider`'s server-preference adoption has not resolved at first paint. `ThemeProvider` seeds the accent ONCE in a mount-time initializer and re-persists on apply, so clearing `localStorage` is NOT sufficient — take a fresh reload with the theme already light, and let it settle.
* **Prefer joining an existing mechanism over adding a parallel one.** `theme.css` already has seven Jest guards parsing it. HEL-444's design gate refuted a script-form guard on exactly this basis and shipped a Jest test instead, dropping a husky line, two npm scripts, a selftest and a whole gate-chain surface. Do the same here unless there is a measured reason not to.
* **A guard must be failable.** Include mutation arms and refuse vacuity (assert the parsed surface/token set is non-empty), matching the existing guards' construction.
* **Do not touch** any worktree directory under `.claude/worktrees/` that this run did not create.
