## Standing Constraints

- [C1] No CLAUDE.md line is edited unless evidence.md first contains the pasted verification command AND its raw output
  for that line's claim. A claim with no pasted proof is not written. Never write a sentence you did not verify.

## 1. Docs: verification evidence (write `openspec/changes/fix-claude-md-endpoint-list/evidence.md`)

- [x] 1.1 Paste `grep -n "Key endpoints" -A26 CLAUDE.md` output as the baseline list.
- [x] 1.2 For EACH bullet, paste `grep -rn '<path segment>' backend/src/main/scala/com/helio/api/routes/<file per design map>` plus `sed -n '<start>,<end>p' <file>` of the enclosing pathPrefix/path + get/post/put/patch/delete directives.
- [x] 1.3 For each bullet record a verdict line: `CLAIM: <text> | VERDICT: TRUE/FALSE | PROOF: <file:line>` — exactly one per baseline bullet (23).
- [x] 1.4 Data-sources: paste `grep -n 'path\|pathPrefix\|get {\|post {\|put {\|patch {\|delete {' backend/src/main/scala/com/helio/api/routes/sources/DataSourceRoutes.scala backend/src/main/scala/com/helio/api/routes/sources/DataSourcePreviewRoutes.scala`; write a table of every (path, method) pair found (incl. `infer`). PASS = the data-sources bullets together (`GET/POST /api/data-sources`, 2.1, 2.2) list exactly these pairs, no more, no fewer.
- [x] 1.5 Paste `grep -rn 'DataSourceIdSegment' backend/src/main/scala` proving no other router mounts GET on bare `data-sources/:id` (note `SourcePreviewRoutes` hits sit under `pathPrefix("sources")`, i.e. `/api/sources/...` — cite that line).
- [x] 1.6 Verify existence/negative claims: no authenticated `GET /api/dashboards/:id` (grep DashboardRoutes + DashboardSnapshotRoutes); `/api/types` + `/api/metrics` absent (`grep -rn '"types"\|"metrics"' backend/src/main/scala/com/helio/api`); schedule firing: paste `grep -n 'def fire\|\.submit(' backend/src/main/scala/com/helio/services/pipelines/PipelineSchedulerService.scala` AND `grep -n 'PipelineSchedulerService\|PipelineSchedulerActor' backend/src/main/scala/com/helio/app/Main.scala`.
- [x] 1.6a If 1.6 shows fire() submits runs AND Main starts the scheduler: the ONLY allowed schedule-bullet edit is deleting "data model + CRUD only; " and "No runtime firing yet — that's the sibling scheduler-runtime ticket (HEL-415)", optionally replaced by exactly "Schedules fire on the scheduler tick (`PipelineSchedulerService`)." — nothing else.
- [ ] 1.7 Optional corroboration: `curl -s -o /dev/null -w '%{http_code}' -X GET http://localhost:9607/api/data-sources/x` (auth may give 401 first — note it; grep remains primary).

## 2. Docs: CLAUDE.md edits (only lines with a FALSE verdict in 1.3)

- [x] 2.1 Replace `GET/DELETE /api/data-sources/:id` with `PATCH/DELETE /api/data-sources/:id` noting only what evidence proves (e.g. "no GET-by-id; read a source via the list" — NOT `/:id/schema`, which is dataset-only; final-gate r1).
- [x] 2.2 Add one bullet listing the data-sources sub-routes with methods exactly as found in 1.4 (nothing more).
- [x] 2.3 Fix any other bullet whose 1.3 verdict is FALSE, using only wording the pasted proof supports.
- [x] 2.4 Do not touch any line outside the "Key endpoints" list; do not reflow.

## 3. Tests: gates

- [x] 3.1 `npx prettier --check CLAUDE.md` passes; paste output. If it fails, do NOT run --write on the file; escalate.
- [x] 3.2 `git diff --stat` shows only CLAUDE.md + this change dir; `git diff CLAUDE.md` touches only Key-endpoints lines.
- [x] 3.3 `openspec validate fix-claude-md-endpoint-list --type change` exits 0; commit (full pre-commit hook, timeout 600000).
