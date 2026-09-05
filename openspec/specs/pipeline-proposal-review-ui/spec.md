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
The pipeline proposal review page SHALL render the proposal's roots (each an existing-source
reference or an inline csv/rest_api/sql/static config), its proposed steps including lane structure,
and its proposed Outputs, sourced from `location.state.proposal` handed off by `ProposalHandoff`.
Where the proposal carries more than one root, every root SHALL be rendered; no root is presented as
the proposal's single source.

#### Scenario: Reviewing a pipeline proposal
- **WHEN** a signed-in user navigates to `/pipeline-proposals/review` with a `PipelineProposal` in
  router state
- **THEN** the page displays the proposal's roots, its steps, and its Outputs, with Accept and Reject
  actions

#### Scenario: Reviewing a two-root proposal shows both roots
- **WHEN** a signed-in user reviews a proposal carrying two roots
- **THEN** both roots are rendered with their source names

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
proposal (its roots, steps including lane structure, and Outputs) and the nested dashboard proposal
(dashboard name, panel list), sourced from `location.state.proposal` handed off by `ProposalHandoff`.
Where the nested pipeline proposal carries more than one root, every root SHALL be rendered. Any
dashboard panel bound to the reserved `"$pipelineOutput"` sentinel SHALL be displayed as referencing
this same proposal's own pipeline output, never as an unresolved or invalid binding.

#### Scenario: Reviewing a combined proposal
- **WHEN** a signed-in user navigates to `/combined-proposals/review` with a `CombinedProposal` in
  router state
- **THEN** the page displays the nested pipeline proposal and the nested dashboard proposal
  (including any panel bound to the pipeline's own not-yet-created output), with a single Accept
  and a single Reject action covering both halves

#### Scenario: Reviewing a combined proposal whose pipeline carries two roots
- **WHEN** a signed-in user reviews a `CombinedProposal` whose nested pipeline proposal carries two
  roots
- **THEN** both roots are rendered, and neither is presented as the pipeline's single source

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

### Requirement: Inline connector setup for an unresolved Connector reference

A pipeline or combined proposal review page SHALL detect every REST root whose Connector
reference is unresolved — a `newConnector` draft, or a `connectorId` that does not match any
Connector currently in the workspace — inside that root's `config` object (`PipelineProposalSource.config`,
a `type === "rest_api"`-discriminated payload; the client-side type has no `restConfig` field —
`restConfig` is a backend-only, wire-serialized-as-`config` name) — and render one inline "Set up
connector" section per unresolved reference, at the point in the review flow where that root
appears. Each section SHALL show any model-authored `retrievalInstructions`, an explicit statement
that agents never see the submitted key and that this is enforced in code, and the shared
credential-input component (`ConnectorCredentialField`) in create mode. The section's submit
action SHALL dispatch the existing Connector-creation action directly — never a chat, assistant,
or conversation-state action — and, on success, resolve that root's reference to the newly created
Connector's id in the reviewer's local copy of the proposal only. A root whose `config.url` is set
(the legacy bare-URL path, unchanged) is excluded from this detection — it resolves through the
existing implicit-Connector mechanism with no inline-setup UI involved.

#### Scenario: A pipeline proposal needs a new Connector

- **WHEN** a user reviews a `PipelineProposal` one of whose REST roots' `config` carries
  `newConnector`
- **THEN** the review page renders a "Set up connector" section for that root, showing the
  drafted retrieval instructions and the agents-never-see-this-key statement

#### Scenario: A combined proposal's pipeline half needs a new Connector

- **WHEN** a user reviews a `CombinedProposal` one of whose `pipeline.roots[].config` carries
  `newConnector`
- **THEN** the combined review page renders the same inline "Set up connector" section for that
  reference

#### Scenario: A dashboard proposal never needs a Connector section

- **WHEN** a user reviews a `DashboardProposal`
- **THEN** the review page renders no "Set up connector" section, because a `DashboardProposal`
  carries no source/Connector-referencing field

#### Scenario: A legacy bare-URL step needs no inline setup section

- **WHEN** a user reviews a proposal one of whose REST roots' `config` carries `url` and neither
  `connectorId` nor `newConnector`
- **THEN** the review page renders no "Set up connector" section for that root

#### Scenario: Apply is disabled until every reference is resolved

- **WHEN** a pipeline or combined proposal has one or more unresolved Connector references
- **THEN** the "Apply proposal" action SHALL be disabled until each corresponding "Set up
  connector" section has successfully created its Connector

#### Scenario: Submitted credential never reaches the raw credential display again

- **WHEN** a user submits a credential in an inline "Set up connector" section
- **THEN** the raw value SHALL NOT be displayed anywhere in the application again, including
  within that same section after submission

#### Scenario: Each unresolved root gets its own setup section

- **WHEN** a user reviews a `PipelineProposal` carrying two REST roots, each with an unresolved
  `newConnector` draft
- **THEN** the review page renders one "Set up connector" section per root, and resolving one leaves
  the other still unresolved and Apply still disabled

### Requirement: Review pages render Output previews
`ProposalReviewPage` and the patch-set, pipeline-proposal, and combined review pages SHALL render
each proposed Output's live preview rather than a "panel bound to type X" summary.

#### Scenario: Reviewing a pipeline proposal shows Output previews
- **WHEN** a user opens the review page for a pipeline proposal containing outputs
- **THEN** each proposed Output is rendered with its own preview, not a DataType-binding summary

### Requirement: Proposal review renders lanes and roots
The proposal review surface SHALL render a proposed pipeline's roots and its lane structure using the
same lane layout the pipeline editor uses, so a reviewer sees branching before applying rather than a
flattened list. Sibling lanes SHALL be visually distinct from a linear chain, and a rejoin node SHALL
show that it consumes more than one input.

#### Scenario: A two-root proposal shows both roots
- **WHEN** a reviewer opens a proposal carrying two roots
- **THEN** both roots are rendered, each with its source name, and neither is presented as the
  pipeline's single source

#### Scenario: Sibling lanes render as branches
- **WHEN** a proposal carries two steps sharing a parent
- **THEN** they render as sibling branches rather than as consecutive steps in one chain

#### Scenario: A rejoin node shows its second input
- **WHEN** a proposal carries a `join` step with a `lane`-kind secondary input
- **THEN** the review surface shows that step consuming the named lane in addition to its parent
