# pipeline-detail-mobile-layout Specification

## Purpose
Defines the phone pipeline detail page (at or below 768px): a compact header, Steps / Preview / Runs tabs, a one-screen step list of source, numbered steps and outputs, a swipe-dismissable step editor sheet, and floating run pills with measured clearance above the glass nav.

## Requirements

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
numbered rows on a vertical line (title, one-line mono summary, row count — the draft's sample count, "saved → draft" when they differ, while a draft exists, as on desktop — a chevron; at least 60px tall), branch lanes
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
top edge. The action bar SHALL hold a `draft-status` slot above the pills that is empty and zero-height when there is no draft, and its
clearance SHALL follow its height. While the pipeline has an unsaved draft (see `pipeline-draft-mode-ui`), the slot SHALL show
"Draft · unsaved changes" and the pills SHALL be Discard (secondary, opaque) and Save & run (the page's only accent-filled
control) instead of Dry run and Run pipeline; Save & run SHALL be disabled while a save is in flight or a run is queued or running.

#### Scenario: Last item clears the pills
- **WHEN** a pipeline with enough steps to scroll is scrolled to the end at 375×812
- **THEN** the last list item's bottom edge is above the action bar's top edge, which is above the nav's top edge

#### Scenario: Draft pills on a phone
- **WHEN** a step's config is edited in the step sheet at 375px
- **THEN** the action bar's `draft-status` slot shows "Draft · unsaved changes", the pills are Discard and Save & run, and the last list item still clears the action bar

### Requirement: Phone touch floor and state contrast
Every interactive element on the phone page, in each tab and in the open step sheet, SHALL meet the 44px touch floor
at 375, 390 and 768px wide, verified with the shared touch-target probe and tap-expander utilities. Phone hover, focus
and pressed states of the new controls SHALL clear a 1.10 state-surface ratio against their backdrop, 4.5:1 for text
and 3:1 for non-text indicators, measured from rendered pixels in both themes, with no named exception: the Run
pipeline pill's hover text SHALL clear 4.5:1 in both themes like every other state. The Dry run pill's hover fill SHALL
also differ from its own rest fill by at least 1.10:1 in both themes, so the hover is visibly distinct.

#### Scenario: Touch floor sweep
- **WHEN** the touch-target probe sweeps the Steps tab and the open sheet at 375px
- **THEN** every interactive element's hit area is at least 44×44px

#### Scenario: Run pipeline pill hover text has no exception
- **WHEN** the Run pipeline pill is hovered in the light and the dark theme
- **THEN** its text measures at least 4.5:1 against the rendered hover fill

#### Scenario: Dry run hover is distinct from rest
- **WHEN** the Dry run pill is hovered in the light and the dark theme
- **THEN** the rendered hover fill measures at least 1.10:1 against the rendered rest fill

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

### Requirement: A step deep link opens the step sheet on a phone
On the phone layout, loading the pipeline page with a `step` URL search parameter that names an existing step (by id,
or by the render key of a created step) SHALL open that step's editor sheet once the steps have loaded. While the
sheet is open the `step` parameter SHALL name the open step; closing the sheet SHALL remove the parameter. The
parameter SHALL be written with history replacement, never adding history entries, and SHALL never clobber other
search parameters (such as `outputId`). A `step` value that names no step SHALL open no sheet and SHALL be removed.
The deep link is consumed once, at the page's first steps load: switching from the desktop layout to the phone layout
on the same page (a resize or rotation) SHALL NOT open a sheet. The desktop layout keeps selecting the named step and
opens no sheet; switching from phone to desktop with a sheet open selects that step.

#### Scenario: Phone deep link opens the sheet
- **WHEN** a pipeline with three steps is opened at 375px with `?step=<id of step 2>`
- **THEN** step 2's editor sheet is open once the page has loaded

#### Scenario: Closing the sheet clears the parameter
- **WHEN** the deep-linked sheet is closed with its close control
- **THEN** the sheet is closed and the URL has no `step` parameter, with other parameters unchanged

#### Scenario: Removing the open step clears the parameter
- **WHEN** the open step is removed from the sheet's menu
- **THEN** the sheet closes and the URL has no `step` parameter

#### Scenario: Desktop to phone switch opens no sheet
- **WHEN** a step is selected on the desktop layout and the viewport is then narrowed to 375px
- **THEN** no sheet opens

#### Scenario: Unknown step
- **WHEN** the phone page is opened with `?step=` naming no step
- **THEN** no sheet opens and the `step` parameter is removed

### Requirement: Escape on a popover inside the step sheet closes only the popover
While a popover opened from inside the open step sheet (the output schema panel) is open, pressing Escape SHALL close
that popover only, return focus to its trigger, and leave the sheet open. A second Escape SHALL then close the sheet
as before.

#### Scenario: Escape on the schema panel
- **WHEN** the output schema panel is open inside the step sheet and the user presses Escape
- **THEN** the panel closes, focus is on the panel's trigger, and the sheet is still open

### Requirement: Pipeline page hover fills apply only on hover-capable pointers
Hover-only fills and colour changes defined by the pipeline detail page's own styles (phone and desktop spine, the
step sheet's pipeline content, preview table, schema disclosure) SHALL apply only when the primary input can hover,
so that a touch tap never leaves a hover fill behind. Focus, expanded, selected and pressed states SHALL be
unaffected. Hover REVEALS of a row's drag grip or actions menu, together with the backing and row tones the compact
spine shows with a revealed menu, are not fills and SHALL keep working on touch devices exactly as before, so the step
menu stays reachable and the tapped row keeps its tone on a touch tablet in the compact spine.

#### Scenario: No sticky fill after a tap
- **WHEN** a step row is tapped on a touch device whose primary pointer cannot hover and the sheet is then closed
- **THEN** the step row has its rest background, not its hover background

#### Scenario: Compact spine menu on a touch tablet
- **WHEN** a compact spine row is tapped at 1024×800 on a touch device whose primary pointer cannot hover
- **THEN** that row's step actions menu is visible and can be opened, and the row's and menu backing's backgrounds are
  the same as before this change, in light and dark

#### Scenario: Desktop hover unchanged
- **WHEN** a mouse hovers a step row on a hover-capable device
- **THEN** the step row shows its hover fill as before

### Requirement: Spine copy is unambiguous and the last-run time is never clipped away
The source card SHALL name a source's kind exactly once: when the sample label's text already starts with the kind
label, the card SHALL omit its kind meta line; in every other label state (loading, unavailable, truncated) the meta
line stays. The phone header's last-run line SHALL keep the relative time fully visible
when the row count is long (an 8-digit count at 375px), hiding the whole row-count part instead (it is shown complete or not at all, never as a fragment); the full figures stay
in the line's title.

#### Scenario: Static named once
- **WHEN** a pipeline whose source is a static dataset is shown on the spine (phone or desktop)
- **THEN** the source card shows "Static" exactly once

#### Scenario: Static named once while loading or truncated
- **WHEN** a static source's sample is loading, or its sample is truncated
- **THEN** the source card still shows "Static" exactly once, on its meta line

#### Scenario: Long row count at 375px
- **WHEN** the last run wrote 12,345,678 rows and the phone page is shown at 375px
- **THEN** the relative time of the last run is fully visible in the header

#### Scenario: Long row count on desktop
- **WHEN** the same pipeline is shown at 1000px and 1280px
- **THEN** the relative time of the last run is fully visible in the header

#### Scenario: Last-run meta hidden rather than clipped on a narrow desktop page
- **WHEN** the desktop page container is 685px wide or less (about a 905-990px window with the context list open)
- **THEN** the header's last-run line is hidden rather than shown as a clipped fragment, and above that width it keeps room for the longest relative time

#### Scenario: A hidden row count gives its width back
- **WHEN** the last-run row count does not fit beside the relative time on a desktop page (for example 1280px wide with the context list open)
- **THEN** the line takes no more room than the time needs, so the pipeline name is not truncated beside blank space, and the count appears whenever there is room (for example at 1440px)

#### Scenario: Static source card label clears the name button on the phone
- **WHEN** the phone source card omits its kind meta line
- **THEN** the sample label sits far enough below the source name button that their 44px tap expanders do not overlap

### Requirement: An editor's phone sample refresh is covered end to end
An editor grantee on a shared pipeline SHALL be able to refresh a source's sample from the phone source card: one
click SHALL send exactly one pipeline-scoped sample request that succeeds, and the sample label SHALL still render
afterwards.

#### Scenario: Editor refreshes on a phone
- **WHEN** an editor grantee opens a shared pipeline at 375px and activates "Refresh sample of <source>"
- **THEN** exactly one sample request carrying the pipeline scope is sent and answered 200, and the label still shows
