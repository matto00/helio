## Skeptic Report — final gate (round 1, skeptic-final-1.md)

### What I verified (with evidence)

1. **AC3 (no scalar references anywhere)** — `grep -rn "sourceDataSourceId\|sourceDataSourceName" frontend/src` returned zero hits (exit code 1, empty output). Confirmed fresh.

2. **AC1 (create POST carries roots[])** — read `frontend/src/features/pipelines/services/pipelineService.ts`: `CreatePipelinePayload.roots: { sourceId: string }[]`, and `frontend/src/features/pipelines/ui/CreatePipelineModal.tsx` diff shows `createPipeline({ name: name.trim(), roots: [{ sourceId: selectedSourceId }] })` replacing the old scalar. Local state renamed `sourceDataSourceId` → `selectedSourceId` throughout, no leftover references.

3. **AC2/AC4 (display sites resolve roots[0] guarded; dependency counters use .some() over ALL roots)**:
   - `PipelineListTable.tsx:105` — `pipeline.roots[0]?.dataSourceName ?? ""`
   - `PipelineDetailPage.tsx:151` — `currentPipeline.roots[0]?.dataSourceName ?? ""`
   - `usePipelineDetailPage.ts:357` — `currentPipeline?.roots[0]?.dataSourceId` (optional-chained, empty roots produce `undefined`, no throw)
   - `SidebarBody.tsx` `deleteWarning` — `pipelines.items.filter((p) => p.roots.some((r) => r.dataSourceId === item.id))`
   - `EmptySchemaAffordance.tsx` — `pipelines.filter((p) => p.roots.some((r) => r.dataSourceId === source.id))`
   - `pipelinesSlice.ts:602-619` `selectPipelineNamesBySourceId` — dedupes per pipeline via a `Set` of the pipeline's root source ids before pushing into the map (a pipeline with two roots on the same source contributes its name once).
   - **Falsifiability check**: `SidebarBody.test.tsx` "counts a pipeline as a dependent when the matching root is not the first one" deletes `src-2`, which appears only as `pipe-1`'s SECOND root (`root-2`). A `roots[0]`-only implementation would find zero matches here and fail this assertion (`"1 pipeline reads..."` would never render). This is genuinely falsifiable, not vacuous.

4. **Scope containment** — `git diff main...HEAD -- backend/` is empty (backend untouched, confirmed). Read the full `CreatePipelineModal.tsx` diff: single-source `Select` UI unchanged in shape, no "+ root" affordance, no root list/columns added anywhere in the diff. No PipelineRiver/editor files touched.

5. **D4 (RootSourceSchema field omission)** — `pipelineStep.ts` declares `RootSourceSchema { rootId, sourceSchema }` — the `sourceDataSourceName`-equivalent field is genuinely omitted (not aliased/renamed), with an 18-line comment explaining the AC3-vs-still-sent-wire-field collision and pointing to HEL-975. `design.md` D4 was read in full: the superseded cycle-1 "rename" reasoning is explicitly quoted and marked "does not survive it," not silently left standing — satisfies the qualification requirement.

6. **Load-bearing e2e proof** — ran `npx playwright test e2e/hel910-pipeline-to-dashboard-flow.spec.ts` against the live dev servers (already running at :6401/:9308 via `start-servers.sh`, reused). Result: **2 passed** (both the create→pipeline→Outputs→dashboard flow and the existing-Output placement flow). This is the load-bearing proof per the ticket and it is genuinely green against a running backend, not merely asserted.

7. **No-regression check** — ran `e2e/hel813-mobile-touch-target-floor.spec.ts`: **14 passed**. Confirms no regression; per the ticket's own correction this proves nothing about the fix itself, treated accordingly (not cited as fix evidence).

8. **Unit tests** — full `npm test`: **254 suites / 2615 tests passed**. Targeted re-run of the four touched suites (`pipelinesSlice`, `SidebarBody`, `CreatePipelineModal`, `PipelineDetailPage`) also independently green (218 tests).

9. **Lint / typecheck** — `npm run lint`: clean (`eslint src --max-warnings=0`, no output). `npm run typecheck`: clean. Per the ticket's own evidence rule this is NOT treated as proof of correctness — only cited as "not additionally broken," with hel910 as the real proof (point 6).

10. **Delivery-hygiene artifacts** — `files-modified.md` declares each path as its own bullet (new one-path-per-bullet form, not the old squash-branch.sh grouped form the ticket warned this branch carries the risk of). `proposal.md` non-goals and `design.md` D4/decisions section both record the CR1 product-owner ruling and the HEL-975/976 spinoff ids rather than leaving stale reasoning unqualified. Spec deltas under `specs/datasource-edit-delete/`, `specs/pipeline-editor-page/`, `specs/pipeline-new-flow/` match the shipped code exactly (roots.some() dependency semantics, roots[0] display resolution, empty-roots-no-throw scenario all present and accurate).

### Verdict: CONFIRM

### Non-blocking notes
- None of substance. The `roots.some(...)` dedup-per-pipeline logic in `selectPipelineNamesBySourceId` and the two dependency counters are correctly scoped beyond the strict "restore single-source experience" reading of the ticket, but this is explicitly self-approved in design.md as a no-behavior-change-today improvement, and is well-reasoned.
