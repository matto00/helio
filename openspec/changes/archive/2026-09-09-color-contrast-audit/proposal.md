## Why

`frontend/src/theme/theme.css` defines every colour token twice, once per `data-theme` block, and component CSS reaches those tokens by name. Nothing in the repo checks that a foreground token placed on a background token clears WCAG AA. Seven Jest guards already parse `theme.css`, but each answers a different question — token parity (presence), elevation/radius adoption, raw-literal sweeps, and the three *derived* accent tokens (`--app-accent-text`, `--app-focus-ring-color`, `--app-selection-bg`). The rendered `e2e/state-surface-contrast-guard.spec.ts` does compute a real ratio, but against `CONTRAST_THRESHOLD = 1.1`, which its own source calls "a measurably-different threshold, NOT a WCAG text-legibility threshold". **No guard measures a plain text-on-surface pair.**

That gap is not hypothetical. Measuring the declared hexes directly, five light-theme pairs miss AA-4.5 for normal-size text today:

| pair | ratio | verdict |
| --- | --- | --- |
| `--app-success` `#1a7f4e` on `--app-surface-soft` `#efece6` | 4.25 | fails 4.5, clears 3.0 |
| `--app-warning` `#99621e` on `--app-surface-soft` | 4.32 | fails 4.5, clears 3.0 |
| `--app-error` `#c73a2a` on `--app-surface-soft` | 4.38 | fails 4.5, clears 3.0 |
| `--app-success` `#1a7f4e` on `--app-bg` `#f4f2ed` | 4.48 | fails 4.5, clears 3.0 |
| `--app-text-muted` `#6c655c` on `--app-surface-soft` | 4.87 | passes (thinnest passing margin) |

The dark theme's intent tokens are clean, but the dark theme overall is not: `--app-text-muted` on the dark intent tints measures 3.82 at worst. Separately, `--app-accent-ink` — the one accent token the ticket calls out by name — is chosen in `buildAccentTokens` by `max(contrast(dark), contrast(light))`, **a pick with no contrast floor**; `appearance.test.ts` asserts only which of the two candidates wins for two hand-picked hexes, never a ratio, and never across the 8 presets.

Finally, the audit's own output has never survived as a durable artifact. HEL-444 produced a real matrix, but wrote it to `.concertino/runs/HEL-444/evidence/`, which `.gitignore:87` excludes. A future token edit has nothing to read.

## What Changes

* **A committed contrast table** covering both themes: every text-capable foreground token against every neutral surface token, plus the derived accent tokens across all 8 presets, with measured ratios and an explicit verdict per pair. Generated from source, not transcribed, so it cannot drift silently.
* **A Jest guard** (`frontend/src/theme/tokenContrastGuard.css.test.ts`) that parses both `data-theme` blocks out of `theme.css` and asserts each *rendered-confirmed* text pair clears 4.5:1, with UI-only pairs held to 3:1. Joins the existing seven-guard mechanism rather than adding a script + husky line + npm scripts + selftest surface — the same call HEL-444's design gate made. Failable by mutation, and refuses vacuity.
* **A contrast floor on `--app-accent-ink`**, asserted across all 8 presets in both themes, closing the AC3 gap the ticket names explicitly.
* **Remediation of the pairs that genuinely render**, by darkening the offending light-theme intent tokens within the existing token scheme. Any pair that measures below AA but never renders as normal-size text is recorded as a documented, justified exception rather than changed — the ticket's own AC1 permits exactly this, and changing a token nothing renders would be unverifiable churn.

## Capabilities

### New Capabilities

- `accessible-token-contrast`: every colour token pair the app renders as text clears WCAG AA in both themes, proven by a source-parsed guard and recorded in a committed contrast table.

### Modified Capabilities

None. The derived-accent capabilities (`accessible-accent-text`, `accessible-focus-indicator`) already hold their own requirements and are not re-litigated here; this change adds the floor for `--app-accent-ink`, which neither covers.

## Impact

* `frontend/src/theme/theme.css` — light-block intent token values only, where a rendered failure is confirmed. No structural or surface/opacity change (DESIGN.md §3 invariants preserved).
* `frontend/src/theme/appearance.ts` — possible floor enforcement in `buildAccentTokens`' accent-ink selection.
* `frontend/src/theme/tokenContrastGuard.css.test.ts` — new.
* `docs/` and/or `DESIGN.md` — the committed contrast table.
* CI: no new job or gate surface; the new guard runs inside the existing `frontend` job's `npm test`, which already feeds the required `ci-complete` check.
