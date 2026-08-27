## ADDED Requirements

### Requirement: Inline connector setup for an unresolved Connector reference

A pipeline or combined proposal review page SHALL detect every REST source step whose Connector
reference is unresolved — a `newConnector` draft, or a `connectorId` that does not match any
Connector currently in the workspace — inside that step's `config` object (`PipelineProposalSource.config`,
a `type === "rest_api"`-discriminated payload; the client-side type has no `restConfig` field —
`restConfig` is a backend-only, wire-serialized-as-`config` name) — and render one inline "Set up
connector" section per unresolved reference, at the point in the review flow where that step
appears. Each section SHALL show any model-authored `retrievalInstructions`, an explicit statement
that agents never see the submitted key and that this is enforced in code, and the shared
credential-input component (`ConnectorCredentialField`) in create mode. The section's submit
action SHALL dispatch the existing Connector-creation action directly — never a chat, assistant,
or conversation-state action — and, on success, resolve that step's reference to the newly created
Connector's id in the reviewer's local copy of the proposal only. A step whose `config.url` is set
(the legacy bare-URL path, unchanged) is excluded from this detection — it resolves through the
existing implicit-Connector mechanism with no inline-setup UI involved.

#### Scenario: A pipeline proposal needs a new Connector

- **WHEN** a user reviews a `PipelineProposal` whose REST source step's `config` carries
  `newConnector`
- **THEN** the review page renders a "Set up connector" section for that step, showing the
  drafted retrieval instructions and the agents-never-see-this-key statement

#### Scenario: A combined proposal's pipeline half needs a new Connector

- **WHEN** a user reviews a `CombinedProposal` whose `pipeline.source.config` carries
  `newConnector`
- **THEN** the combined review page renders the same inline "Set up connector" section for that
  reference

#### Scenario: A dashboard proposal never needs a Connector section

- **WHEN** a user reviews a `DashboardProposal`
- **THEN** the review page renders no "Set up connector" section, because a `DashboardProposal`
  carries no source/Connector-referencing field

#### Scenario: A legacy bare-URL step needs no inline setup section

- **WHEN** a user reviews a proposal whose REST source step's `config` carries `url` and neither
  `connectorId` nor `newConnector`
- **THEN** the review page renders no "Set up connector" section for that step

#### Scenario: Apply is disabled until every reference is resolved

- **WHEN** a pipeline or combined proposal has one or more unresolved Connector references
- **THEN** the "Apply proposal" action SHALL be disabled until each corresponding "Set up
  connector" section has successfully created its Connector

#### Scenario: Submitted credential never reaches the raw credential display again

- **WHEN** a user submits a credential in an inline "Set up connector" section
- **THEN** the raw value SHALL NOT be displayed anywhere in the application again, including
  within that same section after submission
