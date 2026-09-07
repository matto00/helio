## 1. Establish the red arm first

- [x] 1.1 Add a failing test to `PipelineAnalyzeServiceSpec` asserting a valid `groupby`
      step reports no `validationError`. Run it and confirm it is RED with
      `Some("Unknown op: 'groupby'")` before writing any fix.
- [x] 1.2 Add the coverage guard (task 3) in its red state and confirm it names `groupby`
      specifically — not a generic "coverage mismatch".

## 2. Implement groupby inference

- [x] 2.1 Extract `GroupByStep.outputColumnName(cfg: GroupByConfig): String` from the
      existing `outputCol` expression in `GroupByStep.apply`; call it from `apply` so
      there is exactly one definition of the name. Lowercase `aggFunction`, as `apply`
      already does (design Decision 1).
- [x] 2.2 (RESOLVED by skeptic round 1 — no action.) `validateGroupBy` (~line 414) DOES
      lowercase before `SupportedFunctions.contains`. No pre-existing inconsistency exists.
      The lowercasing hazard is on the TYPE path instead — see task 2.3.
- [x] 2.3 Add `private def inferGroupBy(config, inputSchema)` to `PipelineAnalyzeService`:
      group-key fields in config order with types resolved from `inputSchema` by name
      (absent key -> best-effort `string`, documented in-source with the reason, per
      design Decision 3), followed by `GroupByStep.outputColumnName(cfg)` typed via the
      existing `aggResultType(fn, aggColumn, inputSchema)` helper (Decision 2).
- [x] 2.4 Wire `case "groupby" => inferGroupBy(config, inputSchema)` into the
      `inferOutputSchema` dispatch. Follow the file's existing error convention: wrap in
      the same `parseConfig`-style handling used by sibling `infer*` methods so a
      malformed config yields a `"groupby config error"`, not a thrown exception.
- [x] 2.5 Confirm task 1.1's test is now GREEN.
- [x] 2.6 No inline fully-qualified names anywhere in the new Scala (CONTRIBUTING.md).

## 3. The coverage guard (PRIMARY DELIVERABLE)

- [x] 3.0 Widen `inferOutputSchema` from object-`private` to `private[engine]` so the spec
      can call it at all. Add an in-source comment stating the widening exists for the
      coverage guard and for no other reason (skeptic CR1). Without this the guard does not
      compile.
- [x] 3.1 Derive the expected set from `PipelineStep.Registry.keySet` — never a second
      hand-maintained constant.
- [x] 3.2 Establish actual coverage by calling `inferOutputSchema` **DIRECTLY** once per
      kind. Do NOT route the probe through `analyze`/`analyzeNodes`: those short-circuit on
      `validateStepConfig` and never invoke inference on a validation error, so a kind with
      a required-config validator would be certified as covered without ever being probed
      (skeptic CR2 — 13 kinds override `requiredConfigProblems`, 8 more have per-kind
      validators).
- [x] 3.3 Use a **fully valid** config per kind — AND a per-kind `inputSchema` compatible
      with it, since several kinds validate config fields against the input schema rather
      than merely for well-formedness — e.g. `pivot`, `assert`, `unpivot`, `compute` via
      `ExpressionEvaluator.validate`, and `splittext`/`extractheadings`/`chunkbytokencount`
      which need a `string-body`-typed field present; `window` does NOT. This list is
      illustrative, not exhaustive — verify per kind — and assert the returned `validationError` is
      `None`, not merely "not an Unknown op". A probe that landed in a config-error arm did
      not exercise inference and must fail loudly rather than count as covered.
- [x] 3.4 Failure message names the specific uncovered kind(s), e.g.
      "groupby has no inferOutputSchema branch".
- [x] 3.5 Any exempt kind is listed in an explicit `Map[String, String]` of kind -> stated
      reason, asserted to be a subset of the registry. No predicate, prefix, or pattern
      exemption. If no kind needs exempting, the map is empty and that emptiness is asserted.
- [x] 3.6 Confirm the guard is GREEN once task 2 lands.

## 4. groupby projection tests (AC2)

- [x] 4.1 Assert the inferred schema against what `GroupByStep.apply` ACTUALLY emits on
      real fixture rows — take the produced rows' key set and value types and compare
      (design Decision 5). Do not re-derive the expectation from the config.
- [x] 4.2 Cover `sum` over a `float` column -> `sum_amount: float`.
- [x] 4.3 Cover `count` over a `float` column -> `count_amount: integer` — the case that
      proves the type follows the function, not the input column.
- [x] 4.4 Cover multi-column `groupBy`, asserting key order matches config order.
- [x] 4.5 Cover a `groupBy` column absent from the input schema (best-effort path).
- [x] 4.6 Cover a mixed/upper-case `aggFunction` (e.g. `"SUM"`), asserting the projected
      type is still `float` and the column still named `sum_amount` (skeptic CR3).
- [x] 4.7 Name the canonical-type <-> runtime-value correspondence
      (`"integer"` <-> `Long`, `"float"` <-> `Double`) explicitly as a single named mapping
      in the test rather than inlining it per assertion — there is no `inferFieldType`
      helper in `main` to borrow, so this correspondence is a judgment and should be visible
      as one.

## 5. Prove the red arm (AC4)

- [x] 5.1 Delete the `case "groupby"` arm; run the guard; capture the output showing it
      names `groupby` specifically. Restore the arm; confirm green.
- [x] 5.1a Additionally prove the guard is not vacuous in the CR2 direction: temporarily
      delete some OTHER kind's arm whose config has a required-config validator (e.g.
      `window` or `pivot`) and confirm the guard still goes red naming THAT kind. This is
      the case a validation-intercepted guard would have missed. Paste both
      transcripts into the delivery report — this is required evidence, not optional.
- [x] 5.2 Confirm the failure isolates to the intended step: the guard goes red for
      `groupby` and no other kind.

## 6. Gates

- [x] 6.1 `cd backend && sbt test` fully green (not just the touched specs).
- [x] 6.2 `openspec validate fix-groupby-inference-coverage-guard --type change` exits zero.
- [x] 6.3 Write `files-modified.md` listing every file touched.
- [x] 6.4 Commit. No migration is added — state this explicitly in the commit body.

## 7. Remove the now-false "unassertable" comment (AC5)

- [x] 7.1 Delete the stale comment at
      `backend/src/test/scala/com/helio/api/routes/pipelines/PipelineAnalyzeRoutesSpec.scala:492-497`.
      It claims `groupby`/`join` have no `inferOutputSchema` dispatch case and that their
      valid-config path is "unassertable" — already half-false since HEL-911 gave `join` an
      arm, and wholly false once this change lands.
- [x] 7.2 Assert the positive path it says is unassertable: a valid `groupby` step analyzed
      through the real route returns no `validationError`. This is the route-level
      counterpart to the service-level test in task 1.1 — keep it, do not treat 1.1 as a
      substitute, since this one exercises `validateStepConfig` -> dispatch end to end.
- [x] 7.3 Re-run a full-tree `grep -rn "unassertable" backend/src/` and confirm zero hits.
      (The earlier "already gone" claim came from grepping ONE file — do not repeat that.)
