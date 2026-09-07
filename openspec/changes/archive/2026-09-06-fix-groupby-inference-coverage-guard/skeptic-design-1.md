## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence)

**Drift finding: CORRECT.** Verified independently against the live tree, not the narrative.
- `PipelineStep.scala:205-229` — `Registry` has exactly **23** entries (rename, filter, join,
  compute, groupby, cast, select, limit, sort, aggregate, splittext, extractheadings,
  chunkbytokencount, datebucket, pivot, window, unpivot, dedupe, fillnull, stringops, union,
  lookup, assert).
- `PipelineAnalyzeService.scala:447-479` — the `op match` dispatches **22** kinds. `case "join"
  => inferJoin(inputSchema, secondarySchema)` is present at line 461 with an HEL-911 comment
  block; `inferJoin` is defined at line 918; `secondarySchema` is a real parameter (line 445);
  `laneDependencyOf` is used in `analyzeNodes` (line 264). **`groupby` is the sole missing kind**
  and falls to `case unknown => (inputSchema, Some(s"Unknown op: '$unknown'"))`.
- The ticket-as-filed's 21-of-23 / "join also missing" claim is stale; the restated 22-of-23
  scope is right. AC5 correctly voided.

**AC2 types: CORRECT against the runtime.** `GroupByStep.scala` — `case "count" =>
groupRows.count(...).toLong` and `case "sum" => nums.sum` over `PipelineRowJson.toDouble`
results. `aggResultType` (`PipelineAnalyzeService.scala:1006-1012`) returns `"integer"` for
`count` and `"float"` for `sum`. Match confirmed. `SupportedFunctions = Vector("sum","count")`
confirmed, so the `min`/`max`/`avg` arms are indeed unreachable from this path.
`GroupByConfig(groupBy, aggColumn, aggFunction)` has no alias field — the design's correction of
the ticket's AC3 wording is right. `outputCol = aggFn + "_" + aggCol` with `aggFn =
cfg.aggFunction.toLowerCase` confirmed.

**Decision 5 independence: sound, and stronger than the design realizes.** The shared-source
name risk from Decision 1 is already independently pinned by pre-existing literal assertions in
`InProcessPipelineEngineSpec.scala:359` (`engRow("sum_age") shouldBe 30.0`) and `:367`
(`engRow("count_name") shouldBe 2L`), which assert the emitted column NAME as a literal against
real executed rows. Extracting `outputColumnName` cannot silently change the wire name without
turning those red. No revision needed.

**Decision 3 (absent key -> `string`): right call.** `string` is already this file's canonical
conservative fallback (`aggResultType`'s `min`/`max` and `_` arms both fall back to `"string"`).
In-source documentation mirroring HEL-911's `join` treatment is proportionate for a
best-effort projection that carries no wire-shape change.

**Decision 1 / task 2.2 probe: pre-answered, and the design looked in the wrong place.**
`validateGroupBy` (`PipelineAnalyzeService.scala:414-419`) DOES lowercase:
`val fn = cfg.aggFunction.toLowerCase` before `SupportedFunctions.contains(fn)`. There is no
pre-existing inconsistency to report; task 2.2 is a no-op. The real lowercasing hazard is
elsewhere — see Change Request 3.

**Attack on the guard (the primary deliverable): it does not survive.** See Change Requests 1
and 2. The decisive evidence is `PipelineAnalyzeService.scala:136-139` and `:271-278`:

```
val (output, err) = validateStepConfig(step.op, step.config) match {
  case Some(msg) => (currentSchema, Some(msg))
  case None      => inferOutputSchema(step.op, step.config, currentSchema)
}
```

`inferOutputSchema` **is not called at all** when validation reports a problem.

### Verdict: REFUTE

### Change Requests

1. **The guard as designed is unimplementable: `inferOutputSchema` is `private`.**
   `PipelineAnalyzeService.scala:441` declares `private def inferOutputSchema` inside
   `object PipelineAnalyzeService` (line 40). Scala `private` (not `private[engine]`) is
   object-private — `PipelineAnalyzeServiceSpec`, though in the same package, **cannot call it**.
   Design Decision 4 and tasks 3.2 / 4.x instruct the executor to "call `inferOutputSchema` once
   per kind" and say nothing about access. As written the executor will hit a compile error and
   improvise silently, most likely by routing through the public `analyze`, which is exactly the
   failure mode of CR2. Decide and record the access path explicitly in Decision 4: either widen
   to `private[engine]` (with an in-source note that the widening exists for the coverage guard),
   or add a narrow public test hook, or state that the guard goes through `analyze` **and then
   adopt CR2's stricter assertion**. Do not leave this to the executor.

2. **Decision 4's "key on the `Unknown op` signal specifically" rule is NOT sufficient — it is
   the mechanism by which the guard goes vacuously green.** If the guard reaches inference via
   `analyze` / `analyzeNodes`, then for any kind whose minimal probe config trips
   `validateStepConfig`, inference is **never invoked** (lines 136-139, 271-278), so no
   `Unknown op` can ever be produced — and the guard passes while that kind genuinely has no
   dispatch branch. This is not hypothetical: **13** step files override `requiredConfigProblems`
   (Limit, Compute, ChunkByTokenCount, DateBucket, Dedupe, Pivot, ExtractHeadings, SplitText,
   Filter, StringOps, Join, Lookup, Window), and 8 kinds additionally have per-kind validators in
   `validateStepConfig`'s `kind match` (stringops, fillnull, window, aggregate, groupby, pivot,
   union, join). A "minimal" config for any of those yields a non-`Unknown op` validationError,
   which Decision 4 explicitly instructs the guard to accept as fine. The guard would then assert
   coverage for kinds it never actually probed. Required: the guard must either (a) call
   `inferOutputSchema` directly per CR1's widened access, so validation cannot intercept, or
   (b) if routed through the public surface, use a **fully valid** config per kind and assert
   `validationError` is `None` — asserting per kind that validation did not intercept, so a
   probe that never reached inference fails loudly rather than counting as covered. Update
   Decision 4, tasks 3.2, and the spec delta scenario "every registered kind has an inference
   branch" (whose current wording inherits the same hole).

3. **Decision 2 / task 2.3 omit the lowercasing that the type path also needs.** Decision 1
   correctly identifies lowercasing as load-bearing but reasons only about the column *name*.
   `aggResultType` (line 1006) matches on the raw `fn` string and has `case _ => "string"`, so a
   config carrying `"SUM"` — which `validateGroupBy` accepts, because it lowercases before
   checking `SupportedFunctions` — would project `sum_amount` typed **`string`**, not `float`.
   That is precisely the "confidently wrong about types" outcome Decision 2 says is worse than
   `Unknown op`. Require task 2.3 to pass `cfg.aggFunction.toLowerCase` into `aggResultType`
   (ideally the same lowercased value used for the name, computed once), and add a task-4 case
   covering a mixed/upper-case `aggFunction` asserting the projected type is still `float`.

### Non-blocking notes

- Decision 5's independence argument would be materially stronger if it cited
  `InProcessPipelineEngineSpec.scala:359,367` by name as the existing independent pin on the
  literal emitted column name; the current wording ("the existing engine specs still cover
  execution", Risks section) understates a guarantee that is already in the tree.
- Task 4.1 compares inferred canonical type strings (`"integer"`/`"float"`) against runtime Scala
  values (`Long`/`Double`). There is no `inferFieldType`-style helper in `main` to do that
  mapping, so the test must define the correspondence itself. Worth naming that mapping
  explicitly in the test rather than inlining it per assertion, so it is visible as a judgment.
- The exemption rule (Decision 4 / task 3.4: explicit `Map[String, String]` asserted to be a
  subset of the registry, no predicates or prefixes, empty-map case asserted) is airtight as
  written — conditional on the guard actually detecting, i.e. on CR1/CR2 being resolved.
