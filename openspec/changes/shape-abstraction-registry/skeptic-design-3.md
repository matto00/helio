## Skeptic Report — design gate (round 3)

### What I verified (with evidence)

- Read `skeptic-design-1.md` and `skeptic-design-2.md` in full as claims to re-verify, not fact.
- Read the current `ticket.md`, `proposal.md`, `design.md`, `tasks.md`, and
  `specs/pipeline-shape-registry/spec.md` in full, fresh — not just diffed against round 2.
- `openspec validate shape-abstraction-registry --strict` → `Change 'shape-abstraction-registry' is valid`.

**1. `OutputFieldContract` — round-2's `role` finding: fully resolved, no stray references.**
- Grepped `role` across `proposal.md`, `design.md`, `tasks.md`, `specs/`: the only hits are in
  `design.md`'s Decision 2 prose *explaining the removal* (lines 61-75, "carries no `role` field...
  dropped for YAGNI") and `tasks.md:8` ("no `role` field — dropped in design-gate round 2"). No
  artifact still declares or assumes a `role` field on `OutputFieldContract`. `spec.md`'s Requirement
  ("OutputContract declares the shape-level output guarantee", lines 32-38) and its scenario correctly
  state the 3-field shape (`name`, `dataType`, `nullable`) with no `role`. `tasks.md` 1.4 matches.
  Consistent everywhere. **Confirmed fixed.**

**2. `DataFieldType` FQN — round-2's finding: fixed, correct everywhere it's cited.**
- Re-read `backend/src/main/scala/com/helio/domain/model.scala:1` → `package com.helio.domain`, and
  `:229` → `sealed trait DataFieldType`. The real FQN is `com.helio.domain.DataFieldType`.
- Grepped for both the correct and incorrect forms across all artifacts: `design.md:55` now states
  `` `DataFieldType` (`com.helio.domain.DataFieldType`, declared in `model.scala` under `package
  com.helio.domain` — no separate `domain.model` package exists) ``. No occurrence of the old, wrong
  `com.helio.domain.model.DataFieldType` remains anywhere in `proposal.md`/`design.md`/`tasks.md`/
  `specs/`. **Confirmed fixed.**

**3. Routing-collision fix (round-1) — re-verified sound at the code level, and found a fresh
   internal-contradiction regression in `proposal.md`.**
- Re-confirmed the underlying bug is real: `IdParsing.scala:19` →
  `PipelineIdSegment: PathMatcher1[PipelineId] = Segment.map(PipelineId(_))` (unvalidated), and
  `PipelineRoutes.scala:21,42` → `pathPrefix("pipelines") { ... path(PipelineIdSegment) { pipelineId
  => ... } }` — any literal segment under `/api/pipelines/*` including `"shapes"` still matches this
  branch today.
- Re-confirmed `design.md` Decision 6, `tasks.md` 3.3/3.4, and `specs/pipeline-shape-registry/spec.md`
  (Requirement "GET /api/pipeline-shapes returns the shape catalog", lines 58-84) all now consistently
  specify the distinct top-level prefix `/api/pipeline-shapes` (not nested under `pipelines`), and
  correctly cite the `pipeline-steps` sibling-prefix precedent (`PipelineStepRoutes.scala:19,35` — I
  re-read this file and confirmed it genuinely mounts both
  `pathPrefix("pipelines" / PipelineIdSegment / "steps")` and a separate top-level
  `pathPrefix("pipeline-steps" / PipelineStepIdSegment)`).
- Re-confirmed via a full grep of every route file's `pathPrefix` declaration
  (`backend/src/main/scala/com/helio/api/routes/*.scala`) that no other mounted prefix
  (`dashboards`, `panels`, `types`, `data-sources`, `sources`, `connectors`, `pipelines`,
  `pipeline-steps`, `tokens`, `uploads`, `alert-rules`, `alerts`) would swallow the literal
  `pipeline-shapes` — it remains a genuinely distinct, collision-free prefix.
- **New finding: `proposal.md` was never updated and still states the old, broken route path.**
  `proposal.md:21` — `` `GET /api/pipelines/shapes` catalog endpoint (new `PipelineShapeRoutes` +
  `PipelineShapeService`) `` — and `proposal.md:31` — `` ...and the `GET /api/pipelines/shapes`
  catalog endpoint. `` — both cite `/api/pipelines/shapes`, the exact path round 1 proved is
  unreachable (swallowed by `PipelineRoutes`'s `path(PipelineIdSegment)` branch). This directly
  contradicts `design.md` Decision 6, `tasks.md` 3.3/3.4, and every requirement in `spec.md`, all of
  which correctly say `/api/pipeline-shapes`. I grepped every file in the change dir for both forms to
  confirm this is not a false positive: `pipelines/shapes` appears only in `proposal.md` (2x) and in
  `design.md`'s own explanatory prose about the *rejected* alternative (lines 105, 114, 140, 153,
  clearly framed as "the collision that was fixed" / "alternative rejected") — `proposal.md` is the
  only artifact still asserting the broken path as the actual plan. `proposal.md`'s "What Changes"
  section is typically the first thing an implementer or a sibling-ticket author reads for the
  shape-of-the-solution; as written, it would lead someone to believe the endpoint is
  `/api/pipelines/shapes`, silently reintroducing exactly the ambiguity round 1 spent a full round
  closing. This is a textbook "design contradicts proposal" internal contradiction — the class of
  issue I'm explicitly instructed to check for — and it is easy and unambiguous to fix (a two-line
  edit), which is precisely why it should not ship unfixed into the executor's hands.

**4. Fresh end-to-end contract re-scrutiny (not just the diff).**
- `ShapeStepExpansion(kind, config: JsObject)` vs. `CreatePipelineStepRequest(`type`: String, config:
  JsObject)` (`PipelineStepProtocol.scala` — re-confirmed field is backtick-quoted `` `type` ``, not
  `kind`): design.md's positional-mapping framing (not literal field-name identity) is accurate and
  the wording is precise about this, matching round-1's fix.
- `PipelineStepConfigCodec.decode(kind: String, raw: String): Try[Any]` — re-confirmed exists and
  matches Decision 1 / tasks 2.1 / 5.3's cross-check-test plan.
- `SelectConfig`/`SelectStep.Kind` — re-confirmed match Decision 7's `passthrough` claims.
- Registry pattern (`PipelineShape.Registry: Map[String, PipelineShape]`, `shapeFor(id): Either[String,
  PipelineShape]`) is a faithful mirror of the real `PipelineStep.Registry`/`companionFor` pattern
  (`PipelineStep.scala`), consistent with round 1's already-verified finding.
- `RowCountContract` (`ExactlyOne`/`AtMostParam(paramName)`/`Unbounded`) is expressive enough for all 4
  known sibling shapes per rounds 1-2's already-verified mental construction; nothing in this round
  changes that analysis.
- Catalog endpoint wire shape (`spec.md` lines 58-68: `id`, `label`, `description`, `paramsSchema`
  array, `outputContract` with discriminated `rowCount`) is now internally self-consistent across
  `design.md` Decision 3/5/6, `tasks.md` 3.1-3.3, and `spec.md` — no remaining unspecified/untested
  load-bearing piece other than the proposal.md drift noted above.
- Confirmed no code under `backend/src/main/scala/com/helio/domain/shapes/` exists yet (`ls` → no such
  directory) — the design gate has not been jumped ahead of; `git status --short` shows only the
  untracked `openspec/changes/shape-abstraction-registry/` directory, no stray backend edits.
- `RowCountContract.AtMostParam(paramName)` still has no mechanism tying `paramName` to an actual
  `paramsSchema` entry (unchanged from rounds 1-2, not exercised by the one reference shape,
  `design.md`'s own Risks section already self-identifies and defers this) — still non-blocking, as in
  prior rounds.
- The reference-shape cross-check test (AC3 / task 5.3) remains weak-by-construction (`SelectConfig`
  decode never fails) — unchanged, still non-blocking per the ticket's literal AC wording.

### Verdict: REFUTE

### Change Requests

1. **Fix `proposal.md`'s stale route path.** Lines 21 and 31 of `proposal.md` still say
   `` GET /api/pipelines/shapes `` — the exact path round 1 proved is swallowed by
   `PipelineRoutes`'s `path(PipelineIdSegment)` branch and unreachable. Update both occurrences to
   `` GET /api/pipeline-shapes `` to match `design.md` Decision 6, `tasks.md` 3.3/3.4, and every
   requirement in `specs/pipeline-shape-registry/spec.md`. This is the only remaining internal
   contradiction in the artifact set; once fixed, all five documents (ticket context aside) agree on
   the same route path.

### Non-blocking notes

- Rounds 1 and 2's findings (routing-collision root fix, weak-test-plan fix, `role` field removal,
  `DataFieldType` FQN fix) are all confirmed resolved and consistent across `design.md`/`tasks.md`/
  `specs/pipeline-shape-registry/spec.md` — the only drift found this round is the stale prose in
  `proposal.md`, which does not require any design rethinking, just a two-line text sync.
- `RowCountContract.AtMostParam(paramName)`'s lack of a `paramsSchema` cross-check remains a fair,
  already-self-identified risk for the first `AtMostParam`-using sibling shape (HEL-394) to address —
  no action needed at this gate.
- The reference-shape cross-check test being weak-by-construction (tolerant `SelectConfig.decode`)
  remains acceptable for a foundation ticket per the ticket's literal AC wording — no action needed.
