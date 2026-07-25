## Skeptic Report — design gate (round 2)

### What I verified (with evidence)

- **Read all planning artifacts fresh**: `ticket.md`, `proposal.md`, `design.md`, `tasks.md`,
  `specs/panel-creation-shape-step/spec.md`, `specs/panel-creation-datatype-step/spec.md`, and round 1's
  report (`skeptic-design-1.md`) — treated as claims, independently re-checked against the real code.

- **Round-1 gap 1 (incomplete params extraction) — now closed, verified against the real file.**
  `ShapePickerModal.tsx` read in full: `widgetFor` (lines 42-51) is used both in `handleSubmit`'s
  string→typed-value transform loop (lines 100-126: `JSON.parse` for `object[]`, comma-split for
  `string[]`, `Number.parseInt` for `integer`) and in the form-rendering JSX (line 210). Design.md's new
  Decision 6 explicitly extracts **both** halves into `ShapeParamsFields.tsx`: the rendering component
  and an exported `buildShapeParams(paramsSchema, values)` covering the exact same transform, citing the
  same line range (100-126) I independently confirmed. Tasks 1.1/1.2/1.3 assign each half a concrete
  home and require `ShapePickerModal.handleSubmit` to be refactored to call the shared
  `buildShapeParams` (not left with a second, hand-rolled copy) while `ShapePickerModal.test.tsx` must
  still pass unmodified — closing exactly the drift risk round 1 flagged (3 of 4 offered shapes have a
  non-`"string"` param that would silently mis-encode without this).

- **Round-1 gap 2 (unspecified "auto-derived" output type name) — closed in the decision documents,
  verified against the real code.** `PipelineService.scala:117-118` confirmed:
  `if (req.outputDataTypeName.trim.isEmpty) ... BadRequest("outputDataTypeName is required")`.
  `CreatePipelineModal.tsx` confirmed to collect this as its own required `TextField` (state at line 24,
  validation at line 53, dispatch payload at line 70, rendered field at lines 161-177) — matching
  design.md's citations essentially exactly. New Decision 7 replaces "auto-derived" with an explicit
  third required field, "Output type name," identical in validation/behavior to `CreatePipelineModal`'s
  field, and states the collision/rejection path reuses the existing inline-verbatim-error convention
  (Decision 5) rather than inventing a new one. Tasks 3.1 ("output-type-name field (required, same
  validation as `CreatePipelineModal`'s field)") and 3.2 ("`createPipeline` (name, sourceDataSourceId,
  outputDataTypeName from 3.1's fields)") correctly thread the decision into the task list. This closes
  the implementation-blocking ambiguity a competent implementer could previously have resolved two ways.

- **One loose end found, but it is a documentation-propagation gap, not a new design flaw**:
  `specs/panel-creation-shape-step/spec.md:23` still reads "...an auto-derived output type name" (the
  exact stale phrase round 1 flagged), and its "Submit is disabled until required fields are filled"
  scenario (lines 16-19) omits the new required output-type-name field as a disabling condition — the
  spec delta file was not updated even though design.md/tasks.md (the actual decision + task documents
  an implementer follows) were. This is squarely "incomplete application of an already-decided fix" per
  the round-budget guidance, not a new substantive flaw: `design.md` Decision 7 and `tasks.md` 3.1/3.2
  are unambiguous about the field's existence and required-ness, so a competent implementer building from
  those two documents would not be misled. Flagged below as a required fix, non-blocking.

- **Spot-checked a structural claim not covered by round 1's gaps**: whether `dataTypeId` binding
  (`PipelineSummary.outputDataTypeId`, used by task 3.3) is actually populated by the time `run` succeeds.
  `PipelineRepository.scala:216` (`dataTypeRepo.insert(newDataType, user)`) confirms the output `DataType`
  row is created synchronously inside `PipelineService.create`, before any step/run calls — so
  `createPipeline`'s response already carries a real `outputDataTypeId` the chain can hold onto and use
  once `run` succeeds. No hidden dependency on `run` to populate the id. No flaw found.

- **Re-verified round 1's already-confirmed findings still hold** (spot-checked, not re-litigated per the
  pre-settled constraints): `outputContract.fields` still `Vector.empty`/untouched (Non-Goals,
  design.md:25-26); no persisted shape-link column or field added anywhere in design.md/tasks.md
  (Decision 2 unchanged, matches the human's pre-settled constraint (a)/(b) in this prompt); Decision 5's
  no-rollback / run-retry failure handling and Decision 4's panel-type→shape mapping are unchanged from
  round 1 and were already independently grounded then.

- **Traced all five ACs to concrete tasks**: shape offering + instantiate + bind → tasks 2.1-2.3, 3.1-3.4;
  panel-type→shape mapping documented → Decision 4 + `PANEL_TYPE_SHAPES` (task 2.1); persisted-or-not
  decision documented → Decision 2; instantiation-flow + creation-step tests → tasks 4.1-4.5 (including
  the required live-browser HEL-336-guard check, task 4.5); backward compatible/additive → no schema
  change, no new endpoint, confirmed by `proposal.md`'s Impact section and absence of any migration in
  tasks.md.

### Verdict: CONFIRM

### Change Requests

None blocking. Both round-1 gaps are substantively closed in the decision-bearing documents
(`design.md`, `tasks.md`), independently verified against `ShapePickerModal.tsx`, `CreatePipelineModal.tsx`,
and `PipelineService.scala`.

### Non-blocking notes

- `specs/panel-creation-shape-step/spec.md:23` still says "an auto-derived output type name" and its
  "Submit is disabled..." scenario (lines 16-19) doesn't list the output-type-name field as a disabling
  condition — both stale relative to Decision 7. Update this spec delta (to match `design.md`
  Decision 7 / `tasks.md` 3.1) before or during execution so the archived capability spec doesn't
  contradict what was actually built.
