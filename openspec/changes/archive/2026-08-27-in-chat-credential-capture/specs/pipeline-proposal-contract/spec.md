## ADDED Requirements

### Requirement: Inline REST source may propose a not-yet-existing Connector

A `PipelineProposalSource`'s `restConfig` (the new proposal-only `ProposalRestApiConfig` shape —
distinct from the live `POST /api/sources` `RestApiConfigPayload`, which is untouched) whose
inline REST source needs a Connector the workspace does not yet have SHALL be able to carry a
`newConnector` draft — `name`, `baseUrl`, `authType` (`none`/`bearer`/`api_key`), an optional
`apiKeyName`/`apiKeyPlacement`, and `retrievalInstructions` (prose describing where a human
obtains the credential) — instead of `connectorId` or the unchanged legacy `url`. `newConnector`
SHALL NOT define any field capable of holding a credential value. `restConfig`'s JSON Schema
(`config`, typed as an unconstrained object per the schema's own documented intent) does not
itself enforce mutual exclusivity — `PipelineProposalService`'s service-layer validation SHALL
require exactly one of `connectorId`/`url`/`newConnector` be present.

#### Scenario: A proposal drafts a new Connector instead of referencing one

- **WHEN** a `PipelineProposalSource` supplies `restConfig.newConnector` with `name`, `baseUrl`,
  `authType`, and `retrievalInstructions`, and omits `connectorId` and `url`
- **THEN** the document validates against the pipeline-proposal schema, and
  `PipelineProposalService.validateStructure` accepts it as structurally valid

#### Scenario: Service validation rejects combining newConnector with connectorId/url, or neither

- **WHEN** a `PipelineProposalSource`'s `restConfig` supplies `newConnector` together with either
  `connectorId` or `url`, or supplies none of the three
- **THEN** `PipelineProposalService.validateStructure` returns a validation error (the JSON Schema
  itself does not reject this — `config` is deliberately unconstrained — enforcement is at the
  service layer)

### Requirement: Structural validation accepts an unresolved newConnector draft

`PipelineProposalService.validateStructure`/`validate` SHALL treat a step whose `restConfig`
carries `newConnector` as structurally valid and unresolved — no existence check is attempted
against it (there is nothing to check; the Connector does not exist yet). `apply` SHALL NOT be
extended with new handling for `newConnector`: a proposal is only ever submitted to `apply` once
every `newConnector`/dangling `connectorId` has already been resolved to a real `connectorId` by
the reviewing client.

#### Scenario: Validate succeeds on a proposal carrying an unresolved draft

- **WHEN** `validate` is called with a `PipelineProposal` whose only REST step carries
  `restConfig.newConnector` and no `connectorId`
- **THEN** `validate` returns success
