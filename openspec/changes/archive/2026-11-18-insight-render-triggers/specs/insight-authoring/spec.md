## MODIFIED Requirements

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
