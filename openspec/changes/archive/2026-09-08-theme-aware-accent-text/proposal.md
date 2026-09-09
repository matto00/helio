## Why

Accent used as **normal text** fails WCAG's 4.5:1 floor. Unlike the focus ring — which HEL-1046 fixed with a
single theme-independent colour — no single colour can work here. A colour clearing 4.5:1 against the binding
light surface (`--app-surface-soft` `#efece6`) needs luminance **L ≤ 0.1479**; clearing it against the binding
dark surface (`--app-surface-strong` `#262320`) needs **L ≥ 0.2523**. The window is empty, gap **0.1044**.
That constrains **luminance alone**, so it rules out *every* colour — a ninth preset could not escape it either.

The text case is therefore theme-dependent by necessity. The owner has ruled on the resulting brand change
against rendered evidence: a **text-only token**, **hue shift accepted on all eight presets**, and the
accent-tinted surfaces **fixed here** rather than split out.

## What Changes

- A new **per-theme, per-accent derived text token** carries the 4.5:1 obligation. `--app-accent` itself is
  unchanged, so fills, borders and decorative uses keep the user's chosen colour at full brightness.
- The derivation is scored against **every background accent text can land on** — the five neutral surface
  tokens **and** the accent-tinted backgrounds (`--app-accent-surface`, `--app-accent-dim`) composited over
  each of those surfaces. Scoring only the neutral set is what caused the tinted surfaces to be missed.
- The 41 `color: var(--app-accent)` sites are repointed at the new token, sized from **rendered** instances.
- `theme.css`'s dead per-theme `--app-accent` / `--app-accent-ink` defaults are corrected or removed, and the
  `theme.css:161-162` comment is made true.
- A guard asserts the derivation's output clears 4.5:1 for all 8 presets × both themes × every scored
  background class, **and that every proposed colour is producible by the derivation itself**.

## Capabilities

### New Capabilities

- `accessible-accent-text`: the contrast obligation carried by accent used as readable text, and the rule that
  it is scored against every background that text can actually land on.

### Modified Capabilities

_None._ `accessible-focus-indicator` is deliberately untouched — its guarantee is theme-**independent** by
construction and must stay that way (AC-3).

## Non-goals

- **User-chosen surfaces.** A panel with a user-picked background cannot be guaranteed by any derived colour —
  the same structural impossibility, relocated from "two themes" to "any colour the user picks". **HEL-1057**
  owns it (not HEL-1051, which is focus *indicators* at 3:1 — the same component, a different obligation). This change covers theme-token-bound and accent-tinted surfaces only.
- **Changing `--app-accent` itself**, or retuning the eight presets. The owner ruled `text-only-token`, so
  fills stay bright.
- **Making `--app-focus-ring-color` theme-aware.** It must remain theme-independent.

## Impact

`frontend/src/theme/appearance.ts` (new derivation), `theme.css` (new token, dead defaults), `ThemeProvider`
(re-apply on theme change as well as accent change), 24 stylesheets carrying accent-text rules, plus guards
and `DESIGN.md`. No wire, API or schema impact — which is not the same as no downstream impact: **rendered
brand text changes colour in the light theme for all eight presets**, which is the point of the owner ruling
rather than a side effect of it.
