## Skeptic Report — design gate (round 0, skeptic-design-1.md)

### What I verified (with evidence)

- **Migration numbering (ticket's stale-context claim).** Re-verified fresh: `git fetch origin main` →
  `origin/main` HEAD is `6612e291` (matches branch base), highest migration on both is
  `V84__pipeline_run_assertions.sql`. `V85` is genuinely free right now. Confirms ticket.md's
  "Environment facts" section, independently reproduced, not just trusted.

- **`PipelineService.analyze`'s sourceSchema derivation** (design.md Context / D1) — read
  `backend/src/main/scala/com/helio/services/PipelineService.scala:186-227`. Line 200-201 matches the
  design's citation exactly: `dataTypeRepo.findBySourceId(pipeline.sourceDataSourceId, user.id).headOption...`.
  `jsonFormat7` on `PipelineAnalyzeResponse` (`PipelineAnalyzeProtocol.scala:293`) confirmed — 7 fields today,
  `jsonFormat8` needed for the 8th (`sourceSchemaDrift`) — matches D5/task 4.2.

- **`PipelineRunService.onRunSuccess`/`onUnblockedRunSuccess`** — read
  `backend/src/main/scala/com/helio/services/PipelineRunService.scala:113-560`. The `updateLastRun(…,
  "succeeded", …)` call the design cites at line 533 is real and is the only `"succeeded"` call in the file
  (`grep '"succeeded"'` → single match at line 533, inside `onUnblockedRunSuccess`). `dataTypeRepo` is a
  required (non-default) constructor param, confirmed already present in every `new PipelineRunService(...)`
  call site (`grep -rn "new PipelineRunService("` across 9 test files + `ApiRoutes.scala`) — design's "already
  constructor-injected" claim holds.

- **`PipelineRepository.updateLastRun`** (`PipelineRepository.scala:276-290`) — confirmed the exact
  targeted-projection pattern (`.filter(...).map(r => (...)).update(...)`, owner-scoped via
  `ctx.withUserContext` + `r.ownerId === ownerUuid`) design D2 cites as the precedent for
  `updateLastSourceSchema`/`findLastSourceSchema`.

- **`PipelinesTable.*` arity** (`PipelineRepository.scala:395-424`) — read the actual `PipelineRow`/`*`
  projection: 11 fields (`id, name, sourceDataSourceId, outputDataTypeId, lastRunStatus, lastRunAt, createdAt,
  updatedAt, lastRunRowCount, ownerId, tag`), not the "22-arity" design.md D2 states. Factual error in the
  design doc (see notes below) — does not change the decision itself (don't add the column to `*`), just shows
  the citation wasn't checked against the file.

- **`V53__panel_column_widths.sql`** precedent — read the file; confirms the nullable-JSONB-column-via-simple-
  `ALTER TABLE` pattern the migration plan follows.

- **`SchemaField`/`PipelineAnalyzeService`** — confirmed `SchemaField(name, type)` lives in
  `domain/PipelineAnalyzeService.scala:9`, `object PipelineAnalyzeService` in the same file — matches D3's
  "next to PipelineAnalyzeService, which owns SchemaField."

- **`schemas/pipeline-analyze-response.schema.json`** — read in full. Top-level `additionalProperties: false`
  with `sourceSchema`/`steps`-style optional (`validationError`) fields already omitted-when-absent in the
  `AnalyzeStep` sub-schema — confirms the planned "optional property, not in required" approach for
  `sourceSchemaDrift` is consistent with the file's existing convention, and that the harness
  (`JsonSchemaValidation.scala`, already used by `PipelineAnalyzeProposalRoutesSpec`/`WorkspaceContextServiceSpec`)
  is real and applicable — task 5.2's plan is grounded, not aspirational.

- **RLS on `pipelines`/`data_types`** — read `V35__rls_owner_only_tables.sql` and
  `V39__pipeline_sharing_grants.sql`. Confirmed `pipelines_select` is sharing-aware (owner + grantees via
  `helio_can_access_pipeline`), but `data_types_owner` (V35) is still owner-only, unmodified since. Cross-
  checked against `DataTypeRepository.findBySourceId` (`DataTypeRepository.scala:65-70`), which adds an
  explicit `r.ownerId === ownerUuid` Scala-level filter on top of RLS. Conclusion: `analyze`'s existing
  `sourceSchema` is **already empty for a non-owner grantee caller today** — a pre-existing, out-of-ticket-scope
  gap, not introduced by this design (see note below).

- **`openspec validate pipeline-schema-drift-detection --strict`** → `Change 'pipeline-schema-drift-detection'
  is valid`. Spec deltas (`specs/pipeline-analyze-api/spec.md`, `specs/pipeline-schema-drift/spec.md`) read in
  full — scenarios trace cleanly to the design/AC, no contradictions with the existing
  `openspec/specs/pipeline-analyze-api/spec.md` baseline.

- **AC → task traceability** — all 5 ticket ACs map to concrete tasks (1.1→AC1, 4.1-4.3→AC2/AC4, 5.1→AC3,
  5.4→AC5). No AC left uncovered, no task doing unrequested work. Out-of-scope items (blocking on drift,
  frontend surfacing) correctly excluded from tasks.

### Verdict: CONFIRM

The design is sound: grounded in real, verified code citations (not hand-waved), the wire/schema/migration
shapes are internally consistent, the persistence pattern correctly follows an established codebase precedent,
every AC traces to a task, and there's no scope drift. It is not placeholder-laden and contains no unresolved
decisions blocking implementation. The items below are real but do not block starting execution — they're
either mechanically resolved by the compiler/an obvious precedent, or pre-existing/out-of-scope limitations the
design correctly doesn't need to solve.

### Non-blocking notes

1. **`sourceDataSourceId` isn't threaded to the persist-hook's call site — should be made explicit in design.md
   D4.** `onRunSuccess`/`onBlockedRun`/`onUnblockedRunSuccess` (`PipelineRunService.scala:442-551`) currently
   receive `outputDataTypeId` but not `pipeline` or `pipeline.sourceDataSourceId` — that's only in scope one
   level up, in `executeRun` (line 382's call passes `pipeline.outputDataTypeId`, not `pipeline` itself). D1's
   shared helper needs `sourceDataSourceId` to call `dataTypeRepo.findBySourceId`. The design says to "resolve
   the current source schema" in `onUnblockedRunSuccess` but doesn't say *how* it gets there — thread
   `pipeline.sourceDataSourceId` through as a new parameter (mirroring how `outputDataTypeId` already flows
   through the identical call chain — the free option) vs. re-fetch via `pipelineRepo`/`dataSourceRepo` (an
   extra DB round-trip on every successful run). This is a one-line design.md addition that would save the
   executor a moment of ambiguity, but is not blocking: the compiler will surface the gap immediately, and the
   `outputDataTypeId` precedent sitting right next to it makes "thread the field through" the obvious choice.

2. **D2's "mirroring `updateLastRun`'s existing pattern" is ambiguous about whether `findLastSourceSchema`
   should be owner-scoped.** `updateLastRun` filters `r.ownerId === ownerUuid` (correct for a write, and for
   consistency with existing best-effort semantics). If `findLastSourceSchema` copies that filter literally, it
   returns `None` for any analyze call from an editor/viewer grantee (not the owner) even when a real baseline
   exists — because `analyze` is reachable by grantees via `findByIdShared`. In practice this doesn't make
   anything *newly* wrong: `dataTypeRepo.findBySourceId` (the existing, unmodified `sourceSchema` derivation
   `analyze` already uses) is itself owner-scoped (`DataTypeRepository.scala:67-68`), so a grantee's
   `sourceSchema` is *already* empty today, pre-ticket. Worth a one-sentence clarification in design.md so the
   executor doesn't have to independently discover and reason through this, but not a regression this ticket
   needs to fix.

3. **Minor factual inaccuracy**: design.md D2 says "the 22-arity projection" — the actual `PipelinesTable.*`
   projection is 11-arity (`PipelineRepository.scala:395-424`). Doesn't change the decision (don't extend `*`),
   just a citation that wasn't checked against the file — worth a quick correction for anyone reading design.md
   later as documentation.

4. Design.md D4's citation "in `onRunSuccess` (`PipelineRunService.scala:533`)" is slightly imprecise — line
   533 is inside `onUnblockedRunSuccess`, a private helper `onRunSuccess` dispatches into (not `onRunSuccess`
   itself). The line number is exact and unambiguous, so this doesn't affect implementation, just naming
   precision.
