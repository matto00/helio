## Skeptic Report — design gate (round 3, skeptic-design-3.md)

### What I verified (with evidence)

Cold re-derivation from backend source in this worktree; the round-2 prose was treated as a claim only.

Round-2 change requests — status:

1. **CR1 (`POST /api/pipeline-steps` does not exist) — RESOLVED.**
   `api/routes/pipelines/PipelineStepRoutes.scala:21-35` confirms creation is
   `POST /api/pipelines/:id/steps` (201-Created), and `:47` confirms the `pipeline-steps/:id` prefix
   carries PATCH/DELETE/duplicate only. design.md decision 5 (lines 61-66) and task 5.6 now name the
   correct path, explicitly call out the wrong one, and specify `parentStepId` = chosen node —
   which `CreatePipelineStepRequest` really does carry
   (`api/protocols/pipelines/PipelineStepProtocol.scala:167-173`, `jsonFormat5` at `:352`).

2. **CR2 (expand has no `parentStepId`; tail parenting is client-side) — RESOLVED.**
   `PipelineShapeProtocol.scala` — `ExpandPipelineShapeRequest(params: JsObject)` and nothing else;
   `PipelineShapeRoutes.scala:35` forwards `req.params` alone. `ShapeStepExpansionResponse.fromDomain`
   assigns synthetic `"step-N"` `clientId`s with `parentStepId` = the PRIOR entry's `clientId`
   (`None` for index 0). New design.md decision 11 and the rewritten delta (spec.md:63-83) describe
   exactly this: params-only request, root created against the chosen step's real id (or omitted),
   subsequent steps resolved through a `clientId -> real id` map. Task 6.3 matches.

3. **CR3 (dormant `outputs` arm) — RESOLVED for the labelling half.**
   `ExpandPipelineShapeResponse(steps, outputs: Option[JsArray] = None)` and `fromDomain` hard-codes
   `outputs = None`; the docstring states `None` for EVERY shape. design.md decision 12 and the delta
   (spec.md:80-83, scenario headings at :85 and :92) now say fixture-only/dormant vs. the live path,
   and decision 12 names the element shape the client parses. See non-blocking note 1 for the one
   sub-item not carried over.

Non-blocking notes from round 2 — both adopted: the zero-step trunk-seed case is now its own scenario
(spec.md:98-101) and is in decision 11(b) and task 6.3; decision 8 (lines 98-103) now labels the
`key={chartType}` remount as a hypothesis and requires a probe-confirmed root cause per
`.concertino/laws/systematic-debugging.md` before the fix.

New grounding checks this round (the cold pass over what round 2 did not cover):

- `domain/shapes/ShapeParamDescriptor.scala:16-22` — exactly five fields
  (`name, label, dataType, required, description`); `PipelineShapeProtocol` serializes it with
  `jsonFormat5`. `grep -rn "enum\|fieldRef" backend/src/main/scala/com/helio/domain/shapes/` returns
  one unrelated prose hit in `PivotMatrixShape.scala:81` — no `enum`/`fieldRef` metadata exists on the
  descriptor, on the wire, or on any of the five registered shapes.
- `docs/superpowers/specs/2026-08-30-pipelines-outputs-remodel-design.md:223` and `:271` — HEL-731 is a
  **cancelled** ticket "folded as acceptance criteria of" P1.5, i.e. it must actually ship here.
- `OutputRoutes.scala` (`POST /api/pipelines/:id/outputs`, `GET /api/outputs/:id/panels`) and
  `CreateOutputRequest.nodeStepId` re-confirmed still as decisions 5/9 assume.

### Verdict: REFUTE

### Change Requests

1. **The `enum`/`fieldRef` shape-param requirement is unimplementable against the shipped backend, and
   the plan does not acknowledge it — same defect class as round-2 CR3, in the same spec file.**
   `specs/pipeline-shape-instantiation-ui/spec.md:30-46` requires `ShapeParamsFields` to honor
   `enum` and `fieldRef` "metadata when present on the descriptor", with two scenarios stated as live
   ("WHEN a shape's paramsSchema entry declares `enum: ["asc","desc"]`" / "declares `fieldRef: true`").
   No descriptor can ever declare either: `ShapeParamDescriptor` has five fields and no `enum`/`fieldRef`
   (`domain/shapes/ShapeParamDescriptor.scala:16-22`, serialized `jsonFormat5`), and none of the five
   registered shapes emits such metadata. So both scenarios are fixture-only by construction, and
   task 6.2 ("Extend `ShapeParamsFields` for `enum`/`fieldRef` widget metadata (HEL-731)") delivers a
   branch nothing can reach — HEL-731, which the binding spec (line 271) folds into this row as an AC,
   would not actually be absorbed. Resolve one of two ways, explicitly:
   (a) plan the backend half — add `enum: Option[Vector[String]]` / `fieldRef: Option[Boolean]` (or
   equivalent) to `ShapeParamDescriptor`, bump the format off `jsonFormat5`, and have at least one
   registered shape declare each so the scenarios are live — and amend design.md's Non-Goal
   "Backend route changes — this ticket consumes P1.3/P1.4 routes as-is", which currently forbids
   exactly this; or
   (b) mirror decision 12: state in design.md and in the delta that the enum/fieldRef arm is
   dormant/forward-compatible and fixture-tested only, and record that HEL-731 is therefore NOT
   absorbed by this ticket, naming the follow-up that will carry it. Either way the choice must be a
   recorded decision, not left to the executor to discover mid-build.

### Non-blocking notes

- Round-2 CR3 also asked what the client does with an `outputs` element it **cannot** parse (the wire
  type is an untyped `JsArray`). Decision 12 names the expected element shape but not the
  unparseable-element behavior. Non-blocking only because the arm is unreachable today; one sentence
  ("skip and surface a toast" vs. "abort seeding") would close it.
- design.md's decision list is ordered 1-5, 11, 12, 6-10. Harmless, but a reader following
  "decision 6" positionally will land on the wrong item; renumber or reorder when next edited.
