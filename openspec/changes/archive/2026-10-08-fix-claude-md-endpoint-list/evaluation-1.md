## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed HEAD: 17f6c8457f0f25e808a7e03396c0f3ba6a59471d (base 42d2fbd16e4e7b30bd2b266e72616e9d00eb0425, live-resolved via resolve-review-base.sh).
Diff: `CLAUDE.md` (+3/-2, Key-endpoints lines 143/145/146 only) plus the change dir. `~/CLAUDE.md` untouched.

### Phase 1: Spec Review — PASS
Issues: none.

- AC1 (re-derive the whole data-sources section from the routers, check every other bullet): done. I independently re-derived the data-sources (path, method) set from `DataSourceRoutes.scala:107-240` and `DataSourcePreviewRoutes.scala:47-72`:
  list GET/POST (:128-148); `csv-limits` GET (:110); `references` GET (:115); `:id` PATCH/DELETE only (:151-162); `:id/schema` GET/PATCH (:165-178); `:id/rows` GET/POST/PUT (:182-206); `:id/rows/aggregate` GET (:210); `:id/rows/:rowId` PATCH/DELETE (:220); `:id/refresh` POST (Preview :50); `:id/preview` GET (Preview :64); `infer` POST (Preview :71).
  The three new/changed data-sources bullets together list exactly this set, with nothing extra and nothing missing. `grep -rn DataSourceIdSegment backend/src/main/scala` shows no other router mounts a bare `data-sources/:id` GET. `SourcePreviewRoutes` hits are under `/api/sources`. Both routers are mounted inside `pathPrefix("api")` (ApiRoutes.scala:782, :905, :916).
- AC2 (decide on GET-by-id): Decision 1 (no GET-by-id, docs corrected, no follow-up ticket) is recorded in design.md and reflected in the bullet.
- The edit to the schedule bullet is exactly the wording task 1.6a allows. I checked it myself: `PipelineSchedulerService.fire` (:208) calls `.submit(..., triggerSource = TriggerSource.Scheduled)` (:230), and `Main.scala:293-304` constructs the service and spawns `PipelineSchedulerActor` on the tick interval. Both the old "No runtime firing yet" and the old "data model + CRUD only" text were false.
- The rest of the 23-bullet verdict table: I re-checked every method/path/existence TRUE verdict against the route files and found no false TRUE.
  - dashboards: DashboardRoutes :30-102 has list GET/POST, `:id/duplicate` POST, `:id/layout/repair` POST, and `:id` DELETE/PATCH only. No bare-`:id` GET exists in any router; the DashboardIdSegment sweep shows only auto-layout/contents/duplicate/repair/update/export.
  - export/import: DashboardSnapshotRoutes :29-35.
  - Public panels/rows/history: PublicDashboardRoutes :60-63, :152-154, :190-191. These are mounted only under `optionalAuthenticate` (ApiRoutes :815-817). The only other `"panels"` path literals are PanelRoutes :67 and OutputRoutes :108 (`/outputs/:id/panels`).
  - panels: POST, `:id` PATCH, duplicate, submit (PanelRoutes :90-128).
  - outputs: OutputRoutes :58-203, including `history/:uuid/rows` :130.
  - pipelines: PipelineRoutes :23-60 for GET/POST and `:id/analyze`.
  - `"types"`/`"metrics"`: no match anywhere under `com/helio/api` (exit 1).
  - schedule: PipelineScheduleRoutes :24-35, GET/PUT/DELETE.
  - authoring: DashboardAuthoringRoutes :87-94, including the `stream` param.
  - events: ProductEventRoutes :27-29.
  - first-run: FirstRunRoutes :21-24.
  - admin: AdminUsageRoutes :20-24.
  - health: HealthRoutes :9-10, mounted outside `/api` (ApiRoutes :781).
- No scope creep. The env-var table, other sections and the user's home CLAUDE.md are untouched. No reflow; Prettier passes.
- Planning artifacts match the implementation. Task 1.7 (optional curl) is left unchecked and is disclosed as not run.
- CONSTRAINTS C1 (no CLAUDE.md line edited without pasted command and output in evidence.md) is honored. Each of the three edited lines has pasted greps and verdicts (evidence.md :841-848 and the 1.4/1.5/1.6 sections). Ordering within one commit cannot be proven by content. The claim rests on the evidence existing in the same commit, not on mtimes.

**Executor-flagged item: "single-call: source/steps/outputs in one request" when the request key is `roots`.** This is not a false line, and it is out of scope.
- It makes no method, path or existence claim. It describes the request's content, not a key name, so it falls under design.md Non-Goals ("behavioral detail prose ... left as-is unless a check directly contradicts it").
- The code does not contradict it in any case. `CreatePipelineRequest` (PipelineProtocol.scala:78-84) carries `roots: Vector[CreatePipelineRootRequest]`, and each root is a source: either an existing `sourceId` or an inline new source (`type`/`sqlConfig`/`restConfig`/`staticConfig`, :63-71). It also carries `steps` and `outputs`, so source, steps and outputs really do arrive in one request.
- The prose would be misleading only if read as naming a `source` key, and it does not use key-name formatting. The executor was right to leave it TRUE and not edit it.

### Phase 2: Code Review — PASS
Gates (run fresh by me in WORKTREE_PATH):
- Changed files match neither `frontend/**` nor `backend/**`, so no lint/jest/build/sbt gate glob applies.
- `npx prettier --check CLAUDE.md` passed: "All matched files use Prettier code style!" (exit 0).
- `openspec validate fix-claude-md-endpoint-list --type change` passed: "Change 'fix-claude-md-endpoint-list' is valid" (exit 0).
- `git status --short` is clean. The single commit 17f6c8457 has no recorded hook bypass.

Evidence authenticity spot-check: I re-ran `grep -rn DataSourceIdSegment backend/src/main/scala`, and all 13 output lines appear verbatim in evidence.md. The line numbers cited in the verdict table also matched my own greps for every file I opened: OutputRoutes, PanelRoutes, PipelineRoutes, DashboardRoutes, DataSourceRoutes, DataSourcePreviewRoutes, PipelineScheduleRoutes, PublicDashboardRoutes and PipelineSchedulerService.

The code-quality and design checklists do not apply, because no source code changed. The documentation edit is minimal and accurate.

Issues: none.

### Phase 3: UI Review — N/A
No `frontend/**`, `ApiRoutes.scala`, `schemas/**` or `openspec/specs/**` change.

### Overall: PASS

### Change Requests
(none)

### Non-blocking Suggestions
- `CLAUDE.md:145` "use the list or `/:id/schema`": `/:id/schema` returns the declared dataset schema, not the source record. It works for the existence check HEL-1264 needed, but "use the list" is the real read path. Consider "use the list (or `/:id/schema` for an existence/schema check)" in a later pass. This is not a false claim.
- The optional live curl (task 1.7) would have corroborated the 405. Grep evidence is sufficient on its own.
