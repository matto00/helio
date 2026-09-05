## MODIFIED Requirements

### Requirement: PipelineProposal schema shape
`schemas/pipelines/pipeline-proposal.schema.json` SHALL define a `PipelineProposal` object requiring
`pipelineName`, `roots`, and `steps`, carrying no id fields for any resource — no
`sourceId`-for-a-new-source, no `pipelineId`, no `stepId`, no output `outputId`. The singular `source`
field SHALL NOT be a required or accepted property.

#### Scenario: A minimal valid proposal validates
- **WHEN** a JSON document supplies `pipelineName`, a one-element `roots` array whose element
  references an existing `sourceId`, and an empty `steps` array
- **THEN** the document validates against `schemas/pipelines/pipeline-proposal.schema.json`

#### Scenario: A proposal missing a required top-level field is rejected
- **WHEN** a JSON document omits `steps`
- **THEN** the document fails validation against `schemas/pipelines/pipeline-proposal.schema.json`

#### Scenario: A proposal carrying the removed singular source field is rejected
- **WHEN** a JSON document supplies `pipelineName`, `steps`, and a `source` object instead of `roots`
- **THEN** the document fails validation against `schemas/pipelines/pipeline-proposal.schema.json`

### Requirement: Backend protocol round-trips the schema, tolerating absent optionals
The backend SHALL provide `PipelineProposal`/`PipelineProposalSource` case classes and a
`RootJsonFormat[PipelineProposal]` (in `PipelineProposalProtocol`, mixed into `JsonProtocols`) that:
reads a JSON document missing any optional field without error, treating the field as absent rather
than raising a deserialization error; and, on write, omits keys for absent `Option` fields rather
than emitting a `null` value — matching `DashboardProposalProtocol`'s existing tolerant-reader
convention. `PipelineProposal` SHALL carry `roots: Vector[PipelineProposalSource]`, not a singular
`source` field; the reader SHALL reject a document carrying `source` rather than tolerating it as an
unknown key, since tolerating it would silently discard the caller's stated sources.

#### Scenario: Round-trip a proposal referencing an existing source
- **WHEN** a `PipelineProposal` whose `roots` holds one
  `PipelineProposalSource(sourceId = Some("src-1"), ...)` and one step is serialized to JSON and read
  back
- **THEN** the deserialized value equals the original

#### Scenario: Round-trip a proposal with an inline source
- **WHEN** a `PipelineProposal` whose `roots` holds one inline `sqlConfig`-populated
  `PipelineProposalSource` with no `sourceId` is serialized to JSON and read back
- **THEN** the deserialized value equals the original

#### Scenario: Round-trip a two-root proposal preserves root order
- **WHEN** a `PipelineProposal` whose `roots` holds an existing-source element followed by an inline
  element is serialized to JSON and read back
- **THEN** the deserialized value equals the original, with both roots in the same order

#### Scenario: Reading tolerates every optional field being absent
- **WHEN** a JSON object supplies only the required fields (`pipelineName`, `roots`, `steps`) with
  every root-level optional field omitted
- **THEN** `PipelineProposal`'s reader succeeds, populating the omitted fields as `None`

#### Scenario: A document carrying the removed singular source is rejected, not tolerated
- **WHEN** a JSON object supplies `source` and no `roots`
- **THEN** the reader fails with a named error rather than succeeding with an empty `roots`

#### Scenario: Steps reuse the existing CreatePipelineStepRequest shape
- **WHEN** a `PipelineProposal`'s `steps` field is serialized
- **THEN** each entry's wire shape is identical to `CreatePipelineStepRequest`'s existing
  `{type, config}` format, with no separate step DTO introduced

### Requirement: Inline REST source may propose a not-yet-existing Connector

A `PipelineProposalSource`'s `restConfig` (the new proposal-only `ProposalRestApiConfig` shape —
distinct from the live `POST /api/sources` `RestApiConfigPayload`, which is untouched) whose
inline REST root needs a Connector the workspace does not yet have SHALL be able to carry a
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

`PipelineProposalService.validateStructure`/`validate` SHALL treat a **root** whose `restConfig`
carries `newConnector` as structurally valid and unresolved — no existence check is attempted
against it (there is nothing to check; the Connector does not exist yet). Each root is assessed
independently: an unresolved draft on one root SHALL NOT affect the validation of any other root.
`apply` SHALL NOT be extended with new handling for `newConnector`: a proposal is only ever
submitted to `apply` once every `newConnector`/dangling `connectorId` on every root has already
been resolved to a real `connectorId` by the reviewing client.

#### Scenario: Validate succeeds on a proposal carrying an unresolved draft

- **WHEN** `validate` is called with a `PipelineProposal` whose only REST root carries
  `restConfig.newConnector` and no `connectorId`
- **THEN** `validate` returns success

#### Scenario: Validate succeeds when only one of several roots carries an unresolved draft

- **WHEN** `validate` is called with a `PipelineProposal` whose first root references an existing
  `sourceId` and whose second REST root carries `restConfig.newConnector` and no `connectorId`
- **THEN** `validate` returns success, and no existence check is attempted for the second root

## REMOVED Requirements

### Requirement: Source is an existing reference or an inline spec
**Reason**: A proposal now describes a multi-root pipeline, so a single `source` object can no longer
express the contract. The requirement is replaced by "Roots are existing references or inline specs"
below, which carries the same two-form rule per root.

**Migration**: Callers replace `source: {...}` with `roots: [{...}]`. The element shape is unchanged,
so a previously valid single-source proposal becomes valid by wrapping its `source` object in a
one-element array. There is no alias and no transitional period: a proposal carrying `source` is
rejected, matching the "no deprecation" ruling `POST /api/pipelines` already ships under.

## ADDED Requirements

### Requirement: Roots are existing references or inline specs
The schema SHALL define `roots` as a non-empty ordered array. Each element SHALL support two forms:
a reference to an existing data source via `sourceId`, or an inline new-source spec via `type` (one
of `csv`, `rest_api`, `sql`, `static`), `name`, and a per-type `config` object — the same element
shape the singular `source` object used, so a root is not a second source vocabulary. The schema
SHALL NOT require that exactly one form is used per element; resolving which branch wins when both
are present is an apply-time concern outside this contract. Each element MAY carry a request-scoped
`clientId` that a parentless step's `rootClientId` names.

#### Scenario: Existing-source form validates
- **WHEN** a `roots` element supplies only `sourceId`
- **THEN** the document validates

#### Scenario: Inline-source form validates
- **WHEN** a `roots` element supplies `type: "sql"`, a `name`, and a `config` object
- **THEN** the document validates

#### Scenario: A two-root proposal validates
- **WHEN** a proposal carries one existing-source root and one inline-source root
- **THEN** the document validates and no root is treated as primary

#### Scenario: An empty roots array is rejected
- **WHEN** a proposal carries `roots: []`
- **THEN** the document fails validation

### Requirement: A proposal expresses lanes and per-root step binding
The schema SHALL allow `steps` to express sibling lanes — more than one step naming the same
`parentStepId` — and SHALL allow a `join`, `union`, or `lookup` step's config to carry a `lane`-kind
secondary input whose referenced node is addressed by another step's request-scoped `clientId`. A
parentless step SHALL address its root by `rootClientId`, naming a `roots` element that appears
earlier in the same document.

#### Scenario: Sibling lanes validate
- **WHEN** two `steps` entries name the same earlier step's `clientId` as their `parentStepId`
- **THEN** the document validates

#### Scenario: A rejoin step referencing a sibling lane validates
- **WHEN** a `join` step's config carries a `lane`-kind secondary input naming another step's
  `clientId` in the same document
- **THEN** the document validates

#### Scenario: A parentless step names its root
- **WHEN** a proposal carries two roots and a parentless step whose `rootClientId` names the second
  root's `clientId`
- **THEN** the document validates
