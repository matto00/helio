## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence)

1. **File-count claims in design.md are exact, not estimated.** Ran
   `grep -rl "sourceDataSourceId" frontend/src | wc -l` → 21, and
   `grep -rl "sourceDataSourceName" frontend/src | wc -l` → 16. Matches design.md's
   "exactly 21 files ... 16 reference" claim precisely.

2. **All cited line numbers point at real, matching code.** Spot-checked every
   production read/write site named in design.md and tasks.md against the actual
   files:
   - `frontend/src/features/pipelines/services/pipelineService.ts:33` — `sourceDataSourceId: string;` on `CreatePipelinePayload`. Confirmed.
   - `frontend/src/features/pipelines/ui/CreatePipelineModal.tsx:90` — posts `sourceDataSourceId` in the `createPipeline(...)` dispatch. Confirmed.
   - `frontend/src/shared/chrome/SidebarBody.tsx:90` — `pipelines.items.filter((p) => p.sourceDataSourceId === item.id)`. Confirmed, and design.md's `.some(...)` correction is a real fix (currently a scalar comparison, not root-aware).
   - `frontend/src/features/sources/ui/EmptySchemaAffordance.tsx:30` — same pattern, `pipelines.filter((p) => p.sourceDataSourceId === source.id)`. Confirmed.
   - `frontend/src/features/pipelines/hooks/usePipelineDetailPage.ts:354` — `sources.find((s) => s.id === currentPipeline?.sourceDataSourceId)`. Confirmed.
   - `frontend/src/features/pipelines/ui/PipelineDetailPage.tsx:151` — `sourceName={currentPipeline.sourceDataSourceName}`. Confirmed.
   - `frontend/src/features/pipelines/ui/PipelineListTable.tsx:104` — `{pipeline.sourceDataSourceName}`. Confirmed.
   - `frontend/src/features/pipelines/state/pipelinesSlice.ts:273` (createPipeline thunk arg type) and `:598-611` (`selectPipelineNamesBySourceId` keyed on the scalar, no dedupe) — both confirmed as design.md/tasks.md describe.
   - `frontend/src/features/sources/ui/AddSourceModal.tsx:49` — doc-comment-only reference to `sourceDataSourceId`. Confirmed (not a real read site), matching the ticket's characterization.

3. **hel813 is correctly never treated as evidence.** ticket.md, proposal.md, and
   tasks.md (task 7.4) all explicitly state hel813 is a no-regression check only,
   already green on base, and must not be cited as proof the fix worked. No
   artifact cites hel813 as AC evidence for the fix.

4. **The typecheck-cannot-catch-this warning is present and load-bearing.**
   design.md's D6 and tasks.md's 7.3 both explicitly state a green `npm run
   typecheck` is not evidence; the only proof is hel910 red→green against a
   running backend. No artifact substitutes typecheck for that proof.

5. **Scope discipline holds.** proposal.md's Non-goals and design.md's
   Non-Goals explicitly exclude any "+ root" affordance, root columns, or
   multi-root editing, deferring that to HEL-968. Scanned every task in
   tasks.md (1.1–7.5) — none introduce a multi-root authoring affordance; all
   are single-root reads (`roots[0]`) or `.some(...)` dependency matching,
   consistent with restoring the pre-existing single-source UX on the new wire
   shape. D4's inclusion of `PipelineAnalyzeResponse` realignment is
   self-scrutinized in Planner Notes with a stated escalation trigger if it
   turns out to require UI work, and is justified as forced by AC3's zero-hit
   grep with zero production consumers — reasonable, not scope creep.

6. **D2's root-vs-first-root distinction is correct and specifically tested.**
   Design correctly separates "name this pipeline's source" (`roots[0]`,
   legitimate under the single-root current UX) from "does this pipeline use
   this source" (`roots.some(...)`, required for correctness once any pipeline
   ever has >1 root). Task 6.3 requires a second-root-matching fixture that
   would fail under a naive `roots[0]` implementation — this is a real,
   falsifiable test, not vacuous.

7. **Backend wire-shape claims (PipelineProtocol.scala:78/87/100,
   PipelineAnalyzeProtocol.scala:184/197) match what HEL-913 (4b953460) is
   known to have shipped**, consistent with the ticket's own verified-premise
   section and this being the immediately-preceding commit in `git log`.

### Verdict: CONFIRM

The design is precisely grounded in the actual tree (all line numbers and
counts verified independently and matched exactly), correctly treats hel813
as a no-regression check rather than fix evidence, correctly refuses to treat
typecheck as proof, stays scoped to single-root restoration with an explicit
non-goals boundary against HEL-968 multi-root UI work, and the dependency-vs-display
root-resolution distinction (D2) is both correct and backed by a fixture
designed to catch the naive wrong answer.

### Non-blocking notes

- Task 7.5's reminder about the stale `squash-branch.sh` parser (one path per
  `files-modified.md` bullet) is a good catch to carry into execution/evaluation.
- The two openspec spec deltas not being repaired (`pipeline-list-api`,
  `pipeline-edit-flow` backend response docs) are correctly logged as
  follow-up triage rather than silently ignored.
