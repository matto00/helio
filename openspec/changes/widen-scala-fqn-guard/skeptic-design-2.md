## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed at HEAD 71e05843680c886751ca59379ed6fb4c1758be59 (worktree clean apart from the untracked change dir).

### What I verified (with evidence)

- **Spawn guard:** `assert-cwd.sh` returned `READY ambient=/home/matt/Development/helio branch=task/scala-fqn-guard-widen/HEL-1446`.
- **Guard premise (D1):** `scripts/check-scala-quality.mjs:33-46`. `FQN_PREFIXES` contains only `scala.concurrent.` and
  `scala.annotation.` from the `scala` namespace. The regex at L68 is `(<prefixes>)\w`. `assertPrefixesEndInDot` is at L51/59.
- **Widened-guard count:** I made a scratch copy with `"scala.concurrent."` replaced by `"scala."` (a one-line diff) and
  ran it against the worktree. It exited 1 with **76 violations in 39 unique files**. This matches the revised
  Context/Proposal counts. The "Random 2" error is gone.
- **CR1 (round 1) resolved:** D4 now covers the whole namespace (`scala\.[a-z]+\.`), blanks string literals the same
  way the guard does, and names `ShareTokenGenerationSpec.scala:45/:56` as required residual hits that must never be
  edited. Standing Constraint C1 repeats this. Task 1.1 adds a green `"scala.util.Random"` string-literal case. Re-measured:
  the raw grep gives 78 non-import, non-comment lines. The guard flags 76 of them. The other two are exactly the two
  ShareTokenGenerationSpec string literals.
- **CR2 (round 1) resolved:** D5 adds the `PipelineAnalyzeService\.scala:[0-9]+` probe. Live, it hits exactly one line:
  `PipelineAnalyzeRoutesSpec.scala:525`. Task 3.1 names that line explicitly.
- **D5 stale-ref grep (live):** 20 hits, all in D5's sweep scope. They are backend scaladoc in SchemaField,
  ExpressionEvaluator x3, JoinColumnNaming, ConvertFormatStep, AnalyzeWithAiConfig, GroupByStep, PipelineStep:228 and
  model.scala:444/467, plus steps/README.md:102, AssertConfig.tsx:29, docs/compute-expression-grammar.md:317/400 and four
  canonical specs. The ticket's PipelineStep.scala:223 has drifted to :228, and the plan uses :228.
- **Member-existence completeness check:** I listed every distinct `PipelineAnalyzeService.<token>` in scope. Each
  non-moved token (`analyze`, `AnalyzedStep`, `analyzeNodes`, `computeExpressionProblem`, `inferOutputSchema`,
  `laneDependencyOf`, `NodeStepInput`, `PipelineStepInput`, `schemaFieldJsonFormat`, `secondarySourceIdOf`,
  `sourceDependencyOf`, `StepConfigInvalidCode`, `stepConfigProblem`) has a definition in PipelineAnalyzeService.scala.
  `SchemaField` is the only absent token, and it occurs only in the V94 migration, which is correctly exempt because
  editing it changes the Flyway checksum. The non-member tokens (`_`, `getClass`, `.scala`) are named as ignorable.
  No stale ref is left that D5's mapping does not cover.
- **Ticket line drift:** PAS has one remaining inline site, `scala.collection.mutable.LinkedHashMap` at L299.
  MultiInputSchemaInference's site is at L110. PAS L10-12 are blank. PAS L26 is 127 chars. PipelineAnalyzeProtocol L237/238
  are 102/43 chars and L252 is 130 chars. All match D6 and the Context section.
- **Spec deltas:** I extracted each of the four MODIFIED requirement blocks and diffed it against its canonical block,
  with the owner token normalised. All four are identical. The owners are correct: `inferCompute` is on
  ColumnSchemaInference, and `inferSplitText`/`inferExtractHeadings`/`inferChunkByTokenCount` are on TextSchemaInference.
  `openspec validate widen-scala-fqn-guard --strict` reports the change as valid.
- **Selftest structure:** `check-scala-quality.selftest.mjs` already has `red`/`green` tables (L31/L52) and a CLI spawn
  on a red fixture (L93-103), so adding the D2 cases red-first is straightforward. `scripts/concertino/test-gate-in-isolation.sh`
  exists (task 1.4).
- **CONTRIBUTING.md:236** holds the prefix list that D1 says to update.
- **Gate-chain checklist:** unchanged from round 1, which verified it as sound. The only edit is one constant array plus
  new selftest cases.

### Verdict: CONFIRM

### Non-blocking notes

- The D4 raw-sweep regex `(^|[^A-Za-z0-9_.])scala\.[a-z]+\.` misses `_root_.scala.x.` because the preceding `.` is
  excluded. It also misses top-level members such as `scala.Predef`/`scala.Some`. Neither occurs in the tree today
  (`_root_.scala` has 0 hits, and capitalised `scala.[A-Z]` code uses have 0 hits). The widened guard catches both forms
  anyway, so this does not block.
- The guard spec delta is still ADDED next to the canonical requirement "covers java.sql, java.time, java.util and
  scala.annotation", and the Purpose line also names `scala.annotation`. That is valid, but a post-archive tidy of the
  Purpose line would read better.
- The JsonFlattener.scala:132 site sits on a 130+-char line. When the executor imports `immutable`, it may want to
  rewrap that line, but that is not required.
