## MODIFIED Requirements

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
the rows exceed the toast's maximum height they SHALL scroll inside the toast. A toast carrying an
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
