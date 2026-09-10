# icon-system Specification

## Purpose
Defines the single icon system the frontend uses: one icon library, a fixed set of glyph sizes,
and consistent accessible-name / decorative-hiding treatment for every icon, whether or not it's
inside an `IconButton`.

## Requirements

### Requirement: Icons render from a single library
Every icon rendered in `frontend/src` SHALL come from `lucide-react`. No module in `frontend/src`
SHALL import from `@fortawesome/*`.

#### Scenario: No FontAwesome imports remain
- **WHEN** `frontend/src` is scanned for `@fortawesome/*` imports (including re-exports, aliased
  imports, and dynamic `import()`)
- **THEN** zero matches are found

#### Scenario: FontAwesome packages are removed
- **WHEN** `frontend/package.json` and `frontend/package-lock.json` are inspected
- **THEN** neither contains `@fortawesome/fontawesome-svg-core`, `@fortawesome/free-solid-svg-icons`,
  `@fortawesome/free-brands-svg-icons`, or `@fortawesome/react-fontawesome`

### Requirement: Icons sized via an inline `size` prop use a standardized value
Every `lucide-react` icon instance that is sized via an inline `size` prop/literal SHALL use one of
three standardized values — 14px, 16px, 20px — sourced from a shared size constant/util, rather than
an arbitrary numeric literal. Icons sized instead via CSS (e.g. `width`/`height: 1em`, inheriting
from `font-size`) are a distinct, pre-existing, accepted sizing mechanism and are outside this
requirement's scope — see `design.md`'s Non-Goals.

#### Scenario: An icon uses a non-standard inline literal size
- **WHEN** a `lucide-react` icon component is rendered with a numeric `size` prop value that is not
  one of 14, 16, or 20 (and not sourced from the shared size constant)
- **THEN** it is a defect against this requirement

#### Scenario: An icon uses the shared size constant
- **WHEN** a `lucide-react` icon component is rendered with `size={ICON_SIZE.sm}` (14),
  `ICON_SIZE.md` (16), or `ICON_SIZE.lg` (20)
- **THEN** it satisfies this requirement

### Requirement: Every icon has correct accessible treatment
An icon-only interactive control (not already covered by the `icon-button` capability's own
accessible-name requirement) SHALL have an accessible name (`aria-label` or `aria-labelledby`) or a
visible `title`. A purely decorative icon (conveys no information not already present in adjacent
text) SHALL be `aria-hidden`.

#### Scenario: A hand-rolled icon-only control outside IconButton has no accessible name
- **WHEN** an icon-only interactive element renders with no `aria-label`, `aria-labelledby`, or
  `title`, and is not an `IconButton` instance
- **THEN** it is a defect against this requirement

#### Scenario: A decorative icon next to a text label is aria-hidden
- **WHEN** an icon is rendered purely decoratively alongside a text label that already conveys the
  icon's meaning
- **THEN** the icon SHALL carry `aria-hidden="true"`
