## Skeptic Report — design gate (round 6, skeptic-design-6.md)

### What I verified (with evidence)

**1. tasks.md is genuinely populated (round 5's zero-byte defect is fixed).**
`wc -c` reports 7465 bytes; `cat` returns 5 sections / 34 numbered tasks. Not an
empty file, not a stub. All round-1..5 fixes are present in the actual text:
- Task 1.4 carries the per-node/source grounding split (step-targeted via
  `analyzeNodes` at the specific node; `nodeStepId: null` via the source's own
  `inferredSchema`, "since `analyzeNodes` omits the source").
- Task 3.2 carries the two-call inline-source sequence (`POST /api/data-sources`
  then `POST /api/pipelines`) plus the orphaned-data-source-id error surface.
- Task 5.9 carries the full verified scoped jest command; tasks 3.1 and 5.6 both
  point at it by reference and both explicitly disclaim root `npm test`.
- Tasks 1.2/1.5/5.5/1.6/5.11 target `PipelineStep`, not `Output`. Task 1.2 states
  "Outputs have no `enabled` field" — consistent with design decision 7.

**2. The `parentStepId` finding is real — verified against source, not narrative.**
`backend/src/main/scala/com/helio/services/patchsets/PatchSetApplyRollback.scala:288-289`:
```scala
private def pipelineStepCreateRequestFromPrior(prior: PipelineStep): CreatePipelineStepRequest =
  CreatePipelineStepRequest(`type` = prior.kind, config = JsonParser(PipelineStepConfigCodec.encode(prior)).asJsObject)
```
`CreatePipelineStepRequest` (`PipelineStepProtocol.scala:160-166`) declares
`enabled: Option[Boolean] = None` and `parentStepId: Option[String] = None` — both
defaulted, so both omissions compile silently. The domain trait
(`domain/model/PipelineStep.scala:40-62`) does carry `def enabled: Boolean` and
`def parentStepId: Option[PipelineStepId]`, so `prior` genuinely holds the values
being dropped. The defect and its characterization are both correct.

Note on my own process: my first grep used `services/patchset/` (singular) and
returned "No such file"; the real path is `services/patchsets/`. I re-ran rather
than concluding the file was missing. Same for two empty greps for
`case class PipelineStep` — `PipelineStep` is a `trait`, not a case class.
Neither anomaly was a real finding.

**3. The fold-in into design.md decision 7 is correct and precisely attributed.**
Decision 7 names the file and line range, names both functions for the `enabled`
defect, and scopes the `parentStepId` defect specifically to
`pipelineStepCreateRequestFromPrior`. It also self-corrects the earlier wrong
"would be a compile error" claim. Task 1.5 mirrors this attribution.

**4. Acceptance-criteria coverage — all 10 ticket ACs trace to a task.**
E2E→5.1, context fixture→5.2, tool-name set→5.3, grounding→5.4, undo→5.5,
typecheck/OOM→5.6+5.9, schema-drift→5.7, teardown→5.8+2.1, rename table→2.2,
HEL-934→3.12. No uncovered AC; no task outside ticket scope.

**5. Load-bearing tooling claims re-verified first-hand, not accepted.**
- `jest.config.cjs:16,22` contains `"/.claude/worktrees/"` in
  `testPathIgnorePatterns` and `<rootDir>/.claude/worktrees/` in
  `modulePathIgnorePatterns` — exactly as tasks 5.9/5.6 state.
- I ran the scoped command in task 5.9 verbatim. Result: **14 suites passed, 250
  tests passed, 0 skipped, no OOM, 2.587s**. Matches the documented baseline of 14.
- `npx openspec validate mcp-outputs-proposals-rewrite --type change` →
  "Change 'mcp-outputs-proposals-rewrite' is valid", exit 0.

**6. Cross-artifact consistency, cumulative-edit regression pass.**
proposal.md lists 1 new + 21 modified capabilities = 22; `specs/` contains exactly
22 directories, names matching one-for-one. proposal.md's HEL-766 line agrees with
design decision 7 ("`PipelineStep.enabled` ... Outputs have no `enabled` field").
No contradiction found between proposal / design / tasks / ticket. No placeholders,
`TODO`, or `TBD` in any artifact.

### Verdict: CONFIRM

Round 5's two REFUTE grounds are both resolved and independently re-verified from
ground truth. No unresolved correctness gap remains.

### Non-blocking notes

1. Task 1.5 and design decision 7 both end with a summary sentence — "Fix both
   builders to explicitly set `enabled = prior.enabled` and
   `parentStepId = prior.parentStepId`" — that reads as if both fields apply to
   both functions. `UpdatePipelineStepRequest`
   (`PipelineStepProtocol.scala:171`) has **no** `parentStepId` field, so
   `fullPipelineStepInverse` can only thread `enabled`. Both documents attribute
   the defect correctly in the preceding sentences, so an executor will not be
   misled; flagging only so the implementer does not try to pass a nonexistent
   parameter. If the update path also needs to restore parenting, that is a
   protocol change and should be its own decision.
2. Type detail for the executor: `prior.enabled` is `Boolean` (needs
   `Some(prior.enabled)`) and `prior.parentStepId` is `Option[PipelineStepId]`
   against a request field of `Option[String]` (needs `.map(_.value)`).
