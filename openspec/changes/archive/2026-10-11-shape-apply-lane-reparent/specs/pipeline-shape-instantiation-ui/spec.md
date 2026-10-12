## MODIFIED Requirements

### Requirement: Submitting the params form expands the shape and seeds steps

Submitting the params form SHALL call `POST /api/pipeline-shapes/:id/expand` with the collected
params only (the endpoint has no `parentStepId` field and never learns which step was chosen —
`ExpandPipelineShapeRequest(params: JsObject)`; each `object[]` field JSON-parsed before send, a
client-side JSON-parse failure blocks submission with an inline error and does not call the
endpoint). The endpoint returns `{steps, outputs?}`, where each `steps[]` entry's `parentStepId` is a
synthetic intra-response `clientId` reference (e.g. `"step-0"`), not a real step id. On a `200`
response, the form SHALL, client-side: create the response's root step (the entry with no `clientId`
parent reference) via `POST /api/pipelines/:id/steps` with `parentStepId` = the chosen anchor step's
real id as a plain splice (no `attachAsTail`), or with `parentStepId` omitted (a zero-step pipeline's
trunk seed); then create each remaining response step in order as a plain splice, resolving its
`clientId` reference to the real id already returned for that referenced entry via a
`clientId -> real id` map built as creation proceeds; then create each returned Output (if any),
resolving its `nodeStepId` through the same map, attached to its resulting real node; then close the
picker. A splice moves every existing child of the step it is created under (including lanes) to
become a child of the new step, and the create response reports those steps in `reparentedStepIds`.
After EACH step create, the editor SHALL apply that response's `reparentedStepIds` to its local step
structure, so the structure the editor shows is the server's structure without a reload, while
local-only drafts and open-card state are preserved (no wholesale replace). Seeded steps and Outputs
SHALL be ordinary, independent records — no field, tag, or other persisted linkage to the originating
shape or its params SHALL be written. `ExpandPipelineShapeResponse.outputs` is `None` for every shape
on the shipped backend today — the Outputs-creation arm of this requirement is implemented but
exercised only against a fixture until a shape declares outputs.

#### Scenario: Successful expand seeds steps in order
- **WHEN** the expand response omits `outputs` (the case every registered shape currently returns)
  and a user submits valid params for `top-n` (which expands to a `sort` step then a `limit` step)
- **THEN** two new step cards appear, in order: `sort` first, then `limit` (each `parentStepId`
  resolved from its `clientId` reference), both rendered by the standard `StepCard` component and
  independently editable

#### Scenario: Instantiating into a non-empty pipeline appends after existing steps
- **WHEN** a user submits valid params for a shape against a chosen anchor step that already has one
  or more children
- **THEN** the shape's expanded steps are spliced in directly after the anchor (no `attachAsTail`),
  every existing child of the anchor becomes a child of the shape's last step, no step is deleted or
  replaced, and the editor shows that structure without a reload

#### Scenario: A lane hanging off the anchor moves below the shape and the editor shows it without a reload
- **WHEN** the primary lane's last step B has no continuation child but has a lane L (a child created
  with "+ lane"), and a user applies the `top-n` shape at the bottom of the primary lane (anchor B)
- **THEN** the server structure becomes B -> sort -> limit with L a child of `limit`, and immediately
  after apply (no reload) the editor shows `sort` and `limit` continuing the primary lane after B and
  L as a lane off `limit` — the same structure a reload shows

#### Scenario: A partial apply still reflects every reparent already reported
- **WHEN** a shape apply stops after some step creates succeeded (a later create failed)
- **THEN** the editor's structure reflects every `reparentedStepIds` reported by the creates that
  succeeded, and the partial-apply error toast is shown

#### Scenario: Local drafts survive a shape apply
- **WHEN** the editor holds a local-only draft step (not yet persisted) and a user applies a shape
- **THEN** the draft is still present in the editor after the apply

#### Scenario: Instantiating against a zero-step pipeline seeds a trunk, not a tail
- **WHEN** a user opens the shape picker from the empty-state (no steps yet) and submits valid params
- **THEN** the response's root step is created with no `parentStepId` (seeding the trunk root),
  and subsequent steps chain off it exactly as the non-empty case chains off the chosen node

#### Scenario: Successful expand seeds steps and an Output (fixture-only until a shape declares outputs)
- **WHEN** a user submits valid params for a shape that expands to `{steps: [...], outputs: [...]}`
  against an anchor step
- **THEN** the returned steps are seeded after that step (their `clientId` references resolved to the
  real created step ids), and the returned Output(s) attach to the resulting node via the same
  resolution, all independently editable afterward

#### Scenario: Seeded steps carry no shape provenance
- **WHEN** a shape's steps have been seeded into a pipeline
- **THEN** each resulting step's persisted config contains only that step kind's own fields — no
  `shapeId`, `sourceShape`, or equivalent field is present anywhere in the step's config or wire
  response

#### Scenario: Seeded Outputs carry no shape provenance (fixture-only until a shape declares outputs)
- **WHEN** a shape's Outputs have been seeded (per the fixture-only scenario above)
- **THEN** each resulting Output's persisted config contains only its own fields — no `shapeId`,
  `sourceShape`, or equivalent field is present anywhere in config or wire response
