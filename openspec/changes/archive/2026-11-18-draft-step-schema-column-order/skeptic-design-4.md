## Skeptic Report — design gate (round 4, skeptic-design-4.md)

Reviewed: the revised (uncommitted) proposal.md, design.md, specs/pipeline-draft-mode-ui/spec.md, tasks.md and evaluation-1.md in the worktree, against base e83f216b0 (resolved live with resolve-review-base.sh). Branch HEAD is 015c13b1864f3cb644d76ddb90afd0dfb2bf9c8f, which still holds the cycle-1 implementation. Every claim below was checked against code. None of the orchestrator's or executor's narrative was taken on trust.

### What I verified (with evidence)

(a) **No request on a client-evaluable edit.** This holds by construction.
- D1 runs in the browser over the cached sample. D2 changes in-row key order only. D3 orders the view from `baseSteps`/`draftSteps` and the saved analyze result, which are already in page state.
- Nothing in D1-D3 calls a service. D5's revert list matches every request-bearing file in `git diff e83f216b0...HEAD`: `useDraftStepProjection`, `draftProjection`, `usePipelineDraftPresentation`, `usePipelineDetailPage`, `PipelineDetailDialogs`, `outputSheetDraft`, `useOutputSheetNode`, `useDraftNodeCapabilities`, plus the two test edits.
- `StepPreviewTable.tsx` and `StepPreviewTable.columnOrder.test.tsx` are not on the revert list. They are reworked by D3/D6. Their `projectedSchema` prop and test (c) must go.
- One indirect path exists, and it is CR4 below: a root re-key whose identity is not stable could change the draft-preview request body on an analyze refresh.

(b) **Where sample rows become root frames.**
- The one decode point is `sampleFrame()` (`features/sources/state/sourceSamplesSlice.ts:146-153`), cached in a WeakMap per sample object.
- `selectRootFrames` (:157) and `selectSourceFrames` (:171) both consume it. `usePipelineDraftFrames.ts` calls `selectRootFrames` twice, once for the draft roots and once for `savedRoots`, and calls `selectSourceFrames` once for secondaries.
- So there is not one place but three consumers. The design names only roots.
- Cost: a 1,000 x 20 re-key is about 20k property puts, negligible against the HEL-1691 budgets. This is cheap provided it runs once per (sample, order) and not per render or per analyze refresh (CR4).

(c) **D2 claims.**
- `rename` differs. Client `rowOps.ts:37-47` deletes the old key and appends the new one. Server `ColumnSchemaInference.scala:24-28` maps the name in place.
- Spread ops inherit order (`{ ...row }`): confirmed for rename/compute/fillnull/union backfill/join merge.
- Value semantics do not depend on in-row key order:
  - join's `resolveColumnNames` is used only as a lookup map;
  - dedupe keys are `Object.keys(row).sort()`;
  - union byName affects key order only.
- `diffFrames` (`evaluator/testing/corpus.ts:56`) explicitly ignores column order. So "parity stays green" is necessary but proves nothing about order. D6's separate order assertions are the right guard.
- The audit approach (per-op table against `StepSchemaInference.scala`) is adequate for single-input ops.
- It is not adequate for multi-input ops: see CR2.

(d) **D3 "differs from the saved pipeline".** This can be determined from page state (`baseSteps`, `draftSteps`, `roots` vs `savedRoots` in `usePipelineDraftFrames`).
- But "the step or any step above it (config, enabled, position, parent)" is a parent-chain definition.
- `PipelineAnalyzeService.scala:309-315` makes a step's analyzed schema also depend on its root binding (`schemaAt` → `sourceSchemasByRoot`) and on its lane/source secondary (`laneDependencyOf`/`sourceDependencyOf`). See CR5.
- `orderColumns` (`features/panels/state/columnOrder.ts:8-14`) drops absent names and appends unknown names in code-unit order, so a stale saved order degrades gracefully rather than breaking.

(e) **Order-sensitive consumers.** The flash keys rows by `JSON.stringify(row)` (`StepPreviewTable.tsx:59`). A draft frame is compared with `draft.baseRows` (`:149`), which is the saved-side walk over `savedRootFrames`.
- If the draft root frames are re-keyed and the saved ones are not, or are re-keyed with a different order, every row's key differs on the first edit.
- `newCount` then exceeds `FLASH_ROW_CAP` and the flash silently shows nothing.
- The design's risk note asserts both sides "go through the same evaluator". That is true of the evaluator, but the re-key happens before it, in two separate selector calls. See CR4.
- D3 orders the view without re-keying rows, so server-frame flash keys are unaffected.
- I found no other `JSON.stringify(row)` consumer in `features/pipelines` (grep of state/hooks/ui).

(f) **Spec delta vs AC and ruling.**
- The ADDED requirement covers AC1 and states the no-request property explicitly, so the owner's redesign-no-request ruling is reflected. The standing requirement is not modified.
- The truncated requirement covers AC2. Tasks 5.3 covers AC3.
- Evaluation-1's CR2 is closed by D6's page-level test: hash-ordered fixture, shown and descendant headers, recorded unplug mutation, no `httpClient` call.
- CR3 is closed by D6's real-walk draft-inserted step.
- CR1 is superseded by the ruling plus D5.

### Verdict: REFUTE

The direction is sound and matches the ruling. Five specific gaps would each let a competent implementer produce wrong or unstable order, or a silent flash regression. All five are cheap to fix in the artifacts.

### Change Requests

1. **D1's fallback contradicts the helper it names.** `usePipelineAnalyzeLookups.ts:81-91` `sourceSchemaForRoot` falls back to `analyzeResult.sourceSchemas[0]` when the rootId has no match. It also is not returned from the hook (:180-188).
   - Used as written, a draft-added root (HEL-1734) would be re-keyed by the first root's source schema, not by code-unit order as D1 and the spec say.
   - Revise D1 to require an exact `rootId` match (no `[0]` fallback), and add that case to the D6 root re-key unit test.
   - Optionally note that an owned source's declared order is also on the page as `state.sources.items[].inferredSchema` (`sources/types/dataSource.ts:71-73`). The "no declared order on the page" claim is only true for unowned sources.

2. **Multi-input ops with a source secondary are unaddressed.** `selectSourceFrames` decodes secondary samples through the same `sampleFrame()`, so a client-evaluated join/union(byName)/lookup appends the secondary's columns in hash order. Join merge (`combine.ts:144-148`) iterates `Object.keys(rightRow)`; union uses `Object.keys(other[0])`.
   - The server analyze places them in the secondary source's declared order (`PipelineAnalyzeService.scala:312-315` resolves `secondarySourceSchemas`; `MultiInputSchemaInference.scala:104-116` appends `right` in that order).
   - D2's audit premise "given an ordered input" does not cover an unordered secondary input.
   - Revise D1/D2 to state the rule for secondary frames. Either:
     - re-key them by a page-held declared order (the sources list's `inferredSchema`, or the saved join step's analyzed output schema), with a code-unit fallback; or
     - explicitly order those appended columns by code-unit and disclose that as a deviation in the spec.
   - Add an order assertion for join with a source secondary.

3. **D2's "falls under D3's code-unit rule" has no mechanism for client-evaluated steps.** D3 applies only to server-resolved frames. For client-evaluated frames the grid shows the frame's own `frameSchema` (first-seen order), so an unfixed handler's new columns appear in construction order, not code-unit order.
   - First-seen union across sparse rows can also break the declared order: row 1 has `a,c` and row 2 has `b`, giving `a,c,b`.
   - Revise D3 (or add a D3b) to state the grid's ordering function for a client-evaluated step explicitly. For example: `orderColumns(frameSchema(frame), names)` where `names` = the parent's displayed order, adjusted by the step's known projection (rename in place, appended columns), and anything else in code-unit order.
   - Alternatively, state that the frame order is authoritative and drop the "falls under D3" sentence, listing each unfixed handler as a disclosed deviation.

4. **Re-key identity and two-sided consistency.** D1 says "once per sample load", but its input (the analyze `sourceSchemas`) refreshes independently of the sample. `analyzePipeline` is dispatched from `usePipelineDebouncedAnalyze.ts:130`, `usePipelineAnalyzeDeferWatchdog.ts:55` and `usePipelinePageLoad.ts:70,146`.
   - Revise D1 to require memoizing the re-keyed frame on (sample object, ordered names). An analyze refresh with an unchanged order must keep the same frame identity, so the walker cache and the draft-preview request body are untouched.
   - Require that `rootFrames` and `savedRootFrames` are re-keyed by the same rule.
   - Add to D6:
     - a unit or page test that a first edit after the re-key flashes only the changed rows (the `StepPreviewTable.tsx:149` comparison against `baseRows`);
     - a test that a re-delivered analyze with identical order does not change root frame identity.

5. **Define D3 rule 1's "above" against the real dependency graph.** "Neither the step nor any step above it differs (config, enabled, position, parent)" omits two dependencies:
   - the root binding: the draft's `roots` vs `savedRoots`, including a root whose `dataSourceId` changed or was added or removed (HEL-1734);
   - lane/source secondary inputs (`laneDependencyOf`/`sourceDependencyOf`), whose upstream edit changes a join/union/lookup's output schema without touching its parent chain.

   Revise rule 1 to cover both, and add a D6 precedence case: an edit in a secondary lane makes the dependent server-resolved step use rule 2.

### Non-blocking notes
- Rename-in-place implementation: the safest route is to keep the existing fold (it implements chained and colliding renames in Scala's `scalaMapKeyOrder`) and then rebuild key order from the input row, substituting final names. Naive per-key substitution can diverge on chains like `a→b, b→c` and on collisions. `diffFrames` would catch a value change but not an order change.
- `StepPreviewTable.columnOrder.test.tsx` (cycle 1) injects `projectedSchema` by hand. Tasks 3.6 replaces test (c), but the whole file should be rewritten or removed with the prop, so no hand-fed schema test survives as false coverage.
- Server `compute` with an existing column name: the client `put` keeps the existing position. Check this against `inferCompute`'s Right branch in the D2 table.
- Tasks 5.4 (merge origin/main) is good. Main has moved (HEL-1762/1763 touch nearby UI), so re-run the affected specs after the merge.
