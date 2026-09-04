# Tasks — HEL-913 Multi-root pipelines

`frontend/**` is OFF LIMITS for this change (HEL-912 owns it in a parallel run). If a task appears to require a
`frontend/**` edit, STOP and escalate rather than editing it.

## 1. The single-source surface (enumeration to work against)

Planning swept the tree keyed on the property "code that assumes a pipeline has exactly one source" and found
**129 occurrences across 60 files** (main 51/12, test 76/44, migrations 2). Re-run the sweep at the end and report a
**total count with the full list**, never a diff of the sites just fixed (lesson 6).

- [x] 1.1 **DONE (recorded here and in files-modified.md).** Pre-change baseline: 129 occurrences / 60 files
      (planning sweep, design.md), 102 sites (round-5 encoding sweep, `skeptic-design-5.md`).
- [x] 1.2 **DONE — both re-swept.**

      **(a) "assumes exactly one source"** — re-swept by identifier (`sourceDataSourceId`/`sourceDataSourceName`/
      `source_data_source_id`/`source_data_source_name`), **179 occurrences / 58 files** — see 1.3 for the exact
      command/scope; **not directly comparable to the planning sweep's 129/60** (that count was a manual
      property-keyed enumeration across a wider set of encodings; this is a narrower identifier-only re-grep,
      stated honestly per 1.3 rather than implying an apples-to-apples delta). Breakdown: `frontend/` 84
      occurrences / 23 files (HEL-969's, out of scope — `frontend/**` is off-limits to this change);
      `backend/src/main` 40 (excl. migrations); `backend/src/test` 25; migrations (`V22`/`V41`/`V98`, historical)
      8; `helio-mcp/` 18; `schemas/` 4.

      Per-class disposition (every remaining occurrence classed and justified, not itemized one-by-one at this
      volume — see the honesty note in 1.3):
      - **Migrations (8, historical):** `V22`/`V41` created/used the column pre-remodel; `V98` drops it. Correctly
        retained as migration history, not a live assumption. No change.
      - **`frontend/` (84/23, HEL-969's):** the accepted, product-owner-ruled window (design.md "Accepted end
        state"). Not this change's to touch.
      - **`helio-mcp/` (18):** 15 are legitimate — `pipelinesHandlers.ts`'s `sourceDataSourceId` is a **local
        variable name** inside `resolveSource`/`resolveRoots` (one root's own resolved data-source id, not a
        pipeline-level singular assumption) plus doc comments correctly describing the REMOVED field. **2 are a
        real, currently open survivor**: `types.ts:474`'s `PipelineAnalyzeResponse.sourceDataSourceName: string`
        is a stale singular mirror of the backend's own not-yet-fixed `PipelineAnalyzeProtocol.scala:186`
        (below) — not covered by any ticked task.
      - **`schemas/` (4):** `create-pipeline-request.schema.json`'s description mentions the retired field
        historically (8.1a, correct); the rest are already-`roots[]`-shaped schemas' own doc prose. No open
        schema-level survivor for this identifier beyond the analyze response (schemas don't separately model
        `PipelineAnalyzeResponse`).
      - **`backend/src/main` (40) and `backend/src/test` (25):** the bulk is `PipelineRepository.scala`'s
        internal `PipelineSummary` domain DTO, which **deliberately retains** `sourceDataSourceId`/
        `sourceDataSourceName` (self-documented at `PipelineRepository.scala:105-111,177-182`: populated from the
        pipeline's lowest-positioned root, "keeps every existing consumer... correct for the single-root case
        (today's only case) while storage has already moved to `pipeline_roots`", explicitly deferred as "engine
        work, a later stage of this ticket" pending run/analyze generalizing to walk every root) — the wire type
        (`PipelineSummaryResponse`) has the scalar pair REMOVED outright (7.2a); only the internal DTO keeps it.
        This is a real, acknowledged, self-documented survivor, not a hidden one — but it is genuinely not yet
        closed. **One additional real, currently open survivor found by this re-sweep, NOT self-documented as
        deferred**: `PipelineAnalyzeProtocol.scala:186`'s `PipelineAnalyzeResponse.sourceDataSourceName: String`
        wire field has no `roots[]` equivalent at all — 7.2a/7.2b touched `PipelineSummaryResponse` and
        `WorkspaceContextPipeline` only, never `PipelineAnalyzeResponse`. Its MCP mirror (`types.ts:474`, above)
        carries the same gap. **Neither is covered by any currently ticked task** — flagging as a genuine,
        newly-found gap for the coordinator, not fixing inline (outside this slice's "re-sweep, don't
        re-scope" instruction).
      - The remaining `backend/src/test` occurrences are tests asserting the two acknowledged-above shapes
        (`PipelineSummary`'s retained fields, the historical migration specs for V22/V41/V98) — correct tests of
        an intentional or historical shape, not bugs.

      **(b) "means *no node* / *the pipeline's raw root*"** — re-swept against the named **102-site list**
      (`skeptic-design-5.md`), not a fresh grep, per that document's own instruction. SQL (9/9): unchanged,
      re-verified clean (V22/V41/V98 migration history only, no fourth table). Directly re-verified all **27**
      originally ❌/⚠️ (not-covered/partial) sites by reading the named file/line:
      - **Fixed since the design gate** (by already-ticked tasks 4.4a/4.4a-i/4.4b/4.4c/4.4d/5.9/5.10/7.3a/
        7.3a-i/7.6a-i/ii/iii): C4, C5, C6, C7, C8, C9, C18, C19, C20, C24, C25, C29, C31, C52, C54, H3, H4, H5, H6
        (mitigated via `rootClientId` pairing, not the raw type union alone), H7 (same), H8, T6, T9, T13, T15,
        T16, T19, T23 — 27 of the 27 originally-flagged Scala/schema/TS sites either fixed or found
        legitimately non-issues on re-read, **except** the 9 named directly below.
      - **C3/C59** (`PipelineStep.scala:62`'s doc comment + all 24 `domain/steps/*.scala` case classes'
        `parentStepId: Option[...] = None` default): 4.4a claimed DONE, and the FUNCTIONAL fix is real (root
        pairing happens externally via `NodeRef.rootId`, never inferred from this default) — but
        `PipelineStep.scala:62`'s own doc comment was still stale, describing pre-multi-root semantics with no
        mention of `NodeRef`/root pairing at all. **Fixed in this batch** (see files-modified.md).
      - **C35**: justified in writing already (7.5b: "no root-scoped delete twin needed", a real decision, not a
        gap).
      - **H9** (`reorder-pipeline-steps-request.schema.json`'s "the pipeline root" singular prose): re-read in
        context — legitimate, not stale. `reorderTrunkInternal` FAILS CLOSED on a multi-root pipeline by design
        (task 7.3d-i, design.md decision 15 / non-goal waiver #2); this endpoint is deliberately single-root-only,
        so "the pipeline root" is the correct description of its own scope, not an assumption bleeding from
        elsewhere.
      - **T21, T25**: minor/cosmetic prose (a doc-string mention, an e2e comment), as originally flagged; left
        as non-blocking per the original assessment.
      - **STILL GENUINELY OPEN — 9 sites, all under the already-existing unticked task 7.6 or its schema-level
        siblings, none touched by this batch (out of this slice's scope — re-sweep, not re-scope):**
        - `PipelineProposalService:200-202` (C43) — absent `parentStepId` accepted as root, no `rootClientId`.
        - `PatchSetApplyRollback:309` (C45) — restoring a root-attached step loses its root.
        - `PatchSetUndoInverse:146-150` (C46) — same trap one level up (confirmed no `rootId`/`rootClientId`
          anywhere in the file).
        - `PipelineShapeProtocol:66,78` (C51) — shape expansion's `idx == 0` step has no root.
        - `PatchSetPreviewProjection` — confirmed no `rootId`/`rootClientId` anywhere in the file.
        - `RefinementEditShape` — confirmed no `rootId`/`rootClientId` anywhere in the file.
        - `WorkspaceContextService:293` — task 7.6 names this line specifically; the file's only `rootId` hit
          (`:359`) is 5.8b-iv-a's unrelated `listRows` threading fix, not this site.
        - `pipeline-proposal.schema.json` (8.2/H2) — `source` (singular, `$ref PipelineProposalSource`) still
          present, not `roots[]`; its `:25` "absent means the pipeline's raw source" Output-level prose likewise
          unchanged.
        - `AssistantProposalToolSchemas.scala:153-165` (8.3g) — `PipelineProposalStepSchema`'s `parentStepId`
          description still says "the source if this is the first step", no `rootClientId` tool-schema property.
        These 9 sites are the SAME surface as the held task 9.7 (per-root proposal validation) and its two spec
        deltas — the proposal/patch-set contract's own single-source shape. **Not touched, per the coordinator's
        explicit instruction to leave 9.7 untouched pending their ruling** — flagged here as the concrete
        re-sweep evidence that 7.6/8.2/8.3g remain open, for whenever 9.7 resolves.
- [x] 1.3 **DONE.** Commands and scope, stated per count:
      - **(a) 179/58:** `grep -rn "sourceDataSourceId\|sourceDataSourceName\|source_data_source_id\|
        source_data_source_name" --include="*.scala" --include="*.ts" --include="*.tsx" --include="*.sql"
        --include="*.json" .` from the repo root, piped through `grep -v -E "node_modules/|/target/|
        openspec/changes/archive/|openspec/changes/multi-root-pipelines/"` (excludes build output, the archived
        multi-lane design doc, and this change's own tasks/design/skeptic docs, which quote the identifier in
        prose). Counts occurrences (lines), not unique sites; file count via `cut -d: -f1 | sort -u | wc -l`.
      - **(b) 102-site re-verification:** not a fresh grep — a direct read of each of the 27 ❌/⚠️ file:line sites
        named in `skeptic-design-5.md`, using targeted `grep -n` against each named file for `rootId`/
        `rootClientId`/the specific flagged pattern, to determine current status. The 75 "covered" sites were
        spot-checked (not each individually re-verified line-by-line at this volume) via the ✅-covered items that
        also happen to overlap the H/T files checked above (H3-H5, T6/T9/T13/T15/T16/T19/T23), all confirmed
        correct; a full independent line-by-line re-verification of all 75 was not performed in this batch, which
        is the same "not every site individually re-verified" honesty note this task's own text calls for at this
        volume, not a claim of exhaustive re-derivation.
      - Both counts exclude `openspec/changes/archive/**` and `node_modules/`; `frontend/**` is included in the
        count (so the total is honest about the full surface) but excluded from remediation (out of scope, HEL-969's).
## 2. Migration V98

- [x] 2.1 `V98__pipeline_roots.sql`, following `design.md` § "Migration V98" order of operations exactly.
- [x] 2.2 Header comment states, in these terms: the danger is on the **READ side** of the backfill, so the `NO FORCE`
      bracket must cover **every table the SELECT touches**, not only the table being written. Enumerate all **five**
      bracketed tables: `pipelines` (read), `pipeline_steps`, `outputs`, `node_snapshots`, `binary_refs` (written).
      Also state the asymmetry: `pipelines` fails SILENTLY (V39's `helio_can_access_pipeline` fail-false), while
      `pipeline_steps` fails LOUDLY (V35's `current_setting` form) — same bracket, opposite reasons, and the
      more carefully secured table is the more dangerous one. Cite V94:122-131 / V94:1309-1316 as precedent.
- [x] 2.3 Bracket **five** tables with `NO FORCE` / restore `FORCE`: `pipelines` (read — the trap), `pipeline_steps`,
      `outputs`, `node_snapshots`, `binary_refs` (the last three per R12; FORCE per V94:1329-1330, V46:34).
- [x] 2.4 Backfill one root per pipeline at `position = 0`, id derived deterministically from the pipeline id,
      guarded `WHERE NOT EXISTS` for idempotency.
- [x] 2.5 Add `pipeline_steps.root_id`, backfill it for every `parent_step_id IS NULL` step, then add
      `CHECK ((parent_step_id IS NULL) = (root_id IS NOT NULL))` — DB-enforced, not only the one-shot DO $$ guard.
- [x] 2.5a **R12 rebind (highest-severity finding), on all THREE encoding tables** — `outputs`, `node_snapshots`,
      `binary_refs`: add `root_id`. **FK asymmetry is deliberate** — `REFERENCES pipeline_roots(id) ON DELETE CASCADE`
      on `outputs` and `binary_refs`, but a **bare `TEXT NULL` on `node_snapshots`**: an FK there makes it
      FK-reachable from `users` and breaks `TRUNCATE ... RESTART IDENTITY CASCADE` in 12 specs (V94:261-280 records
      this empirically). Do not "tidy up" the inconsistency. Backfill every row whose `node_step_id IS NULL`.
      Without this, every root-bound Output silently stops refreshing and its dashboards serve stale rows forever.
- [x] 2.5a-i **Dispose of unrebindable rows BEFORE adding the CHECK**, logging each count in the
      `hel913_migration_counts` style (V94 section 10 precedent): delete orphaned `node_snapshots` rows whose
      `pipeline_id` matches no pipeline (nothing deletes these on pipeline deletion — only two DELETE sites exist,
      both scoped to a live pipeline), and `binary_refs` rows with `pipeline_id IS NULL` (V94:793-797 never rekeyed
      refs whose data_type had no owning pipeline; V94 section 10 records 77 such data_types). Adding the CHECK first
      ABORTS THE DEPLOY on real rows. Measure and record both counts against the real dump — do not assume zero.
- [x] 2.5a-ii Add `CHECK ((node_step_id IS NULL) <> (root_id IS NULL))` on all three, after 2.5a-i.
- [x] 2.5b Drop `idx_node_snapshots_root_unique` (V94:294-296) and recreate as
      `UNIQUE (pipeline_id, root_id, row_index) WHERE node_step_id IS NULL` — two roots' row 0 collide otherwise.
      Record in the migration comment that the **complement** index `idx_node_snapshots_node_unique`
      (`V94:292-293`, `WHERE node_step_id IS NOT NULL`) was checked and is deliberately left unchanged — verified
      correct under multi-root — so the next reader neither re-derives it nor "tidies" it.
- [x] 2.6 `DO $$ ... RAISE EXCEPTION ... $$` guard, BEFORE the column drop: fail loudly if any pipeline has no root,
      any parentless step has no `root_id`, **or any `outputs`/`node_snapshots`/`binary_refs` row still has both
      `node_step_id` and `root_id` NULL**. The 2.5a CHECK is NOT a substitute — if the bracket is wrong for a table,
      the UPDATE is invisible, writes nothing, and the CHECK passes anyway.
- [x] 2.7 Restore FORCE RLS on **all five** bracketed tables (enumerate them; "both tables" would leave three
      permanently NO FORCE). Then `ALTER TABLE pipelines DROP COLUMN source_data_source_id` — no deprecation, no alias, no view.
- [x] 2.8 `pipeline_roots` ENABLE + FORCE RLS with **per-command** policies: `FOR SELECT USING
      (helio_can_access_pipeline(pipeline_id))` plus owner-only INSERT/UPDATE/DELETE in the V39 form. A single
      all-commands sharing-aware policy is a privilege escalation (Postgres reuses USING as WITH CHECK for INSERT).
      Enabled AFTER the backfill.

## 3. Migration proof (all four are evidence, not assertions)

- [x] 3.1 `FlywayNonSuperuserMigrationSpec`: add a pre-migration capture block and post-migration assertions;
      add `"pipeline_roots"` to `forceRlsTables`. **This is the only gate that runs as the non-superuser role.**
- [x] 3.2 Full coverage: pipelines-before count equals roots-after count, non-zero (73 from the real dump); every
      parentless step has a non-null `root_id`.
- [x] 3.3 Idempotency: re-running V98's DML is a no-op.
- [x] 3.4 Byte-identical passthrough: a non-root step row is byte-for-byte identical after
      (style of `FlywayNonSuperuserMigrationSpec:247-252`).
- [ ] 3.5 **Prove the step-2.6 guard fires — V98's OWN guard, not a copy of it.** REOPENED at the Stage-1 gate.
      The current `V98PipelineRootsMigrationSpec` tests hand-write the guard's predicate inline and execute it as a
      standalone `DO $$` block ("Execute the guard's exact predicate as a standalone statement"). That proves a
      hand-written DO block raises when its condition holds. It does NOT prove V98's guard raises, is reachable, or
      runs before the column drop — and it stays green if V98's real predicate is edited or deleted, because the
      test asserts against a copy it wrote itself. That is the "inline copy" species of evidence-shaped
      non-evidence.
- [ ] 3.5a **The mutation test that actually proves it**: remove/neutralise V98's `NO FORCE` bracket on `pipelines`
      and run the migration AS THE NON-SUPERUSER ROLE. The backfill then reads zero rows, and the migration MUST
      FAIL LOUDLY on V98's own guard. This single test proves three things at once that nothing else proves: the
      guard fires, the guard is correctly placed (before the drop), and the bracket is NECESSARY rather than
      decorative. Assert on the raised message.
- [ ] 3.5b For conditions unreachable end-to-end (a parentless step with no `root_id` cannot arise from V98's own
      bulk UPDATE), keep a direct test but **assert against V98's shipped SQL** rather than a re-typed copy — e.g.
      execute the migration file's own statement, or assert the file contains the predicate the test exercises, so
      the two cannot drift silently.
- [x] 3.5a **Seed both unrebindable populations and assert V98 completes**: an orphan `node_snapshots` row whose
      `pipeline_id` matches no pipeline, and a `binary_refs` row with `pipeline_id IS NULL`. Without this, the first
      time either population is seen is a failed production deploy.
- [x] 3.6a R12 coverage: assert every previously-NULL-node_step_id Output/snapshot row carries a root id after V98,
      against the real dump, in `FlywayNonSuperuserMigrationSpec`.
- [x] 3.6b RLS test: a grantee of a shared pipeline can SELECT its roots but cannot INSERT/UPDATE/DELETE one.
- [x] 3.6 Seed a NULL/orphan source case explicitly if one is to be covered — the real dump has none
      (73/73 non-null), so it cannot arise on its own.

## 4. Model and persistence

- [x] 4.1 `PipelineRoot` domain model + `PipelineRootId`; remove `Pipeline.sourceDataSourceId` (`model.scala:735`).
- [x] 4.2 `PipelineRootRepository` (list/add/remove/compact-positions), Slick table + row.
- [x] 4.3 `PipelineRepository`: drop the column from `PipelineTable`/`PipelineRow`/`*` projection (`:434-479`), rework
      `create`/`createAction`/summary joins (`:116-269`, `:403-410`) onto roots.
- [x] 4.4 `PipelineStepRepository`: `root_id` column; `childrenOf(steps, None)` (`:738`), **`trunkOf` (`:727`)** and
      **`tailsOf` (`:771`)** all become root-scoped; `executionOrder` (`:805`) walks per root. `trunkOf` was missing
      from the planning sweep and also drives `PipelineService.scala:1002`, `:1103`, `:1288`,
      `PipelineStepRepository.scala:543` (attach anchor, reorder).
- [x] 4.4a Domain layer: `PipelineStep.scala:62` and **all 24 op case classes** (`domain/steps/*.scala`) carry a root
      reference. The `parentStepId: Option[PipelineStepId] = None` **default argument** must not survive as an
      implicit "root" — a default argument is one of the non-textual encodings the name sweep cannot see.
      Include `PipelineStepRow:879`, `column[Option[String]]("parent_step_id"):891`, the `*` projection `:893`, and
      all 24 `rowToDomain` construction lines (`:826-848`).
- [x] 4.4a-i `PipelineStepRepository:196,:212,:322,:381` — `parentStepId: Option[PipelineStepId] = None` **default
      arguments** (sweep C7). A default argument is a non-textual encoding: every caller that omits the parameter is
      silently saying "root". Removing the default forces each call site to state its root explicitly.
- [x] 4.4b `PipelineStepRepository:85` and `siblingsQuery:668-671` — the root sibling group becomes **per-root**, or
      position numbering and splice/attach/reorder mix lanes from different roots.
- [x] 4.4c `PipelineStepRepository:549-550` (`reorderTrunkInternal`) writes `parent_step_id = NULL` for `idx == 0`
      and **must write that trunk's `root_id` in the same `.update`** — otherwise the 2.5 CHECK aborts every trunk
      reorder. This is a write obligation, not a `trunkOf` scoping item.
- [x] 4.4d `PipelineStepRepository:633-644` (`deleteInternal`): the head child promoted to `deletedRow.parentStepId`
      must also inherit `deletedRow.root_id`. As written, deleting any root-attached step produces
      `parent_step_id IS NULL AND root_id IS NULL` and fails the CHECK. Test: delete the first step of a two-root
      pipeline; the promoted child carries the same root.
- [x] 4.5 `WorkspaceTeardownRepository:110-120` — the raw `WHERE source_data_source_id = ...` teardown blocker becomes a
      join through `pipeline_roots`.
- [x] 4.6 **DONE, CORRECTED (skeptic-final-2.md FIX 1) -- enforced at the DB level, not only the
      service layer, superseding this task's own original "deliberately not a DB constraint"
      framing.** `PipelineService.removeRoot` already had a service-layer last-root guard
      (`roots.size == 1 -> 400`), but V98's `pipeline_roots.data_source_id ... ON DELETE CASCADE`
      re-homed the pre-V98 `pipelines.source_data_source_id ... ON DELETE CASCADE` cascade one
      level down -- so `DataSourceService.delete` (which never goes through `removeRoot` at all)
      could delete a pipeline's sole root's DataSource and leave the pipeline with zero roots,
      completely bypassing the service guard. V99 (`hel913_prevent_zero_root_pipelines`, a
      SECURITY DEFINER `AFTER DELETE ... FOR EACH STATEMENT` trigger on `pipeline_roots` using a
      transition table) closes this for EVERY writer, not only ones that route through
      `PipelineService` -- the same "the only caller today decays" lesson round 1's CR2 already
      taught this ticket once. Distinguishes "deleting a pipeline's last root while the pipeline
      still exists" (raises) from "deleting the pipeline itself, whose roots cascade along with
      it" (never raises -- by the time the STATEMENT trigger fires, a same-statement pipeline
      delete has already removed the `pipelines` row). 4 new tests in
      `V99PreventZeroRootPipelinesMigrationSpec` re-run the skeptic's own live-DB repro
      (`pipelines_after`/`roots_after` now consistent, not `1`/`0`) on a fresh fully-migrated
      embedded Postgres; mutation-proven (temporarily no-op'd V99, confirmed both guard tests go
      red for the predicted reason, restored, confirmed green). `FlywayNonSuperuserMigrationSpec`
      re-confirmed green — but that proves only that V99 APPLIES cleanly as the non-superuser
      role. **It does NOT prove the trigger enforces under non-superuser RLS: that spec never
      fires the trigger, and V99's own 4 tests run as superuser.** Measured at the final gate:
      the trigger's own read IS subject to FORCE RLS, so with `app.current_user_id` unset the
      guard is vacuous (`pipelines=1, roots=0`). The user-facing path is closed separately by
      `DataSourceRepository.delete`'s `withUserContext`; the residual gap is **HEL-974**.

**Stage-2 gate ruling on 4.4/4.4a/4.4a-i/4.4b/4.4e — SATISFIED BY SUBSTITUTION, accepted.** Root membership is
carried by `pipeline_steps.root_id` (DB, with a CHECK) and by `rootId` on every step response (wire, task 7.6a), but
NOT by the 24 domain case classes; it is resolved via `PipelineStepRepository.rootIdsOf` fetched once at the service
boundary and threaded as an explicit parameter. Verified at the gate: (a) the contract HEL-914 plans against is
unchanged, because both boundaries 914 touches still carry it — see design.md R4's representation table; (b) no
consumer needs a repository call it cannot make, because `childrenOfRoot`/`trunkOfRoot` take the map as an argument
(pure), the engine receives it via `executeTree`, and `PipelineExecutionBackend` is root-aware at the trait level.
Ticked as done under that substitution, with the shipped shape recorded in the contract rather than the intended one.

## 5. Engine

- [x] 5.1 Introduce `NodeKey` (`RootKey`/`StepKey`); `TreeWalkResult.nodeOutcomes` becomes `Map[NodeKey, NodeOutcome]`
      (`InProcessPipelineEngine.scala:71-74`, `:340-347`). Supersedes engine-contract item 8's `Option[String]` keying.
- [x] 5.2 Seed every root's loaded frame under its own `RootKey` before the walk.
- [x] 5.3 `structuralRank` (`:245`) and the topological order take root position as the cross-root tiebreak (R3).
- [x] 5.4 `InProcessExecutionBackend:14-29` loads N root frames instead of one; `PipelineRunService:226/333/520` — the
      three `findByIdInternal` chokepoints — resolve a source per root.
- [x] 5.5 `TreeWalkResult.rows` = terminal frame of the lowest-positioned root's trunk (R10). `rows`,
      `trunkOf(...).lastOption` and `binaryRefRepo.overwriteForNode`'s key (`PipelineRunService.scala:929`) must be
      derived from the SAME root and the SAME node — the agreement `InProcessPipelineEngine.scala:374-390` records.
      Required: a test that FAILS if they diverge (a two-root graph where naive implementations disagree). A test
      asserting only that the run succeeded would not catch it.
- [x] 5.5a Single-root parity test: walk order and every per-node frame byte-identical to pre-change.
- [x] 5.7 R15: `RunStatusEvent` (`PipelineRunRegistry.scala`) gains `nodeKind: Option[String]` (`"root"`/`"step"`),
      always populated alongside `nodeId`, serialized in `toSseBytes`. `PipelineRunService.onNodeProgress` sets it
      from the `NodeKey` match (`RootKey` → `"root"`, `StepKey` → `"step"`); `SparkJobSubmitter` never invokes
      `onNodeProgress` (no per-node concept — documented, unchanged), so no wire surface there needs it. Tests
      (`PipelineRunRoutesSpec`) assert `nodeKind = Some("root")` on the pipeline's own root event and
      `Some("step")` on a tail's — mutation-proven: reverted the `nodeKind` assignment to the pre-fix
      `RunStatusEvent(...)` call (no `nodeKind` argument), confirmed both new assertions go red, restored,
      confirmed green.
- [x] 5.8a **R12 encoding sweep — enumerate by ENCODING, not by name** (design.md R12 lists the surface):
      `NodeSnapshotRepository:38-51,58-74,101-107`; `BinaryRefRepository:42-52,63-86` (both `overwriteX` take a
      `NodeKey` and scope deletes to ONE root — today they delete `WHERE node_step_id IS NULL`, so under multi-root
      whichever root writes second WIPES the other); `OutputRepository:63-66,160-190,275,290,301`;
      `OutputService:88-94,138` + `CreateOutputRequest` (no way to express a root-bound Output today — every such
      create would fail the new CHECK); `OutputRoutes:36-37`; `OutputProtocol:26,40,95`; `model.scala:827-835`
      (`NodeRef`); `PipelineProposalProtocol:126`; `DemoData:56`; Output-related `schemas/`.
- [x] 5.8a-ii **NEW (evaluation-1.md cycle 2, Priority 2), DONE — the thirteenth instance, two sites, honestly
      added to this enumeration so the R12 list stops being false about its own completeness.** The Output
      surface never got the guard its sibling step surface (`PipelineService.persistNewStep`'s `(None, None)`
      400) got, on BOTH the write and read side:
      - **Site A (write) — `OutputService.scala:130-175` (`create`) and the new `requireUnambiguousRootWhenNeither`.**
        A create naming NEITHER `nodeStepId` NOR `rootId` on a multi-root pipeline used to fall straight through
        to `OutputRepository.insertInternal`'s `firstRootIdAction` (lowest-positioned root), silently — the
        in-code comment's own precondition ("unambiguous only because a pipeline with no way to create a second
        root yet always has exactly one") was falsified by this very change shipping `add_root`. Fixed: a new
        400 naming the root count, mirroring `persistNewStep`'s message shape exactly; the stale precondition
        comment DELETED, not edited around (per instruction). Mutation-proven in `OutputRoutesSpec`
        ("multi-root ambiguity" tests): reverting the guard turns 201/silent-root-0 back on.
      - **Site B (read) — `PipelineRunService.scala` `previewAtNode`/`previewOutputs`.** `distinctNodeKeys`
        dropped `rootId` entirely, so EVERY root-bound Output on EVERY root collapsed to key `None` and read
        `roots.head`'s rows via the source-level preview arm — a two-root pipeline's root-1 preview silently
        returned root 0's rows, disagreeing with the ALREADY-fixed persisted-rows path (`OutputService.scala`'s
        `explicitRootId` threading, 5.8b-iv-a above). Absent from this task's own original enumeration — a
        genuinely missed site, not a knowingly-deferred one. Fixed: `previewAtNode` gains a `rootId` parameter;
        the source-level arm selects the NAMED root (falling back to `roots.head` only when none is given, e.g.
        a genuinely single-root pipeline) and calls `backend.execute` with ONLY that root, not the full `roots`
        vector (never touches R9's atomic-real-run guarantee, which governs `executeRun`, not preview);
        `previewOutputs` keys `distinctNodeKeys` on the FULL `(stepId, rootId)` pair. Mutation-proven in
        `OutputRoutesSpec` ("multi-root, ... Site B" tests, both single-Output and all-Outputs arms, real
        content-distinguishable static sources): reverting `selectedRoot`'s resolution turns both red
        (`"root0-row"` where `"root1-row"` is expected).
      - **`MultiRootIsolationSpec.scala:131` corrected, with reasoning recorded inline** — the test used to
        assert the silent-default-to-root-0 behavior AS the intended contract ("both land on the pipeline's
        FIRST root today ... deferred"), certifying the defect as correct and explaining why the ticket's own
        sweep never caught it. Reframed: the test calls `OutputRepository.insertInternal` DIRECTLY, one layer
        BELOW the new service-layer guard, so its own `explicitRootId = None` auto-resolve is legitimate at
        THAT layer (a low-level primitive whose caller is now responsible for refusing the ambiguous case
        before ever reaching it) — the test now documents the repository's own fallback contract, not an
        end-to-end multi-root claim.
- [x] 5.8a-iii **NEW (evaluation-2.md, two small items), DONE.**
      - **Item 1 — enumeration, not trust-me.** `firstRootIdAction`'s doc (`OutputRepository.scala`) rewritten
        from "the caller, `OutputService`, is responsible" into the checkable enumeration form: names all
        THREE callers that can reach the `(None, None)` arm and why each is safe by a DIFFERENT mechanism --
        `OutputService.create` (the `requireUnambiguousRootWhenNeither` guard runs first), `PipelineService
        .buildOutputsAction:617` (`resolveOutputRootIndex`'s own `roots.size > 1` 400, or a step-bound Output
        never reaching this arm regardless), `DemoData:59` (passes `explicitRootId = Some(demoRootId)`
        explicitly, a named-root caller that never reaches the fallback at all, and is structurally single-root
        besides). `OutputService.resolveExplicitRootId`'s doc updated to point at this enumeration rather than
        repeat the trust-me framing locally.
      - **Item 2 — `previewAtNode`'s `getOrElse(roots.head)` now fails CLOSED, matching its sibling.** A NAMED
        `rootId` that does not resolve among the pipeline's actual roots now returns a named
        `UnprocessableEntity` instead of silently substituting `roots.head` -- matches
        `evaluateNodeRowsForBackfill`'s existing handling of the identical mismatch
        (`roots.isEmpty => Future.successful(())`, never a fallback to a different root). `roots.head` is
        reached ONLY for the legitimate "no `rootId` given" case, never as a substitute for an unresolvable
        named one. No new regression test added: the FK cascade chain (`data_sources` → `pipeline_roots` →
        `outputs`, both `ON DELETE CASCADE`) means no live Output can currently reach this mismatch state, so
        there is no reachable write path to construct one from — this is a structural safety-net change (the
        banned `getOrElse` shape, same as 5.9 removed from analyze), not a currently-observable-defect fix;
        recorded here rather than silently claiming test coverage that doesn't exist. Verified: `sbt
        "testOnly OutputRoutesSpec PipelineRunServiceSpec MultiRootIsolationSpec"` — 111/111, no regression.
- [x] 5.8b-iii Widen the guard's rule from the `node_step_id` spelling to the **property**, covering the
      `parentStepId` / `parent_step_id IS NULL`, `nodeStepClientId`, `= None` default-argument and
      `getOrElse(sourceSchema)` encodings — or explicitly exclude each, with a reason, in the header.
- [x] 5.8b Mechanical guard covering **BOTH encodings** — a raw-SQL grep alone is evidence-shaped non-evidence,
      because the `outputs` sites round-2 CR3 raised are Slick-lifted and contain no `node_step_id` text at all
      (`OutputRepository:66` is `r.nodeStepId.isEmpty`):
      (a) raw SQL: `node_step_id IS NULL` in `sqlu"..."`/`sql"..."` against these three tables;
      (b) Slick lifted: `.nodeStepId.isEmpty`, `.nodeStepId.isDefined`, `=== Option.empty` on these tables.
      Hang it off an existing gate (`scripts/check-repo-integrity.mjs` or `check:scala-quality`), the way this repo's
      other mechanical guards are wired — name which.
- [x] 5.8b-ii **Guard honesty (design.md Rule B):** the root-encoding rule spans SQL, Scala and TypeScript. The
      guard must either cover all three, or state IN ITS OWN HEADER exactly which surfaces it does not cover and why,
      naming the task that covers them (9.10 for TypeScript). A narrow guard that reads as complete is the defect;
      an honest narrow guard is fine.
- [x] 5.8b-i **Prove the guard fires**: introduce a violating line of EACH form and observe it fail. A guard never
      seen firing is the same non-evidence 3.5 already demands proof against.
- [x] 5.8c Tests: writing one root's snapshots leaves the other root's intact; two roots each hold row_index 0;
      listing one root's Outputs excludes the other's.
- [x] 5.8b-iv-a **NEW (coordinator, Stage 3), DONE.** The same defaulted-"no explicit root" encoding 7.3e removed
      survives one type over, on the R12 tables themselves: `NodeSnapshotRepository.overwriteRows`/`listRows`/
      `listRowsPaged` and `BinaryRefRepository.overwriteForNode`/`findByNode`/`findByNodeAndRow`/`selectQuery`
      (7 signatures, `explicitRootId: Option[String] = None`). Removed all 7 defaults. Fixed EVERY call site the
      compiler then reported, in two files (main) + two `sbt Test/compile` passes (test, 75 sites across 9
      files) — same "compiler's own file:line, never a blanket search" discipline 7.3e established. **This
      surfaced FOUR real, previously-silent R12 bugs** (not just a mechanical default-removal, unlike most of
      7.3e's sites): `PublicDashboardRoutes`/`PanelCapabilityService`/`OutputService.rows`/
      `WorkspaceContextService` all called `NodeSnapshotRepository.listRows`/`listRowsPaged` for a root-bound
      Output's rows WITHOUT threading `output.node.rootId` through — under multi-root this silently returned
      EVERY root's root-bound rows mixed together (design.md R12's own named bug, "whichever root writes second
      wipes/mixes with the other"), not just the Output's own root's rows. All 4 fixed to pass
      `explicitRootId = output.node.rootId.map(_.value)`. NEW `OutputRoutesSpec` test
      ("returns ONLY the Output's own root's rows...") proves the `OutputService.rows` fix at the HTTP level
      (two roots, independently-written snapshot rows, asserts the Output's response carries only its own
      root's rows) — mutation-proven: reverted the fix, confirmed the test regressed (3 rows instead of 2,
      the OTHER root's row leaking in), restored, confirmed green. The other 3 call sites share the identical
      shape/fix and are covered by the existing test suite staying green plus this reasoning, not a duplicate
      test each (recorded honestly, not claimed as independently proven). Verified: `sbt compile`/`Test/compile`
      clean, `sbt test` full suite green (fresh run), `check:scala-quality` clean.
- [x] 5.8b-iv **DONE.** Every `KNOWN_UNFIXED_LINES` entry re-examined now that 5.8b-iv-a made "does a caller
      reach the `(None, None)` fallback?" a provable fact rather than a judgement call (every default removed,
      every real caller enumerated by the compiler). Original list had 7 entries (1 `OutputRepository`,
      3 `NodeSnapshotRepository`, 3 `BinaryRefRepository`); now has 6.
      - **`OutputRepository.listByNodeInternal` DELETED outright** — `grep -rn` against `src/main` AND
        `src/test` found ZERO callers anywhere. Provably unreachable in the strongest sense (nothing calls the
        METHOD, not just "nothing reaches this arm") → the whole method removed, not merely re-justified, per
        (a)'s own "DELETE the arm" instruction generalized to the enclosing dead method.
      - **The remaining 6 (`NodeSnapshotRepository`/`BinaryRefRepository`) could NOT be cleanly forced into
        either (a) or (b)** — each is exercised by real, deliberate test call sites
        (`explicitRootId = None`, correct for genuinely single-root fixtures reading back their own writes), so
        literally deleting the arm would break real tests, not fix a defect. Instead, every PRODUCTION caller of
        `overwriteRows`/`listRows`/`listRowsPaged`/`overwriteForNode` was traced individually (`grep -rn`
        against `src/main` only) for whether it can reach `nodeStepId = None` (root-bound) paired with
        `explicitRootId = None` simultaneously — the one combination that would trigger R12's named silent-
        mixing bug. PROVEN it cannot, for every production call site, because a root-bound `Output`/snapshot
        ALWAYS carries a real `root_id` at that point (V98's `(node_step_id IS NULL) <> (root_id IS NULL)`
        CHECK enforces this at the DB row level) — every caller derives `explicitRootId` from that same real
        value (`output.node.rootId`, a `RootKey(rid)` match arm, or an explicit `if (nodeStepId.isEmpty)
        Some(realRootId) else None` guard immediately at the call site), never a bare `None` when `nodeStepId`
        is also `None`. `findByNode`/`findByNodeAndRow` additionally have ZERO production callers at all (like
        the deleted method) — read-verification helpers for `BinaryRefRepositorySpec`/`PipelineRunRoutesSpec`
        only. **Conclusion, stated honestly rather than forced into the binary: production-unreachable (proven)
        but test-reachable (deliberately, safely, for genuinely single-root fixtures) — not a defect, not
        deletable.** `scripts/check-node-root-encoding.mjs`'s exemption-list comment rewritten with this full
        per-call-site proof, replacing the prior "single-root-compatible behavior" hand-wave.
      - `scripts/check-node-root-encoding.selftest.mjs`'s exemption-mechanism test case (previously pinned to
        the now-deleted `OutputRepository.scala:84`) repinned to `NodeSnapshotRepository.scala:52`, one of the
        6 survivors — verified: selftest passes (8/8 cases), the real guard (`check:node-root-encoding`) passes
        clean, `sbt compile`/`Test/compile`/`sbt test` all clean (full suite, fresh run after the deletion).
- [x] 5.8 **R12 runtime half:** `PipelineRunService.scala:891` `outputsByNode.keySet.intersect(nodeOutcomes.keySet)`
      keys root-bound Outputs by `RootKey(root_id)` (shipped Stage 2). Test (Stage 3): a NEW `PipelineRunServiceSpec`
      test ("a root-bound Output on a two-root pipeline refreshes from its OWN root on a real run") drives an actual
      two-root pipeline through the REAL `PipelineRunService.submit` path (not just `MultiRootIsolationSpec`'s
      repository-level proof, task 5.8c) — two genuinely different DataSources, an Output bound to each root,
      asserting each Output's `node_snapshots`/schema refresh from ITS OWN root's data after one run, never
      collapsed together or defaulted to "the first" root. Mutation-proven: replaced the `RootKey`-keying with an
      always-pick-the-first-root bug, confirmed the new test goes red, restored, confirmed green.
- [x] 5.6 `PipelineExecutionBackend` contract still compiles for Spark (`SparkJobSubmitter`); implementing the
      multi-root walk on Spark stays HEL-238's.

- [x] 4.4e `PipelineService:984-1001`, `:1053`, `:1085` — the add-step anchor path and `insertInternal`'s bare
      `parentStepId = None` default (sweep C32). Task 4.4 names `:1002,:1103,:1288`, which are different lines.
- [x] 5.9 `PipelineAnalyzeService`: `NodeStepInput` gained `rootId: Option[String] = None` (default preserves
      every existing single-root call site); the old `analyzeNodes(steps, sourceSchema: Vector[SchemaField])`
      is now a thin wrapper delegating to a new `analyzeNodes(steps, sourceSchemasByRoot: Map[String,
      Vector[SchemaField]])` overload, whose `schemaAt` resolves a root-level node's schema by `step.rootId`
      (a root naming a schema absent from the map degrades to empty, never a silent fallback onto ANOTHER
      root's schema or "the first" one). `PipelineService.projectedSchemaAtNode` (the real `GET
      /api/pipelines/:id/analyze`-adjacent caller, `capabilitiesAtNode`/`validateExpression`) rewired to
      resolve EVERY root's `DataSource.inferredSchema` (`listRootDataSourceIdsInternal`) and each step's owning
      root (`rootIdsOf`) and call the multi-root overload, rather than resolving only the lowest-positioned
      root's schema and silently applying it pipeline-wide. `createTransactional` (pre-§7, still single
      `sourceDataSourceId`) is unaffected — left on the backward-compatible single-schema overload, correctly,
      since §7 is what lets a caller create a second root in the first place. New tests in
      `PipelineAnalyzeServiceSpec` (two roots with genuinely different schemas, each root-level node resolves
      its OWN root's schema; an unresolvable rootId degrades to empty, not another root's schema) — proven via
      deliberate mutation (reverting `schemaAt`'s root-keyed lookup to `sourceSchemasByRoot.values.headOption`,
      confirming both new tests go red, then restoring and confirming green).
- [x] 5.10 `PipelineRunService` backfill path: `backfillOutputNode`/`evaluateNodeRowsForBackfill`'s
      `targetStepId.isEmpty` branch/`persistBackfilledRows` now take an explicit `explicitRootId: Option[PipelineRootId]`
      (threaded from `OutputService.triggerBackfill` via `output.node.rootId`), filtering `allRoots` down to the
      named root before `backend.execute` (R10's "lowest-positioned root wins `TreeWalkResult.rows`" would otherwise
      silently backfill the wrong root whenever bound to a non-first one) and filtering `onThisNode` schema-refresh
      targets by `rootId`. `extractBinaryRefs` itself needs NO signature change: it only labels `BinaryRef.nodeStepId`
      (root-agnostic), and `BinaryRefRepository.overwriteForNode` already resolves the `root_id` DB column entirely
      from its own separately-threaded `explicitRootId` param (Stage 2), never from the `BinaryRef` value — verified
      by reading `overwriteForNode:45-58`.

## 6. Lane path (R11)

- [x] 6.1 `StepExecutionException` (`InProcessPipelineEngine.scala:25-37`) carries the lane path and composes it into
      `getMessage`, which is what already reaches the client at `PipelineRunService:361`, `:443`, `:715`.
- [x] 6.2 Path builder over the parent chain, rendering the root as `root:<rootId>`, joined `" > "`; canonical path
      through the lowest-positioned originating root for a multiply-reachable node.
- [x] 6.2a **The path builder MUST traverse rejoin lane edges**, not only `parentStepId`. A rejoin's
      `secondaryInput {kind:"lane", stepId}` is a real DAG edge (engine-contract Decision 2); a builder that walks
      only the parent chain produces a **confidently wrong path** for a rejoin node rather than a missing one, which
      is worse. Test: a rejoin consuming a lane from a second root reports a path reflecting the edge it actually
      consumed. (Adjacent known defect, explicitly NOT ours to fix: `PipelineRunService`'s `previewAtNode`/
      `pathToRoot` never follows that edge — filed standalone by the HEL-912 run. Do not absorb it; do not
      reintroduce its shape here.)
- [x] 6.3 Emit it at the single throw site (`:212`).
- [x] 6.4 Tests: single-root chain, failure in the second of two sibling lanes, failure in the second root's lane.
- [x] 6.5 **No wire/protocol/SSE/frontend change.** If one becomes necessary, STOP and escalate — that ripple is the
      condition under which this scope addition was to be handed back.

## 7. API and protocol

- [x] 7.1 `CreatePipelineRequest`: `sourceDataSourceId` → `roots` (`PipelineProtocol.scala:38`, `:188-204`).
      `roots: Vector[CreatePipelineRootRequest]` (NO default — omitting it, or supplying the legacy scalar field,
      is a named 400; design decision 11 "no deprecation", enforced by the hand-rolled `createPipelineRequestFormat`
      reader using `obj.fields("roots")`, not `.get`). `CreatePipelineRootRequest(sourceId: String, clientId:
      Option[String] = None)` — the EXISTING-SOURCE branch only; an inline source spec (design.md R6's other
      `roots[]`/`add_root` element shape) is explicitly NOT yet supported (task 7.1a, new, below). Schema
      (`create-pipeline-request.schema.json`, task 8.1) moved in the SAME commit — `check:schemas` diffs property
      names only (task 8.5's own caveat), so this was verified by running the gate, not inferred.
- [ ] 7.1a **NEW (raised to the coordinator, ruled required as an explicit unticked task rather than a silent
      comment):** `roots[]`'s inline-source-spec branch (design.md R6: "the body is either an existing `sourceId`
      or an inline source spec, matching the `roots[]` element shape used at create time — one shape, not two")
      is NOT implemented by 7.1. `add_root`/`POST /api/pipelines/:id/roots` (task 7.4, not yet built) MUST use the
      same `CreatePipelineRootRequest` shape once built — R6 explicitly forbids the two ever diverging into two
      shapes. Scope: add an inline-source branch to `CreatePipelineRootRequest` (mirroring
      `PipelineProposalSource`'s existing `Option`-per-kind pattern) and wire actual inline source creation
      through both `POST /api/pipelines` (`roots[]`) and `POST /api/pipelines/:id/roots` (`add_root`) in the SAME
      commit as 7.4 (the roots CRUD unit) — not before, since `add_root` doesn't exist yet to diverge from.
- [x] 7.2 **PARTIAL.** `PipelineSummaryResponse` carries `roots` (`:47`, DONE — `PipelineRootSummaryResponse(id,
      dataSourceId, dataSourceName)`, position-ordered; `sourceDataSourceId`/`sourceDataSourceName` KEPT
      alongside as the lowest-positioned root's convenience fields, since removing them cascades into 12
      files/~59 call sites outside this task's scope, see files-modified.md). `WorkspaceContextProtocol:124`
      (`WorkspaceContextPipeline`) is **NOT done** — still carries only the scalar
      `sourceDataSourceId`/`sourceDataSourceName` fields; tracked as remaining §7 work, not silently dropped.
- [x] 7.2a **DONE.** `sourceDataSourceId`/`sourceDataSourceName` REMOVED outright from `PipelineSummaryResponse`
      (`jsonFormat10` → `jsonFormat8`). Same "delete the field, let the compiler enumerate the callers"
      technique as 7.3e/5.8b-iv-a — compiled clean in `src/main` after fixing only 4 real call sites
      (`PatchSetApplyResolvers.pipelineSummaryResponse`, `PatchSetPreviewProjection`'s two builders,
      `PipelineService.toSummaryResponse`), all simple field-drops since none of them derived anything FROM the
      removed scalars. `PipelineRunService`/`PipelineProposalService`/`RefinementEditShape` turned out NOT to
      reference `PipelineSummaryResponse`'s scalars at all — their `sourceDataSourceId` usages are the
      PERSISTENCE-layer `PipelineRepository.PipelineSummary` DTO's own (unchanged, un-exposed) field, or
      `PipelineAnalyzeResponse`'s own separate `sourceDataSourceName` (a different wire type, not in scope) — the
      ~12-file/~59-site estimate was necessarily approximate before the compiler could enumerate the real set;
      the real number was smaller. `WorkspaceSearchService.toPipelineSummary`'s description field (previously
      `p.sourceDataSourceName`) rewritten to avoid R3's "position privileges a root" pattern reappearing in
      presentation text: single root → its name, multiple roots → `"N sources"`, never a silent `roots.head`.
      3 test files fixed the same way (`AggregatorRegressionSpec`, `PatchSetApplyServiceSpec`,
      `WorkspaceContextServiceApplyBudgetSpec`) plus ONE genuine test bug the compiler could not catch (a
      string-keyed JSON field lookup, `obj.fields("sourceDataSourceId")`, in `PipelineApplyProposalSpec` —
      found only by running the full suite, not by compiling; fixed to read `pipeline.roots` instead).
      `schemas/workspace/workspace-context.schema.json`'s `PipelineEntry` def updated in the SAME commit
      (8.1a's own lesson: a schema left stale after a wire-shape removal is worse than a missing one) — see
      7.2b below, since `PipelineEntry` is `WorkspaceContextPipeline`'s schema, both handled together.
      **Deliberate, tracked gap:** `frontend/**`/`helio-mcp/**` TypeScript consumers of the removed fields are
      NOT updated (`frontend/**` is off-limits per this ticket's own scope; `helio-mcp` is explicitly §9's
      later scope) — `npm --prefix helio-mcp run typecheck`/`npm run check:e2e-types` both stay green because
      neither package's types are compile-time-coupled to the actual backend JSON shape (hand-authored/
      generated TS interfaces, not derived from a live schema check), so this is a REAL runtime gap for any
      MCP/frontend caller still reading `.sourceDataSourceId`/`.sourceDataSourceName` off a pipeline summary,
      not caught by any gate run here. Verified: `sbt compile`/`Test/compile` clean, `sbt test` 3725/3725
      (fresh, full suite — the `PipelineApplyProposalSpec` gap above was found by this exact run),
      `check:scala-quality`/`check:schema-drift`/`check:node-root-encoding` all clean.
- [x] 7.2b **DONE (same commit as 7.2a).** `WorkspaceContextProtocol.WorkspaceContextPipeline` gains
      `roots: Vector[PipelineRootSummaryResponse]`, drops `sourceDataSourceId`/`sourceDataSourceName`
      (`jsonFormat12` → `jsonFormat11`; `WorkspaceContextProtocol` now `extends PipelineProtocol` for the
      implicit format, mirroring `PipelineProtocol`'s own `with DataSourceProtocol` precedent from 7.1a). One
      real call site fixed (`WorkspaceContextService.toPipelineEntry`, echoes `summary.roots` straight through
      — `PipelineSummaryResponse` already carries the real thing, no re-derivation needed). One test file fixed
      (`WorkspaceContextServiceApplyBudgetSpec`). `schemas/workspace/workspace-context.schema.json`'s
      `PipelineEntry` def updated to match (`roots[]` replacing the two scalar `required` properties) —
      pulled forward in this same commit rather than deferred to §8, per 8.1a's precedent that a schema
      actively contradicting a just-shipped wire shape is not "later-batch scope."
- [x] 7.2c **NEW (coordinator-raised, found by the §1.2 re-sweep).** `PipelineAnalyzeResponse` had an unmet
      SHALL in this change's own `pipeline-analyze-api` spec delta: "Analyze SHALL derive a source schema PER
      ROOT... one source-schema entry per root, keyed by root id." Task 5.9 root-keyed the internal
      `analyzeNodes` grounding, but nothing reshaped the RESPONSE, and 7.2a/7.2b reshaped the two sibling
      responses (`PipelineSummaryResponse`, `WorkspaceContextPipeline`) without touching analyze. Fixed:
      - `PipelineAnalyzeProtocol.scala`: new `RootSourceSchemaResponse(rootId, sourceDataSourceName,
        sourceSchema)`; `PipelineAnalyzeResponse`'s scalar `sourceDataSourceName`/`sourceSchema` pair REMOVED
        outright (decision 11, no dual-read path), replaced by `sourceSchemas: Vector[RootSourceSchemaResponse]`
        (`jsonFormat6` → `jsonFormat5` + a new `jsonFormat3` for the nested type).
      - `PipelineService.analyze`: rewired from the single-source `findPrimaryDataSourceIdInternal` +
        `PipelineAnalyzeService.analyze` (flat ordered list) to `listRootDataSourceIdsInternal` +
        `rootIdsOf` + `PipelineAnalyzeService.analyzeNodes` (tree walk, `NodeStepInput`s), mirroring the
        capabilities route's own root resolution exactly. `sourceSchemaDrift` stays scoped to the PRIMARY
        (lowest-positioned) root's schema — the 7.2c delta names only the per-root source-schema SHALL, not a
        per-root drift model, and this is genuinely out of scope for a multi-root drift design.
      - **Delete-and-recompile surfaced a real, independent bug** (the fourth time this technique has found one
        this ticket): `PipelineService.analyze` used to pre-filter `allSteps.filter(_.enabled)` BEFORE building
        step inputs. `analyzeNodes` (unlike the old flat `analyze`) requires a step's `parentStepId` to resolve
        WITHIN the given step list — pre-filtering out a disabled step silently broke `isReady` for any child
        whose `parentStepId` named it, dropping that child from the response entirely (caught by
        `PipelineAnalyzeRoutesSpec`'s existing "excluding a disabled step" test going red). Fixed at the root:
        `PipelineAnalyzeService.NodeStepInput` gains `enabled: Boolean = true` (default preserves every other
        call site); `analyzeNodes.processNode` makes a disabled node transparent (identity pass-through),
        mirroring `InProcessPipelineEngine.evalNode`'s own disabled-node handling exactly (design.md Decision 7 /
        HEL-905); `PipelineService.analyze` now builds `nodeInputs` from EVERY step (enabled or not) and filters
        to enabled-only AFTER the walk, not before it.
      - `schemas/pipelines/pipeline-analyze-response.schema.json` updated in the SAME commit — `check:schemas`
        catches the top-level rename but, per 8.1a's own lesson, NOT this nested shape (no `title` on the nested
        object); verified by eye against `RootSourceSchemaResponse`'s three fields, `additionalProperties: false`
        kept honest against the real field list.
      - `helio-mcp/src/types.ts:474`'s `PipelineAnalyzeResponse` mirror updated identically (new
        `RootSourceSchemaResponse` interface, `sourceSchemas: RootSourceSchemaResponse[]` replacing the scalar
        pair); `helio-mcp/src/context.test.ts` (2 sites) fixed to match.
      - Verified: `sbt compile`/`Test/compile` clean; `sbt test` 3725/3725 (fresh, full suite, including the
        previously-red disabled-step test now green); `npm run check:helio-mcp-types` clean; `npx jest
        helio-mcp` 223/223; `npm run check:schemas` clean; `npm run lint`/`typecheck`/`check:e2e-types` clean;
        `grep -rln "sourceDataSourceName\|sourceSchema\b" e2e/*.spec.ts` returns nothing (no e2e survivor).
      - **NOT part of the held 9.7 cluster** — analyze belongs to this ticket; the proposal/patch-set contract
        (9.7, and the 9 sites named in §1.2(b)) is HEL-914's and stays untouched.
- [x] 7.3 **DONE (superseded, see 7.3a below).** `PipelineService.create`: per-root `findByIdOwned` 404 (R8) —
      `PipelineRepository.create`'s own internal sequential `resolveInOrder` for the simple (no steps/outputs)
      path, `PipelineService.resolveRootDataSources` for the transactional path (now genuinely multi-root, not
      capped at one); empty/blank-id 400 with **NO ownership lookup** for that entry (R8's explicit rule,
      mutation-proven: reverted the blank-check, confirmed `PipelineAclSpec`'s new test goes red — 404 instead
      of 400 — restored, confirmed green); empty-`roots` 400. The earlier `roots.size > 1` transactional refusal
      is REMOVED — see 7.3a.
- [x] 7.3a R13: `roots[]` elements carry `clientId`; steps carry `rootClientId`, resolved in the existing
      left-to-right `clientId` fold. Unresolvable / neither / both are each a named BadRequest — never a silent
      default to `roots[0]` (that defaulting is the HEL-620 class). Implementation:
      `PipelineService.resolveStepRootIndex` resolves a PARENTLESS step's root to an INDEX into `req.roots`
      (never a real id — no root is persisted yet at this point), run OUTSIDE the DBIO chain so a bad
      `rootClientId` fails BEFORE any write; a step WITH `parentStepId` inherits its root implicitly and a
      non-absent `rootClientId` alongside it is the named "both" BadRequest; a parentless step with `rootClientId`
      absent is unambiguous (and unchanged) with exactly one root, a named "neither" BadRequest with more than
      one. `PipelineRepository.createAction` generalized to accept `Vector[(DataSourceId, DataSource)]` (like
      `create`) and returns `(PipelineSummary, Vector[PipelineRootId])` — the real persisted root ids, in request
      order, translated from the resolved indices only INSIDE the transaction.
      `PipelineStepRepository.insertInternalAction`/`insertInternal` gained `explicitRootId: Option[PipelineRootId]
      = None` (defaulted, every pre-existing call site unaffected) so `buildStepsAction` can pass a parentless
      step's REAL resolved root instead of the pre-existing `firstRootIdAction` silent-first-root default.
      **This is also where `PipelineService:173`'s previously-unpopulated `NodeStepInput.rootId` is fixed**, per
      the coordinator's ruling that 7.3a must carry that fix inside it (it's what unmasks the multi-root create
      path) — `sourceSchemasByRoot`/`NodeStepInput.rootId` now keyed by the SAME resolved index (as a string),
      computed once before the DBIO chain. New `PipelineCreateTransactionalSpec` tests: a genuine two-root
      pipeline with one root-level step under EACH root, each step's real `root_id` independently verified via
      `rootIdsOf` (not just "some root_id got set"); the "both"/"neither"/"unresolvable" rejections, each
      asserting a `Left`. Mutation-proven: removed the "both" check, confirmed the dedicated test goes red,
      restored, confirmed green. Schemas `create-pipeline-transactional-step-request.schema.json`
      (`rootClientId`) moved in the SAME commit; `AssistantProposalToolSchemas.scala`'s
      `PipelineProposalStepSchema` needed the same property (8.4's parity check caught this — a real drift,
      not inferred, found by running `check:schemas` and reading its output).
- [x] 7.3a-i R13 extends to **Outputs, not just steps**: `PipelineService:395-410`'s `nodeStepClientId` fold accepts
      a `rootClientId` (never a silent `roots[0]`), and its `nodeSchema = ...getOrElse(sourceSchema)` grounding
      resolves that root's schema. Without this, every transactional create carrying a source-attached Output writes
      the NULL/NULL row 2.5a-ii rejects. Implementation: `PipelineService.resolveOutputRootIndex` mirrors
      `resolveStepRootIndex` (step-bound Output inherits its step's root implicitly, "both"/"neither"/
      "unresolvable" named BadRequests for a root-bound one); `buildOutputsAction`'s `nodeSchema` grounding
      changed from `.getOrElse(sourceSchema)` (a single implicit schema) to
      `.getOrElse(rootIdx.flatMap(sourceSchemasByRoot.get).getOrElse(Vector.empty))` — grounded against THAT
      Output's OWN resolved root, never an arbitrary/first one; `outputRepo.insertInternalAction` receives the
      resolved `explicitRootId` (already-existing param from task 5.8a). New test: a genuine two-root pipeline
      with a root-bound Output on EACH root, each Output's persisted `node.rootId` independently verified to
      match its OWN named root (not the other one), plus the "neither" rejection. `create-pipeline-transactional
      -output-request.schema.json` + `AssistantProposalToolSchemas.scala`'s `PipelineProposalOutputSchema` moved
      in the same commit.
- [x] 7.3d **`firstRootIdAction` audit, all five fallback sites classified.** Findings (current line numbers
      shifted from the original grep after 7.3a/7.3b's edits; re-identified by call site, not line number):
      - **`insertRootStep`** (test-only helper) — **(a) single-root only, PROVEN**: `grep`-confirmed ZERO
        production callers (the method's own doc comment already said so); every one of its ~20 test call sites
        seeds a freshly-created single-root pipeline (this codebase's universal fixture convention). Left
        unchanged — deleting the fallback would require adding an `explicitRootId` param nothing would ever use.
      - **`insertAtInternal`** (test-only, `HEL-410` position-index insert) — **(a) single-root only, PROVEN**:
        `grep`-confirmed ZERO production callers at all (not even the note "test-only" was needed — the method
        is entirely unreachable from any route). Both its 2 test call sites operate on single-root fixtures.
        Unchanged.
      - **`insertInternalAction`'s `(None, None)` arm** — **(a) single-root only, PROVEN BY CONSTRUCTION**: its
        ONE production caller (`PipelineService.buildStepsAction`, task 7.3a) always passes
        `rootIdx.map(rootIds(_))` as `explicitRootId`, and `resolveStepRootIndex` NEVER returns `Right(None)`
        for a parentless step (only for a step WITH `parentStepId`, which independently forces the
        `(Some(_), _)` match arm, never `(None, None)`) — the fallback is structurally unreachable from
        production code, not merely untested. Test call sites that bypass `explicitRootId` all seed single-root
        fixtures.
      - **`spliceInsertAtInternal`'s `(None, None)` arm** — **(a) single-root only, PROVEN BY THE 7.3b GATE**:
        of its 5 production call sites, 2 always pass a non-`None` `parentStepId`, 1 (7.3b's `rootId` branch)
        always passes `explicitRootId` explicitly, and the remaining 2 (the "extend trunk"/`position`-based
        anchors inside `persistNewStep`'s `(None, None)` match arm) are BOTH lexically inside the
        `roots.size > 1` 400 gate 7.3b added — reachable only when `pipelineRepo.listRootDataSourceIdsInternal`
        has already confirmed exactly one root exists for this pipeline.
      - **`reorderTrunkInternal`** — **(b) reachable on a multi-root pipeline, and NOT fixed by this task** (a
        real, tracked gap, not silently declared safe): `PUT /api/pipelines/:id/steps/order`, its only caller,
        has NO `rootId` parameter at all, and `trunkOf(steps)` itself is root-unaware — "the trunk" of a
        multi-root pipeline is not a well-defined single sequence to begin with (which root's trunk?). This is
        a genuinely bigger gap than a defaulted argument: reordering under multi-root needs its OWN task (new,
        recorded as **7.3d-i** below), not a quick `explicitRootId` thread-through, since the request shape
        (`ReorderPipelineStepsRequest.stepIds`) itself has no way to name a root or scope the permutation check
        to one root's trunk.
- [x] 7.3d-i **`reorderTrunkInternal` FAILS CLOSED on a multi-root pipeline.** `PipelineService.reorderSteps`
      resolves `pipelineRepo.listRootDataSourceIdsInternal(pipelineId)` before ever calling
      `reorderTrunkInternal`, and returns a named 400 ("reordering a multi-root pipeline's steps is not yet
      supported (HEL-973)") when `roots.size > 1` — matching 7.3b's ambiguous-under-multi-root precedent, never
      "documented as single-root-only" (documentation does not prevent the call). New `PipelineStepRoutesSpec`
      test: `PUT /pipelines/:id/steps/order` on a genuinely two-root pipeline returns 400. Mutation-proven:
      removed the fence, confirmed the request that should be refused instead succeeds with `200 OK` (the
      silent-corruption path this task exists to close), restored, confirmed green. The real semantics ("reorder
      THIS root's trunk" — needs a `rootId` on the request — versus "whole pipeline interleaved") is HEL-973,
      blocked by this ticket, carrying this task's own analysis; not resolved here.
- [x] 7.3e **DONE.** Removed `explicitRootId: Option[PipelineRootId] = None`'s default from all 9 signatures:
      `OutputRepository.listByNodeInternal`/`insertInternal`/`insertInternalAction`,
      `PipelineStepRepository.insertInternal`/`insertInternalAction`/`spliceInsertAtInternal`,
      `PipelineRunService.backfillOutputNode`/`evaluateNodeRowsForBackfill`/`persistBackfilledRows`. This forces
      every call site to STATE a root rather than silently inherit `firstRootIdAction`'s fallback (the C7/C59
      default-argument encoding, same shape as `fromDomain`'s removed `= Map.empty`). Every call site across
      `backend/src/main` (9, mechanically found via `sbt compile`'s "not enough arguments" errors) and
      `backend/src/test` (163, via two `sbt Test/compile` passes — the first pass's fixes unblocked a second wave
      of errors in files the compiler hadn't reached yet, both passes' locations matched precisely by the
      compiler's own reported file:line, never a blanket text search, after an earlier blanket-`sed` attempt this
      session corrupted 3 unrelated files and had to be reverted) now passes `explicitRootId` explicitly:
      - **`reorderTrunkInternal`'s `firstRootIdAction` call (`:622`) is DELIBERATELY untouched** — it remains
        behind 7.3d-i's fail-closed `roots.size > 1` fence; HEL-973 owns the real semantics, not this sweep.
      - Production sites with a genuine parentStepId/existing-step anchor pass `explicitRootId = None` with a
        comment citing the repo's own `(Some(_), _) => None` branch (root is irrelevant once a parent is named) —
        proven, not assumed.
      - Production sites reached only past a `roots.size > 1` refusal (the `case (None, None)` arm of
        `persistNewStep`'s own match, guarded above it) pass `None`, which resolves via `firstRootIdAction` to the
        one PROVEN root — single-root-only, matching 7.3d's classification, not a re-introduced guess.
      - `DemoData.scala` (seeds a genuinely single-root demo pipeline) resolves and passes the REAL root id
        (`pipelineSummary.roots.head.id`), not `None` — the strongest form, since a real id is available.
      - `PipelineRunService`'s one step-bound call site (`persistBackfilledRows(pipelineId, targetStepId,
        targetRows, explicitRootId = None)`, `nodeKey = Some(stepId)`) passes `None` correctly since
        `explicitRootId` only governs the ROOT-BOUND (`nodeKey = None`) case per that method's own body.
      - Every test call site passes `explicitRootId = None` (test fixtures are single-root by construction; none
        of these sweep call sites needed a REAL root id to preserve their test's assertions — verified by the
        full suite staying green, not merely by compiling).
      Verified: `sbt compile` clean, `sbt Test/compile` clean, **`sbt test` 3724/3724 passing, 0 failures**
      (fresh full run after the sweep), `check:scala-quality` clean.
- [x] 7.3b `POST /api/pipelines/:id/steps` + `CreatePipelineStepRequest` carry `rootId`; exactly one of
      `parentStepId`/`rootId`; a root of another pipeline is a named error. Implementation:
      `PipelineService.persistNewStep` restructured to match `(parentStepId, rootId)` — both present is a named
      400; `rootId` alone validates against `pipelineRepo.listRootDataSourceIdsInternal` (a root of another
      pipeline, or no root at all, is a named 422) then splices via `spliceInsertAtInternal`'s new
      `explicitRootId` param; neither present is unambiguous (unchanged) with exactly one root, a named 400 once
      the pipeline has more than one. **Also fixed two real multi-root correctness bugs found while wiring
      `explicitRootId` through (the SAME class of "resolves a query without scoping to which root" defect,
      caught before shipping, not after):** `spliceInsertAtInternal`'s reparenting read
      (`siblingsQuery(pipelineId, None)`) matched EVERY root-level step in the WHOLE PIPELINE regardless of root
      — root-scoped explicitly when a caller names a root, so splicing onto root B never reparents root A's
      children; `insertInternalAction`'s `maxPos` position-numbering query had the identical whole-pipeline gap
      (already shipped in 7.3a) — root B's first step would otherwise collide with root A's position
      numbering instead of starting at position 0, fixed the same way. New `PipelineStepRoutesSpec` tests:
      `rootId` attaches to that specific root (not the other one); both/neither/foreign-root rejections.
      Mutation-proven: removed the "both" check, confirmed the dedicated test regresses 400→500 (the mismatched
      state a naive both-present request falls into), restored, confirmed green. Schema
      `create-pipeline-step-request.schema.json` (`rootId`) moved in the same commit.
- [x] 7.3c R14: create-time validation errors use the `roots[<i>] › steps[<i>]` request address, emitted by THIS
      change so HEL-914 inherits rather than retrofits it. Implementation: new `stepAddress`/`outputAddress`
      helpers (`steps[<i>]`/`outputs[<i>]`) in `PipelineService`, threaded into `resolveStepRootIndex`/
      `resolveOutputRootIndex`'s three named-BadRequest messages (both/neither/unresolvable) via the step's/
      Output's own index in the request array — the only stable address at create time, since nothing has a
      real persisted id yet. The joined `roots[<i>] › steps[<i>]` form (R5/R14's own example) is not currently
      reachable by any of this change's own failure cases (each fails BEFORE a valid root index exists to pair
      with the step/Output index), so it is defined for HEL-914 to use but not exercised here — recorded
      honestly, not silently assumed unreachable. New `PipelineCreateTransactionalSpec` assertions on the exact
      message text for all four rejection scenarios (step both/neither/unresolvable, Output neither), not just
      "some Left came back."
- [x] 7.3c-i **NEW (coordinator ruling):** prove the joined `roots[<i>] › steps[<i>]` form directly at the unit
      level, since no route/resolver in this change reaches it. `rootAddress`/`stepAddress`/`outputAddress`/
      `joinAddress` moved to `PipelineService`'s companion object as `private[pipelines]` (mirroring
      `classifyDbError`/`ancestorChainOf`'s existing testable-companion-helper convention); new
      `PipelineServiceAddressFormatSpec` asserts each single-array format AND the joined two/three-segment forms
      (`roots[1] › steps[3]`, `roots[0] › outputs[2]`, a three-segment join) — converting "defined and never
      executed" into "proven at the unit level, unreachable at the route level."
- [ ] 7.3c-i **Unit-test the joined `roots[<i>] › steps[<i>]` address form directly.** 7.3c honestly records that no
      failure case in THIS change reaches the joined form — each fails before a valid root index exists to pair
      with. That honesty is right, but "defined and never executed" is a format HEL-914 inherits without evidence it
      works. Test the address helper directly at the unit level, so the joined form is **proven correct even though
      no route emits it here**. Cheap, and it converts "defined but unproven" into "proven at the unit level,
      unreachable at the route level" — which is a statement HEL-914 can rely on.
- [x] 7.4 `POST /api/pipelines/:id/roots`, `DELETE /api/pipelines/:id/roots/:rootId` wired in `PipelineRoutes.scala`
      (registered before the bare `PipelineIdSegment` branch), backed by `PipelineService.addRoot`/`removeRoot`.
      13 tests in NEW `PipelineRootRoutesSpec.scala` (create/reject-blank/reject-unowned/cross-user-404/last-root-
      refusal/compact-positions/explicit-node_snapshots-delete/surviving-lane-refusal/rootId-404 + 4 inline-source
      tests, see 7.1a). R7's two refusals are mutation-proved (temporarily disabled each check, confirmed the
      dedicated test goes red, restored, confirmed green) — not just asserted once green.
- [x] 7.1a **DONE.** `CreatePipelineRootRequest.sourceId` changed to `Option[String]`; added `type`/`name`/
      `sqlConfig`/`restConfig`/`staticConfig` (mirrors `PipelineProposalSource`'s Option-per-kind pattern).
      `PipelineService.resolveOneRootSourceId`/`resolveInlineRootSourceId` (private, companion-shared) resolve
      EITHER branch to a `DataSourceId`, reusing `SourceService.createSql`/`createRest` and
      `DataSourceService.createStatic` — the SAME instances `POST /api/sources`/`POST /api/data-sources` use
      (`sourceService`/`dataSourceService` threaded through `ApiRoutes.scala`'s `pipelineService` construction,
      both nullable-optional). `csv` is deliberately NOT supported inline, mirroring
      `PipelineProposalService.resolveSource`'s own documented gap (no bytes channel in a JSON body for the
      upload path) — a caller gets a named 422, not a silent drop. Both `roots[]` (create-time, via NEW
      `resolveRootSourceIds`/`resolveRootDataSources`) and `add_root` route through this SAME shared resolver —
      R6's "one shape, not two" is now a structural guarantee (one function), not a convention. Blast radius from
      widening `sourceId` to `Option[String]`: `PatchSetApplyResolvers`/`PatchSetPreviewProjection` (pre-check
      degrades to "apply-time re-validates" for an inline root, since neither has SourceService/DataSourceService
      wired — a real, tracked gap, not silently dropped) and `PipelineProposalService` (`Some(...)` wrap, no
      behavior change, proposals remain single-root/existing-source only). Verified compiling + all dependent
      test files updated (`AuditMutationInstrumentationSpec`, `PatchSetApply/Preview/UndoServiceSpec`,
      `RefinementServiceSpec`, `PipelineCreateTransactionalSpec`) — see files-modified.md.
- [x] 7.5 Root removal, one transaction (`PipelineRootRepository.removeAction` + `PipelineStepRepository.
      removeRootCascadeAction` + `compactPositions`, composed via `pipelineRepo.runTransactionally`), **all
      refusals evaluated before any delete** (R7 phase 1: last-root check via `listRootDataSourceIdsInternal`
      size, surviving-lane-reference check via `PipelineService.descendantStepIds` +
      `PipelineStepConfigCodec.secondaryLaneStepId`; phase 2: `outputRepo.listByPipelineInternal`-based placement
      count computed BEFORE the transactional delete — design.md's own callout that a DB cascade would otherwise
      remove the evidence — then delete, then `compactPositions`). Both phase-1 refusals mutation-proved (see
      7.4's note).
- [x] 7.5a **Delete root-bound `node_snapshots` rows EXPLICITLY on root removal.** `PipelineStepRepository.
      removeRootCascadeAction` deletes every descendant step's `node_snapshots` row by `node_step_id` AND the
      root's own root-level `node_snapshots` row (`root_id = ... AND node_step_id IS NULL`) via raw
      `sqlu"DELETE ..."`, BEFORE deleting the `pipeline_steps` rows themselves (deletion order matters: V98's
      `node_snapshots_root_id_matches_node_step_id` CHECK and the migration's own orphan-cleanup precedent both
      assume this). Mutation-proved: removed the per-step delete statement, confirmed the dedicated
      `PipelineRootRoutesSpec` test ("delete node_snapshots explicitly...") went red (`1 did not equal 0`),
      restored, confirmed green. Also discovered THIS turn: `pipeline_steps.parent_step_id` has NO
      `ON DELETE CASCADE` (V94:172, bare `REFERENCES`) — so relying on `pipeline_roots`'s cascade alone would
      only delete the root-level step and then fail on its children; the service explicitly computes the full
      descendant subtree (`PipelineStepRepository.descendantsOfRoot`) and deletes it as one
      `DELETE ... WHERE id IN (...)`.
- [x] 7.5b **Decision, not code: no root-scoped delete twin needed.** `OutputRepository:247-249`
      (`deleteByNodeInternal`) is NOT called by `removeRoot` — `outputs.root_id`/`outputs.node_step_id` both carry
      `ON DELETE CASCADE` to `pipeline_roots`/`pipeline_steps` respectively (V98, V94:208-209), so deleting the
      root row and the doomed step rows (7.5's transaction) cascades every Output automatically; the SAME is true
      of `binary_refs` (V98/V94:425-426). The only table this change's root removal touches with an explicit
      statement is `node_snapshots` (7.5a), because it alone has no FK. `removedOutputCount` in the response is
      computed via a plain read (`outputRepo.listByPipelineInternal`) BEFORE the transaction runs — a report, not
      a delete path.
- [ ] 7.6a **PARTIAL.** The `PipelineStepProtocol:27-38` wire-shape sub-item and the full `fromDomain` sweep
      are DONE (see 7.6a-i/ii/iii below). **STILL NOT DONE:** `PipelineProposalService:200-202`;
      `PipelineShapeProtocol:66,:78` (shape expansion's `idx == 0` step needs a root) — neither is a `fromDomain`
      call site, both remain open.
- [x] 7.6a-i **All 9 remaining `fromDomain` call sites now pass `rootIdOfStep`; the `= Map.empty` default is
      REMOVED.** New `PipelineStepRepository.rootIdOfStep(pipelineId, stepId)` (single-step counterpart to bulk
      `rootIdsOf`, recursive-CTE walk to the root-level ancestor) backs a new `PipelineService.stepResponseWithRoot`
      helper used by every create/update/duplicate-step response (6 sites in `PipelineService.scala`). The 2
      `PatchSetApplyResolvers` sites (update/delete `priorState` capture) now resolve and thread the step's real
      root too — this is exactly what a later undo/rollback restores from, so this closes the
      "`PatchSetApplyRollback`/`PatchSetUndoInverse` restoring a step's root" gap named below as part of this task
      (undo/rollback ALREADY restores whatever `priorState` carries; the gap was `priorState` itself never
      carrying a root — now fixed at the capture site, so no separate undo/rollback code change was needed). The
      ONE remaining call site, `PatchSetPreviewProjection.pipelineStepUpdateAfter`, is a PURE/synchronous preview
      projection with no DB access — it passes `Map.empty` EXPLICITLY (never silently inherited, since the
      default is gone) with an inline comment stating why (7.6a-iii). New `PipelineStepRoutesSpec` assertions on
      the create/update/duplicate responses, mutation-proven (broke `stepResponseWithRoot` to always return
      `Map.empty`, confirmed 3 tests go red, restored, confirmed green).
      **STILL NOT DONE:** `PipelineProposalService:200-202`; `PipelineShapeProtocol:66,:78` (shape expansion's
      `idx == 0` step needs a root) — neither is a `fromDomain` call site, both are separate R4-adjacent gaps
      named by this task's original text, out of 7.6a-i's narrower scope (the `fromDomain` sweep specifically).
- [x] 7.6a-ii **Audit of every `NodeStepInput.rootId`/`PipelineStepResponse.rootId` consumer**, per the
      coordinator's ruling. Findings: (1) `PipelineAnalyzeService:247`'s `schemaAt` consumes `step.rootId`
      correctly (task 5.9, resolves to empty rather than a wrong root's schema — verified, not just reasoned
      about). (2) `PipelineService:644` (`projectedSchemaAtNode`) POPULATES `NodeStepInput.rootId` correctly
      (task 5.9). (3) `PipelineService:173`'s `createTransactional` grounding path does NOT populate
      `NodeStepInput.rootId` — **today this is correctly masked**, not a live bug: `createTransactional` is
      still pre-section-7 single-root (`req.sourceDataSourceId` singular, one implicit root), so every
      `NodeStepInput` there legitimately has no OTHER root to distinguish itself from, and the single-root
      `analyzeNodes` overload's `DefaultRootKey` wrapping makes the lookup succeed regardless. **This becomes a
      live gap the moment 7.3a-i (multi-root create) ships** — a create carrying two+ roots would silently
      ground an Output's schema against an empty/wrong root without this fix. Recorded here so 7.3a-i's own
      implementation is REQUIRED to thread `NodeStepInput.rootId` through `:173` as part of that task, not
      after it. (4) Every other `.rootId` reference in the codebase (`Output.node.rootId`,
      `PipelineRoot`/persistence-layer reads) is populated straight from a real DB column, never defaulted —
      no further gap found.
- [x] 7.6a-iii **The one call site that genuinely cannot resolve a root states so, distinguishably, in its own
      code.** `PatchSetPreviewProjection.pipelineStepUpdateAfter` is pure/synchronous (no DB access — `positioned`
      is a hypothetical, not-yet-persisted projection), so it cannot look up a root. It passes `Map.empty`
      EXPLICITLY (the removed default in 7.6a-i means this can never happen by accident) with an inline comment
      stating BOTH the mechanical reason (no DB access) and the semantic one (a config/position preview never
      changes which root a step belongs to, so this is "unchanged, not reflected here," not "unknown").
      `PipelineStepResponse.fromDomain`'s own scaladoc states the no-default policy and points to this case as
      the documented exception, per the "state it in the scaladoc" option this task offers.
- [ ] 7.6 `PipelineProposalService:374`, `PatchSetApplyResolvers:138/497/499`, `PatchSetPreviewProjection:251-274`,
      `RefinementEditShape:258`, `WorkspaceContextService:293`.

## 8. Contracts (these move in ONE commit or `check:schemas` fails)

- [x] 8.1 **DONE (folded into 8.1a below — same file, same commit).** `schemas/pipelines/create-pipeline-request.schema.json` — `roots[]`, `required` updated.
- [x] 8.1a **DONE.** `roots[].items`'s `"required": ["sourceId"]` removed (`sourceId` is now optional, matching
      `CreatePipelineRootRequest`); added `type`/`name`/`sqlConfig`/`restConfig`/`staticConfig` inline (no
      standalone `schemas/sources/*.schema.json` files exist for `SqlSourceConfigPayload`/`RestApiConfigPayload`/
      `StaticDataPayload` to `$ref` — none were ever created for `POST /api/sources`/`POST /api/data-sources`
      either — so each is spelled out field-for-field against the Scala case class, `additionalProperties: false`
      kept honest against the REAL field list, not a partial guess). Description updated to state the R6
      existing-or-inline contract and the deliberate `csv`-unsupported-inline gap. Verified: `npm run
      check:schemas` green AND the JSON re-parses (`python3 -m json.tool`) — not just "the gate didn't complain",
      since 8.1a's own root cause is that this exact gate cannot see this exact object (it diffs schema `title`s
      against case-class names; `roots[].items` has no `title`, so `check:schemas` passing is NOT evidence this
      object's shape is right — it never was, and remains true after this fix too; read the object by eye).
      **Lesson 4, stated so the next reader does not re-derive it:** a mechanical gate's green result is scoped to
      exactly what it scans, never wider — check what a gate actually inspects before citing it as evidence of
      something it cannot see.
- [x] 8.2 **MOVED TO HEL-914** (product ruling). `pipeline-proposal.schema.json` stays singular-`source` here.
      Proposals carrying `roots[]` is HEL-914's scope; this change's two proposal spec deltas were removed for the
      same reason. Not deferred debt — reassigned scope, with the owning ticket updated to carry it.
- [ ] 8.3 `schemas/workspace/workspace-context.schema.json:340-365` — `PipelineEntry.roots[]`.
- [ ] 8.3a `schemas/outputs/create-output-request.schema.json` — root binding. (An earlier draft said "the only two
      schema files matching `nodeStepId`" — literally true and materially false: it keyed on the STRING, not the
      property. Four more schema files encode the concept under other spellings, below.)
- [ ] 8.3b `schemas/outputs/output.schema.json` — root binding.
- [ ] 8.3c `schemas/pipelines/create-pipeline-transactional-step-request.schema.json:12` — `parentStepId`
      `["string","null"]`. **This union IS the wire null-means-root that R15 bans, in the binding contract itself.**
- [ ] 8.3d `schemas/pipelines/create-pipeline-transactional-output-request.schema.json:9` — `nodeStepClientId`
      `["string","null"]`; same defect.
- [ ] 8.3e `schemas/pipelines/create-pipeline-step-request.schema.json:21` — `parentStepId` (the 7.3b body).
- [ ] 8.3f `schemas/pipelines/reorder-pipeline-steps-request.schema.json:5` — singular-root description;
      and `pipeline-proposal.schema.json:25`'s "absent means the pipeline's raw source" prose.
- [ ] 8.3g `AssistantProposalToolSchemas:153,:159` — the `"parentStepId"` tool-schema property, where absent means
      root (sweep C52). Task 8.4 checks NAME parity only, so it would stay green while this encoding persists —
      the property must change, not just match.
- [ ] 8.4 `AssistantProposalToolSchemas.scala` parity (`KNOWN_PRE_EXISTING_DRIFT` is empty — strict).
- [ ] 8.5 `npm run check:schemas` green. Note it diffs property NAMES only, so it does not prove types or `required`
      are right — do not cite it as evidence of more than it checks (lesson 4).

## 9. MCP (`helio-mcp/**`)

**Status: PARTIAL, this batch.** Before any of the below, `create_pipeline` was a HARD RUNTIME BREAK against the
current backend: `helioApi.ts.createPipeline` still sent the legacy scalar `{name, sourceDataSourceId, tag}` body
7.1 made the backend hard-reject (400, "no deprecation") — every `create_pipeline`/`propose_pipeline`-apply call
through the MCP server was failing. Fixed FIRST, as the highest-priority item, ahead of the numbered list below
(the numbered items assume a working `create_pipeline` to test against).

- [x] 9.1 **DONE (corrected).** Re-ruled by the coordinator after checking `ticket.md` directly: scope states
      verbatim *"API + MCP: `POST /api/pipelines` and `create_pipeline` accept `roots[]`"* — `create_pipeline`
      staying single-root was NOT an available scoping decision (my earlier framing was wrong; flagging the
      decision rather than guessing was still right, per the coordinator). `tools/pipelines.ts`'s `create_pipeline`
      registered schema now takes `roots: CreatePipelineRootSchema[]` (`.min(1)`), each element the SAME
      `createPipelineSourceSchema` `add_root` uses PLUS an optional `clientId` (R6 "one shape, not two" — R13
      extended to this tool). `types.ts`: added `PipelineRootSummaryResponse`, `CreatePipelineRootRequest`,
      `RemovePipelineRootResponse`; `PipelineSummaryResponse` drops `sourceDataSourceId`/`sourceDataSourceName`,
      gains `roots: PipelineRootSummaryResponse[]` (mirrors 7.2a exactly); `PipelineProposalStep`/
      `PipelineProposalOutput` gain `rootClientId?` (mirrors the backend's `CreatePipelineTransactionalStepRequest`/
      `OutputRequest.rootClientId` from 7.3a-i — these types are shared by `create_pipeline`/`propose_pipeline`/
      `apply_pipeline_proposal`, and `propose_pipeline` staying single-source, per 9.7's ruling, is unaffected
      since the field is simply never populated there). `helioApi.ts.createPipeline`'s wire body fixed to send
      `roots: CreatePipelineRootRequest[]` (the actual break named above) + `addPipelineRoot`/`removePipelineRoot`
      methods added.
- [x] 9.2 **DONE.** `tools/pipelinesHandlers.ts`'s `resolveSource` (still used AS-IS by `add_root`, unchanged)
      is now wrapped by a NEW `resolveRoots`, resolving every `roots[]` entry IN ORDER, sequentially (never
      parallel — a later root's failure must know exactly which earlier roots already created a real,
      now-orphaned DataSource). If root N's OWN resolution throws, every EARLIER root's created inline source
      is reported as orphaned (plural) in the re-thrown error; if the final `createPipeline` call fails, every
      root's created source across the WHOLE list is reported. 2 new tests
      (`pipelinesHandlers.test.ts`): a genuine two-root pipeline (one existing sourceId, one inline static,
      asserting BOTH resolved roots land in the wire body in order with their `clientId`s) and the
      multi-orphan-reporting case (2 inline roots created, 3rd fails, asserts BOTH created ids are named).
      Mutation-proved the orphan-reporting fix: temporarily made the "report orphans" branch unreachable,
      confirmed the dedicated test's expected error message went unmatched (a different error surfaced
      instead), restored, confirmed green.
- [x] 9.3 **DONE.** `add_root`/`remove_root` tools (`tools/pipelines.ts`) + handlers (`addPipelineRootHandler`/
      `removePipelineRootHandler`, `tools/pipelinesHandlers.ts`, reusing `resolveSource` for `add_root`'s own
      inline-source branch — same orphan-reporting contract `create_pipeline` already has); `server.test.ts`'s
      `EXPECTED_TOOL_NAMES` updated (was a hard-coded "60-tool list" comment, now says "originally 60"). 4 new
      tests in `pipelinesHandlers.test.ts` (existing-source, inline-source, orphan-reporting-on-failure,
      `remove_root` pass-through) — `npx jest` 220/220 (was 216/216 before this batch).
- [x] 9.4 **DONE.** `context.ts`'s `WorkspaceContextPipeline`-equivalent inline type and its construction site
      both updated: `sourceDataSourceId`/`sourceDataSourceName` replaced by `roots` (mirrors 7.2b).
- [x] 9.5 **PARTIAL.** `helioApi.ts.addPipelineStep` gained `rootId?`/`attachAsTail?` params (mirrors the
      backend's `CreatePipelineStepRequest`, which already had both — a genuine, previously-unaddressed MCP
      gap); `types.ts.CreateOutputRequest` gained `rootId?` (mirrors the backend's `CreateOutputRequest`, which
      already had it via task 5.8a). **NOT verified against the exact stale line numbers this task cites**
      (`:499-506`/`:257`/`:723-728`/`:798`) — every prior commit in this ticket has shifted line numbers
      repeatedly; fixed by CONTENT (grep for the actual gap against the backend's real contract), not by line
      number, and said so rather than claiming a line-number match I did not verify.
- [x] 9.6 **PARTIAL.** `outputs.ts`'s `add_output` description and `helioApi.ts.createOutput`'s doc comment
      updated to state `rootId`'s role instead of "absent means the pipeline's raw source" (now genuinely
      ambiguous under multi-root). `write.ts`'s `add_pipeline_step` description updated with the same
      `rootId`/`parentStepId` mutual-exclusivity explanation. **NOT verified**: `read.ts:133-166`,
      `combinedProposal.ts:78` — not checked this batch.
- [x] 9.7 **MOVED TO HEL-914** (product ruling). `pipelineProposalValidation.ts` per-root validation belongs with
      the proposal contract itself. The 9 correlated sites (`PipelineProposalService`, `PatchSetApplyRollback`,
      `PatchSetUndoInverse`, `PipelineShapeProtocol`, `PatchSetPreviewProjection`, `RefinementEditShape`,
      `WorkspaceContextService:293`, `pipeline-proposal.schema.json`, `AssistantProposalToolSchemas.scala`) move with
      it — they are one surface, not scattered debt.
- [x] 9.9 **PARTIAL — three of four bullets fixed, verified against the real backend contract:**
      `write.ts`'s `add_pipeline_step` (`rootId` added to the schema + handler + `helioApi.addPipelineStep`,
      mirroring the backend's already-shipped `CreatePipelineStepRequest.rootId` from task 7.3b),
      `outputs.ts`'s `add_output` (`rootId` added the same way, mirroring the backend's `CreateOutputRequest
      .rootId` from task 5.8a), and `context.ts`'s `nodeStepId ?? null` null-means-root encoding (the fourth
      bullet) — `types.ts.OutputResponse` was missing `rootId` OUTRIGHT (the backend's real `OutputResponse`
      has had it since task 5.8a; MCP never mirrored it), so `nodeStepId: o.nodeStepId ?? null` on
      `context.ts:205` had genuinely nothing to pair with. Added `rootId?` to `OutputResponse`, `rootId` to
      `WorkspaceContextOutputSummary`, and `rootId: o.rootId ?? null` alongside the existing line. NEW test
      (`context.test.ts`) proves a root-bound Output's REAL `rootId` (not just `nodeStepId: null`) reaches the
      workspace-context response. **NOT done**: `pipelinesHandlers.ts`'s `addOutputsFromShapeHandler`
      (`apply_pipeline_shape`'s handler) does not thread a `rootId` through either the step-chain or the final
      Output.
- [ ] 9.9a **NOT VERIFIED.** The four named sites (`helioApi.ts:828`, `:833-836`, `assertSchemas.ts:109,:123`,
      `context.test.ts:199-207`) reference line numbers from before this ticket's many prior commits shifted
      every file's line count repeatedly. `assertSchemas.ts`'s `addPipelineStepHandler` (wherever it now sits)
      IS fixed — see 9.9/9.5 above — but the other three named sites were not independently re-derived by
      content and confirmed against this exact list; recorded as unverified rather than assumed covered.
- [ ] 9.9b **NOT DONE.** The full named list (`context.ts:146-147`'s type, `helioApi.ts:515,:524`,
      `types.ts:189,:204,:737-743,:749-752,:790`, `pipelineProposal.ts:69,:75,:80,:117,:120-121`, `read.ts:252`,
      the e2e comments) was not worked through item-by-item this batch.
- [x] 9.10 **DONE.** NEW `scripts/check-node-root-encoding.ts.mjs` (`npm run check:node-root-encoding:ts`),
      mirroring the Scala guard's structure and honesty standard exactly (own header states EXACTLY what it
      covers/does not — `helio-mcp/src/**/*.ts` excluding `*.test.ts`; not `backend/**`; not `frontend/**`; not
      every possible TS spelling). TWO independent checks, mirroring the Scala guard's raw-SQL/Slick pair:
      (1) VALUE-LEVEL, per-line: `nodeStepId ?? null` / `|| null` with no same-line `rootId` (`
      KNOWN_ROOT_QUALIFIED_LINES` exemption for the one real multi-line case, `context.ts:205`, mirroring the
      Scala guard's own `KNOWN_ROOT_QUALIFIED_LINES` convention); (2) TYPE-LEVEL, per-interface-block: an
      `interface` declaring `nodeStepId` with NO `rootId` field ANYWHERE in that block — this is the check the
      coordinator specifically asked for ("the TYPE, not only the VALUE"), and it is what would have caught
      `types.ts.OutputResponse`'s missing `rootId` even before any call site wrote `?? null` against it.
      `KNOWN_TYPE_EXEMPT_INTERFACES` names the one genuine exception (`ProposalOutputSummary` — the backend's
      real type has no `rootId` at all, confirmed single-source by design per 7.2a/9.7). Full run against the
      real `helio-mcp/src/**` tree: clean (32 files scanned), only after fixing the real gap 9.9 found.
- [x] 9.10-i **DONE.** NEW `scripts/check-node-root-encoding.ts.selftest.mjs`, 9 cases, mirroring the Scala
      selftest's own structure: both value-level forms (`?? null`/`|| null`) fire; a same-line `rootId`
      qualifier does not fire; the real `KNOWN_ROOT_QUALIFIED_LINES` exemption (`context.ts:205`) does not
      fire, and the SAME pattern at a different, non-exempted line still fires (proves the exemption is
      line-pinned, not file-wide); both type-level cases (nodeStepId alone fires, nodeStepId+rootId together
      does not); the real `KNOWN_TYPE_EXEMPT_INTERFACES` entry does not fire; neither field present does not
      fire. All 9 pass (`npm run check:node-root-encoding:ts:selftest`). **Not wired into
      `.husky/pre-commit`** — same as the EXISTING Scala guard/selftest, which are ALSO not in the hook chain
      (`npm run check:node-root-encoding`/`:selftest` are real, runnable, but not part of `.husky/pre-commit`
      today) — recorded as a genuine, pre-existing gap for both guards, not something 9.10 introduced or was
      asked to fix; deliberately did not touch `.husky/pre-commit` itself (a live-infrastructure change with
      its own checklist/isolation-test requirement, out of this task's scope).
- [x] 9.8 **DONE.** `npm run check:helio-mcp-types` clean; `npx jest` (helio-mcp's own suite) 223/223 passing,
      fresh run after every change in this batch (including this turn's 9.1/9.2/9.9/9.10 work).

## 10. e2e (`e2e/**` — NOT `frontend/**`)

- [x] 10.1 **DONE.** All 11 named `sourceDataSourceId: source.id` call sites, across all 8 named specs, replaced
      with `roots: [{ sourceId: source.id }]` — the same wire-format break 9's `helioApi.createPipeline` had
      (the backend hard-rejects the legacy scalar field, 7.1's "no deprecation"), one call site type over: every
      one of these specs was POSTing a body the current backend already 400s, via a raw `page.request.post`, not
      the MCP client this ticket's other fixes covered. Verified by `grep -rn "sourceDataSourceId"
      e2e/*.spec.ts` returning zero matches afterward. The stale `outputDataTypeName` field also present in
      several of these same request bodies (a genuinely dead field pre-dating HEL-904, never part of
      `CreatePipelineRequest`) was left untouched — not named in this task's own scope, and harmless (the
      backend's hand-rolled reader only extracts named fields; an unrecognized key is silently ignored, not a
      400) — recorded here rather than silently "fixed" beyond scope.
- [x] 10.2 **Noted, not modified, per its own instruction.** `e2e/hel910-pipeline-to-dashboard-flow.spec.ts`,
      `e2e/hel813-mobile-touch-target-floor.spec.ts` are expected-red during the HEL-969 window (both drive the
      create UI, which needs the frontend repair) — confirmed neither was touched beyond `hel910`'s own 10.1 call
      site (the ONE line named for it, `:234`'s wire-format fix, which is this change's own scope and not part
      of the expected-red UI-driving behavior).
- [x] 10.3 **PARTIAL.** `npm run check:e2e-types` — clean (confirmed fresh, this batch). **NOT verified**: the
      actual Playwright suite was NOT run against a live backend+frontend stack in this session — no dev server
      was standing up (`curl localhost:8080/health`/`:5173` both connection-refused), and `frontend/**` is
      off-limits per this ticket's own scope, so standing up that stack was not attempted. `check:e2e-types` is a
      `tsc --noEmit` — it proves the specs still COMPILE against the current backend response types, never that
      they PASS against a live run (the exact "a green gate is not evidence of what it cannot see" lesson this
      ticket keeps re-deriving, stated once more here rather than silently assumed). Recorded as a genuine,
      unverified gap, not claimed as done.

## 11b. Wire the node-root-encoding guards into CI (NEW, coordinator-raised)

- [x] 11b **DONE.** `grep` confirmed: `check:node-root-encoding`, its selftest, `check:node-root-encoding:ts`, and
      its selftest existed as real, runnable `package.json` scripts (5.8b and 9.10 respectively) but were wired
      into NOTHING mandatory — not `.husky/pre-commit`, not `.github/workflows/ci.yml`. Both guards could pass or
      fail and it would change nothing about any commit or PR — this ticket's own defect class (a green gate that
      is not evidence) applied to the tools built to detect that exact class, and both gaps are THIS change's own
      (5.8b created one, 9.10 the other — neither is pre-existing to the repo). Fixed by adding all four as new
      steps to `.github/workflows/ci.yml`'s `frontend` job (the same job that already runs
      `check:e2e-types`/`check:helio-mcp-types`/`check:dependabot`/`check:dependabot:selftest` the identical way),
      immediately after `check:helio-mcp-types`. **CI, not `.husky/pre-commit`** — recorded reasoning, not just the
      choice: CI is merge-blocking and cannot be bypassed; the husky chain CAN be (and was, once, in this exact
      ticket, via `git commit -n`) — so CI is both the cheaper wiring AND the stronger enforcement. Wiring
      `.husky/**` itself would ALSO trip the gate-chain-change requirements (a `## Gate-Chain Implications
      Checklist` in design.md plus per-script isolation-test transcripts, enforced at Delivery) for strictly
      weaker enforcement than CI already gives for free. Verified task 11b.4's own distinction deliberately:
      confirmed all four `- run:` lines are PRESENT IN THE WORKFLOW FILE (`grep -n "check:node-root-encoding"
      .github/workflows/ci.yml` — 4 matches, all real steps, not merely that the four scripts pass when run by
      hand (which they also do, but that was never the missing evidence).

## 11. Specs and docs

- [x] 11.1 **DONE.** Superseded engine-contract items 8 and 11 in
      `openspec/changes/archive/2026-09-03-multi-lane-pipeline-engine/design.md` with forward pointers: item 8
      (rejoin keying, `Some(stepId)`) now points to this change's `design.md` § R4 (`NodeKey` root sentinel); item
      11 (lane-path reporting format, bare `root > ...`) now points to § R5 (`root:<rootId> > ...`, and why it does
      not conflict with HEL-914's `roots[1] › steps[3]` request-address format). Both superseded notes are inline,
      not a separate section, so a reader hits them exactly where the stale claim lives.
- [x] 11.2 **DONE.** Corrected six now-false sentences in
      `docs/superpowers/specs/2026-08-30-pipelines-outputs-remodel-design.md`, in the established
      **Corrected (HEL-913)** style used at (pre-edit) line 160: line 7 (Phase 1/2 framing — multi-root shipped as
      its own change, not folded into either phase), line 32 decision 3 ("No second migration" — V98 was a second
      migration), line 50 (non-goals: "the data model supports them from day one" — it did not; V98 was required),
      line 63 (concept table: "one root source" / "multi-root arrives with Phase 2" — a pipeline has N roots via
      `pipeline_roots`, shipped as its own change), line 158 decision 4 ("the root previewed", singular), line 174
      (`create_pipeline` "sourceId or inline source spec" singular — now `roots[]`).
- [x] 11.3 **DONE.** `docs/agent-native.md` documented a singular pipeline source in three places: the tool table's
      "single call: source/steps/outputs" (now "roots/steps/outputs"), the `create_pipeline`/`add_pipeline_step`
      reshape paragraph (now names `roots[]` and `add_root`/`remove_root`), and the verified-composition sentence
      (now names `roots[]` alongside `steps[]`/`outputs[]`). The line-121 ASCII diagram's bare "Source" label was
      left untouched — it is a concept-level diagram, not an assertion of singularity, and is not one of the
      sentences actually contradicted by multi-root.
- [x] 11.4a **DONE.** `domain/panels/OutputBindingSpec.scala:170`'s doc comment stated the banned
      null-means-root encoding as fact (`nodeStepId: null` with no root cross-reference). Corrected to
      `nodeStepId: None` paired with the Output's own `rootId`, with an explicit note that a bare null/None
      `nodeStepId` with no accompanying root is never valid under multi-root, cross-referencing this change's
      design.md R12/R15.
- [x] 11.5 **CHECKED, no change needed.** `backend/scripts/repair-dev-db.sql` is a HEL-267-era fixup for
      pre-remodel `data_types`/pipeline-owner drift; it never references `source_data_source_id` or any dropped
      column (grepped, zero matches) — it has nothing to repair here. `backend/README.md` documents the same
      HEL-267 repair script and contains no claim about pipeline source cardinality or the dropped column (grepped
      for `source_data_source_id`/`sourceDataSourceId`/singular-source language, zero matches). Both left
      unmodified; verified by content, not assumed clean.

## 11a. Do NOT touch

- [ ] 11a.1 `frontend/**` is off limits (HEL-912 owns it in parallel). The 21 `frontend/src` files referencing the
      scalar field are HEL-969's, filed for exactly this. If a task seems to need a `frontend/**` edit, STOP and
      escalate.

## 11b. Wire the guards into CI (they currently run NOWHERE mandatory)

- [x] 11b.1 **Both guards this change created are inert.** `check:node-root-encoding`, its selftest,
      `check:node-root-encoding:ts` and its selftest are npm scripts only — **not in `.husky/pre-commit`, not in
      `.github/workflows/ci.yml`**. They would never fire on anyone's commit or PR. A guard that runs nowhere is
      decoration, and this is the very defect class the guards were built to detect, applied to the guards.
      **Neither is pre-existing to the repo** — 5.8b and 9.10 created them in this change, so wiring them is
      squarely this change's job, not a follow-up.
- [x] 11b.2 **Wire all four into `.github/workflows/ci.yml`**, which already invokes checks exactly this way
      (`- run: npm run check:e2e-types`, `check:helio-mcp-types`, `check:dependabot`, `check:dependabot:selftest`).
      Add the four as sibling steps.
- [x] 11b.3 **CI, not `.husky/pre-commit`, is the right home — state this reasoning in the task record.** CI is
      merge-blocking and **cannot be bypassed**; the husky chain can, and was bypassed once in this very ticket with
      `git commit -n`. Wiring `.husky/**` would additionally trip the gate-chain-change requirements (a
      `## Gate-Chain Implications Checklist` in `design.md` plus a per-script isolation-test transcript, enforced by
      `assert-phase.sh delivery`) for strictly weaker enforcement. If a later ticket wants them in the hook chain
      too, that is additive and must carry that checklist.
- [x] 11b.4 Verify by running the CI job's own command sequence locally, and confirm each of the four is present in
      the workflow file — not merely that the scripts pass when invoked by hand.
      **Verified at the orchestrator gate:** `.github/workflows/ci.yml:40-43` carries all four `- run:` steps.

## 11c. Final-gate round-1 fixes (skeptic-final-1.md, two blocking CRs)

- [x] 11c.1 **CR1 — the fourteenth instance, hiding in a prompt string literal.**
      `RefinementEditShape.scala:258`'s live refinement prompt told the model, verbatim, that pipeline `create`
      reuses `CreatePipelineRequest — { "name", "sourceDataSourceId" }` — a field this change retired outright
      months ago (no alias, no default, hard 400). Fixed: the prose now describes the current `roots[]` shape
      (non-empty array, each element `sourceId` or an inline source spec) and explicitly warns the model never
      to emit `sourceDataSourceId`. `CreateExample` widened `private` → `private[services]` (matching every
      other example val in this file) and `RefinementEditShapeSpec` gained 2 new tests asserting the prose
      names the current field names and never presents the retired one as required — mutation-proven (reverted
      the fix, confirmed red for the predicted reason, restored, confirmed green).
      **Why this survived the §1.2 re-sweep, and the lesson recorded in `design.md` as new Rule D:** the
      re-sweep's raw count DID include this site (inside the "backend main+test (65)" bucket), but the bucket
      was classified in aggregate ("mostly `PipelineRepository`'s self-documented DTO retention") rather than
      per-site, and this site rode along inside that summary judgement uncaught. A bucketed total is a diff
      wearing a total's clothes — see `design.md`'s Rule D for the generalizable form.
- [x] 11c.2 **CR2 — AC2's Output half was unproven.** The only `removedOutputCount` assertion anywhere in the
      repo was `shouldEqual 0` (`PipelineRootRoutesSpec.scala`, pre-existing tests) — every OTHER test in that
      file removes a root with no Output on it, and the file's `PipelineService` construction didn't even wire
      an `OutputRepository` until this fix, so `removedOutputCount` was structurally guaranteed 0 regardless of
      what the code did. Neither arm of the count predicate nor the Output/panel cascade on root removal was
      ever independently observed firing. Fixed: `outputRepo` wired into the spec's `PipelineService`
      construction; new test seeds a root carrying a REAL, panel-placed Output, removes that root, and asserts
      `removedOutputCount shouldEqual 1` plus the Output row AND its panel placement are both actually gone
      (`outputs.root_id`/`panels.output_id`, both `ON DELETE CASCADE`). Mutation-proven the COUNTING half:
      reverted `removedOutputsF` to `Future.successful(0)`, confirmed the new test goes red
      (`0 did not equal 1`), restored, confirmed green. The DELETION half is DB-FK-enforced (not application
      code to mutate); the test's own row-count assertions verify the real end state directly rather than
      re-deriving that from a code path already covered by this file's sibling "delete node_snapshots
      explicitly" test.
- [x] 11c.3 `design.md` gains **Rule D — a bucketed total is a diff wearing a total's clothes**, in the same
      transferable form as Rules A/B/C, recording CR1's lesson for future re-sweeps.

## 11d. Final-gate round-3 fixes (skeptic-final-2.md, two findings)

- [x] 11d.1 **FIX 1 — the V98 cascade re-homing, silent data loss. See 4.6 above for the full
      writeup; recorded here too since this is where the final-gate round's own numbering lives.**
      V99 migration (`hel913_prevent_zero_root_pipelines` trigger) + `V99PreventZeroRootPipelinesMigrationSpec`
      (4 tests, mutation-proven).
- [x] 11d.2 **FIX 2 — `PipelineService.removeRoot`, round 1's CR2 left half-fixed.**
      `if (outputRepo == null) Future.successful(0)` reported `removedOutputCount = 0` while the root's own
      cascade (`outputs.root_id`/`outputs.node_step_id`, both `ON DELETE CASCADE`) destroyed the Outputs
      regardless -- the exact mechanism round 1's CR2 fixed one caller over (`OutputService`/
      `PipelineRunService`) and left standing here. Fixed: `removeRoot` now FAILS CLOSED at its own entry
      point when `outputRepo == null` (a named `InternalError`, mirroring `createTransactional`'s own
      identical guard for the same collaborator), matching its sibling at `PipelineService.scala` (task 7.4's
      transactional-create Output path) exactly, per the coordinator's instruction. New test in
      `PipelineRootRoutesSpec` — "500s and removes NOTHING when outputRepo is not wired" — asserts the
      SPECIFIC fail-closed contract (500, zero roots removed) rather than merely "some error", mutation-proven
      (reverted to the silent-0 fallback, confirmed the new test goes red with `200 OK did not equal 500`,
      restored, confirmed green).
- [x] 11d.3 Verified: `sbt "testOnly PipelineRootRoutesSpec V98PipelineRootsMigrationSpec
      FlywayNonSuperuserMigrationSpec V99PreventZeroRootPipelinesMigrationSpec"` — 31/31, no regression in
      either direction (V99's trigger does not interfere with `removeRoot`'s own legitimate ≥2-root removal
      path, and the non-superuser RLS gate stays green with the new SECURITY DEFINER trigger present — green
      because V99 applies cleanly there, NOT because that gate exercises the trigger; it does not
      fire it, see 11d.2 and HEL-974). Full
      `sbt test` run before commit (see commit message for the final count).

## 12. Gates

- [x] 12.1 **DONE.** `sbt test` — 3725 tests, 245 suites, all passed, 0 failed. Re-affirmed: this run covers
      compile-level and typed-behavior correctness, not the migration's own real risk (a live non-BYPASSRLS
      Flyway run against prod-shaped data) — 3.1 covers that separately.
- [x] 12.2 **DONE.** `npm run lint`, `typecheck`, `test` (223 MCP + 2590 frontend, all passed), `check:schemas`,
      `check:openspec`, `check:spec-structure`, `check:e2e-types`, `check:helio-mcp-types`, `check:scala-quality`
      (149 pre-existing soft warnings, none new) — all clean, fresh run this batch.
- [x] 12.3 **DONE.** `openspec validate multi-root-pipelines` — "Change 'multi-root-pipelines' is valid", exit 0.
      (Note: the CLI flag is `openspec validate <name>`, not `--change <name>` — `--change` does not exist on this
      CLI version; ran the working form.)
- [x] 12.4 **DONE.** `files-modified.md` updated (§11 section appended); committing this batch now, per the
      standing "never yield with uncommitted work" rule.

## Known open at Evaluation entry — NOT oversights

- [ ] **9.7 cluster — HELD pending a product ruling, deliberately untouched.** Two of this change's spec deltas
      (`pipeline-proposal-contract`, `pipeline-proposal-apply`) assert SHALLs requiring `PipelineProposal` to carry
      `roots[]`. The backend keeps singular `source` (`PipelineProposalProtocol.scala:116`; the schema requires
      `source`, no `roots`). So this change currently holds **two unmet SHALLs in its own binding artifacts**.
      **Cause: an orchestrator planning error** — those deltas were written for work **HEL-914 explicitly owns**
      ("Proposals: `PipelineProposal` / combined proposals may propose lanes and roots"); HEL-913's ticket scope
      never mentions proposals.
      **Correlated open sites (9), all on this one surface, all deliberately untouched:** `PipelineProposalService`,
      `PatchSetApplyRollback`, `PatchSetUndoInverse`, `PipelineShapeProtocol`, `PatchSetPreviewProjection`,
      `RefinementEditShape`, `WorkspaceContextService:293`, `pipeline-proposal.schema.json`,
      `AssistantProposalToolSchemas.scala` (tasks 7.6/8.2/8.3g).
      **Options:** move both deltas to HEL-914 (orchestrator's recommendation — coherent intermediate state: a
      proposal creates a one-root pipeline, `add_root` extends it), or implement all 11 here.
      **Not self-authorized:** the design gate CONFIRMed with these deltas present, so removing them is a post-gate
      scope reduction requiring the product owner.
- [ ] **10.3 Playwright suite unrun by the executor** — no dev server available to it. Belongs to Evaluation, which
      owns the worktree's ports (6345/9252). Expected-red: `hel910-pipeline-to-dashboard-flow`,
      `hel813-mobile-touch-target-floor` (both pending HEL-969's frontend repair). Known flake:
      `hel908-full-flow` (HEL-964). Quarantined, do not run: `hel912-lanes-rejoin` (HEL-972). **Any OTHER spec red
      is this change's defect.**
