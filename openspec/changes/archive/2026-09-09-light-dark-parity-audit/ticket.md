# HEL-444: Light / dark parity audit

## Description

`DESIGN.md` defines light/dark via `ThemeProvider` setting `data-theme` on `<html>`, with tokens split into
`:root[data-theme="dark"]` and `:root[data-theme="light"]` blocks. Because most component CSS references tokens, both
themes should "just work" — but a component that references a token defined in only one theme block, hardcodes a
value, or assumes dark-only contrast breaks in the other theme. There has been no systematic parity pass.

## Acceptance criteria

* No component references a token undefined in one theme block; verified by a token-coverage guard test.
* Every listed surface is legible and on-brand in both light and dark across all 8 accent presets; before/after
  screenshots in the PR.
* Text meets WCAG AA contrast against its surface for body and muted text on the primary surfaces.
* `npm run lint` / `npm test` pass, zero new warnings.

## Orchestrator Planning-phase audit — MEASURED. Three of four ACs already satisfied; one REAL defect found.

Full evidence: `.concertino/runs/HEL-444/evidence/premise-validation.md`. All figures PARSED from `theme.css`, never
transcribed — a first pass using a hand-copied `--app-text-muted` produced wrong dark-theme numbers and was discarded.

| AC | measured |
| -- | -- |
| AC1 token parity | **zero defects** — dark block defines 30, light 30, set difference EMPTY both directions |
| AC3 text contrast | **20/20 pass AA** — {text, muted} x 5 surfaces x 2 themes. Thinnest light muted on `surface-soft` 4.87 |
| AC4 accent-ink | **8/8 presets pass AA**, and theme-INDEPENDENT by construction |
| AC2 running-app walk | **never done** — the genuine work |

**AC1's guard is NOT covered by HEL-1037** (merged #601, `scripts/check-tokens.mjs`): that validates every `var(--*)`
resolves *anywhere in the scanned set*, explicitly "not just theme.css". A token defined only inside
`:root[data-theme="dark"]` DOES resolve, so it passes. The gap is "defined in BOTH theme blocks", which nothing checks.

**AC4 is satisfied structurally.** `buildAccentTokens` (`theme/appearance.ts:305-326`) picks whichever fixed ink
(`#181511` / `#fdfcfa`) has higher contrast against the accent; theme is not an input. Ratios: Orange 6.49, Red 4.83,
Pink 5.16, Purple **4.60** (thinnest), Blue 4.95, Cyan 7.49, Green 7.98, Yellow 9.49.

## THE REAL FINDING — CORRECTED at design gate r1. My first version was measured against values the app never renders.

**What I originally reported was wrong.** I claimed a per-theme accent asymmetry (dark `#f97316` vs light `#ea580c`)
read straight out of `theme.css`. Those light values are **unreachable**: `ThemeProvider.tsx:89-92` calls
`applyAccentTokens` unconditionally on mount, and `appearance.ts` writes via
`document.documentElement.style.setProperty` — **inline style on `<html>`, which beats both
`:root[data-theme=...]` blocks.** `theme.css:161-162`'s own comment says so ("Runtime-set: `--app-accent` (user
choice)... Defaults below match DefaultAccentColor"); I read the value and missed the comment two lines above it.
Verified on the running app in both themes: computed `--app-accent` is `#f97316` either way.

**The corrected finding is worse, not milder.** There is no per-theme asymmetry — there is ONE accent in both themes,
and light gets the *un-darkened* value:

| theme | rendered accent | as text vs the 5 surfaces | AA normal 4.5:1 | non-text / large 3:1 |
| -- | -- | -- | -- | -- |
| dark | `#f97316` | 5.58 – 6.73 | **PASS** | pass |
| light | `#f97316` | **2.38 – 2.80** | **FAIL** | **FAIL** |

Light fails **3:1 as well as 4.5:1**. That matters beyond text: it means the **63 accent border / outline / ring uses
are also below threshold**, which an earlier draft of this plan waved through at "3:1, fine".

**Across all 8 presets** (hexes parsed from `theme/theme.ts`, surfaces from `theme.css` — the accent presets do NOT
live in `theme.css`): in light, **four of eight fail 3:1 outright** — Yellow 1.63–1.92, Green 1.93–2.28, Cyan
2.06–2.43, Orange 2.38–2.80 — Pink straddles it (2.99–3.53), and only Blue, Red and Purple clear it. In dark all
eight clear 3:1, but **four of eight fall below 4.5:1 in dark too** — Purple 3.95, Red 4.15, Blue 4.25, Pink 4.43 —
so "dark is fine" is only true at the 3:1 non-text threshold, not for normal text. **The shipped default (Orange) is
one of the four failing 3:1 in light.**

`color: var(--app-accent)` has 41 static sites (22 link/button, 12 badge/chip/notice, 4 icon/svg, 3 state) — but a
computed-style sweep of the Dashboards view in light theme found **zero** elements actually rendering that colour, so
the sites concentrate elsewhere (20 are in `PipelineDetailPage.css`). **Which sites are normal-size text must be
settled per-surface on the running app, not from the grep count.**

**Not a defect count:** the raw accent x surface matrix has many sub-threshold pairings because a saturated accent is
inherently low-contrast on light surfaces. It becomes a defect where the accent colours normal-size text or draws a
border users must perceive.
