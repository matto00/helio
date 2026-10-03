## Skeptic Report — design gate (round 2, skeptic-design-2.md)

### What I verified (with evidence)
- Re-read proposal/design/tasks/spec delta cold against live JoinStep.scala: `leftRow ++ rightRow` (inner/left), left no-match emits `Seq(leftRow)`; the spec's "Left join with no match" requirement matches this. Decision 7 (right wins today) is correct.
- CR1 resolved: Decision 3 now commits to option (a) (secondarySourceSchemas via findByIdInternal, same privilege model as JoinStep L92), with fallback to passthrough; task 2.3 and a spec requirement cover it.
- CR2 resolved: Decision 5 / task 2.4 commit to applying the helper in SparkJobSubmitter with helper-level tests.
- CR3 resolved: ragged/empty-left divergence documented in Decision 1, spec requirement "Declared-but-absent left columns", and parity cases in Decision 4.
- CR4 resolved: spec has left-join-no-match and source-kind requirements; task 3.3 defines the inventory table format.
- Acceptance/red-green/mutation tasks present (1.1, 3.2, C3). No TODO/TBD placeholders.

### Verdict: CONFIRM

### Non-blocking notes
- Design Decision 3 / task 2.3 say "the three sites that build sourceSchemasByRoot", but live code has FIVE analyzeNodes call sites in PipelineService.scala (L354, L995, L1099, L1309, L1409). The executor must grep and wire all of them (or centralize in one helper), otherwise some analyze paths (L1309/L1409) will keep the passthrough and disagree with the others.
- Ensure the LookupStep/UnionStep follow-up ticket is actually filed and cited in the PR body.
