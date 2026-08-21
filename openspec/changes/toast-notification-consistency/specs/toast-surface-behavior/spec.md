## ADDED Requirements

### Requirement: Concurrent toasts are capped with oldest-first eviction
Toast state SHALL hold at most a fixed maximum number of concurrent toasts, except where the requirement below exempts
an entry from eviction. When a push would exceed that maximum, the oldest evictable toast SHALL be evicted so that the
newest feedback always remains visible. The cap SHALL be enforced in the
reducer, so that toast state itself never exceeds the maximum, rather than only in the rendered view.

#### Scenario: Pushing beyond the cap evicts the oldest
- **WHEN** more auto-dismissing toasts are pushed than the maximum
- **THEN** toast state holds exactly the maximum number of toasts
- **AND** the most recently pushed toasts are retained and the oldest are removed

#### Scenario: Pushing up to the cap evicts nothing
- **WHEN** exactly the maximum number of toasts is pushed
- **THEN** all of them are retained in push order

### Requirement: A non-auto-dismissing toast is exempt from eviction
Eviction SHALL target only auto-dismissing toasts. A toast that never auto-dismisses, or that carries an action the
user must be able to reach, SHALL NOT be evicted to make room for a newer toast, because destroying such an affordance
without user action would contradict the guarantee that a zero-duration toast persists. When every toast in state is
exempt, a new push SHALL still be admitted rather than dropped.

#### Scenario: A sticky action toast survives eviction pressure
- **WHEN** a toast with a zero duration and an action is present and enough further toasts are pushed to exceed the cap
- **THEN** the sticky toast is still present
- **AND** the evicted toast is the oldest auto-dismissing one

#### Scenario: An all-exempt state still accepts a new toast
- **WHEN** the cap is reached and every toast in state is exempt from eviction
- **THEN** the newly pushed toast is still added

### Requirement: An identical repeated message is coalesced rather than stacked
When a toast is pushed whose intent and message exactly match a toast already in state, the existing toast SHALL be
replaced by the new one rather than stacked alongside it, and the replacement SHALL restart that toast's auto-dismiss
timer and move it to the newest position.

#### Scenario: A repeated identical failure does not stack
- **WHEN** the same intent and message are pushed twice in succession
- **THEN** toast state holds exactly one toast with that intent and message

#### Scenario: A different message still stacks
- **WHEN** two toasts with different messages are pushed
- **THEN** toast state holds both

### Requirement: One auto-dismiss default applies to every intent
Toasts SHALL auto-dismiss after a single default duration that is identical for every intent, and that default SHALL be
applied when a toast is created so that stored toast state carries its effective duration. A caller MAY override the
duration, and a duration of zero SHALL mean the toast never auto-dismisses.

#### Scenario: A pushed toast carries the default duration
- **WHEN** a toast is pushed without an explicit duration
- **THEN** the stored toast carries the default duration

#### Scenario: An explicit duration is preserved
- **WHEN** a toast is pushed with an explicit duration
- **THEN** the stored toast carries that duration

#### Scenario: A zero duration never auto-dismisses
- **WHEN** a toast is pushed with a duration of zero
- **THEN** no auto-dismiss timer is started for it

### Requirement: Live-region politeness follows toast intent
Toast announcement SHALL use live regions that are mounted before any toast exists, so that announcement never depends
on a live region being created together with its content. The toast viewport SHALL mount a polite region
(`role="status"`, `aria-live="polite"`) and an assertive region (`role="alert"`, `aria-live="assertive"`) from first
render. An `error` toast's message SHALL be rendered into the assertive region and every other intent's into the polite
region. The visible toast element SHALL NOT itself carry a live-region role, so that no message is announced twice.
Every toast SHALL expose a dismiss control with an accessible name, and SHALL be reachable and operable by keyboard.

#### Scenario: Both live regions exist before any toast
- **WHEN** the toast viewport is rendered with no toasts present
- **THEN** a polite live region and an assertive live region are both present

#### Scenario: An error message is routed to the assertive region
- **WHEN** a toast with the `error` intent is pushed
- **THEN** its message appears in the assertive region and not in the polite region

#### Scenario: Other intents are routed to the polite region
- **WHEN** a toast with the `success`, `info`, or `warning` intent is pushed
- **THEN** its message appears in the polite region and not in the assertive region

#### Scenario: The visible toast is not a second live region
- **WHEN** any toast is rendered
- **THEN** the visible toast element carries no `aria-live` or live-region role of its own

#### Scenario: The visible message is not encountered twice
- **WHEN** a toast is rendered and its message also exists in a live region
- **THEN** the visible copy of the message is hidden from assistive technology
- **AND** the toast's action and dismiss controls remain reachable

#### Scenario: A coalesced repeat does not silently drop its announcement
- **WHEN** an identical `variant` and `message` is pushed while the earlier one is still present
- **THEN** the surviving toast's message is still present in its intent's live region

### Requirement: The toast surface follows the design token and motion contract
The toast surface SHALL be rendered bottom-right on an opaque strong surface token, with its intent accent drawn from
the intent tokens, and SHALL use no hardcoded colour, spacing, or type value where a token applies. It SHALL have a
single entrance animation, using the slow-transition token reserved for entrances.

#### Scenario: The surface uses tokens
- **WHEN** the toast stylesheet is inspected
- **THEN** every colour, spacing, and type value for which a design token applies resolves to that token rather than a
  literal, excluding values the design standard explicitly blesses as literal

#### Scenario: One entrance animation
- **WHEN** a toast is rendered
- **THEN** it plays a single entrance animation

### Requirement: Reduced motion disables toast animation rather than shortening it
When reduced motion is preferred, the toast entrance and exit animations SHALL be disabled outright, and the delay
between initiating a dismissal and removing the toast from state SHALL be elided, so that a dismissed toast does not
remain occupying layout while invisible.

#### Scenario: Animations are disabled under reduced motion
- **WHEN** reduced motion is preferred
- **THEN** the toast entrance and exit animations are disabled

#### Scenario: Dismissal is immediate under reduced motion
- **WHEN** reduced motion is preferred and a toast is dismissed
- **THEN** it is removed from toast state without waiting for an exit animation delay

### Requirement: The toast stack does not obscure mobile navigation
At mobile breakpoints the toast viewport SHALL be offset above the fixed bottom navigation bar, including any device
safe-area inset, so that toasts never cover the navigation controls. The dismiss control SHALL meet the mobile
tap-target floor at those breakpoints.

#### Scenario: Toasts clear the bottom navigation on a phone
- **WHEN** a toast is displayed at a mobile viewport width
- **THEN** the toast viewport is offset above the bottom navigation bar and its safe-area inset

#### Scenario: The dismiss control meets the tap-target floor
- **WHEN** a toast is displayed at a mobile viewport width
- **THEN** its dismiss control meets the mobile minimum tap-target size
