## ADDED Requirements

### Requirement: Phone pipeline detail header
At or below 768px, `/pipelines/:id` SHALL show a compact header: a back control to the pipelines list, the pipeline
name in the mono family on one line truncated with an ellipsis (full name in its title), one status line (run status
dot and label · rows written · relative last-run time · truncation badge, or the live run state while a run is queued
or running, followed by the schedule state: "Add schedule", the schedule summary, and a visible "Paused" marker when
paused, with the full state in its title, opening the schedule dialog), and a
"Pipeline actions" menu holding Rename, Edit source (exactly one resolvable root), Add source, Add Outputs from a
shape, Set/Edit schedule, Pause/Resume schedule (when a schedule exists) and Share (owner only). Rename SHALL swap the
name for the "Pipeline name" field with Save, Cancel and the discard confirmation. The cost-verdict denial and the
run-truncation notice SHALL show under the tabs only when present.

#### Scenario: Paused schedule visible
- **WHEN** a pipeline with a paused schedule is opened at 375px
- **THEN** the status line shows the schedule with a visible "Paused" marker

#### Scenario: Never-run pipeline
- **WHEN** a pipeline that has never run is opened at 375px
- **THEN** the header shows the back control, the mono name and the actions menu, and no last-run figures

### Requirement: Steps, Preview and Runs tabs
The phone page SHALL show a Steps / Preview / Runs tab strip implementing the ARIA tabs pattern (roving tabindex,
arrow/Home/End keys), with an active indicator that slides between tabs via the shared indicator-slide primitive.
Steps is active on load. A failed run's full error text SHALL stay reachable. Preview SHALL show a step chooser (default: the last step of the first source's trunk), that
step's output schema chips and its preview table. Runs SHALL show the run history list inline (the same list the
desktop Run history modal shows). Opening the page SHALL NOT issue any request that the Preview or Runs tab needs
before that tab is first activated.

#### Scenario: Runs tab
- **WHEN** the user activates Runs on a pipeline with past runs
- **THEN** the run history rows render in the tab and no Run history modal opens

### Requirement: Steps tab lists source, numbered steps and outputs
The Steps tab SHALL list each source as a card (mono name, kind, the source sample label with its refresh control, and
its "Source actions" menu with Edit source and Remove from pipeline; tapping the card edits the source when it resolves),
then the step count with the partial-count badge visible when the shown counts are partial, then each lane's steps as
numbered rows on a vertical line (title, one-line mono summary, row count, a chevron; at least 60px tall), branch lanes
as labelled sub-lists, a "+ Add step" row, then each Output as a card (tapping opens the Output editor; its menu keeps
"History for <name>") and a "New output" control. Page content
SHALL sit 12px from the screen edges. At 375×812 a pipeline with one source, three steps and one Output SHALL show the
source card, all three step rows and the Output card fully, above the floating action bar, without scrolling. The header's status line SHALL stay within two lines in every run
state (the run status and the last-run figures on one line that ellipsizes, with the Partial badge never clipped, and
the schedule state on the second). Extra or transient content is outside this one-screen check: the run-truncation
notice strip under the tabs, an analyze warning banner, and the rename or discard-confirmation rows.

#### Scenario: Three steps fit
- **WHEN** a three-step, one-Output pipeline is opened at 375×812 in either theme
- **THEN** the source card, the three step rows and the Output card are fully visible with the list scrolled to top

#### Scenario: Partial counts visible
- **WHEN** the latest run hit its row cap and the pipeline is opened at 375px
- **THEN** a visible partial-count badge is shown with the step count

### Requirement: Step editor sheet
Tapping a step row SHALL open that step's focused editor in a full-height bottom sheet (the shared swipe-dismissable
sheet), above that step's preview table, with a "Step actions" menu (Move up/down on trunk rows, Insert step
before/after on the first source's trunk, Branch from here, Add output) and the editor's Disable/Enable, Duplicate and
Remove. Every step kind SHALL be editable there. The sheet SHALL close by swipe-down and by a visible close control;
closing SHALL send any pending debounced edit. The open step SHALL be tracked by its render key, so an AI step's
temporary-to-server id swap keeps the sheet open; when an ordinary create is confirmed and its temporary step is
replaced by the server step, the sheet SHALL stay open on the confirmed step without closing or replaying its entrance;
removing the open step SHALL close the sheet. A step that appears
(added, inserted, branched, duplicated or created from a shape) SHALL open in the sheet once it exists.

#### Scenario: Added step stays open through confirmation
- **WHEN** the user appends a step with "+ Add step" and the server confirms it while its sheet is open
- **THEN** the sheet stays open on the confirmed step with no close or reopen

#### Scenario: Edit then swipe away
- **WHEN** a user edits a filter value in the sheet and swipes the sheet down
- **THEN** the sheet closes and the edit is saved

### Requirement: Floating run pills with clearance
The phone page SHALL float a Dry run pill (secondary, opaque) and a Run pipeline pill (the page's only accent-filled
control) above the glass bottom navigation, with no footer bar. Both SHALL be disabled while a run is queued or
running. The scrolling content SHALL have bottom padding of at least the action bar's measured height plus a gap, so
that scrolled to the end the last item ends above the action bar, and the action bar SHALL end above the navigation's
top edge. The action bar SHALL reserve an empty, zero-height `draft-status` slot above the pills for the draft-mode status, Discard
and Save & run of HEL-1631, and its clearance SHALL follow its height.

#### Scenario: Last item clears the pills
- **WHEN** a pipeline with enough steps to scroll is scrolled to the end at 375×812
- **THEN** the last list item's bottom edge is above the action bar's top edge, which is above the nav's top edge

### Requirement: Phone touch floor and state contrast
Every interactive element on the phone page, in each tab and in the open step sheet, SHALL meet the 44px touch floor
at 375, 390 and 768px wide, verified with the shared touch-target probe and tap-expander utilities. Phone hover, focus
and pressed states of the new controls SHALL clear a 1.10 state-surface ratio against their backdrop, 4.5:1 for text
and 3:1 for non-text indicators, measured from rendered pixels in both themes. One named exception: the Run pipeline
pill's hover text in the light theme is the product-wide `--app-accent-ink` on `--app-accent-strong` pair, measured at
3.95:1 (follow-up candidate FU-3, shared with the desktop primary button and the modal primary button); it SHALL stay
at or above 3.9:1 until that token pair is fixed, and every other state and theme of the pill SHALL clear 4.5:1.

#### Scenario: Touch floor sweep
- **WHEN** the touch-target probe sweeps the Steps tab and the open sheet at 375px
- **THEN** every interactive element's hit area is at least 44×44px

### Requirement: River view and phone footer are retired
The pre-HEL-1579 river view, the phone header and footer bars and the phone Outputs gallery tab SHALL NOT exist. In
every "Layout scope (HEL-1579)" paragraph of another capability that describes "the phone layout (at or below 768px,
the river view), which is unchanged", the river-placement wording is superseded by this capability, but every
obligation of the paragraph's desktop side that is not about placement SHALL also apply at or below 768px unless this
capability says otherwise — including truncation context on row counts, the page-boot request bound, the
create-in-flight guard, inline validation, warnings and schema-diff display on every lane, and schedule-state
visibility.

#### Scenario: No river at phone width
- **WHEN** any pipeline is opened at 390px wide
- **THEN** no river, ribbon, river footer or Outputs gallery tab element is rendered

#### Scenario: Non-layout obligations carry over
- **WHEN** a step on a branch lane has a validation error and the pipeline is opened at 390px
- **THEN** that step's row shows the validation marker, as the desktop spine does
