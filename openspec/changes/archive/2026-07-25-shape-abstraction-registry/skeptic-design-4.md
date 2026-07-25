## Skeptic Report — design gate (round 4)

### What I verified (with evidence)

**1. `/api/pipeline-shapes` path consistency (the round-3 fix).**
- Grepped every artifact for both `pipelines/shapes` and `pipeline-shapes`:
  - `proposal.md:21` and `proposal.md:34` now both say `` `GET /api/pipeline-shapes` `` — the two
    stray `/api/pipelines/shapes` references round 3 flagged are gone.
  - `design.md` Decision 6 (lines 97–119) prescribes `/api/pipeline-shapes`; its two remaining
    `/api/pipelines/shapes` mentions (lines 105, 114) are strictly inside the rejected-alternative /
    root-cause-of-the-collision narrative ("would have `GET /api/pipelines/shapes` swallowed by...",
    "*Alternative rejected*: keep `/api/pipelines/shapes`...") — context, not a prescription.
  - `design.md` line 140 (Risks) and line 152–153 (Planner Notes) likewise reference the old path only
    as historical/rejected context ("revised from the ticket's... suggested `/api/pipelines/shapes`").
  - `tasks.md` 3.3/3.4 and `spec.md`'s "GET /api/pipeline-shapes returns the shape catalog" requirement
    (and all 3 of its scenarios) consistently prescribe `/api/pipeline-shapes`.
  - `ticket.md` lines 14/23 still say `/api/pipelines/shapes` — this is the ticket's original,
    unmodified "e.g." suggestion (verbatim source text), and `design.md`'s Planner Notes explicitly
    call out the revision away from it. Per my brief, this is source context, not a prescription — no
    contradiction.
  - **No artifact that governs implementation prescribes the broken path.** Round 3's finding is
    fully resolved; no regression.

**2. Fresh pass over the full contract, cross-checked against real code (not the artifacts' claims about the code).**
- `PipelineRoutes.scala:20-56` — confirmed `pathPrefix("pipelines")` + `path(PipelineIdSegment)` at
  the top level, `PipelineIdSegment` unvalidated (`IdParsing.scala`) — Decision 6's routing-collision
  claim still holds against the real file.
- `PipelineStepRoutes.scala:35` — confirmed `pathPrefix("pipeline-steps" / PipelineStepIdSegment)` —
  the "existing `pipeline-steps` sibling-prefix convention" cited as precedent for Decision 6 is real,
  not invented.
- `PipelineStepConfigCodec.scala` (`def decode(kind: String, raw: String): Try[Any]`) and
  `PipelineStepProtocol.scala:138` (`CreatePipelineStepRequest(`type`: String, config: JsObject)`) —
  confirmed Decision 1's technical claims about the decode signature and the DTO's field shape are
  accurate; `PipelineStepConfigCodec.decode(kind, config.compactPrint)` (spec.md's scenario) type-checks
  against the real signature.
- `SelectStep.scala` (`SelectConfig(fields: Vector[String])`) — confirmed the `passthrough` reference
  shape's `expand` claim (one `select` step, `SelectConfig(fields)`) matches the real step's config shape.
- `model.scala:229-242` — confirmed `DataFieldType` is a `sealed trait` in `package com.helio.domain`
  (not a `domain.model` sub-package) with exactly the variants implied; `OutputFieldContract` reusing
  it is a real type, not a forward reference to something that doesn't exist.
- `Connector.scala:17` (`ConnectorFieldDescriptor(name, label, secret)` — no `dataType` field at all) —
  confirmed Decision 3's "mirrors `ConnectorFieldDescriptor`'s *role*" claim is about descriptive intent,
  not a literal field-for-field mirror (it isn't one), so it isn't overclaiming.
- `git status` / `find backend/src/main/scala/com/helio/domain -maxdepth 1` — confirmed this is a true
  design gate: `com.helio.domain.shapes` doesn't exist yet, no naming collision, nothing implemented.

**3. New finding — `RowCountContract`'s 3-variant wire encoding is a spec.md MUST with no test plan covering 2 of the 3 variants.**
- `spec.md:65-66` (Requirement "GET /api/pipeline-shapes returns the shape catalog") pins the wire
  shape as `rowCount` is `{ kind: "exactly-one" | "at-most-param" | "unbounded", paramName? }` — a
  MUST on the catalog endpoint, which HEL-400 (MCP) and HEL-402 (panel UI) are told to build against
  (design.md Decision 5/Goals).
- The only shape this ticket registers is `passthrough`, whose `outputContract` uses
  `RowCountContract.Unbounded` (design.md Decision 7) — the one variant with **no** `paramName` field
  to get right.
- I re-read every test task in `tasks.md` §5 (5.1 registry lookup, 5.2 `PassthroughShapeSpec`, 5.3
  `PipelineStepConfigCodec` cross-check, 5.4 catalog/route 200+401, 5.5 full suite regression) — none
  of them constructs an `OutputContract` with `ExactlyOne` or `AtMostParam("n")` and asserts its JSON
  encoding. Task 3.2 ("Spray JSON formats... including the `rowCount` discriminated shape from
  spec.md") requires the *code* to exist but no task requires a *test* that exercises the
  `exactly-one` or `at-most-param` branches — only `unbounded` is ever serialized, incidentally, via
  the `passthrough` catalog entry in 5.4.
- This means a real bug in the discriminated-union writer (e.g. `paramName` present for `unbounded`,
  wrong key name, `paramName` silently dropped for `at-most-param`, wrong `kind` string) would compile
  fine — `RowCountContract` is `sealed`, so exhaustive pattern-matching is compiler-enforced, but
  *correctness* of each branch's JSON is not — and would go undetected by this ticket's own test suite.
  It would only surface when a sibling ticket (single-row → `ExactlyOne`, top-N → `AtMostParam("n")`,
  per design.md Decision 2's own mapping) is the first to actually exercise that branch, at which
  point the bug is in code this ticket owns but a different ticket has to debug — exactly the
  "expensive to unwind across eight tickets" failure mode the proposal's own "Why" section is trying
  to avoid, and a direct violation of "every guaranteed claim must have a test that fails when it
  stops being true" for a MUST requirement this ticket itself specifies and owns.
- This is **not** something an implementer following `tasks.md` literally would produce on their own
  initiative — no task calls for it, and the two non-default variants have zero natural exercise path
  through this ticket's single registered shape.

### Verdict: REFUTE

**Classification: (a) NEW substantive issue** — a real, previously-unflagged test-coverage gap on a
spec.md MUST for the foundational wire contract every sibling ticket depends on. It is narrower in
scope than rounds 1–2's findings (a one-task addition, not a redesign or a re-architecture), but it
meets the bar this round was explicitly asked to check: an unenforced "guaranteed" claim.

### Change Requests

1. Add a test task (extend `tasks.md` §3.2 or add a new §5 item, e.g. a
   `PipelineShapeProtocolSpec` or an addition to `PipelineShapeServiceSpec`) that hand-constructs an
   `OutputContract` for all three `RowCountContract` variants — `ExactlyOne`, `AtMostParam("n")`, and
   `Unbounded` — and asserts each serializes to the exact wire shape `spec.md:65-66` pins: `kind` is
   `"exactly-one"` / `"at-most-param"` / `"unbounded"` respectively, and `paramName` is present (and
   equal to `"n"`) **only** for the `at-most-param` case and absent for the other two. This closes the
   gap before any sibling ticket becomes the first real consumer of the two untested branches.

### Non-blocking notes

- `ShapeParamDescriptor.dataType` is a plain `String` while `OutputFieldContract.dataType` reuses the
  real `DataFieldType` enum — a minor asymmetry (descriptive/catalog metadata vs. an enforced row-type
  vocabulary) that is defensible given `paramsSchema` is explicitly non-validating (design.md Decision
  3), but worth a one-line justification in design.md if a sibling-ticket author ever needs a param
  whose `dataType` should be a real `DataFieldType` value (e.g. a "which field" selector param). Not
  blocking — no AC requires it and nothing in this ticket's scope needs it resolved now.
- `expand`'s "pure function, no repo/network/ActorSystem access" guarantee is structurally enforced by
  the trait signature (no such dependency is ever passed in) rather than by an explicit purity test —
  reasonable for a foundation trait with a single trivial reference implementation; flag only if a
  sibling shape's `expand` ever needs something that tempts a static/global side-channel.
