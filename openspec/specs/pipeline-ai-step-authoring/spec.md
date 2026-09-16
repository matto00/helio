# pipeline-ai-step-authoring Specification

## Purpose
Defines the two contracts shared by every AI step card in the pipeline editor: how a step whose config the
backend rejects while incomplete gets created, and what a user is told about cost and quota before running one.

## Requirements

### Requirement: A step kind whose incomplete config is rejected is created only once its config is complete

For a step kind whose write-path validation rejects an incomplete config — today `analyzewithai` and
`generatetext`, both of which require every field non-empty — the editor SHALL NOT issue a create request
carrying a known-invalid seed config. The step SHALL appear in the editor immediately as an unsaved draft
card, and the create request SHALL be issued once, when its config first becomes complete. A step kind whose
validator accepts an incomplete draft (such as `convertformat`) SHALL retain the existing
create-immediately behavior unchanged.

#### Scenario: Adding an AI step issues no immediately-failing create
- **WHEN** a user adds an `analyzewithai` or `generatetext` step from the op picker
- **THEN** no create request carrying an incomplete config is sent, and no failure is surfaced

#### Scenario: The draft card is visible and editable before it is saved
- **WHEN** an AI step has been added but its config is not yet complete
- **THEN** its card is present and editable in the editor, and is identifiably not yet saved

#### Scenario: Completing the config creates the step exactly once
- **WHEN** the last required field of a draft AI step's config is supplied
- **THEN** exactly one create request is issued, and further edits update the created step rather than
  creating another

#### Scenario: A rejected create is shown, not swallowed
- **WHEN** the create request for a completed AI step config is rejected by the backend
- **THEN** the card shows an inline error naming the backend's reported cause, and the step remains an
  unsaved draft rather than appearing saved

#### Scenario: A non-AI step's create flow is unchanged
- **WHEN** a user adds a `convertformat` step
- **THEN** it is created immediately with its seed config, as every other non-AI step kind is

### Requirement: A draft's field picker offers the schema flowing into its actual anchor

Because a draft AI step has no server-side row yet, it is never included in an analyze request and so
carries no analyze-derived schema of its own. The editor SHALL still populate the draft's field picker(s)
from the schema that would flow into the draft's real position, resolved from its actual anchor — the step
it was attached after for a lane draft, or the nearest preceding step for a trunk draft — rather than
leaving the picker empty or resolving it from an unrelated step.

#### Scenario: A trunk draft offers the nearest preceding step's output schema
- **WHEN** a draft AI step is added after an existing step whose own output schema is known
- **THEN** the draft's field picker offers exactly that preceding step's output fields

#### Scenario: A lane draft offers its own anchor's output schema, not an unrelated trunk step's
- **WHEN** a draft AI step is added as a new lane off a specific anchor step
- **THEN** the draft's field picker offers that anchor's own output fields, even when the anchor is not
  the step immediately before the draft in trunk order

#### Scenario: A first-ever-step draft offers its own root's source schema
- **WHEN** a draft AI step is the very first step added to an empty pipeline root
- **THEN** the draft's field picker offers that root's source schema

#### Scenario: A multi-root pipeline's draft resolves the matching root, not always the first
- **WHEN** a draft AI step's anchor has no analyze entry and the pipeline has more than one root
- **THEN** the draft's field picker offers the source schema of the ROOT the draft actually belongs to

### Requirement: An AI step card discloses per-row model cost, no-auto-run, and the shared daily quota before a run

An AI step card SHALL state, before any run, that the step issues one model call per input row, that it is
never auto-run, and that it draws on the caller's shared daily AI budget. Where the analyze response
carries an estimated row count, the disclosure SHALL present it as the pipeline's estimated row count rather
than as this step's own call count, because that value is pipeline-level and a step downstream of a
row-reducing step issues fewer calls. The disclosure SHALL NOT state a monetary or token cost figure, because no such per-step
estimate exists on any available surface.

#### Scenario: The per-row cost and quota are stated before running
- **WHEN** a user views a configured `analyzewithai` or `generatetext` step card
- **THEN** the card states that the step calls the model once per row, is never auto-run, and consumes
  the shared daily AI budget

#### Scenario: An available row estimate is attributed to the pipeline, not the step
- **WHEN** the analyze response for the pipeline carries an estimated row count
- **THEN** the disclosure presents that number as the PIPELINE's estimated row count, and SHALL NOT present it
  as this step's own model-call count, since a step downstream of a row-reducing step issues fewer calls

#### Scenario: No fabricated cost figure is shown
- **WHEN** a user views any AI step card
- **THEN** no monetary amount and no token count is presented as the step's cost

#### Scenario: A non-AI step card carries no such disclosure
- **WHEN** a user views a `convertformat` step card
- **THEN** no model-cost or AI-quota disclosure is shown, since the op calls no model
