## Purpose

Defines the frontend step-card editor and MCP-documentation contract for an `upsertsource`
pipeline step: how a target dataset and write mode are chosen, how destructive replace is
surfaced, and how backend rejections (ownership, cycle) are shown to the caller.

## ADDED Requirements

### Requirement: Target picker never defaults to a selection
The step-card editor for an `upsertsource` step SHALL render a target picker offering an
"existing dataset" option and a "create new source" option requiring a name. The picker SHALL
start with no selection when the step's config has no `target` yet, and SHALL NOT auto-select
the first available dataset.

#### Scenario: A freshly added upsertsource step shows no pre-selected target
- **WHEN** a new `upsertsource` step is added with an empty/incomplete-draft config
- **THEN** the target picker shows no dataset selected and no new-source name filled in

### Requirement: Existing-dataset targeting is scoped to what the backend actually accepts
The system SHALL populate the "existing dataset" option's list from datasets the CURRENT
VIEWER owns, and SHALL enable that option only when the current viewer is the pipeline's
owner — matching the backend's ownership check, which resolves an `existingSource` target
against the pipeline owner's identity, never the calling editor grantee's. For a non-owner
editor grantee, the "existing dataset" option SHALL be disabled with an inline explanation,
leaving "create new source" as the only enabled choice.

#### Scenario: The pipeline owner sees their own writable datasets
- **WHEN** the pipeline owner opens the target picker
- **THEN** it lists datasets they own and enables selecting one

#### Scenario: A non-owner editor cannot pick an existing dataset
- **WHEN** a non-owner editor grantee opens the target picker on a shared pipeline
- **THEN** the "existing dataset" option is disabled with an inline explanation, and "create
  new source" remains the only enabled choice

### Requirement: Mode choice exposes both write modes with replace marked destructive
The step-card editor SHALL expose `append` and `replace` as an explicit, always-visibly-selected
mode choice — a freshly added step's mode control shows `append` selected (matching the
backend's own absent-`mode`-decodes-to-`append` behavior, made visible rather than left as an
unselected control) — and selecting `replace` SHALL surface a destructive-action confirmation
consistent with the project's existing destructive-action UI pattern before the mode change is
committed to the step's config.

#### Scenario: A freshly added step shows append selected
- **WHEN** a new `upsertsource` step is added with an empty/incomplete-draft config
- **THEN** the mode control shows `append` selected, not an unselected/blank state

#### Scenario: Selecting replace requires confirmation
- **WHEN** a user selects `replace` mode on an upsertsource step card
- **THEN** the UI shows a destructive-action confirmation before persisting `mode: "replace"`
  to the step's config, and the control still shows the previously-committed mode until confirmed

#### Scenario: Canceling the replace confirmation reverts the selection
- **WHEN** a user selects `replace`, sees the confirmation, and clicks Cancel
- **THEN** the mode control reverts to the last committed mode and no PATCH is sent

#### Scenario: Selecting append requires no confirmation
- **WHEN** a user selects `append` mode
- **THEN** the mode is persisted immediately without a destructive-action confirmation

#### Scenario: Loading an already-replace step shows no confirmation
- **WHEN** the pipeline editor loads an existing `upsertsource` step whose persisted config is
  already `mode: "replace"` (e.g. created via MCP)
- **THEN** the mode control shows `replace` selected with no confirmation prompt shown

### Requirement: Backend rejections surface as specific, readable errors
A cycle rejection or an ownership-check "not found" response from the backend for an
`upsertsource` step's target SHALL be displayed in the step card as a specific error message
naming the reported cause, not a generic toast or a silently swallowed failure.

#### Scenario: A cycle rejection is shown inline
- **WHEN** saving an upsertsource step's target is rejected by the backend because it would
  close a cycle
- **THEN** the step card shows an inline error containing the backend's cycle description,
  and the config is not optimistically marked saved

#### Scenario: An unauthorized/nonexistent existing-source target is shown inline
- **WHEN** saving an upsertsource step's existing-source target is rejected as "not found"
- **THEN** the step card shows an inline "not found" error and does not distinguish, in its own
  wording, between nonexistent and other-tenant-owned (matching the backend's identical response)

### Requirement: A created step round-trips through the editor
An `upsertsource` step created through the MCP `add_pipeline_step` tool with a valid config
SHALL render in the pipeline editor as a fully editable step-card (target + mode visible and
editable), not the generic "unsupported step" notice.

#### Scenario: An MCP-created upsertsource step renders as an editable card
- **WHEN** the pipeline editor loads a pipeline containing an `upsertsource` step created via
  `add_pipeline_step`
- **THEN** the step card shows the configured target and mode, editable like any other step kind

### Requirement: MCP tool documentation matches the backend config contract
The `add_pipeline_step` (and `update_pipeline_step`, where it separately documents step
config shapes) tool description SHALL document the `upsertsource` config contract exactly as
specified by `pipeline-upsertsource-config`: both target forms, both modes, the
identical-"not found" ownership-check behavior, and that a cycle-forming target is rejected at
write time naming the cycle.

#### Scenario: Tool description documents both target forms and both modes
- **WHEN** an agent reads the `add_pipeline_step` tool description for `type: "upsertsource"`
- **THEN** it finds the `newSource`/`existingSource` target shapes and the `append`/`replace`
  mode values documented, matching `pipeline-upsertsource-config`

#### Scenario: Tool description documents the cycle-rejection behavior
- **WHEN** an agent reads the `add_pipeline_step` tool description for `type: "upsertsource"`
- **THEN** it finds a statement that a cycle-forming target is rejected at write time with a
  message naming the cycle, not silently accepted or generically failed

#### Scenario: Tool description documents the pipeline-owner ownership rule
- **WHEN** an agent reads the `add_pipeline_step` tool description for `type: "upsertsource"`
- **THEN** it finds a statement that an `existingSource` target must be owned by the PIPELINE
  OWNER, not the calling agent's own identity, so an agent acting on a shared/editor-granted
  pipeline is not surprised by a "not found" rejection
