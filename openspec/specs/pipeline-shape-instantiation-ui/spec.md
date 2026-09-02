# pipeline-shape-instantiation-ui Specification

## Purpose
Lets a pipeline author instantiate a registered smart shape (HEL-391 catalog) from the pipeline editor —
picking a shape, filling a params form generated from its `paramsSchema`, and seeding the resulting steps
as ordinary, independent, editable steps — instead of hand-authoring every step from scratch.

## Requirements

### Requirement: The pipeline editor offers a "Start from a shape" affordance

The pipeline editor (`PipelineRiverView`) SHALL offer an "Add Outputs from a shape" control
against a chosen step, available from the Outputs rail's "+ output" affordance and from the
Outputs gallery tab's "+ New output" affordance. Selecting it SHALL open a shape picker that lists
every entry from `GET /api/pipeline-shapes`, each showing at least its `label` and `description`.

#### Scenario: Shape entry point is per-step, not page-level
- **WHEN** a user activates "+ output" on a trunk step
- **THEN** the resulting menu offers "Add Outputs from a shape" scoped to that step, alongside the
  ordinary "Add output" (Output sheet) option

#### Scenario: Shape picker lists the live catalog
- **WHEN** a user opens the shape picker
- **THEN** it lists every shape returned by `GET /api/pipeline-shapes` (id `passthrough`, `single-row`,
  `top-n`, `time-series`, `pivot-matrix` at time of writing), each showing its `label` and `description`

#### Scenario: Empty pipeline shows the shape-picker affordance
- **WHEN** a user opens a pipeline with zero steps
- **THEN** the empty-state offers both "+ Add step" and an "Add Outputs from a shape" control
  scoped to the pipeline's root

#### Scenario: Non-empty pipeline shows the shape-picker affordance
- **WHEN** a user opens a pipeline with one or more existing steps
- **THEN** each step's Outputs rail and the Outputs gallery tab offer an "Add Outputs from a shape"
  control scoped to that step

### Requirement: Selecting a shape opens a params form driven by its paramsSchema

Choosing a shape from the picker SHALL open a form rendering one input per entry in that shape's
`paramsSchema`, in schema order, using a widget selected by the entry's `dataType`, plus forward-
compatible support (HEL-731, **partially absorbed** — see design.md decision 13) for `enum`
(rendered as a select) and `fieldRef` (rendered as a field picker sourced from the chosen step's
capabilities-at-node) metadata when present on the descriptor. `ShapeParamDescriptor` on the
shipped backend has no `enum`/`fieldRef` field today (five fields, `jsonFormat5`) — this half of
HEL-731 is dormant until a backend follow-up (filed at delivery time) adds it; the two scenarios
below are fixture-only until then. The existing `"string"` / `"string[]"` / `"integer"` /
`"object[]"` / fallback mapping remains the only live path. Each field SHALL display its
`description` as helper text.

#### Scenario: enum param renders as a select (fixture-only until the backend descriptor gains `enum`)
- **WHEN** a shape's paramsSchema entry declares `enum: ["asc", "desc"]`
- **THEN** the form renders that field as a select offering exactly those two options

#### Scenario: fieldRef param renders as a field picker scoped to the node (fixture-only until the backend descriptor gains `fieldRef`)
- **WHEN** a shape's paramsSchema entry declares `fieldRef: true`
- **THEN** the form renders that field as a picker listing fields from the chosen step's
  capabilities-at-node response, not a free-text input

#### Scenario: Params form renders one field per paramsSchema entry
- **WHEN** a user selects the `top-n` shape (paramsSchema: `measure` (string), `direction` (string),
  `n` (integer), `ties` (string)), none of which declare `enum`/`fieldRef`
- **THEN** the form renders four inputs per the original `dataType` mapping, unchanged

#### Scenario: object[] params render as a JSON text area
- **WHEN** a user selects the `single-row` shape and its `measures` field (`dataType: "object[]"`)
- **THEN** the form renders `measures` as a text area accepting raw JSON array text, with the field's
  `description` shown as helper text

#### Scenario: Required fields block submission until non-empty
- **WHEN** a user opens the params form for a shape with at least one `required: true` paramsSchema
  entry and leaves that field empty
- **THEN** the submit control is disabled (or submission is blocked) until the field is non-empty

### Requirement: Submitting the params form expands the shape and seeds steps

Submitting the params form SHALL call `POST /api/pipeline-shapes/:id/expand` with the collected
params only (the endpoint has no `parentStepId` field and never learns which step was chosen —
`ExpandPipelineShapeRequest(params: JsObject)`; each `object[]` field JSON-parsed before send, a
client-side JSON-parse failure blocks submission with an inline error and does not call the
endpoint). The endpoint returns `{steps, outputs?}` (**BREAKING** — see proposal.md), where each
`steps[]` entry's `parentStepId` is a synthetic intra-response `clientId` reference (e.g.
`"step-0"`), not a real step id. On a `200` response, the form SHALL, client-side: create the
response's root step (the entry with no `clientId` parent reference) via `POST
/api/pipelines/:id/steps` with `parentStepId` = the chosen step's real id (a tail attach) or
omitted (a zero-step pipeline's trunk seed); then create each remaining response step in order,
resolving its `clientId` reference to the real id already returned for that referenced entry via a
`clientId -> real id` map built as creation proceeds; then create each returned Output (if any),
resolving its `nodeStepId` through the same map, attached to its resulting real node; then close
the picker. Seeded steps and Outputs SHALL be ordinary, independent records — no field, tag, or
other persisted linkage to the originating shape or its params SHALL be written.
`ExpandPipelineShapeResponse.outputs` is documented as `None` for every shape on the shipped
backend today — the Outputs-creation arm of this requirement is implemented but exercised only
against a fixture until a shape declares outputs; the steps-only path is the only one currently
live.

#### Scenario: Successful expand seeds steps in order
- **WHEN** the expand response omits `outputs` (spray-json omits absent `Option`, not `null` — the
  case every registered shape currently returns) and a user submits valid params for `top-n`
  (which expands to a `sort` step then a `limit` step)
- **THEN** two new step cards appear, in order: `sort` first, then `limit` (each `parentStepId`
  resolved from its `clientId` reference), both rendered by the standard `StepCard` component and
  independently editable

#### Scenario: Instantiating into a non-empty pipeline appends after existing steps
- **WHEN** a user submits valid params for a shape against a chosen trunk step that already has one
  manually-added child (a tail)
- **THEN** the shape's expanded steps are seeded as a NEW tail off the chosen step (a tail-attach,
  per the primitive `attachTailInternal` established for tail creation elsewhere in this change);
  the chosen step's existing tail and every other step are unmodified and not replaced

#### Scenario: Instantiating against a zero-step pipeline seeds a trunk, not a tail
- **WHEN** a user opens the shape picker from the empty-state (no steps yet) and submits valid params
- **THEN** the response's root step is created with no `parentStepId` (seeding the trunk root),
  and subsequent steps chain off it exactly as the non-empty case chains off the chosen node

#### Scenario: Successful expand seeds steps and an Output (fixture-only until a shape declares outputs)
- **WHEN** a user submits valid params for a shape that expands to `{steps: [...], outputs: [...]}`
  against a trunk step with no existing tail
- **THEN** the returned steps are seeded as a new tail off that step (their `clientId` references
  resolved to the real created step ids), and the returned Output(s) attach to the resulting tail
  node via the same resolution, all independently editable afterward

#### Scenario: Seeded steps carry no shape provenance
- **WHEN** a shape's steps have been seeded into a pipeline
- **THEN** each resulting step's persisted config contains only that step kind's own fields — no
  `shapeId`, `sourceShape`, or equivalent field is present anywhere in the step's config or wire
  response

#### Scenario: Seeded Outputs carry no shape provenance (fixture-only until a shape declares outputs)
- **WHEN** a shape's Outputs have been seeded (per the fixture-only scenario above)
- **THEN** each resulting Output's persisted config contains only its own fields — no `shapeId`,
  `sourceShape`, or equivalent field is present anywhere in config or wire response

### Requirement: A failed expand or step-create is always surfaced, never silent

The picker SHALL display the error message inline, and SHALL NOT close or create any steps or
Outputs, when `POST /api/pipeline-shapes/:id/expand` returns a non-2xx response (e.g. `422` for
invalid params, `404` for an unknown shape id). If the expand call succeeds but a subsequent
per-step or per-Output create call fails partway through seeding, the picker SHALL stop seeding
further steps/Outputs, leave already-created records in place (no compensating delete), close, and
SHALL push a visible error notification naming that the shape only partially applied.

#### Scenario: A 422 from expand is shown inline and blocks step creation
- **WHEN** a user submits params that fail a shape's server-side validation
- **THEN** the form displays the `422` response's error message inline, the picker remains open, and no
  steps or Outputs are created

#### Scenario: An unknown shape id error is surfaced, not silently dropped
- **WHEN** the expand request targets a shape id the backend does not recognize
- **THEN** the form displays the `404` error message inline rather than failing silently

#### Scenario: A mid-loop step-create failure surfaces a visible toast, not a silent drop
- **WHEN** expand succeeds and returns two steps and one Output, but the Output create call fails
- **THEN** both steps remain created and visible, the picker closes, and a visible error toast
  reports that the Output failed to create
