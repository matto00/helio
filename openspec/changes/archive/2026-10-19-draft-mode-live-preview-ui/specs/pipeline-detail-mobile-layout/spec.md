## MODIFIED Requirements

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
