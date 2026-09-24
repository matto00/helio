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
carry a "Run to update" action; when zero or more than one pipeline was denied, or `canRun` is
false, the toast SHALL carry no action. A toast carrying that action SHALL NOT auto-dismiss.

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
  reasons
- **THEN** exactly one toast is shown listing both pipelines' specific reasons, and it carries no
  "Run to update" action

#### Scenario: Rapid repeated writes with an identical denial do not stack toasts
- **WHEN** several dataset writes in quick succession each deny the same pipeline for the same
  reason
- **THEN** toast state holds exactly one toast for that denial, not one per write

#### Scenario: A viewer without run permission sees the reason but no action
- **WHEN** a form submit's response denies exactly one pipeline and `canRun` is false for the
  submitting user
- **THEN** the toast names the specific denying rule but carries no "Run to update" action

#### Scenario: A write denying only pipelines the writer cannot see produces no toast
- **WHEN** a form submit's response has no entries in `deniedPipelines` (every denied downstream
  pipeline was omitted server-side because the writer has no grant on any of them)
- **THEN** no denial toast is shown for that write

### Requirement: The pipeline's own page shows why auto-run is denied and offers a manual run
When a pipeline's analyze response has `costVerdict.autoRunnable` false, the pipeline detail page
SHALL render each reason using the same rule-code-to-copy mapping as the toast, and SHALL show a
"Run to update" control when `costVerdict.canRun` is true for the viewing user.

#### Scenario: An AI-gated pipeline's page names the rule
- **WHEN** a pipeline's analyze response denies auto-run with reason code `ai-step`
- **THEN** the pipeline detail page displays that the pipeline calls AI, not a generic message

#### Scenario: A non-permitted viewer sees the reason without a run control
- **WHEN** a pipeline's analyze response denies auto-run and `costVerdict.canRun` is false for the
  viewing user
- **THEN** the denial reason is shown but no "Run to update" control is rendered

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
update" action SHALL be keyboard-reachable and keyboard-operable on both surfaces.

#### Scenario: A screen reader announces the denial reason
- **WHEN** a denial reason is shown on either surface
- **THEN** its text is exposed via a computed accessible name, description, or live-region
  announcement, verifiable via the browser's computed accessibility tree

#### Scenario: The run action is keyboard operable
- **WHEN** a "Run to update" action is rendered on either surface
- **THEN** it can be reached and activated using the keyboard alone
