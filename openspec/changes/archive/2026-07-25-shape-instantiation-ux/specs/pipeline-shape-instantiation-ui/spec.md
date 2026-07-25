## ADDED Requirements

### Requirement: The pipeline editor offers a "Start from a shape" affordance

The pipeline editor (`PipelineRiverView`) SHALL offer a "Start from a shape" control alongside the
existing "+ Add step" / "+ Add transformation step" control, in both the empty-state (no steps yet) and
the "+ Add" row (one or more steps already present) layouts. Selecting it SHALL open a shape picker that
lists every entry from `GET /api/pipeline-shapes`, each showing at least its `label` and `description`.

#### Scenario: Empty pipeline shows the shape-picker affordance

- **WHEN** a user opens a pipeline with zero steps
- **THEN** the empty-state offers both "+ Add step" and a "Start from a shape" control

#### Scenario: Non-empty pipeline shows the shape-picker affordance

- **WHEN** a user opens a pipeline with one or more existing steps
- **THEN** the "+ Add" row offers both the existing op picker and a "Start from a shape" control

#### Scenario: Shape picker lists the live catalog

- **WHEN** a user opens the shape picker
- **THEN** it lists every shape returned by `GET /api/pipeline-shapes` (id `passthrough`, `single-row`,
  `top-n`, `time-series`, `pivot-matrix` at time of writing), each showing its `label` and `description`

### Requirement: Selecting a shape opens a params form driven by its paramsSchema

Choosing a shape from the picker SHALL open a form rendering one input per entry in that shape's
`paramsSchema`, in schema order, using a widget selected by the entry's `dataType`: `"string"` → text
input, `"string[]"` → comma-delimited text input, `"integer"` → numeric text input, `"object[]"` → a raw
JSON array text area, any other value → text input (fallback). Each field SHALL display its
`description` as helper text. The form SHALL NOT hardcode per-shape field layouts or cross-field
conditional logic beyond this generic per-`dataType` mapping.

#### Scenario: Params form renders one field per paramsSchema entry

- **WHEN** a user selects the `top-n` shape (paramsSchema: `measure` (string), `direction` (string),
  `n` (integer), `ties` (string))
- **THEN** the form renders four inputs, each labeled with its `paramsSchema` entry's `label` and helper
  text from its `description`, and the `n` field uses a numeric input

#### Scenario: object[] params render as a JSON text area

- **WHEN** a user selects the `single-row` shape and its `measures` field (`dataType: "object[]"`)
- **THEN** the form renders `measures` as a text area accepting raw JSON array text, with the field's
  `description` shown as helper text

#### Scenario: Required fields block submission until non-empty

- **WHEN** a user opens the params form for a shape with at least one `required: true` paramsSchema
  entry and leaves that field empty
- **THEN** the submit control is disabled (or submission is blocked) until the field is non-empty

### Requirement: Submitting the params form expands the shape and seeds steps

Submitting the params form SHALL call `POST /api/pipeline-shapes/:id/expand` with the collected params
(each `object[]` field JSON-parsed before send; a client-side JSON-parse failure blocks submission with
an inline error and does not call the endpoint). On a `200` response, the form SHALL sequentially POST
each returned `{kind, config}` entry via the pipeline's existing step-create call, in order, appending
after any steps already present in the pipeline, then close the picker. Seeded steps SHALL be ordinary,
independent step records — no field, tag, or other persisted linkage to the originating shape or its
params SHALL be written — and SHALL render, be editable, and be previewable through the unmodified
`StepCard`/`OP_TYPES` machinery with no special-casing.

#### Scenario: Successful expand seeds steps in order

- **WHEN** a user submits valid params for `top-n` (which expands to a `sort` step then a `limit` step)
  into a pipeline with zero existing steps
- **THEN** two new step cards appear, in order: `sort` first, then `limit`, both rendered by the
  standard `StepCard` component and independently editable

#### Scenario: Instantiating into a non-empty pipeline appends after existing steps

- **WHEN** a user submits valid params for a shape into a pipeline that already has one manually-added
  step
- **THEN** the shape's expanded steps are appended after the existing step; the existing step is
  unmodified and not replaced

#### Scenario: Seeded steps carry no shape provenance

- **WHEN** a shape's steps have been seeded into a pipeline
- **THEN** each resulting step's persisted config contains only that step kind's own fields — no
  `shapeId`, `sourceShape`, or equivalent field is present anywhere in the step's config or wire response

### Requirement: A failed expand or step-create is always surfaced, never silent

The picker SHALL display the error message inline, and SHALL NOT close or create any steps, when
`POST /api/pipeline-shapes/:id/expand` returns a non-2xx response (e.g. `422` for invalid params, `404`
for an unknown shape id). If the expand call succeeds but a subsequent per-step `createPipelineStep` call
fails partway through seeding, the picker SHALL stop seeding further steps, leave already-created steps
in place (no compensating delete), close, and SHALL push a visible error notification (toast or
equivalent) naming that the shape only partially applied.

#### Scenario: A 422 from expand is shown inline and blocks step creation

- **WHEN** a user submits params that fail a shape's server-side validation (e.g. `single-row` with
  `mode: "aggregate"` and no `measures`)
- **THEN** the form displays the `422` response's error message inline, the picker remains open, and no
  steps are created

#### Scenario: An unknown shape id error is surfaced, not silently dropped

- **WHEN** the expand request targets a shape id the backend does not recognize
- **THEN** the form displays the `404` error message inline rather than failing silently

#### Scenario: A mid-loop step-create failure surfaces a visible toast, not a silent drop

- **WHEN** expand succeeds and returns three steps, but the second per-step `createPipelineStep` call
  fails
- **THEN** the first step remains created and visible, no third step is attempted, the picker closes,
  and a visible error toast reports that only 1 of 3 steps were added
