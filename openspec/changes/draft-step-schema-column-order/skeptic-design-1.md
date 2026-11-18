## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed tree: HEAD e83f216b0a6b84da100e465517d210c13da52ab5 (planning artifacts are untracked, not yet committed).

### What I verified (with evidence)

- **D3 premise (truncated fallback): confirmed.** `frontend/src/features/pipelines/state/draftStepView.ts:136-145`. In the `ok` branch of `mapServerResolved`, `rows` falls back to `lastGood?.rows`, but `truncated` is `transport.rows.get(stepId)?.truncated ?? false`. That loses `lastGood.truncated`. The consumers are `liveOutputSource.ts:99/111/123` (`view.truncated === true`). D3 and its RED test are sound, and the fix is as small as claimed.
- **Grid premise: confirmed.** `ui/spine/StepPreviewTable.tsx:156-167` builds `draftColumns` from `frameSchema(draftFrame)`, and `frameSchema` (`evaluator/evaluatePipeline.ts:67-71`) uses first-seen `Object.keys` order. The saved grid (`:124-130`) uses `analyzeOutputSchema` order.
- **Transport premise: confirmed.** `hooks/useDraftPreviewTransport.ts:52` keeps only `{kind:"ok", count}` from a `step` line.
- **HEL-1705 helpers exist as described.** `panels/state/columnOrder.ts:9-15` (`orderColumns`: schema names present, then extras by code unit) and `pipelines/state/liveOutput/frameRecords.ts:11-27` (`orderLiveColumns`/`frameColumns`).
- **D1 step 1 is unsound.** The server's `step`-line `schema` is not a schema order. It is the server's row-key iteration order:
  - `backend/.../draftpreview/DraftPreviewService.scala:152` emits `DraftPreviewSchema.of(rows)`.
  - `backend/.../draftpreview/DraftPreviewSchema.scala:8-35` says it builds the column list "in first-seen order" by iterating each row with `rows.foreach(_.foreach ...)`.
  - A row is `PipelineRowJson.Row = Map[String, Any]` (`domain/engine/PipelineRowJson.scala:17`). The draft-preview decoder builds each input row with `Map.newBuilder` (`DraftPreviewCells.scala:32-42`). A Scala immutable `Map` keeps insertion order only up to 4 entries (Map1-Map4). From 5 entries up it is a `HashMap`, which iterates in hash order.
  - So for any frame with more than four columns (the ticket's case, and task 5.2's own test case), the server's `schema` order is the same scrambled hash order the ticket complains about. Under D1, this order takes precedence over `analyzeOutputSchema`, so every server-resolved step would keep the bug.
  - The spec scenario "Server-resolved step" (`schema [x, y, z]` → headers `x, y, z`) and the D4/3.3(b) test feed a hand-written `schema`. They would go green while the real server sends a scrambled one: a test that looks like evidence but proves nothing.
  - The design's claim that this is "the server's own ... schema for that exact draft" is false as stated.
- **The rejected alternative already exists in the tree.** D1 rejects "a new analyze-proposal request per draft edit" as an extra request and a larger change. But `state/draftNodeSchema.ts` (`buildAnalyzeProposalRequest`, `schemaAtNode`) and `hooks/useDraftNodeCapabilities.ts` (HEL-1733, fd370e5e5) already call `POST /api/pipelines/analyze-proposal` on every draft change for the Output editor sheet. They return the draft's projected `outputSchema` per step node. This is the server's own `analyzeNodes` projection: a real declared schema, not one inferred from rows. The design never mentions this helper, and "larger change" is overstated: the request builder and the node lookup are already written and pure.
- **The accepted risk is wider than the design says.** `getAnalyzeOutputSchema` (`hooks/usePipelineAnalyzeLookups.ts:147-151`) returns the SAVED pipeline's analyze, or `[]` for a step it lacks. During a draft, the step shown in "Rows after step N" is usually the step being edited (`PipelineSpineLayout.tsx:279-287` passes the selected step). So the saved-schema fallback goes wrong in exactly the cases where the order changes:
  - (a) The edited step renames, selects, groups or aggregates: the new names drop to the end, sorted by code unit.
  - (b) Every step downstream of an edited step has the same problem.
  - (c) A step the draft added (`isDraftClientId`, rendered through the draft branch at `StepPreviewTable.tsx:194`) has no analyze entry. Its order is pure code-unit order with no schema at all.

  The Risks section covers only part of (a). In cases (a) to (c) the AC ("columns follow the step's output schema") is not met, and the design does not say so.

### Verdict: REFUTE

### Change Requests

1. **Drop the server `step`-line `schema` as an order source (D1 step 1, D2's `columns`, spec scenario "Server-resolved step", tasks 3.1/3.2/3.3(b)).** It is `Map[String, Any]` iteration order (`DraftPreviewSchema.scala:22-35`, `DraftPreviewCells.scala:33`), which is hash order beyond four keys. Two ways forward:
   - Remove it from the precedence altogether.
   - Make it schema-ordered on the server, using `RowColumnOrder`-style ordering from a declared schema. That is a backend change the Non-Goals currently exclude, so it must be planned explicitly with its own RED test.

   Whichever you choose, record the hash-order fact in design.md Context, because Context currently implies the server schema is authoritative.
2. **Use the draft's projected schema as the primary order for every draft step, not the saved analyze.** Reuse HEL-1733's `buildAnalyzeProposalRequest` + `schemaAtNode` (`state/draftNodeSchema.ts`). Lift the request out of `useDraftNodeCapabilities` or share it with that hook, so the grid and the Output sheet send one request per draft key, not two. Precedence:
   1. The draft projection for the node, when settled for the current draft key.
   2. Otherwise the saved `analyzeOutputSchema`, used only while the projection is in flight or failed.
   3. Otherwise code-unit order.

   Then rewrite D1's "Alternative rejected" paragraph so it states the real cost honestly: the request already exists in the tree and is shared or debounced.

   If the plan keeps the saved schema only, the Risks section and the PR must say that the AC is not met for an edited step that changes columns, for its downstream steps, and for a draft-added step (pure alphabetical). That is a product call on a partially met AC, and the owner is not available, so raise it as an ESCALATION rather than shipping it as an "accepted risk".
3. **Add a RED test for the realistic shape.** Use a frame with five or more columns, row keys out of schema order, and a draft that renames or adds a column in the shown step. Assert headers in the draft-projected order. Also cover a draft-added step (`isDraftClientId`): its headers follow the projection, not code-unit order. A hand-supplied `[x, y, z]` schema with three keys cannot catch hash ordering, so do not use one as the only server-side evidence.
4. **Task 5.2 must check a server-resolved step on the running app, not only a client-evaluated one.** For example, a join against a cached source secondary, or any step `serverResolvedStepIds` returns, over a source with more than four columns. That is the path where D1 as written would visibly fail.
5. **Fix the spec delta to match.** "for a step the server resolved, the column order of the server's own draft-preview result for that step" must be replaced by the projection-based rule (or the server-ordering rule, if CR1 goes the backend way). The "Server-resolved step" scenario must describe something the real server produces.

### Non-blocking notes

- D3 / task 2 is correct and independent: it can land first.
- `GoodFrame.columns` (D2) is still useful once the order source is the projection. Keep the column order a remembered frame was shown with. Note that `createViewTracker` (`draftStepView.ts:205-209`) stores `view.rows ?? good.get(id)?.rows`, so when rows fall back, columns must fall back the same way.
- The evidence path `.concertino/runs/HEL-1732/evidence/premise-validation.md` cited in design.md Context was not present when I listed the directory. Make sure it is persisted before the final gate cites it.
- Optional group 4 extras: 4.2 is a backend change. It pulls in `sbt testFull` for a cosmetic item, so it is worth deferring.
