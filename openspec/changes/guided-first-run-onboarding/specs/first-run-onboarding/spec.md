## ADDED Requirements

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

### Requirement: Each step's action opens that step's real creation flow

Each step SHALL open the same creation flow the workspace's own create action for that resource opens,
obtained from that resource's shared create action rather than re-derived by the checklist.

Where a step's flow is mounted by a page other than the one hosting the checklist, the step SHALL navigate
to that page, where that page's own create affordance opens the flow. The checklist SHALL NOT set a
page-mounted flow's visibility flag from a surface that does not mount that flow, in any form — including
setting it alongside a navigation, which leaves the mounting page rendering with the flag already set and so
exposed to an unmount cleanup running before the flow is ever seen.

A step whose precondition is unmet SHALL remain unavailable, exactly as the underlying create action
already reports.

#### Scenario: A step whose flow is mounted at the shell opens in place
- **WHEN** the user activates a step whose creation flow is mounted at the application shell
- **THEN** that flow opens without navigation

#### Scenario: A step whose flow is mounted elsewhere navigates to that page
- **WHEN** the user activates a step whose creation flow is mounted by another page
- **THEN** the workspace navigates to that page, where that page's own create affordance opens the flow

#### Scenario: The checklist never sets a page-mounted flow's visibility flag
- **WHEN** the user activates a step whose creation flow is mounted by another page
- **THEN** the checklist sets no visibility flag for that flow

#### Scenario: An unmet precondition leaves a step unavailable
- **WHEN** the panel step is reached with no dashboard selected
- **THEN** that step's action is unavailable, matching the underlying create action's own state

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

### Requirement: The checklist teaches the source-to-panel model in words and in glyphs

The checklist's copy SHALL name the workspace's four resources — data source, pipeline, type, and panel —
and SHALL state explicitly that a type is produced by a pipeline and cannot be created directly, because the
type registry offers no create path.

Because the workspace's phone navigation is icon-only, the vocabulary lesson SHALL bind each concept to the
glyph that navigation uses for it. Each step SHALL carry its section's own glyph, taken from the shared
section registry every other surface derives from rather than independently chosen, and the type concept
SHALL be shown with the registry's own glyph beside the sentence that explains it. Teaching the words while
leaving the glyphs unexplained would leave a user unable to map either onto the other.

The copy SHALL be brief enough to read at a glance, and SHALL be specific to this workspace's model rather
than generic encouragement. This SHALL hold for the completed state as much as for the steps: on completion
the surface SHALL restate the chain it just taught, rather than offering congratulation that names none of
the four resources.

#### Scenario: The copy states where types come from
- **WHEN** the checklist is presented
- **THEN** its pipeline step states that a type is a pipeline's output and is never created directly

#### Scenario: Each step carries its section's own glyph
- **WHEN** the checklist is presented
- **THEN** each step shows the same glyph the workspace navigation uses for that section, taken from the
  shared registry rather than chosen independently

#### Scenario: The type concept is shown with the registry glyph
- **WHEN** the checklist presents the step that explains what a type is
- **THEN** the type registry's own glyph is shown alongside that explanation

#### Scenario: The completed state restates the chain
- **WHEN** every step is complete
- **THEN** the surface names the four resources in order rather than offering generic congratulation
