# pipeline-proposal-review-ui Specification

## Purpose
Lets a user review and apply (or reject) a `PipelineProposal` or `CombinedProposal` produced by the
in-app assistant's `propose_pipeline`/`propose_combined` tools directly from the web app, closing
the authoring dead end where those proposal kinds had no review page.
## Requirements
### Requirement: Pipeline proposal handoff
`ProposalHandoff` SHALL offer a "Review proposal" action for a `pipeline`-kind extraction that
navigates to the pipeline proposal review route, passing the extracted `PipelineProposal` via
router state — mirroring the existing `dashboard`/`patch` handoff mechanism exactly (same
`navigate(path, {state: {...}})` call shape, no new hand-off machinery).

#### Scenario: Pipeline proposal ready
- **WHEN** `ProposalHandoff` receives an extraction with `kind === "pipeline"`
- **THEN** it renders a "Review proposal" button that, on click, navigates to
  `/pipeline-proposals/review` with `{state: {proposal: extraction.input}}`

### Requirement: Combined proposal handoff
`ProposalHandoff` SHALL offer a "Review proposal" action for a `combined`-kind extraction that
navigates to the combined proposal review route, passing the extracted `CombinedProposal` via
router state.

#### Scenario: Combined proposal ready
- **WHEN** `ProposalHandoff` receives an extraction with `kind === "combined"`
- **THEN** it renders a "Review proposal" button that, on click, navigates to
  `/combined-proposals/review` with `{state: {proposal: extraction.input}}`

### Requirement: Pipeline proposal review page
The pipeline proposal review page SHALL render the proposed source (existing-source reference or
inline csv/rest_api/sql/static config), the ordered list of proposed steps (kind + config), and
the proposed output DataType name, sourced from `location.state.proposal` handed off by
`ProposalHandoff`.

#### Scenario: Reviewing a pipeline proposal
- **WHEN** a signed-in user navigates to `/pipeline-proposals/review` with a `PipelineProposal` in
  router state
- **THEN** the page displays the proposal's source, ordered steps, and output DataType name, with
  Accept and Reject actions

#### Scenario: No proposal in router state (production)
- **WHEN** a signed-in production user navigates to `/pipeline-proposals/review` with no
  `location.state.proposal`
- **THEN** the page shows a "Nothing to review" empty state instead of any live or synthesized
  proposal

### Requirement: Pipeline proposal accept/reject
Accepting a pipeline proposal SHALL call `POST /api/pipelines/apply-proposal` with the reviewed
proposal and, on success, navigate to the newly-created pipeline's detail page. Rejecting SHALL
discard the proposal and navigate away without any backend write.

#### Scenario: Accepting a pipeline proposal
- **WHEN** the user clicks Accept on the pipeline proposal review page
- **THEN** the system calls `POST /api/pipelines/apply-proposal` with the proposal, and on success
  navigates to `/pipelines/:id` for the created pipeline

#### Scenario: Accept fails
- **WHEN** `POST /api/pipelines/apply-proposal` returns an error
- **THEN** the page displays the error inline and remains on the review page (no navigation)

#### Scenario: Rejecting a pipeline proposal
- **WHEN** the user clicks Reject on the pipeline proposal review page
- **THEN** no request is sent to `/api/pipelines/apply-proposal` and the user is navigated away
  from the review page

### Requirement: Combined proposal review page
The combined proposal review page SHALL render both halves of the proposal: the nested pipeline
proposal (source, steps, output DataType name) and the nested dashboard proposal (dashboard name,
panel list), sourced from `location.state.proposal` handed off by `ProposalHandoff`. Any dashboard
panel bound to the reserved `"$pipelineOutput"` sentinel SHALL be displayed as referencing this
same proposal's own pipeline output, never as an unresolved or invalid binding.

#### Scenario: Reviewing a combined proposal
- **WHEN** a signed-in user navigates to `/combined-proposals/review` with a `CombinedProposal` in
  router state
- **THEN** the page displays the nested pipeline proposal and the nested dashboard proposal
  (including any panel bound to the pipeline's own not-yet-created output), with a single Accept
  and a single Reject action covering both halves

#### Scenario: No proposal in router state (production)
- **WHEN** a signed-in production user navigates to `/combined-proposals/review` with no
  `location.state.proposal`
- **THEN** the page shows a "Nothing to review" empty state instead of any live or synthesized
  proposal

### Requirement: Combined proposal accept/reject
Accepting a combined proposal SHALL call `POST /api/proposals/apply` with the reviewed proposal
and, on success, navigate away from the review page with the newly-created dashboard available in
the app's dashboard list without requiring a full page reload. Rejecting SHALL discard the
proposal and navigate away without any backend write.

#### Scenario: Accepting a combined proposal
- **WHEN** the user clicks Accept on the combined proposal review page
- **THEN** the system calls `POST /api/proposals/apply` with the combined proposal, and on success
  navigates to `/` with the created dashboard selected

#### Scenario: Accept fails
- **WHEN** `POST /api/proposals/apply` returns an error
- **THEN** the page displays the error inline and remains on the review page (no navigation)

#### Scenario: Rejecting a combined proposal
- **WHEN** the user clicks Reject on the combined proposal review page
- **THEN** no request is sent to `/api/proposals/apply` and the user is navigated away from the
  review page

