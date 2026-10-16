## MODIFIED Requirements

### Requirement: Added bottom-nav motion respects reduced-motion preference
Any motion introduced by the floating tab bar SHALL be disabled outright when reduced motion is in effect, not merely
shortened, and SHALL be disabled by a declaration that clears the transition property rather than only its duration.
"Reduced motion in effect" means the user saved Motion = Off, or saved no motion choice while the OS reports `prefers-reduced-motion: reduce` (appearance-preferences). A saved Full or Subtle choice is not reduced motion, whatever the OS reports. This requirement constrains added motion; it does not mandate that motion exist — a per-tab lozenge does not
travel between tabs, so it may be satisfied vacuously. The active tab SHALL still be correctly indicated either way.

#### Scenario: Reduced motion disables any added transition
- **WHEN** reduced motion is in effect (OS reduce with no saved choice, or a saved Off) and the user switches tabs
- **THEN** no added transition runs on the active tab's lozenge — either because none was declared, or because the
  declared one is removed rather than shortened — and the correct tab is indicated
