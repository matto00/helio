## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed tree: HEAD 365d824c8f2eba017e150e9b5f67743920f56619 (branch feature/analyze-warnings-followups/HEL-1414; the change dir is untracked, no source edits yet).

### What I verified (with evidence)

**D2 (warnings-only resolution of a source-kind lookup secondary): sound, and verified against the tree.**
- `PipelineAnalyzeService.sourceDependencyOf` (PipelineAnalyzeService.scala:215) is join-only, and `analyzeNodes` uses it at :268-269 to pick the secondary schema. `AnalyzeSchemaWarnings.secondaryOf` (AnalyzeSchemaWarnings.scala:96-98) uses the same helper. So today a source-secondary lookup gets `sec = None`, and `lookupRenames` (:191) returns nothing. Item 4 is confirmed.
- `MultiInputSchemaInference.inferLookup` (:37-47) types each requested column from `secondarySchema`, falling back to `"string"`. Because `analyzeNodes` keeps calling `sourceDependencyOf`, a lookup over a source still projects `"string"` placeholders after D2. The projection is unchanged and the validationError is unchanged.
- The design's `viaLane` reasoning is correct and necessary. Today `typesPreserved("lookup")` (:126) is `sec.exists(s => s.flags.types && lookupColumnsResolved(...))`. Once D2 makes `sec` a source `Secondary` with `Flags(true,true)`, that expression would return true over placeholder types, and the false positives would land downstream. Gating on `viaLane` keeps the post-fix downstream flags exactly equal to the pre-fix ones (`sec = None` gives false today).
- `resolveSecondarySourceSchemas` (PipelineService.scala:1102-1109) feeds 5 sites: :363 create, :974 full analyze, :1130 concise, :1348 node capabilities, :1446 proposal (`findByIdOwned`). Widening the id set only adds extra reads at the non-warning sites (:363, :1348). Those sites pass the map to `analyzeNodes`, which never consults a lookup id. `data_sources.id` is a `String` column (DataSourceRepository.scala:1133), so a garbage proposal id resolves to `None` and does not throw.
- `LookupStep.evaluate` builds `refRows.groupBy(lookupKey)` and probes it with the raw `sourceKey` value (LookupStep.scala:~98-110). It loads a source through the same `ctx.loadSource` as `JoinStep` (:124-129 vs JoinStep.scala:98-107). So D1's reuse of `family()` and the join source-secondary trust model is justified.

**C1 / never-blocks: preserved.**
- `RunConfigGate.stepConfigReasons` (RunConfigGate.scala:20) reads only `stepConfigProblem(kind, raw config)`, and so do the scheduler (PipelineSchedulerService.scala:205) and auto-run (AutoRunTriggerService.scala:107). None of them touch `resolveSecondarySourceSchemas` or `AnalyzeSchemaWarnings`.
- canRun/costVerdict derive from projections' `validationError`, which D2 leaves unchanged.

**Other checks**
- D5: `evaluation-1.md` ("My own mutation runs", line 28) and `evaluation-2.md` both exist in `openspec/changes/archive/2026-10-08-analyze-schema-warnings/`. Archived `tasks.md` 1.3 carries the stale compute rationale. `PipelineAnalyzeSchemaWarningsSpec.scala:30-31` still says "see the change's verification notes". D5's targets are real.
- D6 vs owner ruling: `escalation.answered optionA` is recorded in `.concertino/runs/HEL-1414/events.jsonl` line 8, with `answer_source: human`. I viewed `optionA-light.png` and `optionA-dark.png`.
- Frontend chain: `getAnalyzeValidationError` flows usePipelineDetailPage.ts:615 → PipelineDetailPage.tsx:283 → PipelineRiverView.tsx (StepCard call at :378) → RootColumn.tsx:131 → LaneColumn.tsx (StepCard calls at :223 and :275). The design plus task 2.2 cover this chain.
- `--app-warning` / `--app-warning-surface` exist in theme.css. No shared warning-banner primitive exists; the truncation-banner recipe at PipelineDetailPage.css:1913 is the page-local precedent.
- `openspec validate analyze-warnings-followups --type change` prints "Change 'analyze-warnings-followups' is valid".

### Verdict: REFUTE

The core technical design (D1, D2, C1) is sound. Four planning defects need fixing before execution; each is cheap to fix.

### Change Requests

1. **design.md D1 contradicts D1b.** D1's last sentence says "A missing `lookupKey` on the secondary is NOT added here (would be a new field-not-in-input-schema case)." D1b, the spec delta (ADDED "Lookup key missing from the secondary input warns") and tasks 1.1/1.5 all add it. Delete or rewrite D1's sentence so the artifacts agree.
   - While there, D1b says the message "names it as `key`". `missingMessage` (AnalyzeSchemaWarnings.scala:219) only says `key '...'` when `op == "join"`. Task 1.5 should say explicitly that this condition is widened to `lookup`, or D1b should drop the claim.

2. **Red-first (C2) is unachievable as written for the negative/guard cases, and the key D2 guard has no failability proof.**
   - Task 1.1 asks to "capture red" for cases that pass on the pre-fix tree: matching families, untrusted input, unresolved source secondary, and especially "source-lookup output stays type-untrusted downstream". Today `sec = None` already makes that last one untrusted.
   - The same applies to 2.1's "Step without warnings" and 3.1's "omitted when none" / "missing `warnings` treated as none".
   - Split each task list into (a) red-first behavioural tests, which must fail on the whole pre-fix tree, and (b) guards, labelled as guards.
   - For the `viaLane` guard, name the mutation that must turn it red: implement D2 with `typesPreserved("lookup")` NOT checking `viaLane`; the downstream-join test must then fail. Without this the most important D2 guard can pass vacuously.

3. **D6 placement is ambiguous against the mockup the owner ruled on.** D6 says the warning region goes in the "Expanded body". In `optionA-light.png` / `optionA-dark.png` the region sits between the card header and the "+ Output" rail. In StepCard.tsx that rail is `<OutputsRail>`, rendered at :361-366 *outside and before* the `{expanded && <div className="...step-card-body">}` block at :370. A competent implementer could put the region inside `step-card-body`, below the Outputs rail, and diverge from the ruled mockup. Pin the placement explicitly: either "rendered only when expanded, between the header row and `OutputsRail`, as mocked", or "first child of `step-card-body`" with an explicit note that this differs from the mockup. Also state where the `validationError` `InlineError` (body, :394) sits relative to it for a step that has both.

4. **D3 omits a required contract update (`mcp-concise-response-modes`).**
   - That spec's "Concise workspace context omits depth, never breadth" enumerates a closed set of omitted per-entity detail: per-step column lists and per-source schema listings.
   - Its "Omission is always detectable by the caller" requirement says the truncation report SHALL "enumerate which kinds of detail were omitted".
   - D3 replaces per-step warning messages with `warningCount` in concise mode, which is a new omitted kind. The plan has no delta to that spec, no addition to `CONCISE_OMITTED_DETAIL_KINDS` (context.ts:276), and no test that `omittedDetailKinds` names it.
   - Also, "Tool descriptions state size behaviour" requires the description to state what concise omits.
   - Fix one of two ways:
     - (a) Add a MODIFIED delta for `mcp-concise-response-modes` plus a task to add the kind (e.g. `pipelineStepWarningMessages`) to `CONCISE_OMITTED_DETAIL_KINDS`, with a test.
     - (b) Keep the messages in concise mode, as concise `analyze` already does with `warnings?: string[]`. Then nothing new is omitted and the decision says why.

### Non-blocking notes

- Widening `resolveSecondarySourceSchemas` also adds a DB read per lookup source at the create (:363) and node-capabilities (:1348) sites, where the extra entries are never read. This is harmless, but the executor may want to pass the widened id set only at the three warning sites (:974/:1130/:1446).
- Reusing the truncation-banner recipe a second time as a new class duplicates CSS. Consider sharing one class (or a small local component) rather than copying the declarations.
- D1 overloads `join-key-type-mismatch` for lookup. This is acceptable given the existing `lookup:`-prefixed `join-column-renamed` precedent; make sure the helio-mcp `analyze_pipeline` code list text (tools/read.ts ~:179-181, "join-key-type-mismatch (... join may return no rows)") mentions lookup too.
- D1b was absorbed beyond the ticket ACs on a "driver ruled" basis. It is small and on the same code path, so I accept it, but it is scope beyond AC3 and the final gate should check it as such.
