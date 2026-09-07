## Skeptic Report — design gate (round 4, skeptic-design-4.md)

### What I verified (with evidence)

- **Residue sweep (all five artifacts).** `grep -rniE "unknown op|not merely|weaker|vacuous"` over
  ticket.md / proposal.md / design.md / tasks.md / specs/. Round 3's three fixes are real and
  strict: ticket.md AC3 ("probed by CALLING `inferOutputSchema` DIRECTLY ... asserting
  `validationError` is `None` — never merely 'no `Unknown op`'"), design.md:93-94 (Decision 4 lead
  now strict + explicit forbid pointer), design.md:127 (Belt and braces), design.md:187 (Risks —
  "forbidden, not a fallback"), proposal.md:32, tasks.md:48, spec delta's guard scenario ("no
  invocation reports any validationError at all"). **One survivor found** — see CR1.
- **Registry vs dispatch, from source.** `PipelineStep.scala:205-228` = 23 kinds;
  `PipelineAnalyzeService.scala:448-476` = 5 passthrough + 17 arms = 22. `groupby` is the sole gap;
  `join` has a real arm (HEL-911). Premise confirmed independently.
- **Corrected input-schema-validating list, checked against source.** `inferPivot` (:742) and
  `inferUnpivot` (:810) return `Some("Unknown field(s): ...")`; `inferSplitText` (:617) requires a
  present `string-body` field; `inferAssert` (:942) checks rule fields against `fieldNames`.
  `inferWindow` (:778) does **not** validate against the input schema — it falls back to `string`.
  design.md's corrected list is accurate. tasks.md 3.3 was not correspondingly updated — non-blocking
  note 1.
- **Guard achievability.** `inferUnion` (:898), `inferJoin` (:918), `inferLookup` (:869) all return
  `None` error when `secondarySchema` is `None`. Every other kind errors only on malformed config or
  an absent input field — both author-controlled. `validationError == None` for all 23 kinds is
  attainable, so the strict assertion is not an impossible bar that would pressure a later weakening.
- **AC5 fold-in against the tree.** `grep -rn "unassertable" backend/src/` → exactly one hit,
  `PipelineAnalyzeRoutesSpec.scala:494` (comment block ~491-497), matching the restated scope. Read
  it: it asserts `groupby`/`join` have no dispatch case and the positive path is "unassertable" —
  half-false today, wholly false after this change. tasks 7.1/7.2/7.3 delete it, assert the positive
  route path, and re-sweep the whole tree. Task 7.2 is genuinely additive: the surrounding test at
  :486-499 goes through `Get(/pipelines/$pid/analyze) ~> routes`, i.e. `validateStepConfig` →
  dispatch end to end, which the service-level test in task 1.1 does not exercise.
- **Previously-approved parts survived.** `GroupByStep.scala:58-79`: `SupportedFunctions =
  {sum,count}`, `aggFn = cfg.aggFunction.toLowerCase`, `outputCol = aggFn + "_" + aggCol`,
  `nums.sum` (Double) / `.toLong` — Decisions 1/2 correct including the lowercase hazard
  (`aggResultType`:1008-1010 ends `case _ => "string"`, and `validateGroupBy`:414-419 lowercases
  before the support check, so `"SUM"` is accepted and would type `string` — the hazard is real and
  tasks 4.6 covers it). Decision 3 best-effort fallback, Decision 4's by-name-only exemption map with
  asserted emptiness, and tasks 5.1 + 5.1a (the two-part red arm, including the CR2-direction
  proof on a validator-bearing kind) are all intact.

### Verdict: REFUTE

One surviving weak-form statement, in the binding spec delta.

### Change Requests

1. **`openspec/changes/fix-groupby-inference-coverage-guard/specs/pipeline-analyze-api/spec.md:37`**
   — the best-effort scenario's THEN is the forbidden weak form:
   "**THEN** analyze still projects that key field **without reporting `Unknown op`**, using the
   documented best-effort fallback type". A `groupby` whose `groupBy` names a column absent from the
   input schema is a *valid config* (`validateGroupBy` checks only `aggFunction`), so by this
   requirement's own lead sentence ("MUST NOT report a `validationError` for a `groupby` step whose
   config is valid") the scenario must assert **`validationError` is absent**, not merely that it is
   not an `Unknown op`. As written it licenses exactly the assertion shape design.md Decision 4 and
   the Risks section declare forbidden, in the one artifact that is binding after archive.
   Restate as: "**THEN** that step's `validationError` is absent and the key field is projected using
   the documented best-effort fallback type".

### Non-blocking notes

- `tasks.md` 3.3 still lists `window` among the kinds that "validate config fields against the input
  schema" — round 3 corrected this in design.md but not here. `inferWindow`
  (`PipelineAnalyzeService.scala:778-800`) degrades to `string` and never errors. Harmless to the
  guard (a compatible input schema for `window` costs nothing) but stale. Consider mirroring
  design.md's corrected, explicitly non-exhaustive list.
- `design.md` Non-Goals: the round-3 correction paragraph was inserted mid-list, leaving the trailing
  fragments "Any change to the `AnalyzedStep` wire shape. Any migration." orphaned onto the end of
  the correction paragraph, where they read as part of the AC5 discussion rather than as Non-Goals.
  Readability only — the content is right.
