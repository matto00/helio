# run-to-update-affordance Specification

## Purpose
Surfaces, on both the writing panel and the pipeline's own page, the specific rule that denied a
pipeline's auto-run, and offers a "Run to update" action that submits a manual run through the
existing guarded run path when the caller is permitted to trigger it.

## Requirements

### Requirement: A denied write surfaces a toast naming the specific denying rule
When a dataset write's response includes one or more denied downstream pipelines, the frontend
SHALL push exactly one toast for that write. Its message SHALL name, for each denied pipeline, a
specific rule-derived sentence drawn from a rule-code-to-copy mapping covering every
`CostReason.code` the estimator can produce (`ai-step`, `writeback-step`, `content-conversion`,
`unclassified-op`, `remote-fetch`, `unclassified-source`, `no-roots`, `row-estimate-unavailable`,
`rows-above-threshold`, `steps-above-bound`) — never a single generic "couldn't update" message.
When exactly one pipeline was denied and the response's `canRun` for it is true, the toast SHALL
carry a "Run to update" action; when exactly one pipeline was denied and `canRun` is false, the
toast SHALL carry no action. When two or more pipelines were denied, the toast SHALL list every
denied pipeline (none truncated) as a row whose pipeline name is a link to that pipeline's page
(`/pipelines/<id>`), followed by that pipeline's reason text; each row whose pipeline the writer
`canRun` SHALL also carry its own "Run to update" action that runs only that pipeline, and a row
whose `canRun` is false SHALL carry the link but no run action. Activating a row's "Run to update"
SHALL remove that row's action, and when no row action remains the toast SHALL be dismissed. When
the rows exceed the toast's maximum height they SHALL scroll inside the toast, and while rows remain
below the visible area the list SHALL show a bottom-edge fade cue drawn in the toast surface color;
a list that fits SHALL show no cue. The rows SHALL be ordered by pipeline name (English, numeric-aware
collation) with the pipeline id as the tie-break, and the toast message SHALL list the pipelines in that same
order. At phone width the first row SHALL line up with the variant icon as a single-message toast's
text does. A toast carrying an
action or a pipeline link SHALL NOT auto-dismiss.

#### Scenario: A single AI-step denial shows specific copy and a run action
- **WHEN** a form submit's response denies exactly one downstream pipeline with reason code
  `ai-step`, and the caller `canRun` for that pipeline
- **THEN** a toast is shown whose message names that the pipeline calls AI (not a generic message),
  carrying a "Run to update" action, and the toast does not auto-dismiss

#### Scenario: An unclassifiable-op denial gets honest, non-generic copy
- **WHEN** a form submit's response denies a pipeline with reason code `unclassified-op`
- **THEN** the toast names the unrecognized step rather than a generic "something went wrong"
  message

#### Scenario: Multiple denied pipelines from one write produce one toast, no action
- **WHEN** a form submit's response denies two different downstream pipelines with different
  reasons, and `canRun` is false for both (the writer holds only viewer grants on them)
- **THEN** exactly one toast is shown listing both pipelines' specific reasons, each pipeline's
  name is a link to its own pipeline page, the toast carries no "Run to update" action, and the
  toast does not auto-dismiss

#### Scenario: Each runnable pipeline in a multi-denial toast gets its own run action
- **WHEN** a form submit's response denies two pipelines, the writer `canRun` the first and not
  the second
- **THEN** the first pipeline's row carries a "Run to update" action that submits a run of that
  pipeline only, and the second pipeline's row carries a link but no run action

#### Scenario: Using every row action dismisses the multi-denial toast
- **WHEN** the user activates "Run to update" on a row of a multi-denial toast
- **THEN** that row no longer offers the action, the other rows are unchanged, and once no row
  action remains the toast is dismissed

#### Scenario: Rapid repeated writes with an identical denial do not stack toasts
- **WHEN** several dataset writes in quick succession each deny the same pipeline or the same set
  of pipelines for the same reasons
- **THEN** toast state holds exactly one toast for that denial, not one per write

#### Scenario: A viewer without run permission sees the reason but no action
- **WHEN** a form submit's response denies exactly one pipeline and `canRun` is false for the
  submitting user
- **THEN** the toast names the specific denying rule but carries no "Run to update" action

#### Scenario: A write denying only pipelines the writer cannot see produces no toast
- **WHEN** a form submit's response has no entries in `deniedPipelines` (every denied downstream
  pipeline was omitted server-side because the writer has no grant on any of them)
- **THEN** no denial toast is shown for that write

#### Scenario: Multi-denial rows are ordered by pipeline name, then id
- **WHEN** a write denies pipelines named "Zeta", "alpha" and "Beta" whose ids sort in a different
  order, and two further pipelines share the name "Gamma"
- **THEN** the rows render as alpha, Beta, Gamma, Gamma, Zeta, the two "Gamma" rows are ordered by
  pipeline id, Tab reaches the rows in that rendered order, and the toast message lists the
  pipelines in that same order

#### Scenario: The same denial set in any input order coalesces into one toast
- **WHEN** two writes deny the same pipelines for the same reasons but the response lists them in
  different orders
- **THEN** both builds produce a byte-identical message and toast state holds exactly one toast

#### Scenario: The first row lines up with the icon at phone width
- **WHEN** a multi-denial toast is shown at 390px width in either theme
- **THEN** the first row's link text sits at the same vertical offset from the variant icon as a
  single-message toast's text does, within 1px, every link and action keeps its 44px touch extent,
  and no row content paints at or above the toast's top border in any scroll position

#### Scenario: An overflowing row list shows a cue that more rows are below
- **WHEN** a multi-denial toast's rows exceed the list's maximum height and the list is not
  scrolled to its end
- **THEN** a bottom-edge fade in the toast's surface color is shown over the list, and it is gone
  once the list is scrolled to its end

#### Scenario: A row list that fits shows no overflow cue
- **WHEN** a multi-denial toast's rows fit within the list's maximum height
- **THEN** no overflow fade is shown

### Requirement: The pipeline's own page shows why auto-run is denied and offers a manual run
When a pipeline's analyze response has `costVerdict.autoRunnable` false, the pipeline detail page
SHALL render each reason using the same rule-code-to-copy mapping as the toast, and SHALL show a
"Run to update" control when `costVerdict.canRun` is true for the viewing user. A `step-config-invalid`
reason SHALL be rendered with copy that says a step has a problem and the pipeline's results may be wrong or
missing until that step is fixed, never the generic fallback message, and SHALL NOT claim the pipeline cannot run:
the reason is also emitted for analyze-only (schema-derived) step errors, for which manual, scheduled and
dataset-write runs still run.

#### Scenario: An AI-gated pipeline's page names the rule
- **WHEN** a pipeline's analyze response denies auto-run with reason code `ai-step`
- **THEN** the pipeline detail page displays that the pipeline calls AI, not a generic message

#### Scenario: A non-permitted viewer sees the reason without a run control
- **WHEN** a pipeline's analyze response denies auto-run and `costVerdict.canRun` is false for the
  viewing user
- **THEN** the denial reason is shown but no "Run to update" control is rendered

#### Scenario: A misconfigured step names the problem and offers no run control
- **WHEN** the owner's analyze response carries a `step-config-invalid` reason and `costVerdict.canRun` is false
- **THEN** the pipeline detail page shows the step-problem copy and no "Run to update" control is rendered

#### Scenario: The step-problem copy does not claim the pipeline cannot run
- **WHEN** the pipeline detail page renders a `step-config-invalid` reason
- **THEN** the copy reads "A step in this pipeline has a problem, so its results may be wrong or missing until that
  step is fixed." and contains no claim that the pipeline cannot run

### Requirement: A manual run from either surface uses the existing guarded submission path
Triggering "Run to update" from either the toast or the pipeline page SHALL submit through
`POST /api/pipelines/:id/run`, the same path every other manual run uses. A guard rejection (HTTP
429) SHALL render a message distinct from the gate-denial copy, naming that the run was rate- or
concurrency-limited rather than denied by the cheapness verdict. A successful run SHALL refresh any
bound panel through the existing pipeline run-status fan-out, without any change to that mechanism.

#### Scenario: A guard-rejected manual run shows a distinct message
- **WHEN** a "Run to update" action is triggered and the run submission is rejected with HTTP 429
- **THEN** the shown message states the run was rate- or concurrency-limited, not that the pipeline
  failed the cheapness verdict

#### Scenario: A successful manual run refreshes bound panels
- **WHEN** a "Run to update" action is triggered and the resulting run succeeds
- **THEN** a panel bound to that pipeline's Output refetches via the existing run-status fan-out,
  with no new refresh mechanism introduced

### Requirement: The denial reason and action are computed-ARIA accessible
The denial reason's presence and text, and the "Run to update" action's presence, SHALL be
exposed via a computed accessible state (name, description, or live-region announcement) on both
surfaces — the mere presence of the text in the DOM does not satisfy this requirement. The "Run to
update" action SHALL be keyboard-reachable and keyboard-operable on both surfaces. In a
multi-denial toast each pipeline link SHALL have the pipeline's name as its computed accessible
name, and each row's "Run to update" action SHALL have a computed accessible name that begins with
the visible label and names its pipeline, so identical visible labels remain distinguishable; every
link and action SHALL be reachable by Tab in row order. Activating a row's "Run to update" from the
keyboard SHALL leave focus on a control of that toast while any row remains, and SHALL never leave
focus on the document body when the toast is removed.

#### Scenario: A screen reader announces the denial reason
- **WHEN** a denial reason is shown on either surface
- **THEN** its text is exposed via a computed accessible name, description, or live-region
  announcement, verifiable via the browser's computed accessibility tree

#### Scenario: The run action is keyboard operable
- **WHEN** a "Run to update" action is rendered on either surface
- **THEN** it can be reached and activated using the keyboard alone

#### Scenario: Multi-denial rows are distinguishable to assistive technology
- **WHEN** a multi-denial toast lists two runnable pipelines
- **THEN** the computed accessibility tree exposes two links named after the pipelines and two
  "Run to update" buttons whose computed names each name their own pipeline

#### Scenario: Keyboard focus stays in the toast after a row's run action is used
- **WHEN** a keyboard user activates one row's "Run to update" in a multi-denial toast that still has
  another row
- **THEN** focus is on that row's pipeline link (a control inside the toast), not on the document
  body, and Tab then reaches the next row's controls

#### Scenario: Focus is not dropped when the last row action removes the toast
- **WHEN** a keyboard user activates the last remaining row "Run to update" and the toast is removed
- **THEN** focus moves to the control that had focus before entering the notifications region (or,
  if gone, another toast's control or the main content landmark), never the document body
