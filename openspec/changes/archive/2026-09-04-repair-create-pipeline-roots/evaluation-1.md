## Evaluation Report — Cycle 1 (evaluation-1.md)

### Phase 1: Spec Review — PASS
- AC1 (create posts `roots: [{sourceId}]`): confirmed in `CreatePipelineModal.tsx:92`.
- AC2 (detail header from `roots[0]`): confirmed `PipelineDetailPage.tsx:151` `currentPipeline.roots[0]?.dataSourceName ?? ""`, guarded.
- AC3 (zero `sourceDataSourceId`/`sourceDataSourceName` hits): ran `grep -rn "sourceDataSourceId\|sourceDataSourceName" frontend/src` myself — zero hits (empty result, grep exit 1).
- AC4 (dependency counters use `.some(...)`, not `roots[0]`): confirmed in `SidebarBody.tsx:93`, `EmptySchemaAffordance.tsx:33`, and `selectPipelineNamesBySourceId` (dedupes via `Set` per pipeline before pushing — a pipeline with two roots on the same source is listed once, verified by reading the implementation).
- Tasks 1–7 all marked done and match the diff; no scope creep found outside the ticket's file list.
- No multi-root UI: `CreatePipelineModal.tsx` diff confirms single-source flow (`selectedSourceId` scalar local state → one-element `roots[]` array); no "+ root" affordance, no root columns. Correctly out of HEL-968 scope.
- Regression risk: `PipelineDetailHeader.tsx` doc comments updated; `PipelineListTable.tsx` renders `roots[0]?.dataSourceName ?? ""`.

**One deviation, addressed under Phase 2 below (task 2.3 / design decision D4):** the executor renamed `RootSourceSchemaResponse.sourceDataSourceName`'s frontend mirror to `dataSourceName` instead of matching the wire field name, to dodge AC3's literal grep. This is flagged as a Phase 2 code-quality/correctness defect, not a Phase 1 AC gap (AC3's grep genuinely returns zero hits) — but it does violate task 2.3's explicit "matching `RootSourceSchemaResponse` on the wire" instruction and D4.

### Phase 2: Code Review — FAIL

Gates run fresh, in `WORKTREE_PATH` (no `CLEAN_WORKTREE` flag at this speed):
- `npm run lint` — PASS (zero warnings)
- `npm run format:check` — PASS
- `npm test` — PASS (254 suites / 2615 tests)
- `npm --prefix frontend run build` — PASS

Design/D2/D3 mechanical checks:
- D2 (`.some(...)` over all roots for dependency counters) — confirmed correct in `SidebarBody.tsx`, `EmptySchemaAffordance.tsx`, `selectPipelineNamesBySourceId`.
- D3 (guarded `roots[0]` access, never asserted) — confirmed: `usePipelineDetailPage.ts:357` uses `currentPipeline?.roots[0]?.dataSourceId` (optional chaining on both `currentPipeline` and the array-index access result); `PipelineDetailPage.tsx:151` uses `roots[0]?.dataSourceName ?? ""`. No non-null assertions (`!`) found on any `roots[...]` access. An empty `roots` array renders `""` rather than throwing.
- Test falsifiability (task 6.3): `SidebarBody.test.tsx:210-232` — "counts a pipeline as a dependent when the matching root is not the first one" builds a pipeline whose match is on `roots[1]` only. Verified by inspection this is genuinely falsifiable: a `roots[0]`-only implementation (e.g. `p.roots[0]?.dataSourceId === item.id`) would find zero matches for `src-2` and the assertion `"1 pipeline reads from this source..."` would fail. Not vacuous.
- `selectPipelineNamesBySourceId` (task 5.3): confirmed it dedupes per pipeline via `new Set(pipeline.roots.map((r) => r.dataSourceId))` before indexing, so a pipeline with two roots on one source is listed once — matches the requirement.

**Change Request — CR1 (blocking).** `frontend/src/features/pipelines/types/pipelineStep.ts:472-475`, `RootSourceSchema.dataSourceName`. The backend's actual wire field for this response is `sourceDataSourceName` (`backend/src/main/scala/com/helio/api/protocols/pipelines/PipelineAnalyzeProtocol.scala:184`, `RootSourceSchemaResponse(rootId: String, sourceDataSourceName: String, sourceSchema: ...)`; spray-json's default formatter serializes by the case-class parameter name, so the JSON key really is `sourceDataSourceName`, not `dataSourceName`). Task 2.3 and design decision D4 explicitly require this frontend type to match `RootSourceSchemaResponse` on the wire; instead the executor renamed the field to `dataSourceName` specifically to dodge AC3's literal grep for the string `sourceDataSourceName`, per the type's own comment at lines 466-470 ("Named `dataSourceName` to match `PipelineRoot.dataSourceName`'s convention rather than the wire field literally, since AC3 ... bars the old scalar's name from appearing anywhere"). This is a real, if currently dormant, defect: any future consumer of `PipelineAnalyzeResponse.sourceSchemas[].dataSourceName` will get `undefined` at runtime against the real API, because the actual parsed JSON key is `sourceDataSourceName`. It reintroduces exactly the class of silently-wrong-type defect this ticket exists to eliminate (frontend types not compile-time-coupled to backend JSON — see ticket.md "Why the typecheck gate cannot catch this defect class"). The comment's "zero production consumers today" claim is true (verified: `grep -rn "sourceSchemas\|RootSourceSchema" frontend/src` outside tests returns only the type declaration and its use in `PipelineAnalyzeResponse`) but that only means the bug is latent, not that it doesn't exist. AC3's grep should not have been satisfied by renaming a field that is supposed to mirror the wire shape; the correct fix is either (a) name the frontend field `sourceDataSourceName` and thread it through with a local alias/comment noting it is "the old scalar's name reused for an unrelated per-root field, not the retired global scalar" (AC3's intent is clearly about the retired *pipeline-level* scalar, not a like-named nested field that happens to share the wire's chosen name), or (b) keep `dataSourceName` in the *TypeScript* interface only if the JSON deserialization site explicitly remaps `sourceDataSourceName → dataSourceName` (e.g. a small adapter/mapper at the point the response is read) rather than typing the raw wire object directly under this interface name. As shipped, the interface is asserted to describe the wire response verbatim (`PipelineAnalyzeResponse.sourceSchemas: RootSourceSchema[]`) and does not match it.

No other Phase 2 issues found. DRY/readability/modularity/type-safety/error-handling of the rest of the diff are sound; tests are meaningful (real fixture changes across the roots[] shape, not vacuous updates); no dead code; no over-engineering; changes are behavior-preserving where expected (D2/D3/dedupe are intentional new behavior called for by the ticket, not drive-by).

### Phase 3: UI Review — PASS
Servers started via `scripts/concertino/start-servers.sh` / `assert-phase.sh servers` (both healthy, reused already-running instances). Load-bearing proof re-run myself against the live backend:

```
DEV_PORT=6401 BACKEND_PORT=9308 npx playwright test e2e/hel910-pipeline-to-dashboard-flow.spec.ts --reporter=line
→ 2 passed (13.0s)
```

I attempted to independently reproduce the pre-fix RED state by checking out the parent commit (`4b953460`) into a throwaway worktree, but a full clean dependency install was infeasible at this effort level (cross-device hardlink copy of `node_modules` from `WORKTREE_PATH` into `/tmp` failed — different filesystems) and I stopped rather than spend disproportionate time on it; that throwaway worktree was removed (`git worktree remove --force`, confirmed via `git worktree prune`). In its place I confirmed the causal mechanism directly: `git show 4b953460:frontend/.../CreatePipelineModal.tsx` still posts the scalar `sourceDataSourceId` field, and the ticket's "Verified premise" section (independently re-enumerated by the ticket author from the tree at `4b953460`, not taken on the executor's word) already establishes `CreatePipelineRequest` on that commit requires `roots: Vector[CreatePipelineRootRequest]` with no scalar fallback — so the pre-fix frontend payload would 400. Combined with the now-green hel910 run against the identical backend contract, this is adequate (if not maximally rigorous) evidence of the RED→GREEN transition.

Additional checks:
- `e2e/hel813-mobile-touch-target-floor.spec.ts` not re-run as evidence (per instructions — it was already green and is a no-regression check only, not load-bearing).
- Live browser check of `/pipelines`: page loads, zero console errors.
- No console errors during the hel910 Playwright run.
- No multi-root UI surfaced anywhere in the running app (matches scope).

### Overall: FAIL

### Change Requests
1. Fix `RootSourceSchema` in `frontend/src/features/pipelines/types/pipelineStep.ts:472-475` so it actually matches the backend wire field `sourceDataSourceName` (`PipelineAnalyzeProtocol.scala:184`), per task 2.3 / design D4 — either rename the field back to `sourceDataSourceName` (AC3 targets the retired pipeline-level scalar, not this unrelated nested per-root field sharing part of its name) or introduce an explicit adapter that remaps the wire key at the response-parsing boundary if the team wants to keep the TS field renamed. As shipped, this type silently lies about the JSON it claims to describe.

### Non-blocking Suggestions
- Consider a one-line comment on `RootSourceSchema` (once CR1 is resolved) noting it currently has zero production consumers, so a future reviewer doesn't assume runtime coverage exists for it.
