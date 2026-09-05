## MODIFIED Requirements

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

## ADDED Requirements

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
