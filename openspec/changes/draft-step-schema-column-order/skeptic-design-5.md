## Skeptic Report — design gate (round 5, skeptic-design-5.md)

Reviewed: the uncommitted revised proposal.md, design.md, specs/pipeline-draft-mode-ui/spec.md and tasks.md, against base e83f216b0 (resolved live with resolve-review-base.sh). Branch HEAD is 015c13b1864f3cb644d76ddb90afd0dfb2bf9c8f, which still holds the cycle-1 implementation. I checked every claim below against the code. None of the orchestrator's narrative was taken on trust.

### What I verified (with evidence)

**CR1 (exact rootId match): closed.**
- D1 precedence 1 now requires an exact `rootId` match and forbids the `sourceSchemas[0]` fallback. The fallback is confirmed at `usePipelineAnalyzeLookups.ts:81-91`.
- The D6 unit test covers a draft-added root.
- I checked whether an exact `rootId` match could still apply the wrong source's order. It cannot. `draftRoots.ts:17-40` (`replayRoots`) only adds roots, with fresh client ids, or removes them. No draft op rebinds an existing root id to a different `dataSourceId`. So an exact `rootId` match always names the same source.

**CR2 (source secondaries): closed.**
- D1 now covers secondaries decoded through `selectSourceFrames` -> `sampleFrame()` (`sourceSamplesSlice.ts:171-185`).
- Precedence 2 is `state.sources.items[].inferredSchema`. This matches the server: `PipelineAnalyzeService.scala:134` reads the source schema from `DataSource.inferredSchema`, and `:312-315` uses it for `secondarySourceSchemas`.
- The sources list is loaded on the pipeline page (`usePipelinePageLoad.ts:111-116`, `fetchSources`).
- An unowned secondary falls back to code-unit order. The spec discloses this ("a source neither the saved analysis nor the caller's own source list describes").
- D6 and spec scenario "Join with a source secondary" add the order assertion.

**CR3 (ordering function for client-evaluated frames): closed.**
- D3a defines one pure `draftColumnOrder` that wraps `orderColumns`.
- A dense frame uses its first row's key order.
- A sparse frame uses the parent's displayed order with renames substituted, then new columns. This handles the `a,c` / `b` case.
- The function has a unit test that includes the sparse case.

**CR4 (memo identity, both sides): closed.**
- D1 memoizes on (sample identity, ordered names). `rootFrames`, `savedRootFrames` and secondary frames all go through the same function.
- This matters because the draft-preview request key uses frame identity: `draftPreviewRequest.ts:156-162` (`frameIdOf(r.frame)`). The walker caches by frame reference.
- Keying on the names rather than on where the order came from means analyze arriving after the sources list keeps identity when the order is the same.
- D6 adds the flash test and the identity test. Base and draft use the same function (`usePipelineDraftFrames.ts:93-94,124-131`), so `baseRows` and the draft frames share key order.

**CR5 (D3b rule 1 dependency set): closed.**
- Rule 1 now covers the ancestor steps, the lineage's root binding (`roots` vs `savedRoots`), and lane/source secondaries recursively, matching `PipelineAnalyzeService.scala:296-315`.
- D6 has precedence cases for a root-binding change and a secondary-lane edit.
- Descendants of a `needsServer` step are `blocked`, and `serverResolvedStepIds` (`draftEvaluation.ts:115-126`) counts them as server-resolved. So D3b applies to every server-fed view, and no client step consumes hash-ordered server rows.

**No request on a client-evaluable edit.**
- Nothing in D1-D3 calls a service. The order data (`analyzeResult`, `sources.items`, samples) is already in page state.
- D5's revert list matches every request-bearing file in `git diff e83f216b0...HEAD --stat` (16 frontend files). `StepPreviewTable.tsx` is reworked, not reverted, and its cycle-1 test is removed or rewritten.

**D2.**
- Server rename analysis maps names in place (`ColumnSchemaInference.scala:23-27`). Client rename moves the key to the end (`rowOps.ts:37-47`).
- The rebuild-from-input-order rule matches the server's in-place mapping. It keeps the fold, so values are unchanged.

**Spec vs AC and the ruling.**
- AC1: the ADDED requirement and its scenarios.
- AC2: the truncated requirement.
- AC3: task 5.3.
- The standing "no request" requirement is unchanged.

### Verdict: CONFIRM

All five round-4 change requests are closed in design.md, the spec and tasks.md. The revision introduces no defect that blocks implementation. The stale lines below are summaries that D1/D3b and the D6 tests override, but the executor should fix them while implementing.

### Non-blocking notes
1. Some summary lines were not updated with D1/D3b. Fix them so nobody reads them as normative:
   - proposal.md "What Changes" bullet 1 still says roots only, `sourceSchemas` only, "once per sample load".
   - proposal.md bullet 3 still says "that step or anything above it".
   - design.md Risks still says "A draft-added root ... has no declared order on the page: code-unit order", which contradicts D1 precedence 2.
   - design.md Context still points at `sourceSchemaForRoot`, which has the `[0]` fallback.
   - The Risks flash rationale ("same evaluator") is superseded by D1's same-function rule.
2. The memo should also keep the `RootFrame[]` array identity stable, not only each frame's identity, when the order is unchanged. Otherwise `baseWalk` (`usePipelineDraftFrames.ts:124-127`, a full non-incremental `evaluatePipeline`) re-runs on every analyze or sources-list refresh. That is not a request and not a correctness problem, but it is wasted work. The ordered-names memo key should use a separator that cannot appear in a column name, or a nested Map per name list.
3. The spec says a step SHALL place created columns where the server places them. D2 allows a "disclosed deviation" for a handler that is not fixed. If the audit leaves any handler unfixed, the PR must list it as a known spec deviation, not a silent one.
4. The server's rename analysis does a single lookup (`renames.getOrElse`), while the runtime folds renames in a chain. For a chain or collision, D2's "final name" order follows the fold. Record that choice in the D2 table.
5. D6's "removed or rewritten with the prop": make sure the `projectedSchema` prop itself is deleted from `StepPreviewTable.tsx`, not only its test.
