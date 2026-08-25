# HEL-439 — Full mechanical enumeration

Complete, mechanically-derived enumeration of every DESIGN.md §3 token-rule
violation across `frontend/src/**/*.css` and `*.tsx`, using design.md's five
widened grep patterns (spacing/font-size include `em`/`%`, not just
`px`/`rem`), applying the documented exclusion list (`theme/theme.css`,
`theme/appearance.ts`, `AccentPicker.*`, chart-series-palette modules,
`**/*.test.ts(x)`, code comments, `MfaEnrollModal.tsx` QR-code colors,
`PreferencesEditor.tsx` appearance defaults). Counts below are the skeptic-independently-verified final numbers
(final-gate skeptic reports `skeptic-final-1.md`/`skeptic-final-2.md`),
superseding earlier cycle estimates where they differed, plus one
methodology note (the `~75` vs `78` optical-tweak reconciliation) resolved
below in favor of the exact mechanical recount.

## Spacing (`margin`/`padding`/`gap`)

- **84 fixes** applied across 15 files (exact-value literal → `var(--space-*)`
  substitution; no tolerance/near-miss substitutions). See `files-modified.md`
  for the per-file list.
- **0** exact-match-fixable literals remain repo-wide — every literal whose
  value exactly equals a `--space-*` token's px/rem value has been
  substituted.
- **119 off-scale residual** literals across 20 files (no matching token —
  left unfixed per the exact-value-only rule). Full breakdown (13 line
  items, sums to 119):
  - `6px` × 41
  - `10px` × 33
  - `14px` × 12
  - `7px` × 10
  - `5px` × 9
  - `0.375rem` × 3
  - `18px` × 2
  - `0.4rem` × 2
  - `0.35rem` × 2
  - `0.3rem` × 2
  - `30px` × 1 (`features/dashboards/ui/DashboardList.css:74` —
    `padding: 0 30px 0 var(--space-2);`; correctly off-scale, matches no
    `--space-*` value)
  - `0.4375rem` × 1
  - `60px` × 1
- **78 literals ≤4px** — the documented optical-tweak allowance (DESIGN.md
  §3: "small optical tweaks ≤4px may be literal"), not violations. Verified
  by an independent per-value mechanical recount (parsing each full
  `margin`/`padding`/`gap` declaration body, not just the substring
  immediately after the colon — this is also what surfaces the `30px`
  case above, since it sits after `0` and before `var(--space-2)` in its
  shorthand): 24 literals are exactly `4px`-equivalent, 54 are strictly
  under (dominated by `2px` × 35 and `1px` × 11). design.md's own `~75`
  figure is an approximation from the design-gate scoping pass, not this
  ticket's exact enumeration; 78 is the reconciled, reproducible count
  (reproduced twice, byte-identical).
- **10 relative `em`/`%` spacing values** with no absolute token equivalent
  (relative units cannot exact-match an absolute `--space-*` scale value).

This off-scale residual (119 literals across 20 files, dominated by
`6px`/`10px`) is **materially larger** than HEL-680's stated remit ("the one
already-known compact-chip case") — the human PR reviewer should decide
whether to broaden HEL-680's scope or file a further follow-up ticket to
cover the rest.

## Font-size

**3 flagged, 0 fixed.** All three are relative-`em` icon-glyph sizing with no
absolute `--text-*` token equivalent (relative units can't exact-match an
absolute scale value):

- `features/panels/ui/MarkdownPanel.css:79` — `font-size: 0.85em;`
- `shared/chrome/MobileNavSheet.css:161` — `font-size: 0.8em;`
- `shared/ui/EmptyState.css:171` — `font-size: 0.8em;`

## Font-weight

**0 violations.** No numeric `font-weight` literal exists anywhere in
`frontend/src` outside `var(--weight-*)` usage.

## Font-family

**10 non-token hits, all `inherit`, 0 ad-hoc font-families.** No violation.

## Color

**0 violations outside the documented exclusions.** Every hex/rgb/rgba
literal in `frontend/src` (excluding tests and `theme.css`) falls inside a
documented exception:

- `features/settings/ui/PreferencesEditor.tsx` — appearance defaults (§3
  documented exception, same rationale as `theme/appearance.ts`).
- `features/settings/ui/MfaEnrollModal.tsx` / `MfaEnrollModal.css:40` — QR
  code fixed white/black (functional, not themeable; the `.css` background
  carries an explicit in-source comment for the same rationale as the
  `.tsx` QR-prop exclusion).
- `features/panels/ui/editors/DividerEditor.tsx` — `#cccccc` divider-color
  UI-fallback/equality-sentinel value in application logic, not a rendered
  style declaration; outside the CSS-styling scope of this ticket.

## Guard test

`frontend/src/theme/tokenAuditSweep.css.test.ts` re-runs all five widened
grep patterns against the 15 spacing-swept files and asserts every
surviving hit matches a pinned per-category baseline (spacing's baseline is
the off-scale/optical-tweak residual within those 15 files; color/font-size/
font-weight/font-family baselines are empty since those categories have
zero live hits in the 15 swept files — pure regression guards). RED
demonstrated for both spacing and color: reverting a fixed
`var(--space-*)`/introducing a raw hex literal each fails the corresponding
category's test; reverting the change restores green.
