## MODIFIED Requirements

### Requirement: Hover emphasis is subtle and respects reduced motion
Series/point hover SHALL show a subtle highlight (series emphasis / point enlarge). When reduced motion is in effect,
the emphasis SHALL apply with no animated transition. "Reduced motion in effect" means the user saved Motion = Off, or saved no motion choice while the OS reports `prefers-reduced-motion: reduce` (appearance-preferences). A saved Full or Subtle choice is not reduced motion, whatever the OS reports.

#### Scenario: Hovering a series or point shows subtle emphasis
- **WHEN** the user hovers a series or a data point
- **THEN** that series/point is visibly, subtly highlighted (e.g. slightly enlarged or brightened) relative to its
  resting state

#### Scenario: Reduced-motion preference suppresses the emphasis transition
- **WHEN** the user's browser reports `prefers-reduced-motion: reduce` and the user saved no motion choice, or the user
  saved Motion = Off
- **THEN** the hover emphasis still applies but with no animated transition

#### Scenario: An explicit Full keeps the emphasis transition
- **WHEN** the user saved Motion = Full and the browser reports `prefers-reduced-motion: reduce`
- **THEN** the hover emphasis animates as for a user without reduced motion
