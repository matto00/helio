## MODIFIED Requirements

### Requirement: Motion setting and reduced-motion precedence
The root SHALL carry `data-motion="full|subtle|off"` exactly when the user has saved a motion choice, and no
`data-motion` attribute otherwise. With no saved choice the OS `prefers-reduced-motion: reduce` setting SHALL produce
Off behaviour; an explicit saved choice SHALL beat the OS setting. Off SHALL reduce every animation and transition
driven by the motion tokens and the transition shorthands to a near-instant (0.01ms) change that still fires its end
event. Subtle SHALL keep fades and opacity changes and SHALL drop the overshoot curve, and for the shared motion
primitives SHALL also drop translation, scale, layout slide and value tweens. Every existing reduced-motion consumer
(CSS rules and script checks) SHALL follow the same precedence. The public landing page, which never carries saved
preferences, SHALL keep following the OS setting alone.

#### Scenario: Off disables token-driven motion
- **WHEN** the user selects Off
- **THEN** every element whose transition or animation uses a motion token or shorthand completes instantly

#### Scenario: No preference follows the OS
- **WHEN** a user with no saved motion choice has OS reduce-motion on
- **THEN** animations behave as Off

#### Scenario: Explicit Full beats the OS
- **WHEN** a user who saved Full has OS reduce-motion on
- **THEN** token-driven animations run at their normal durations

#### Scenario: Returning to the system default
- **WHEN** a user with a saved motion choice chooses to follow the system setting again
- **THEN** the saved choice is removed and the root carries no `data-motion`

#### Scenario: Subtle keeps fades and drops movement
- **WHEN** the user selects Subtle
- **THEN** primitive fades still animate, while primitive translation, scale, layout slides and value tweens are
  instant
