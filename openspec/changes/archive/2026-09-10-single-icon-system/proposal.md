## Why

The app ships two icon systems (`lucide-react` and FontAwesome), producing inconsistent stroke
weight/sizing/metaphor and doubled bundle weight. Premise-validated inventory (2026-09-10, against
`origin/main` `d8d398ca`): FontAwesome is used in 57 files (67 distinct symbols) vs lucide-react's
32 files — FontAwesome is the more broadly used system today, not lucide, so the migration direction
is larger than the original ticket implied. `DESIGN.md` §0.5 and the v0.7 UI/UX Cohesion epic
(HEL-346) require one system, chosen on stroke-based aesthetic grounds (matches the hairline design
language), not usage share.

## What Changes

- Replace every `@fortawesome/*` icon usage across `frontend/src` (57 files, 67 symbols) with its
  `lucide-react` equivalent.
- Remove `@fortawesome/fontawesome-svg-core`, `@fortawesome/free-solid-svg-icons`,
  `@fortawesome/free-brands-svg-icons`, `@fortawesome/react-fontawesome` from `frontend/package.json`
  and `frontend/package-lock.json`.
- Introduce a standardized glyph-size set (14/16/20px) expressed as a shared constant/util, replacing
  today's arbitrary inline `size={N}` literals (observed: 16, 18, 22, 28...).
- Ensure every icon-only interactive control has an accessible name (extending the existing
  `IconButton`/HEL-718 guarantee to any remaining hand-rolled icon-only controls uncovered by it) and
  every purely decorative icon is `aria-hidden`.

## Capabilities

### New Capabilities

- `icon-system`: single-icon-library requirement (lucide-react only, zero `@fortawesome/*`), the
  standardized glyph-size set and its shared mechanism, and decorative-icon `aria-hidden` coverage
  for icons outside `IconButton`.

### Modified Capabilities

- `error-state-pattern`: `EmptyState`'s icon-prop requirement ("EmptyState icon and cta icons accept
  a ReactNode") is removed and replaced by a cleanly-named successor ("...accept a ReactNode only")
  that drops the `IconDefinition`/`FontAwesomeIcon` arm now that `@fortawesome/*` no longer exists
  (a remove-and-replace pair, not a `MODIFIED` edit — see design.md D6's round-4 correction for why).
- `dependabot-update-grouping`: the "Co-versioned families arrive as a single pull request"
  requirement's `fortawesome` scenario is dropped now that those packages no longer exist in
  `frontend/package.json` (design-gate round 5, driver-ruled `proceed-to-delivery` — see design.md's
  round-5 addendum).
  (`icon-button`'s existing accessible-name requirement already covers icon-only buttons unmodified;
  this change extends coverage to non-`IconButton` icon usages via the new `icon-system` capability
  rather than editing `icon-button`'s own requirements.)

## Impact

- `frontend/src/**` — 57 files with `@fortawesome/*` imports get their icon usages swapped.
- `frontend/package.json` / `frontend/package-lock.json` — 4 `@fortawesome/*` packages removed.
- New `frontend/src/shared/ui/iconSize.ts` (or equivalent) — shared size constant/util.
- No backend/API/schema impact — frontend-only, no wire-shape change.

## Non-goals

- Redrawing/theming individual glyphs beyond the equivalent lucide swap.
- The OrbitMark brand logo.
- Reworking `IconButton`'s own container-size (`xs`/`sm`/`md`) scale — that's the button's hit-target
  size, not the glyph's rendered size, and is out of scope here.
