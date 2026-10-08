## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed HEAD 42d2fbd16e4e7b30bd2b266e72616e9d00eb0425 (change dir untracked; artifacts: ticket.md, proposal.md,
design.md, tasks.md, workflow-state.md).

### What I verified (with evidence)

- **Spawn-cwd guard:** `assert-cwd.sh` → `READY ambient=/home/matt/Development/helio branch=task/fix-claude-md-endpoint-list/hel-1268`.
- **Core defect is real.** `routes/sources/DataSourceRoutes.scala:151` `path(DataSourceIdSegment)` → `patch` (:153) +
  `delete` (:158) only. `grep -rn '"data-sources"\|DataSourceIdSegment' backend/src/main/scala/com/helio` finds no other
  bare `data-sources/:id` mount (SourcePreviewRoutes' `/refresh`, `/preview` sit under `pathPrefix("sources")`, :46).
  Both routers are mounted under `pathPrefix("api")` (ApiRoutes.scala:782, :905, :916).
- **Full data-sources route set on HEAD** (DataSourceRoutes.scala:107-240, DataSourcePreviewRoutes.scala:47-72):
  `GET csv-limits`, `GET references`, `GET/POST /`, `PATCH/DELETE :id`, `GET/PATCH :id/schema`,
  `GET/POST/PUT :id/rows`, `GET :id/rows/aggregate`, `PATCH/DELETE :id/rows/:rowId`, `POST :id/refresh`,
  `GET :id/preview`, **`POST infer`** (DataSourcePreviewRoutes.scala:71-72).
- **Decision 1 (no GET-by-id) is grounded.** `frontend/src/features/sources/services/dataSourceService.ts` uses list,
  csv-limits, references, POST, DELETE (:227), PATCH (:328), rows/schema/preview/infer sub-routes — no bare GET by id.
  `helio-mcp/src/helioApi.ts:268-277` (`listSourceObjects`) deliberately finds a source by scanning the list and only
  *names* `/api/data-sources/${sourceId}` in a synthetic 404 message; :1090 is PATCH, :1297 DELETE. e2e callers are
  DELETE only. No OpenAPI/schema entry for a GET-by-id. Ticket delegates this decision; docs-correction is defensible.
- **Planner lead on schedule bullet is correct, and the bullet is false.** `PipelineSchedulerService.scala:208-230`
  `fire()` calls `.submit(schedule.pipelineId, isDry = false, owner, triggerSource = TriggerSource.Scheduled)`, and
  `app/Main.scala:293,304` constructs the service and `context.spawn(PipelineSchedulerActor(...), "pipeline-scheduler")`.
  "No runtime firing yet" is stale.
- **Simulated task 1.6's schedule command:** `grep -n 'PipelineScheduleRepository\|schedule' ... | head` returns the
  import line and doc comments (line 15 "scans due `pipeline_schedules` on every tick and fires runs") — i.e. its only
  "proof" of firing is a **comment**, and it never touches Main.scala wiring.
- **Other routers named in the design map exist** (DashboardRoutes duplicate :71 / layout/repair :81;
  DashboardSnapshotRoutes export :29 / import :34; PipelineRoutes analyze :59; OutputRoutes :58/:87/:115/:130/:201;
  PipelineScheduleRoutes :24). Map omits `PipelineRun*Routes.scala` (step/run/status bullet) and
  `DashboardContentsRoutes.scala` (mounted ApiRoutes.scala:896, only `:id/contents`), but design's "grep the whole tree"
  fallback covers it.
- **Prettier risk low:** `prettier.config.cjs` sets no `proseWrap` (default `preserve`), CLAUDE.md is not in
  `.prettierignore`; existing long bullets already pass, so a new long bullet will not be reflowed.
- **Scope:** matches ticket + driver notes (Key endpoints only, env table untouched, no reformat, ~/CLAUDE.md never
  touched). Both ACs covered (re-derive data-sources + check all bullets; GET-by-id decision).

### Verdict: REFUTE

Plan is fundamentally sound; three cheap, specific revisions close the exact unverified-claim holes a weaker executor
would fall into.

### Change Requests

1. **proposal.md "What Changes" bullet 1 — the enumerated sub-route list is itself an unverified, incomplete claim and
   contradicts tasks.md 2.2.** It presents `(csv-limits, references, :id/schema, :id/rows, :id/rows/aggregate,
   :id/rows/:rowId, :id/refresh, :id/preview)` as the routes "that actually exist", but omits `POST /api/data-sources/infer`
   (DataSourcePreviewRoutes.scala:71-72) and gives no methods. A Haiku executor will anchor on this list. Either remove
   the enumeration and point to tasks 1.4/2.2 ("exactly as found in evidence"), or correct it to the full set with
   methods listed above. Same applies to design.md Decision 2 if you restate it.
2. **tasks.md 1.4 — the grep must cover every method directive and the `infer` path.** The
   `grep -n 'path\|get\|post'` on DataSourcePreviewRoutes happens to work today, but require the same pattern for both
   files as `grep -n 'path\|get {\|post {\|put {\|patch {\|delete {'` and add an explicit acceptance signal: "the 2.2
   bullet lists exactly every (path, method) pair present in that output — no more, no fewer; `infer` included."
3. **tasks.md 1.6 schedule check — replace the weak command and specify the edit.** `grep ... 'PipelineScheduleRepository\|schedule' | head`
   yields only an import and doc comments; a comment is not proof. Require pasting
   `grep -n 'def fire\|\.submit(' backend/src/main/scala/com/helio/services/pipelines/PipelineSchedulerService.scala`
   AND `grep -n 'PipelineSchedulerService\|PipelineSchedulerActor' backend/src/main/scala/com/helio/app/Main.scala`
   (code call + boot wiring). Then state the permitted edit precisely, e.g. "delete the clause `No runtime firing yet —
   that's the sibling scheduler-runtime ticket (HEL-415)` and the `data model + CRUD only;` qualifier; optionally replace
   with `fired by the scheduler tick (\`PipelineSchedulerService\`, HEL-415)` — no other new wording." This is the one
   known-false bullet besides the data-sources line; leaving its replacement text to the executor's discretion is the
   exact gap C1 exists to close.

### Non-blocking notes

- design.md router map: add `pipelines/PipelineRun*Routes.scala` (for the "step/run/status sub-routes" claim) and
  `dashboards/DashboardContentsRoutes.scala` so the executor does not mark a true claim FALSE for want of a file.
- The helio-mcp list-scan in `listSourceObjects` is mild evidence a GET-by-id *could* be convenient; not a need. Worth
  one sentence in design.md Decision 1 so the evaluator does not re-litigate it.
- tasks 1.3: also require a verdict line for every bullet even when TRUE (it says "for each bullet" — keep the evaluator
  checking the count equals 23).
