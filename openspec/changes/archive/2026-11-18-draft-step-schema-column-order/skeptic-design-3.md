## Skeptic Report — design gate (round 3, skeptic-design-3.md)

Reviewed tree: HEAD e83f216b0a6b84da100e465517d210c13da52ab5 (the planning artifacts are untracked). Spawn-cwd guard: READY.

### Round 2 change requests: were they addressed?

1. **CR1, D2 cache semantics: addressed.** D2 now states all four rules.
   - (a) An in-flight promise is shared. A rejection is evicted when it happens, so the next same-key call issues a new POST.
   - (b) Only successes are kept, in an LRU of 8.
   - (c) The cache is page-scoped, created once in `usePipelineDetailPage` or the nearest common owner. No module singleton.
   - (d) Save and Discard need no explicit clear, and the reason is given.
2. **CR2, task 3.2 claim: addressed, and now true.** The cache is page-scoped. `useDraftNodeCapabilities` takes an optional `project` parameter that defaults to plain `analyzeProposal`. `OutputEditorSheet.draft.test.tsx` renders the sheet without a page cache, so it keeps today's per-mount request path. Its cases (a), (b), (e) and (g) stay independent without editing any expectation. Task 3.2 also forbids expectation edits.
3. **CR3, failure-eviction RED test: addressed.** D4 "Failure eviction" and task 3.1 both cover it, and D4 adds cache unit tests (LRU, rejection evicted, separate caches isolated).

### What I verified against the live tree

- **A page-scoped cache has a precedent and a host.** `usePipelineDetailPage.ts:66` already creates per-page memory the same way: `const [draftFrameMemory] = useState(createDraftFrameMemory)`. It reaches the spine via `page.draftFrameMemory` (`:180`). So D2(c) follows an existing pattern.
- **Both consumers build the same request key.**
  - The grid side reads `page.steps`, `page.roots` and `page.pipelineName` (`usePipelineDraftPresentation.ts:21-31`).
  - The sheet reads `page.pipelineName` and `page.roots` through the memoised `sheetDraft` (`PipelineDetailDialogs.tsx:29-39`), and `steps={page.steps}` (`:54`). These reach `buildAnalyzeProposalRequest` via `useOutputSheetNode.ts:48-56`.
  - The sheet's local key prefixes `nodeStepId` (`useDraftNodeCapabilities.ts:55-58`), but the request itself does not depend on the node. A cache keyed on `JSON.stringify(request)` is therefore shared across nodes and across the two consumers, as D2 says.
- **The sheet is mounted in one place only:** `PipelineDetailDialogs.tsx:45`. Passing the page's `project` there (for example on `OutputSheetDraft`) reaches every production use.
- **Rejection semantics are preserved.** `analyzeProposal` (`services/analyzeProposalService.ts`) is a plain axios promise with no abort. The sheet's `.then(ok, fail)` (`useDraftNodeCapabilities.ts:63-70`) still receives the rejection through a shared promise, so `unavailable` behaves as today. Evicting the rejection lets a remount re-request.
- **D3 is correct and minimal.**
  - `GoodFrame.truncated?: boolean` exists (`draftStepView.ts:57-62`).
  - The `stale()` helper already uses `good?.truncated === true` (`:86-91`).
  - `mapServerResolved`'s `ok` branch (`:136-143`) is the only path that loses it.
  - The planned RED case (no `rows` line, `lastGood.truncated: true`) fails on main as written.
- **The D1 wiring site matches.** `StepPreviewTable.tsx:156-167` builds `draftColumns` from `frameSchema(draftFrame)` and takes types from `analyzeOutputSchema`, as the Context states.
- **Scope against the ticket ACs.**
  - AC1 (schema order, RED first) is covered by D1 and D4 (a)-(e), and tasks 4.1-4.2.
  - AC2 (truncated, RED first) is covered by D3 and tasks 2.1-2.2.
  - AC3 (running app, desktop and phone, light and dark) is covered by task 6.2.
  - The optional extras are gated as "cheap only", and the backend extra is deferred. No AC is left uncovered.
  - The cache work goes beyond the ticket's literal text. It is the minimum needed so the grid does not double the existing HEL-1733 requests, so I accept it.
- No placeholders, TODO/TBD or internal contradictions between proposal, design, tasks and spec. The round 2 non-blocking notes (pivot, the sheet's per-change requests, the task 6.2 wording) were folded into Risks and task 6.2.

### Verdict: CONFIRM

### Non-blocking notes

- **Staleness trade-off.** Today the sheet re-requests on every mount. With the page cache, reopening the sheet on an unchanged draft is served from cache. If a root source's schema changes during the same page session (a source refresh in another tab), the cached projection can be stale until navigation or a draft change. This is bounded (page scope, LRU 8) and the risk is small. Record it under Risks.
- **File overlap with HEL-1763.** The sheet's `project` will likely go through `outputSheetDraft.ts`, `PipelineDetailDialogs.tsx` or `useOutputSheetNode.ts`. Before editing them, confirm none of these is among the files HEL-1763 is changing.
- Keep the `project` parameter's default exactly `analyzeProposal`, so the no-cache path is byte-identical to today's behavior.
