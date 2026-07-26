## Skeptic Report — design gate (round 1)

### What I verified (with evidence)

1. **`PipelineRunService` is genuinely synchronous.** Read
   `backend/src/main/scala/com/helio/services/PipelineRunService.scala` end to end.
   `submit` → `runPipeline` → `executeRun` chains `preExec.flatMap { engine.loadRows(...).flatMap {
   engine.executeWithStepCounts(...) } }.transformWith { ... followUp.map(_ => Right(response)) }`,
   where `followUp` on success is `onRunSuccess`, whose `for { schemaUpsert; rowsUpsert (=
   dataTypeRowRepo.overwriteRows); binaryRefsUpsert; alertEvaluation; updateMeta; updateRun } yield
   ()` is itself part of the `Future` `submit` returns. Rows are written before the outer Future
   resolves. **Confirmed.**

2. **FK cascade claims, verified against the migrations themselves:**
   - `V22__pipelines.sql`: `source_data_source_id TEXT NOT NULL REFERENCES data_sources(id) ON
     DELETE CASCADE`, `output_data_type_id TEXT NOT NULL REFERENCES data_types(id) ON DELETE
     CASCADE` — matches.
   - `V4__data_sources_and_types.sql`: `data_types.source_id ... REFERENCES data_sources(id) ON
     DELETE SET NULL` — matches (not cascade).
   - `V23__pipeline_steps.sql`: `pipeline_id ... REFERENCES pipelines(id) ON DELETE CASCADE` —
     confirms steps cascade from the pipeline, as D5 assumes.
   - `V29__data_type_rows.sql`: no FK at all on `data_type_id` — confirms "no cascade to rely on."
   - `DataTypeRowRepository.overwriteRows` (read directly) with an empty `rows` sequence does a
     DELETE-only, which is the mechanism D5 step 1 needs even though design.md doesn't name the
     method explicitly (non-blocking implementation detail for the executor).
   - `DataSourceService.delete` (read directly) does **not** touch the companion DataType — it only
     deletes the source file (if any) and the source row. This confirms D5's claim that skipping the
     explicit companion-DataType delete would leave an orphaned `source_id IS NULL` DataType behind
     (SET NULL, not cascade) — the risk design.md flags is real, and the mitigation is correctly
     ordered.

3. **HEL-399/400 prior art, verified as claimed.** `ShapeInstantiateStep.tsx` composes `expand →
   createPipeline → createPipelineStep* (loop, no rollback on failure, comment says so explicitly:
   "No rollback of the already-created pipeline on a mid-loop failure") → run`, entirely client-side
   against existing endpoints. `helio-mcp/src/helioApi.ts#createPipelineFromShape` (lines 391-411)
   does the same sequential await-loop with zero new backend endpoint and zero cleanup on a
   mid-loop `addPipelineStep` failure. Both confirmed as design.md describes. The proposal's
   rationale for a third, server-side, cleanup-bearing path (unattended-agent caller vs.
   human-with-UI-retry) is specific and reasoned, not hand-waved, and directly answers the
   orchestrator's explicit "must settle whether this generalizes/reuses HEL-399/400" requirement.
   The scope is genuinely distinct: HEL-399/400 take a *shape id* (a preset); this ticket takes raw
   `pipeline.steps` and also creates/binds the panel, which HEL-399/400 never do. Not a duplicate.

4. **`PanelBindingSpec`/`PanelCapabilityService` shape, verified.** Read both files.
   `PanelBindingSpec.DataBindable = Vector(Metric, Chart, Table, Collection, Timeline)` exists with
   `requiredSlots`/`optionalSlots`/`columnEligibility` exactly as D3 describes.
   `PanelCapabilityService.capabilityFor`/`eligibleColumnNames` compute bindability from
   `spec.requiredSlots.forall(slot => eligible.getOrElse(slot, Vector.empty).nonEmpty)`, which is a
   pure function of `(spec, columns)` once the `isPipelineOutput` branch is factored out — the
   proposed `PanelBindingSpec.evaluate(spec, columns)` extraction is a legitimate,
   behavior-preserving refactor (the `isPipelineOutput=false` short-circuit stays in
   `capabilityFor`, only the column-satisfiability math moves).

5. **`PanelService.buildForCreate` reusability, verified.** It is `private[services]`
   (`PanelService.scala:136`), package-scoped exactly as needed for a same-package
   `BoundPanelService`. `DashboardContentsService.scala:93` already calls
   `panelService.buildForCreate(dashboardId, createRequest, user)` (HEL-363 precedent, confirmed by
   grep + read). `buildForCreate` internally calls `rejectCompanionBinding` (V41 enforcement) and
   `resolveCreateAppearance` (appearance-at-creation, including chart appearance) — both AC #2 and
   AC #4 are satisfied "for free" as claimed, confirmed by reading the method body.

6. **D3's gate is achievable, not overstated.** `PipelineAnalyzeService` is a pure `object` (no DB,
   no DI) — `PipelineService.analyze` (read directly, `PipelineService.scala:158-200`) already
   calls it exactly the way D3 proposes: derive `sourceSchema` from
   `dataTypeRepo.findBySourceId(sourceDataSourceId, ...)`, feed it + step configs through
   `PipelineAnalyzeService.analyze`, and read the final step's `outputSchema`. This is a real,
   already-proven code path, not new invention.

7. **V41 exists** (`V41__pipeline_only_panel_binding.sql`, confirmed on disk) and `openspec
   validate compound-bound-panel-op --strict` passes cleanly.

8. **Scope discipline** — grepped `tasks.md`/`design.md`/`proposal.md`: no mention of batch
   creation, resource tagging, layout/auto-pack, or panel id key. Out-of-scope items match the
   ticket's own "Out of scope" section verbatim.

### Weak points scrutinized on the merits (not just fact-checked)

- **D3's "no true cross-service transaction" framing** is correct in conclusion but slightly
  under-explains *why*: the more fundamental blocker isn't just "multiple Slick repos" (which could
  in principle be composed into one `DBIO.seq(...).transactionally`, as `DashboardContentsOps`
  shows for a single-repo case) — it's that `PipelineRunService.executeRun` interleaves a
  non-transactional compute step (`InProcessPipelineEngine.executeWithStepCounts`, arbitrary-latency
  Scala transformation, not a DB action) between the pipeline-creation writes and the row writes.
  You cannot hold a Postgres transaction open across that. Design.md's stated reasoning ("each with
  independent Slick actions") is true but incomplete — non-blocking, the conclusion is still
  correct.
- **D3 doesn't inspect `AnalyzedStep.validationError` per intermediate step**, only the final
  projected schema's column satisfiability. A step with a bad config (e.g., referencing an unknown
  field) would sail through the gate with an identity-fallback schema and only fail later at
  `addStep`/run time (a named, cleaned-up failure stage, per D5) — this is consistent with the
  design's own "advisory-strong, not a guarantee" framing in Risks, not a contradiction.
- **Inline `source.rows` wire format is not fully pinned in D2** (`{name, columns, rows}` doesn't
  specify row shape). Verified the existing convention it should mirror:
  `StaticDataSourceRequest.rows: Vector[Vector[JsValue]]` and the MCP's existing
  `createDataSource({..., rows: unknown[][]})` both use positional row-arrays, not row-objects. The
  design is inferable from precedent but not explicit — worth the executor pinning down in the wire
  type task (1.1), not a blocking design gap.
- **Multi-tenancy in the chain** — verified `PipelineRepository.create` re-checks
  `dataSourceRepo.findByIdOwned(sourceDataSourceId, user)` internally (defense in depth beyond
  D4-step-1's own explicit re-verify), and `PipelineService.addStep`'s Join/Union/Lookup pre-flight
  checks (`dataSourceRepo.findByIdOwned` per cross-source reference) are real and inherited for
  free, confirmed by reading `PipelineService.scala:270-341`. No gap found.
- **The AC #2 "V41 rejection" test case** is structurally hard to trigger since the server always
  injects the freshly-created `dataTypeId` into `panel.config` (D2) — design.md D4 step 5 explicitly
  calls this out as "belt-and-suspenders... by construction step 5 always binds to the just-created
  pipeline output, never a companion type." This is self-aware, not an oversight.

### Verdict: CONFIRM

### Non-blocking notes
1. Pin the inline `source.rows` wire shape (positional array-of-arrays, matching
   `StaticDataSourceRequest`/the existing `create_data_source` MCP convention) explicitly in task
   1.1's wire-type definition, rather than leaving it implicit.
2. Consider tightening design.md's "no true transaction" rationale to name the real blocker
   (`InProcessPipelineEngine`'s non-DB compute step interleaved in the chain), not just "independent
   Slick repos" — purely a documentation clarity improvement, doesn't change the plan.
