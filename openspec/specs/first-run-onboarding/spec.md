# first-run-onboarding Specification

## Purpose
The guided first-run checklist that teaches the source -> pipeline -> type -> panel model: when it appears,
how each step's completion is derived and actioned, how dismissal persists per user, and how it re-opens.

## Requirements

### Requirement: The checklist is presented whenever it is active, and activation is distinct from content

The system SHALL distinguish three separate notions and SHALL NOT conflate them: whether the checklist is
currently **active**, whether it has been **dismissed** for this user, and whether the conditions that
**automatically activate** it are met.

The checklist SHALL be presented whenever it is active. Once active, it SHALL remain active until the user
dismisses it. Creating a resource SHALL NOT end it — a checklist that disappears when the user completes one
of its own steps cannot function as a checklist, and would leave the remaining steps untaught.

Completing every step SHALL record the dismissal, so the checklist does not return automatically, but SHALL
NOT itself remove the checklist from the screen. Removing it at that moment would mean the completion is
never seen, and would leave the re-open affordance presenting nothing at all for any user whose account
already has all four resources.

Automatic activation SHALL occur when the dashboard collection has completed a fetch and returned nothing
and no dismissal is stored for that user. An unstarted collection SHALL NOT be treated as an empty one; the
two are indistinguishable by item count alone, so activating on counts without consulting fetch status would
present the checklist to every returning user on first paint.

Activation SHALL NOT wait on any collection the host surface does not already fetch. Waiting would paint the
ordinary zero-content empty state — including its own create action, which is one of the checklist's own
steps — for a full network round trip before the checklist replaced it, inviting the user to skip the lesson
before it appears.

Visibility SHALL be derived such that the checklist renders on the same frame the superseded empty state
would otherwise have first rendered on, rather than one frame later.

#### Scenario: An account with no dashboards activates the checklist automatically
- **WHEN** a signed-in user's dashboard fetch has completed and returned nothing
- **AND** no dismissal is stored for that user
- **THEN** the checklist is activated and presented

#### Scenario: The superseded empty state never paints first
- **WHEN** the dashboard fetch resolves with no dashboards for a user who has not dismissed the checklist
- **THEN** the checklist is what renders in that region, and the zero-content empty state it supersedes is
  never displayed first

#### Scenario: Completing a step does not end the checklist
- **WHEN** the checklist is active and the user creates a data source, a pipeline, or a dashboard
- **THEN** the checklist remains active and presented, with that step now shown complete

#### Scenario: An unstarted fetch does not activate the checklist
- **WHEN** the dashboard or data-source collection has not yet completed a fetch
- **THEN** the checklist is not activated, regardless of how many items are currently held

#### Scenario: A returning user with a dashboard is not activated automatically
- **WHEN** a signed-in user has at least one dashboard
- **THEN** the checklist is not activated automatically

#### Scenario: A stored dismissal suppresses automatic activation
- **WHEN** a dismissal is stored for the signed-in user and that user's account is otherwise empty
- **THEN** the checklist is not activated automatically

#### Scenario: Completing every step records the dismissal but keeps the checklist on screen
- **WHEN** the checklist is active and all four steps have become complete
- **THEN** the checklist remains presented, showing every step complete, and is not presented again
  automatically on a later load

#### Scenario: A user who re-opens with everything already complete sees the same completed chain
- **WHEN** a user whose account already has all four resources re-opens the checklist
- **THEN** the same four-step chain is presented with every step shown complete

### Requirement: Reported collections are fetched and no gate depends on its own fetch

The system SHALL fetch every collection the checklist reports on. Where the surface hosting the checklist does not already fetch a collection a step depends on, the system
SHALL fetch it, so no step reports a completion state that was never observed.

The condition that triggers those fetches SHALL be derivable from collections the host surface already
fetches, and SHALL NOT depend on the result of a fetch it is itself responsible for triggering. Such a
condition can never become true, and the checklist would never appear for any user.

While a step's underlying collection is unstarted or in flight, that step SHALL render an indeterminate
state, distinct from both complete and incomplete, and SHALL NOT be rendered as an empty unchecked step. The
step's action SHALL remain available while indeterminate, since creating that resource is valid regardless.

Where a step's collection **failed** to load, that step SHALL report its completion as unknown and SHALL NOT
report it as incomplete. Reporting it incomplete asserts as fact that the user has not created something
they may well have created, and because an already-attempted fetch is not retried automatically, that
assertion would never correct itself. The failed step SHALL surface the failure with a retry that
re-attempts its fetch, rather than absorbing it silently — this surface is not exempt from the rule that a
failed fetch is never swallowed.

#### Scenario: A step checks off when its resource exists
- **WHEN** the user creates a data source, a pipeline, a dashboard, or a panel
- **THEN** the corresponding step is shown as complete without the user reloading the page

#### Scenario: Collections the host surface does not fetch are fetched by the checklist
- **WHEN** the checklist's fetch trigger is met on a surface that does not already fetch data sources or
  pipelines
- **THEN** those collections are fetched, so their steps report observed state

#### Scenario: Re-opening fetches too, so no step stays indeterminate
- **WHEN** a user with dashboards re-opens the checklist and the data-source and pipeline collections are
  unstarted
- **THEN** both are fetched and both steps resolve to a definite state

#### Scenario: An already-loaded collection is not fetched again
- **WHEN** the checklist becomes visible and a collection it reports on has already loaded
- **THEN** that collection is not fetched a second time

#### Scenario: The fetch trigger does not depend on the fetch it triggers
- **WHEN** the condition for dispatching a collection's fetch is evaluated
- **THEN** that condition does not require that same collection to have already completed a fetch

#### Scenario: An unresolved collection renders as indeterminate, with its action still available
- **WHEN** a step's underlying collection is unstarted or in flight
- **THEN** that step renders in an indeterminate state rather than as incomplete, and its action can still
  be activated

#### Scenario: A failed collection is not reported as incomplete
- **WHEN** the fetch for a step's underlying collection fails
- **THEN** that step does not display as incomplete, and the failure is surfaced with a retry

#### Scenario: Retrying a failed collection re-attempts its fetch
- **WHEN** the user activates the retry on a step whose collection failed
- **THEN** that collection is fetched again and the step resolves to a definite state on success

### Requirement: Dismissal persists per user and the checklist can be re-opened from anywhere

The checklist SHALL be dismissible without blocking any other use of the workspace, and its dismissal SHALL
persist across reloads for the signed-in user individually, so one user's dismissal on a shared browser does
not suppress the checklist for another.

The system SHALL provide an affordance that re-opens the checklist. Re-opening SHALL activate the checklist
directly, without regard to whether the account still has content, and SHALL bring the user to the surface
that presents it. An affordance that mutates stored state but presents nothing — because the user has
content and the surface only renders when empty — SHALL NOT be shipped.

The stored dismissal SHALL have a single owner. Where one component holds it in local state while another
writes the underlying storage directly, a dismissal issued after a re-open is silently lost: the holder is
not re-rendered by the other's write, so setting it again is a no-op and nothing is persisted. Every reader
and writer SHALL therefore go through the same shared state, and the re-open affordance SHALL request the
change rather than writing storage itself.

A failure to read or write the stored dismissal SHALL NOT prevent the workspace from rendering.

#### Scenario: Dismissal survives a reload for that user
- **WHEN** a user dismisses the checklist and reloads the workspace
- **THEN** the checklist is not presented again for that user

#### Scenario: One user's dismissal does not suppress another's checklist
- **WHEN** one user has dismissed the checklist and a different user signs in on the same browser
- **AND** the second user's account is empty
- **THEN** the second user is presented with the checklist

#### Scenario: Re-opening works for a user who already has content
- **WHEN** a user with dashboards and panels activates the getting-started affordance
- **THEN** the checklist is activated and presented, with its completed steps shown complete

#### Scenario: Dismissing again after a re-open still persists
- **WHEN** a user dismisses the checklist, re-opens it from the affordance without leaving the surface, and
  dismisses it a second time
- **THEN** the dismissal is stored, and the checklist is not presented again after a reload

#### Scenario: Unavailable storage does not break the workspace
- **WHEN** reading or writing the stored dismissal raises an error
- **THEN** the workspace still renders

### Requirement: The checklist teaches the source-to-output-to-dashboard model in words and in glyphs
The checklist SHALL present exactly three steps — connect a source, shape it into outputs, place them on a dashboard — with every glyph derived from the nav section registry (not a bypass constant, closing HEL-794). The closing copy SHALL name all five nav destinations (Dashboards, Data Sources, Data Pipelines, Connectors, Assistant) so the icon-only mobile nav is fully covered (closing the surviving half of HEL-793).

#### Scenario: Three-step model replaces the four-step one
- **WHEN** the onboarding checklist renders
- **THEN** exactly three steps are shown: connect a source, shape it into outputs, place them on a dashboard
- **AND** no step references Types or Metrics

#### Scenario: Every step glyph comes from the section registry
- **WHEN** the checklist renders its step icons
- **THEN** each icon is read from `sections.ts`'s registry entries, not a separate hardcoded icon

#### Scenario: Closing copy names all five destinations
- **WHEN** the checklist reaches its closing/completion copy
- **THEN** the text names Dashboards, Data Sources, Data Pipelines, Connectors, and Assistant

### Requirement: Each of the three steps' actions opens that step's real creation flow
Each step's action SHALL open that step's real creation flow: a step whose flow is mounted at the shell (e.g. a modal) opens in place; a step whose flow is mounted elsewhere (e.g. a full page) navigates to that page. The checklist SHALL NOT set a page-mounted flow's own visibility flag directly. A step whose precondition is unmet SHALL remain unavailable rather than opening a broken flow. The third step's ("place them on a dashboard") action SHALL open the Output picker (or a dashboard on which the picker is available) — never the retired `PanelCreationModal`.

#### Scenario: A step whose flow is mounted at the shell opens in place
- **WHEN** the user activates a step whose creation flow is a shell-mounted modal
- **THEN** that modal opens without a route navigation

#### Scenario: A step whose flow is mounted elsewhere navigates to that page
- **WHEN** the user activates a step whose creation flow lives on its own page
- **THEN** the user is navigated to that page

#### Scenario: The checklist never sets a page-mounted flow's visibility flag
- **WHEN** a step's flow is page-mounted
- **THEN** the checklist only navigates; it does not toggle that page's own open/visible state directly

#### Scenario: An unmet precondition leaves a step unavailable
- **WHEN** a step's precondition (e.g. at least one source exists, for the "shape it into outputs" step) is not met
- **THEN** that step's action remains unavailable rather than opening a flow that would immediately fail

#### Scenario: Third step opens the Output picker
- **WHEN** the user activates the third onboarding step's action
- **THEN** the Output picker opens (directly, or via navigating to a dashboard where it can be opened)

### Requirement: Done button is styled correctly and provably so
The onboarding checklist's Done button SHALL be styled per DESIGN.md, and SHALL be covered by a regression test that asserts **computed** styles (`getComputedStyle` in jsdom, or an equivalent rendered probe) — a test asserting only text content or a class name is not sufficient (closing HEL-792's second half). The test SHALL be proven red against a deliberately broken style cascade before being trusted.

#### Scenario: Computed-style guard catches a broken cascade
- **WHEN** the Done button's governing CSS rule is deliberately removed (test setup)
- **THEN** the regression test fails
- **AND** restoring the rule makes it pass again
