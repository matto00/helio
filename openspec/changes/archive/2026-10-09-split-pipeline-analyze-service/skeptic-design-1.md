## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed tree: worktree HEAD `ecaa1a532dcbf10b8d7f3664335bff392fd59554` (= origin/main ecaa1a53), change dir untracked.

### What I verified (with evidence)

- **Spawn guard**: `assert-cwd.sh` -> `READY ambient=/home/matt/Development/helio branch=task/split-pipeline-analyze-service/HEL-1385`.
- **File size / members**: `wc -l` = 1201. I enumerated every 2-space member (`grep -nE '^  (private...)?(def|val|...)'`):
  log 42, StepConfigInvalidCode 47, stepConfigProblem 52, schemaFieldJsonFormat 84, PipelineStepInput 108,
  AnalyzedStep 115, analyze 137, NodeStepInput 184, DefaultRootKey 196, laneDependencyOf 225, sourceDependencyOf 242,
  analyzeNodes 264/275, validateStepConfig 344 + 8 validators 401-456, inferOutputSchema 470, 22 infer* helpers,
  canonicalizeLegacyType 589, AssertFieldRequiredKinds 1130, AssertRuleKinds 1134, parseConfig 1139,
  aggregateResultType 1187, aggResultType 1194. Every one is assigned in D1/D2. No member is missed.
- **D2 line ranges** (printed with `awk` line numbers): SchemaField doc+class 13-36 correct; validation doc starts 331,
  validateJoin closes 461 (462-463 blank); HEL-872 comment 464-469, dispatch closes 515; select doc 518; aggregate
  closes 648; orphan splittext doc 650-657 directly above convertformat doc 658; chunkbytokencount closes 849;
  datebucket doc 851; stringops closes 995; lookup doc 997; join closes 1076; assert doc 1078; AssertRuleKinds 1134;
  parseConfig doc 1137-1153; groupby doc 1154; aggResultType closes 1200. **Line 1201 is the closing `}` of
  `object PipelineAnalyzeService`, not part of aggResultType** (D2 says 1154-1201). **Lines 464-469 are claimed twice**
  (D2 moves them in "464-516"; D1 keeps the HEL-872 comment above the forwarder).
- **Cross-family calls**: parseConfig (refs 520, 527, 534, 862, 919, 992, 1014, 1167 -> Column/Reshape/Multi import it
  from StepSchemaInference); canonicalizeLegacyType (536, 560, 568) and aggregateResultType/aggResultType (637, 1178,
  1190) all intra-Column; AssertRuleKinds/AssertFieldRequiredKinds intra-Reshape; laneDependencyOf in moved code only in
  comments (483, 1038); log at 94 (kept) and 575, 646, 692, 724, 753, 776, 810, 847, 903, 976, 1125, 1150 (moved).
  No moved body uses `convertTo[...SchemaField]`/the implicit `schemaFieldJsonFormat`, so losing it from scope is safe.
- **stepConfigProblem single entry**: `RunConfigGate.scala:20` calls `PipelineAnalyzeService.stepConfigProblem`;
  `AutoRunTriggerService.scala:130` and `PipelineService.scala:1079` consume `StepConfigInvalidCode` from analyze
  verdicts, which come from `analyzeNodes` -> `validateStepConfig` (line 302). After the split both paths still reach
  the one `StepConfigValidation.validateStepConfig`. C2's wording ("keep reaching the same validateStepConfig") is accurate.
- **External callers**: `grep PipelineAnalyzeService\.\w+` over backend/src. Only public/private[engine] members are
  used in code; `AnalyzeSchemaWarnings.scala` uses `laneDependencyOf`/`sourceDependencyOf`/`AnalyzedStep`/`NodeStepInput`
  (kept). `StepEnumWriteValidationSpec` (package `domain.steps`) and `PipelineAnalyzeServiceSpec` use
  `import PipelineAnalyzeService._`; the coverage guard (spec line 1468) calls unqualified `inferOutputSchema`, so a
  same-signature forwarder keeps it compiling.
- **Logger**: current bytecode (`javap -public` of `backend/target/scala-2.13/classes/.../PipelineAnalyzeService$.class`
  in the main checkout) shows `public org.slf4j.Logger com$helio$domain$engine$PipelineAnalyzeService$$log()` (expanded
  name, so `$$`-filtered) and public `inferOutputSchema` + `inferOutputSchema$default$4` (private[engine] compiles public).
  `LoggerFactory.getLogger(PipelineAnalyzeService.getClass)` yields the same `...PipelineAnalyzeService$` name. No test
  attaches an appender to this logger (ListAppender users target `PipelineRunService`/`ApiRoutes`), so D6c's grep is the
  only guard. That is the right call.
- **Nits**: `PipelineAnalyzeProtocol.scala:237` is 142 chars; `AutoRunTriggerService.scala:122` is 131 chars (moved from
  :116 as the ticket notes say). `AutoRunTriggerServiceSpec.scala:5` has unsorted selectors
  `{AnalyzeWithAiConfig, ComputeConfig, AnalyzeWithAiOutputField, ...}`. All confirmed.
- **Guard scope**: `scripts/check-scala-quality.mjs` walks the whole tree. `scala.util.` is not in `FQN_PREFIXES`, so
  D3's "MAY" for `scala.util.Try` (1071) is accurate. Its 250-line rule is only a warning.
- **Evidence plan**: the forward and positional-reverse byte checker with two red runs, the synthetic-filtered javap
  diff with a red run, the logger grep with a red run, and per-suite test counts plus a test-dir diff would catch a
  non-move edit in any of the eight files. One exception is noted below: the reflows are not word-checked.
- **Precedent**: `archive/2026-10-08-split-pipeline-run-service/design.md` uses the same structure.

### Verdict: REFUTE

The design is close. Two decisions contradict each other or the evidence contract. A competent executor would hit both and have to improvise, which the move discipline (C4/C5) exists to prevent.

### Change Requests

1. **D1 is self-contradictory about `inferOutputSchema` (forwarder plus named import of the same name), and lines
   464-469 are assigned twice.** D1 says `analyze`/`analyzeNodes` call `inferOutputSchema(...)` unqualified "through
   named imports of the new objects", and also that a `private[engine] def inferOutputSchema` forwarder stays in the same
   object. Both cannot hold. With `import StepSchemaInference.inferOutputSchema` inside the object body, scalac 2.13
   reports "reference to inferOutputSchema is ambiguous; it is both defined in object ... and imported subsequently". At
   file top, the member silently shadows the import. In that case a forwarder written as an unqualified
   `inferOutputSchema(op, config, inputSchema, secondarySchema)` is a self-recursive tail call. scalac turns it into a
   loop, so the analyze suites hang instead of failing. Revise D1/D3 to state:
   (a) there is NO named import of `inferOutputSchema` in `PipelineAnalyzeService.scala`; the call sites at 148/304 keep
   their text and resolve to the forwarder;
   (b) the forwarder body is the qualified `StepSchemaInference.inferOutputSchema(op, config, inputSchema, secondarySchema)`;
   (c) where the HEL-872 comment (464-469) goes. It must be exactly one of: kept above the forwarder and excluded from
   the moved span, or moved with the dispatch. If any copy or rewording is intended, say so and list it as a D3
   category. Its text ("widened ... for exactly one reason -- the coverage guard") is false for
   `StepSchemaInference.inferOutputSchema`, which `PipelineAnalyzeService` now calls cross-object. Fix D2's
   StepSchemaInference range to match (e.g. 470-515 if the comment stays).

2. **D4's second option contradicts C5/D6b.** D4 allows "imports the entry point's `log` (widened to
   `private[engine]`)". The accessor is currently `com$helio$domain$engine$PipelineAnalyzeService$$log()`, which the
   `$$` filter drops. Widening it emits a new unfiltered public `log()` on `PipelineAnalyzeService$`, so D6b's diff can no
   longer be empty. Pick one: allow only `LoggerFactory.getLogger(PipelineAnalyzeService.getClass)` per new object and
   keep `log` `private`, or keep the widening option and record the one expected `log()` javap line as an allow-listed
   diff in C5/D6b.

3. **Correct D2's off-by-one.** `ColumnSchemaInference` "1154-1201" includes line 1201, the closing brace of
   `object PipelineAnalyzeService`, which the positional reverse checker must not claim as part of `aggResultType`.
   Use 1154-1200, and list the unassigned scaffolding and blank lines (1-12, 37-39, 462-463, 516-517, 1201) as
   allow-listed so the inventory is exact.

### Non-blocking notes

- External doc comments that name moved members (`PipelineAnalyzeService.inferCompute` in ExpressionEvaluator.scala:46,
  424, 470, PipelineService.scala:1294, model.scala:706; `.inferAggregate` model.scala:729; `.inferJoin`
  JoinColumnNaming.scala:4; `.inferConvertFormat` ConvertFormatStep.scala:43; `.inferGroupBy` GroupByStep.scala:62;
  `.inferAnalyzeWithAi` AnalyzeWithAiConfig.scala:27; `.validateStepConfig` PipelineStep.scala:223; and SchemaField's own
  doc at line 23) go stale. The precedent design said explicitly "Doc links made stale by the move are NOT edited". Say
  the same here, or list them as follow-up candidates, so the executor does not drift into editing files outside the change.
- D7 reflows: add a `git diff --word-diff=porcelain` (or token-multiset) check showing no word changed on 237/122, and
  a sorted-multiset comparison of the spec's import lines. Neither is covered by the byte-move checker. With no
  scalafmt/scalafix config in the repo, "alphabetically" should mean lexicographic on the full import path and on
  selectors inside braces.
- D4's list of moved log sites omits unpivot (976), assert (1125) and parseConfig (1150). "And any others" covers them,
  but D6c's grep should enumerate all 12 sites.
