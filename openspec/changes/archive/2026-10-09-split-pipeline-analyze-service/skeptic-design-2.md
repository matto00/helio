## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed tree: worktree HEAD `ecaa1a532dcbf10b8d7f3664335bff392fd59554` (= origin/main), change dir untracked
(design.md, proposal.md, tasks.md, ticket.md, workflow-state.md, plus skeptic-design-1.md from round 1). I re-derived
everything from the live file. I did not reuse round 1's checks.

### What I verified (with evidence)

- **Spawn guard**: `assert-cwd.sh` printed `READY ambient=/home/matt/Development/helio branch=task/split-pipeline-analyze-service/HEL-1385`.
- **Member inventory**: `grep -nE '^  (private|...)(def|val|...)'` on the 1201-line file. Kept: log 42,
  StepConfigInvalidCode 47, stepConfigProblem 52, schemaFieldJsonFormat 84, PipelineStepInput 108, AnalyzedStep 115,
  analyze 137, NodeStepInput 184, DefaultRootKey 196, laneDependencyOf 225, sourceDependencyOf 242, analyzeNodes
  264/275. Moved: validateStepConfig 344 and 8 validators, inferOutputSchema 470, the 22 `infer*` helpers,
  canonicalizeLegacyType, the two Assert sets, parseConfig, aggregateResultType, aggResultType. Every moved member is
  plain `private`, except `inferOutputSchema` (`private[engine]`, which keeps a forwarder). No test can reference a
  moved member directly.
- **Round-1 CR1 (D1 inferOutputSchema / HEL-872) is resolved.** D1 now says: no import of `inferOutputSchema` in the
  entry point; the forwarder body is receiver-qualified `StepSchemaInference.inferOutputSchema(...)` and keeps the
  `= None` default; call sites 148 and 304 stay unchanged. I confirmed both lines by `grep -n` (148 is 3-arg, 304 is
  4-arg). The HEL-872 comment (464-469) belongs to D1 only, and its text is still true above the forwarder. D2's
  StepSchemaInference range is now 470-515, and I confirmed the dispatch closes at 515. The named import of
  `validateStepConfig` has no same-named member left in the object, so it is unambiguous. Spec callers at
  PipelineAnalyzeServiceSpec:676 and :1542 call the 3-arg form through `import PipelineAnalyzeService._`. The forwarder's
  default keeps them compiling.
- **Round-1 CR2 (D4 logger) is resolved.** D4 and C6 allow only `LoggerFactory.getLogger(PipelineAnalyzeService.getClass)`,
  and the entry point's `log` stays `private`. I enumerated every moved `log` use by cross-reference: 575, 646 (Column);
  692, 724, 753, 776, 810, 847 (Text); 903, 976, 1125 (Reshape); 1150 (parseConfig, StepSchemaInference). That is
  exactly the 12 sites D4 names. Multi and Validation never log, so a logger is not needed there.
- **Round-1 CR3 (ranges) is resolved, with one stray overlap (see notes).** I printed every boundary with `cat -A`:
  SchemaField 13-36; validation 331-461 (`}` at 461, blank lines 462-463); dispatch 470-515; Column 518-649 and
  1154-1200; Text 650-850 (the splittext doc 650-657 sits directly above the convertformat doc 658); Reshape 851-996
  and 1078-1136; Multi 997-1077; parseConfig 1137-1153; 1201 = closing `}` of the object. The ranges are contiguous
  and complete.
- **Cross-family call graph**: I joined each moved def's family against the family of every non-comment use site. The
  only cross-object edges are: dispatch (D) to all 22 `infer*` in C/T/R/M; C/R/M to `parseConfig` in D (520, 527,
  534, 1167, 862, 919, 992, 1014); and kept code (K) to `validateStepConfig` (52, 146, 302) and to the
  `inferOutputSchema` forwarder (148, 304). canonicalizeLegacyType, aggregateResultType/aggResultType and the Assert
  sets are intra-family. D3's widening to `private[engine]` plus named imports covers every edge. No "forced move" is
  needed.
- **Implicit/scope safety**: moved code (331-462, 470-1200) has no non-comment reference to `schemaFieldJsonFormat`,
  `DefaultRootKey`, `StepConfigInvalidCode`, `laneDependencyOf`, `sourceDependencyOf`, the nested case classes,
  `toJson`, `implicit` or `getClass`. Losing the object's implicit scope therefore cannot silently change resolution;
  any miss fails to compile. The new object names collide with nothing in `backend/src` (grep -w found 0 hits).
- **C2 single entry point**: `RunConfigGate.scala:20` calls `PipelineAnalyzeService.stepConfigProblem`, and
  `AutoRunTriggerService.scala:130` and `PipelineService.scala:1079` consume `StepConfigInvalidCode`. After the split,
  all three paths reach the one `StepConfigValidation.validateStepConfig`.
- **D6b javap soundness**: the moved members are object-private, so their bytecode is either private or has a `$$`
  expanded name (filtered). The public members and the `private[engine]` members (which compile public) all remain.
  An empty filtered diff is achievable, and C5 is consistent with C6.
- **Guard**: `scripts/check-scala-quality.mjs` has no line-length rule and no `scala.util.` prefix. The 250-line limit
  is a soft warning only. D3's optional `scala.util.Try` import (moved line, base 1071) is allowed but not forced.
  The kept FQNs at 230/244/280 are untouched, which is correct because they are not moved code.
- **Nits**: `PipelineAnalyzeProtocol.scala:237` is 142 chars and `AutoRunTriggerService.scala:122` is 131 chars
  (`awk length>120`). The only unsorted import in `AutoRunTriggerServiceSpec.scala` is line 5's selectors
  (`AnalyzeWithAiConfig, ComputeConfig, AnalyzeWithAiOutputField, ...`). Every other line and group is already
  lexicographic. D6e adds the word-diff check and the sorted-multiset import check that round 1 asked for. D6e also
  says external doc comments are not edited.
- **Internal consistency**: proposal, design, tasks, C1-C6 and the ticket ACs agree. The ticket AC "import-only spec
  changes" maps to C1 and task 3.5. The AC "no inline FQNs" maps to D3 and task 2.4. The dropped "cost/canRun" seam
  is justified: no such code is in this file. Tasks 1.x-3.6 cover every decision (README update is 2.5, nits are 2.6
  and 3.5a). The precedent `archive/2026-10-08-split-pipeline-run-service` exists.

### Verdict: CONFIRM

The three round-1 revisions are made, and the live tree supports them. An implementer can follow the design without
improvising.

### Non-blocking notes

- D2 lists validation as `331-462` and also lists `462-463` as unclaimed scaffolding, so blank line 462 is claimed
  twice. Treat validation as 331-461 and allow-list 462-463 as blank. That keeps the "exactly one claim" rule exact.
- D3's "positional words in comments that the move made false" is allowed. Candidates include groupby's "the
  `unknown`-op arm below" (1156) and "this file's existing fallback convention" (1159). Each such edit should be listed
  individually in move-evidence.md, so the forward checker's exemptions are enumerable and not a blanket pass.
- D7's "alphabetically" means lexicographic within the existing blank-line-separated groups. D6e forbids changing
  non-import lines, which effectively rules out merging groups. In practice only line 5's selectors change.
