# insight-authoring Specification

## Purpose
Lets a pipeline owner or editor create and configure an `insight` Output from the Output editor sheet without writing
a prompt, choosing a preset, the Outputs it reads and when it refreshes.

## Requirements

### Requirement: Insight is creatable from the Output editor
The Output editor's create kind picker SHALL offer `insight` alongside every other Output kind. Choosing it SHALL show
the insight settings card, and saving with no field touched SHALL create an insight Output whose config contains no
`prompt` key.

#### Scenario: Create without typing a prompt
- **WHEN** a user picks the Insight kind in the create sheet and saves without editing any insight field
- **THEN** the create request succeeds, the created Output has kind `insight`, and its config has no `prompt`

#### Scenario: Picker offers every kind
- **WHEN** the create picker's options are compared with the canonical Output kind list
- **THEN** they are equal, including `insight`

### Requirement: Insight settings with defaults filled in
The insight settings card SHALL show:
- a preset picker over `auto`, `delta`, `trend`, `leaders` and `summary`, showing `auto` when the config has none;
- a model selector after the preset, listing the selectable models from `GET /api/assistant-models` plus "Server
  default", showing "Server default" when the config has no `model`; choosing "Server default" leaves `model` out of
  the saved config (clearing a stored one), and when the model list cannot be loaded the selector is hidden and saving
  still works;
- a refresh selector over `on_run`, `daily` and `manual`, showing `on_run` when the config has none;
- a checklist of the pipeline's other saved, non-insight Outputs;
- a collapsed "Custom prompt" disclosure holding a text area limited to 2000 characters.

When the config has no `reads.outputs`, the checklist SHALL be pre-ticked with exactly the Outputs on the same node as
the insight: the same step when the insight is bound to a step, or the same root (and no step) when it is bound to a
root. Opening an existing insight SHALL show its stored values.

#### Scenario: Defaults on create
- **WHEN** the create sheet shows the insight card for a node that has two other Outputs
- **THEN** the preset shows Auto, the refresh shows On every run, those two Outputs are ticked, Outputs on other nodes
  are unticked, and the custom prompt disclosure is closed

#### Scenario: Existing values
- **WHEN** an insight with preset `trend`, refresh `daily`, a prompt and `reads.outputs` naming one Output is opened
- **THEN** the card shows Trend, Daily, the prompt inside the disclosure, and exactly that Output ticked

#### Scenario: Two roots
- **WHEN** a root-bound insight is created on a pipeline with two roots, each with a root-bound Output
- **THEN** only the Output on the insight's own root is pre-ticked

#### Scenario: Model chosen and cleared
- **WHEN** an insight is saved with Haiku 5.5 chosen, then reopened and saved with "Server default"
- **THEN** the first save writes `model: "claude-haiku-5-5"` and the second save's config has no `model`

### Requirement: Insight config written by the editor
The editor SHALL write only keys the backend insight config contract accepts. It SHALL omit `reads` while the
checklist equals the same-node default, and SHALL write `reads.outputs` as the ticked ids (at most 8) otherwise. An
edit SHALL send only the changed keys, and clearing a stored value SHALL send an explicit `null`. The editor SHALL
NOT write `model`, `maxSentences`, `maxChars` or `reads.windows`, and SHALL leave any of them already stored unchanged.
Draft-only (unsaved) Outputs SHALL NOT appear in the checklist. Saving SHALL be blocked with an inline message when
more than 8 Outputs are ticked.

#### Scenario: Untouched edit sends nothing
- **WHEN** an existing insight is opened and saved with no change
- **THEN** the update request carries no insight config key

#### Scenario: Unticking writes an explicit list
- **WHEN** the user unticks one of two default Outputs and saves
- **THEN** the request's `reads.outputs` names only the other Output

#### Scenario: Stored windows survive
- **WHEN** an insight with stored `reads.windows` and an explicit `reads.outputs` has its checklist returned to the
  default and is saved
- **THEN** the request sends `reads` containing the stored `windows` and no `outputs`

#### Scenario: Too many Outputs
- **WHEN** nine Outputs are ticked
- **THEN** save is disabled and an inline message names the limit of 8

### Requirement: Free tier sees an upsell on the insight card
When the signed-in user owns the pipeline and has the `free` tier, the insight settings card SHALL show a note that insights render on the
beta plan, with a link to the beta-access settings. Creating and editing SHALL still be allowed.

#### Scenario: Free tier
- **WHEN** a free-tier pipeline owner opens the insight card
- **THEN** the upsell note and link are visible and save is enabled

#### Scenario: Free-tier editor
- **WHEN** a free-tier editor opens the insight card on a beta owner's pipeline
- **THEN** no upsell note is shown
