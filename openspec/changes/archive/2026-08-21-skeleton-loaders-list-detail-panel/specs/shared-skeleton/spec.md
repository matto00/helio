## ADDED Requirements

### Requirement: A shared Skeleton primitive exists in shared/ui
The system SHALL provide a `Skeleton` component at `frontend/src/shared/ui/Skeleton.tsx`, exported from
`frontend/src/shared/ui/index.ts`. It SHALL accept a `variant` prop of `"block" | "line" | "circle"`
(default `"line"`), an optional `width`/`height` override, and an optional `className`. All skeleton
placeholder markup in the application SHALL be composed from this primitive; no component outside
`Skeleton.css` SHALL define its own shimmer keyframes or shimmer background.

#### Scenario: The primitive is exported from the shared ui barrel
- **WHEN** `Skeleton` is imported from `frontend/src/shared/ui`
- **THEN** the component resolves and renders

#### Scenario: Each variant renders its own modifier class
- **WHEN** `Skeleton` is rendered with `variant="block"`, `variant="line"`, and `variant="circle"`
- **THEN** each renders the base skeleton class plus a distinct variant modifier class

#### Scenario: No competing shimmer implementation exists
- **WHEN** the frontend stylesheets are searched for shimmer keyframes
- **THEN** they are defined only in `Skeleton.css`

### Requirement: Skeleton styling uses design tokens only
`Skeleton.css` SHALL express every colour, radius, spacing and duration through a `theme.css` custom
property. The shimmer SHALL ramp between `--app-surface-soft` and `--app-surface-raised` and SHALL NOT
be accent-tinted, consistent with the theme's rule that structure is neutral. The shimmer loop duration
SHALL come from a dedicated token (`--app-skeleton-shimmer`) defined in `theme.css`, not from a literal
and not from `--app-transition`/`--transition-slow`, whose durations are tuned for hover and one-shot
entrances rather than a continuous loop.

#### Scenario: No literal colour, radius, or duration in the stylesheet
- **WHEN** `Skeleton.css` is inspected
- **THEN** it contains no hardcoded hex/rgb colour, no literal font-size, and no literal animation
  duration; each such value references a custom property

#### Scenario: The shimmer duration token is defined in theme.css
- **WHEN** `theme.css` is inspected
- **THEN** `--app-skeleton-shimmer` is defined once, theme-invariantly, alongside the other motion tokens

#### Scenario: The shimmer is neutral, not accent-tinted
- **WHEN** the shimmer background is inspected
- **THEN** it references only neutral surface tokens, never `--app-accent*`

### Requirement: The shimmer is genuinely disabled under prefers-reduced-motion
`Skeleton.css` SHALL carry its own `@media (prefers-reduced-motion: reduce)` block that sets
`animation: none` on the skeleton and resets it to a flat, static surface fill. The global reduced-motion
rule in `theme.css`, which only collapses `animation-duration` to `0.01ms` and
`animation-iteration-count` to `1`, SHALL NOT be relied upon for this: the animation still runs once, and
with the default `animation-fill-mode: none` the element then reverts to its base computed style, leaving
the gradient visible at its base position as a static, lopsided highlight rather than a neutral
placeholder.

The mitigation SHALL be expressed as the `animation` shorthand or an explicit `animation-name: none`,
because the global rule's `animation-duration: 0.01ms` carries `!important` and cannot be overridden by a
normal declaration; `animation-name` is the one longhand that rule does not set, so a duration-based or
iteration-count-based mitigation would silently have no effect.

#### Scenario: The stylesheet disables the animation outright under reduced motion
- **WHEN** `Skeleton.css`'s `prefers-reduced-motion: reduce` block is inspected
- **THEN** it sets the `animation` shorthand, or `animation-name`, to `none` for the skeleton
- **AND** it sets a flat, non-gradient background so no highlight position remains visible

#### Scenario: The mitigation does not rely on a declaration the global rule outranks
- **WHEN** the reduced-motion block is inspected
- **THEN** it does not rely solely on `animation-duration` or `animation-iteration-count`, which the
  global rule sets with `!important`

#### Scenario: Reduced motion is not merely a slower shimmer
- **WHEN** the skeleton is rendered under `prefers-reduced-motion: reduce`
- **THEN** no shimmer movement occurs at any speed, and the placeholder is a uniform static fill

### Requirement: Skeletons are decorative; the loading announcement lives on the wrapper
Each rendered `Skeleton` SHALL carry `aria-hidden="true"`, mirroring the existing `Spinner` primitive's
contract that the loading state's accessible label lives on a sibling or ancestor element rather than on
the indicator itself. A surface that replaces its visible loading text with skeletons SHALL retain an
accessible loading name on the wrapper that contains them, so assistive technology announces one loading
state rather than one per placeholder, and never announces an empty region.

#### Scenario: An individual skeleton is not announced
- **WHEN** a `Skeleton` is rendered
- **THEN** it carries `aria-hidden="true"` and exposes no accessible name of its own

#### Scenario: The loading wrapper carries the accessible name
- **WHEN** a surface renders a group of skeleton placeholders during load
- **THEN** exactly one accessible loading name is exposed for that region

#### Scenario: A loading region is never announced as an error
- **WHEN** a surface renders its skeleton loading state
- **THEN** no element in that state carries `role="alert"`
