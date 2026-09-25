## ADDED Requirements

### Requirement: Output-bound panels expose a keyboard-accessible Refresh control
Every panel whose bound Output can be resolved (`getOutputId(panel)` is non-null) SHALL render a
keyboard-operable Refresh control in its `PanelCard` header with a non-empty accessible name
(DESIGN.md §8) that, when activated, immediately calls that panel's `usePanelData().refresh()`.
Panels with no resolvable Output (markdown, image, divider, form) SHALL NOT render this control.

#### Scenario: Activating Refresh re-fetches an output-bound panel
- **WHEN** a user activates the Refresh control (mouse click or Enter/Space via keyboard) on a
  panel bound to an Output
- **THEN** that panel's bound Output data is re-fetched (`GET /api/outputs/:id/rows` re-invoked)

#### Scenario: A non-output panel renders no Refresh control
- **WHEN** a `markdown`, `image`, `divider`, or `form` panel (no bound Output) is rendered
- **THEN** no Refresh control is present in that panel's header

### Requirement: In-flight refresh shows accent-spinner feedback without a full skeleton
While a fetch triggered by any refresh source (manual, interval poll, or pipeline-run-succeeded SSE
fan-out) is pending for an already-loaded panel, the Refresh control SHALL render the shared
border-spinner (DESIGN.md §7) in place of its icon and SHALL be disabled. `PanelContent`'s full
loading skeleton SHALL NOT be shown during this refresh (only on a panel's true first load, with no
data yet).

#### Scenario: Manual refresh shows a spinner, not a skeleton
- **WHEN** a user activates Refresh on a panel that already has loaded data
- **THEN** the Refresh control shows the accent border-spinner and is disabled until the fetch
  completes, and the panel's existing rendered content remains visible (no skeleton replaces it)

### Requirement: At most one fetch is ever in flight per panel, across all refresh triggers
For a given panel, while a fetch for its current bound Output is already in flight, a subsequent
activation of ANY refresh trigger (a repeat manual activation, an interval poll tick, or an SSE
fan-out event) SHALL NOT start a second, concurrent fetch for that panel. This guard applies
uniformly regardless of which trigger initiated the in-flight fetch.

#### Scenario: Repeat manual activation while loading is a no-op
- **WHEN** a user activates Refresh a second time while the first activation's fetch is still
  pending
- **THEN** no second fetch is dispatched, and the panel's data-fetch call count for that refresh
  cycle is exactly one

#### Scenario: Two same-tick activations (a genuine double-click) still dispatch only once
- **WHEN** the refresh trigger is activated twice synchronously, back-to-back, with no render or
  network round-trip between the two activations (a fast physical double-click, or a keyboard
  repeat)
- **THEN** exactly one fetch is dispatched — the guard is a synchronous check at the point of
  activation, not one that depends on a prior render or state update having already committed

#### Scenario: A poll tick during a manual refresh does not double-fetch
- **WHEN** the interval poll fires for a panel while a manual refresh for that same panel is still
  in flight
- **THEN** no second concurrent fetch is dispatched; polling resumes its normal cadence once the
  in-flight fetch completes

#### Scenario: An SSE fan-out event during a manual refresh does not double-fetch
- **WHEN** a pipeline-run-succeeded SSE fan-out event arrives for a panel while a manual refresh for
  that same panel is still in flight
- **THEN** no second concurrent fetch is dispatched
