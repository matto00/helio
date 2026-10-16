## MODIFIED Requirements

### Requirement: The shimmer is genuinely disabled under prefers-reduced-motion
"Reduced motion in effect" means the user saved Motion = Off, or saved no motion choice while the OS reports `prefers-reduced-motion: reduce` (appearance-preferences). A saved Full or Subtle choice is not reduced motion, whatever the OS reports. When reduced motion is in effect, `Skeleton.css` SHALL set `animation: none` on the skeleton and reset it to a
flat, static surface fill, through its own two rules: one inside `@media (prefers-reduced-motion: reduce)` scoped to
`:root:not([data-motion])`, and one scoped to `:root[data-motion="off"]`. The global reduced-motion rule in
`theme.css`, which only collapses `animation-duration` to `0.01ms` and `animation-iteration-count` to `1`, SHALL
NOT be relied upon for this: the animation still runs once, and with the default `animation-fill-mode: none` the
element then reverts to its base computed style, leaving the gradient visible at its base position as a static,
lopsided highlight rather than a neutral placeholder.

The mitigation SHALL be expressed as the `animation` shorthand or an explicit `animation-name: none`, because the
global rule's `animation-duration: 0.01ms` carries `!important` and cannot be overridden by a normal declaration;
`animation-name` is the one longhand that rule does not set, so a duration-based or iteration-count-based mitigation
would silently have no effect.

#### Scenario: The stylesheet disables the animation outright under reduced motion
- **WHEN** `Skeleton.css`'s reduced-motion rules are inspected
- **THEN** both the OS-scoped and the `data-motion="off"` rule set the `animation` shorthand, or `animation-name`, to
  `none` for the skeleton
- **AND** they set a flat, non-gradient background so no highlight position remains visible

#### Scenario: The mitigation does not rely on a declaration the global rule outranks
- **WHEN** the reduced-motion rules are inspected
- **THEN** they do not rely solely on `animation-duration` or `animation-iteration-count`, which the global rule sets
  with `!important`

#### Scenario: Reduced motion is not merely a slower shimmer
- **WHEN** the skeleton is rendered with reduced motion in effect
- **THEN** no shimmer movement occurs at any speed, and the placeholder is a uniform static fill

#### Scenario: An explicit Full keeps the shimmer
- **WHEN** the user saved Motion = Full and the OS reports `prefers-reduced-motion: reduce`
- **THEN** the skeleton shimmer runs
