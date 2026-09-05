## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence)

- **Read all artifacts**: `ticket.md`, `proposal.md`, `design.md`, `tasks.md`,
  `specs/schema-inference/spec.md`. No `TODO`/`TBD`/deferred decision found.

- **(a) One rule, not two — CONFIRMED.** Design D1/D2 replaces `PathAcc.nullable: Boolean`
  with `presentNonNullCount: Int` and derives `nullable = presentNonNullCount < objects.size`
  at projection. Read the live code
  (`backend/src/main/scala/com/helio/domain/engine/SchemaInferenceEngine.scala:96-125`):
  today there is exactly one `nullable = true` assignment (the `JsNull` branch, line 107);
  under the plan there is none — both absence and `JsNull` become the same arithmetic.
  That is genuinely one rule. Order-independence follows from commutativity of addition,
  and the spec states it normatively ("function of the SET ... SHALL NOT depend on their order").

- **Adversarial probe of D1 (double-increment hazard) — REFUTED by ground truth.** A count-based
  accumulator would be wrong if `JsonFlattener.leaves` could emit the same dotted path twice for
  one object (e.g. `{"a.b":1,"a":{"b":2}}`), since the count could reach `objects.size` while an
  object genuinely lacked the path. I read `JsonFlattener.leaves`
  (`JsonFlattener.scala:53-64`): it folds `walk` into a `ListMap` and returns
  "AT MOST ONE pair per dotted path". So the increment is bounded at 1 per object per path and
  D1 is sound. Not a change request.

- **(b) Three encodings — CONFIRMED enumerated and distinguished.** The ADDED requirement
  `JSON nullability from absence or null` names absent / explicit `JsNull` / present-but-empty
  (`JsString("")`), states the first two are identical and the third is a present non-null
  `StringType` value, and has distinct scenarios for each plus a fourth side-by-side scenario
  ("The three encodings are distinguished"). Tasks 3.2/3.3/3.4/3.5 mirror them one-for-one and
  are named by encoding. CSV's inability to encode the distinction is stated as a *retained*
  divergence in the MODIFIED CSV requirement, not silently aligned.

- **(c) Spec restructure is honest — VERIFIED scenario-by-scenario, not taken on trust.**
  Live `openspec/specs/schema-inference/spec.md` `Requirement: JSON schema inference` has 15
  scenarios (lines 11-68). Two are dropped: `Null value marks field as nullable` (subsumed
  verbatim-in-effect by `Explicit null still marks a field nullable`) and
  `Absence of a key does not by itself mark a field nullable` (the codified defect itself).
  I diffed the remaining 13 against the ADDED `JSON schema field enumeration`: all 13 are
  present and textually verbatim (Root object infers fields from keys; Root array infers union
  of keys; Nested sub-keys unioned; A field absent from the first element still appears; Nested
  object flattened with dot notation; Inferred nested field is one the rows carry; Schema and
  rows agree on colliding dotted paths; scalar-vs-subtree yields both paths; Schema field set is
  the union of the rows' column sets; Array field is a string leaf; Float vs integer; Timestamp
  pattern). The requirement prose is also carried verbatim except for the deliberate insertion
  of the nullability cross-reference. **No coverage is quietly dropped.** I also checked the
  neighbouring requirements for contradiction: `JSON type widening`'s nullability-touching
  scenarios ("A null alongside integral values yields a nullable integer", "All-null path is a
  nullable string") remain consistent with the new composed rule, and
  `Order-independent JSON schema inference` is unaffected.

- **(d) Tests would prove the produced value — CONFIRMED, and the fixtures actually support them.**
  Task 3.6 asserts the inferred `nullable` for a path carried by 1 of 100 objects (the ticket's
  literal AC1), and task 3.7 asserts it on the real fixture. I checked the fixtures exist and are
  adequate rather than assuming it:
  - `backend/src/test/resources/hel858/sleeper-mixed-projections-slice.json` — 15 elements,
    84 leaf paths, of which **41 are present and non-null in all 15**. So task 3.7's
    false-positive guard ("a path present in all 15 elements is non-nullable") is satisfiable
    on real data, not vacuous.
  - `backend/src/test/resources/hel599/sleeper-wr-projections-slice.json` — 3 elements,
    63 paths, of which 53 are always-present-non-null. **10 fields will flip to nullable**, so
    task 3.12 (update the pinned 63-field `(name, type, nullable)` expectation) is a real,
    correctly-anticipated consequence rather than a speculative one. A plan that had assumed
    "single-shape fixture, nothing flips" would have been wrong here; this one did not.
  - Task 3.1 inverts the existing assertion at
    `SchemaInferenceEngineSpec.scala:81` (`"not mark field nullable when merely absent..."`,
    currently `shouldBe false`) — an inherently red-before/green-after regression proof.

- **Run constraints — all honoured.** No Flyway migration or DB change (design Non-Goals + task
  1.6; D6 establishes `SchemaInferenceFacade.toSchemaFields` drops `nullable` before persistence,
  which I confirmed is the basis for "nothing persisted changes"). No browser/Playwright (backend
  unit tests only). `WorkspaceContextService.scala` is read-only reference only; `PipelineService`,
  `api/protocols/patchsets/`, the proposal surface and `helio-mcp` are explicitly out of scope.
  HEL-893 is explicitly not fixed — task 2.3 records a finding and changes nothing.

- **Ticket AC coverage traced.** AC1→3.6/3.7 + spec scenario "1 of 100"; AC2→3.4/3.10 + the
  false-positive scenario; AC3→3.2/3.3/3.4/3.5; AC4→the ADDED nullability requirement;
  AC5→D6 + task 2.2; AC6→3.8 + the order-independence scenario; AC7→D5 + task 2.1 + 3.9.
  No AC is uncovered, and no task exceeds the ticket's scope.

### Verdict: CONFIRM

### Non-blocking notes

1. Task 1.6 says "no file outside `SchemaInferenceEngine.scala` (plus tests) is touched", but the
   spec deltas under `openspec/changes/` are of course also touched. Wording only.
2. Tasks 3.6 and 3.7 are new tests (not inversions), so their red-before state is not automatic.
   Worth capturing the pre-fix failing output for them explicitly, so the regression proof is
   evidence rather than inference — 3.1 alone carries that burden today.
3. D5's claim that absence cannot affect the widened type is pinned by task 3.9 on the
   integral case only. A second, cheap case (a path that is `StringType` in some objects and
   absent from the rest) would close the "only tested one arm of the lattice" gap. Optional.
