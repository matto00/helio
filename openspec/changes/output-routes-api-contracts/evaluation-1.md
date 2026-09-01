# Evaluation Report — Cycle 1 (evaluation-1.md)

Ticket: HEL-906 (P1.3 — Output routes, single-call create_pipeline, capabilities-at-node,
assertion status). Change: `output-routes-api-contracts`. Reviewed commit `4348bb1b`.

## Phase 1: Spec Review — FAIL

The work that *is* present is genuinely good (see Phase 2), but the ticket's acceptance
criteria are mostly unaddressed. AC-by-AC, checked directly against `ticket.md` (not against
the executor's self-report):

| # | Acceptance criterion | Status |
|---|---|---|
| 1 | Route specs cover every new route incl. ACL, and the single-call `create_pipeline` transaction rolls back | **FAIL** — ACL covered for Output CRUD only. `create_pipeline` transaction does not exist; no rollback test. `parentStepId`, step-DELETE splice report, capabilities, preview, validate-expression, shapes-expand envelope: no routes, no specs-as-tests. |
| 2 | Metric Output over `sum`/`avg` binds (HEL-895/638); `select`-produced numeric column bindable (HEL-644); bad slot name → 400 with slot list (HEL-892) | **FAIL** — none implemented. Nothing to bind against (no capabilities-at-node). |
| 3 | Enumerate every field-type-string producer by grep and assert canonical values (HEL-895 AC 5) | **FAIL** — not attempted. |
| 4 | `DELETE /api/outputs/:id` lists removed placements; panels gone | **PASS** — implemented and tested end-to-end (`OutputRoutesSpec`, two real placements, both asserted gone via `findByIdInternal`). |
| 5 | `GET /api/types/*`, `/api/metrics/*`, `/api/panels/bound`, `/api/panels/:id/query` return 404 | **PARTIAL** — verified by my own grep that `ApiRoutes.scala` retains only two explanatory HEL-904 comments and no live route; but task 4.1's required *route test* asserting 404 was not written. No code change was needed; the assertion is still owed. |
| 6 | `GET /api/outputs/:id/assertion-status`; alert-rule create/read against `targetOutputId` | **FAIL** — route not implemented (task 2.5). |
| 7 | `check-schema-drift.mjs` green with proposal files untouched | **PASS** — verified independently: `check-schema-drift.mjs` green (64 schemas / 47 protocol files, 7 panel-type surfaces); `git diff --stat origin/main...HEAD` on `DashboardProposalService.scala` and `helio-mcp/src/tools/proposal.ts` is empty; the only `proposal`-matching path in the whole diff is this change's own `proposal.md`. The P1.3/P1.4 split is clean. |
| 8 | `schemas/` + `openspec/` + `check:spec-structure` + selftest green; no `@deprecated`/alias/shim | **PASS** — verified independently (below). |
| 9 | `PipelineAnalyzeService` per-node (trunk + tail) schema projection, exercised by `capabilities?stepId=` | **FAIL** — not implemented (task 3.3). This is the HEL-905 task 6.4 handoff and the hard blocker for AC 1/2/3. |

Net: **3 of 9 AC met, 1 partial, 5 failed.**

Other Phase-1 findings:

1. **Scope narrowing is disclosed, not silent** — `execution-progress.md`, `files-modified.md`
   and `tasks.md` all enumerate the deferrals accurately. I cross-checked each "NOT
   implemented" claim against the diff and found no case where the executor claimed less
   than it did, and (with the two exceptions below) no case where it claimed more.
2. **Task 2.4 overclaims.** tasks.md says `GET /api/outputs/:id/panels` is "implemented and
   tested (via `listPanels`/cascade-delete test)". The route is implemented
   (`OutputRoutes.scala:71-76`), but no test issues `GET /outputs/:id/panels` — the
   cascade test exercises `DELETE`, which reaches `panelRepo.deleteByOutputIdInternal`, a
   different repo method than `findByOutputIdInternal`. The GET route and its ACL are
   entirely uncovered.
3. **Task 1.1 partial-marking is honest** but the checkbox is `[x]`; two of the five schemas
   the ticket names (`output-capabilities-response`, `preview-outputs-response`) are absent.
   The inline note says so, so this is a bookkeeping nit rather than a misrepresentation.
4. **Planning artifacts vs. implementation:** the change dir carries spec deltas for
   capabilities, preview, validate-expression, create-pipeline, pipeline-list, data-source
   persistence and dashboard-panel-layouts — all describing behavior not yet implemented.
   That is acceptable for a mid-flight (unarchived) change, but the change cannot be
   archived until code catches up; flagging so it is not forgotten at P1.7.
5. **No scope creep.** Every file in the diff is within the ticket's stated surface.
   `ApiRoutes.scala` gains only wiring; `PanelRepository`/`OutputRepository` gain only
   additive methods.

## Phase 2: Code Review — PASS

All gates re-run by me in this worktree (fresh evidence; the executor's report was not
relied on):

- `cd backend && sbt -batch 'set Test/parallelExecution := false' test` → **`Tests: succeeded 3400, failed 0` / `All tests passed` / exit 0.** All 9 `OutputRoutesSpec` cases green.
  (First invocation from the repo root failed with "doesn't appear to be an sbt project" —
  operator error on my part, not a code issue; re-run from `backend/`.)
- `node scripts/check-schema-drift.mjs` → in sync, 64 schemas / 47 protocol files.
- `npm run check:schemas` → green.
- `npm run check:spec-structure` → 338 canonical specs, 0 issues.
- `npm run check:openspec` → `openspec/ is clean`.
- `node scripts/check-scala-quality.mjs` → **clean** (134 pre-existing soft file-size
  warnings; none of them in files this diff touches).
- Frontend gates: not run — **zero `frontend/**` files in the diff**, correctly.

### ACL bug fixes — verified real, not evidence-shaped

Both claimed fixes were checked against the specific failure modes this codebase has hit
before (inline copies, same-spec twins, ambient fixtures, dead mutation arms):

1. **`OutputRepository.updateOwned` RLS-blocked-write → 404** (`OutputRepository.scala:170-197`).
   The fix is real: the method tracks `rowsAffected` from the combined transactional update
   and returns `None` when it is zero, instead of the previous unconditional sharing-aware
   `findById` re-read that made an RLS-dropped write look like a 200-with-unchanged-row.
   The guard is genuinely failable: `OutputRoutesSpec` "let the owner rename the Output, but
   404 for a non-owner grantee" patches as the *editor grantee* (who passes `outputs_select`
   but not `outputs_update`), asserts 404, **and** then asserts the persisted name is still
   `"new-name"` via `findByIdInternal`. Reverting the fix flips 404→200 and fails the test.
   Not an ambient fixture: the spec stands up its own embedded Postgres, creates a real
   `NOSUPERUSER NOCREATEDB NOCREATEROLE` role `helio_app_test_output_routes`, and routes the
   app pool through `SET ROLE` — so RLS actually evaluates rather than being bypassed
   (the exact vacuity trap recorded in `project_rls_testing_parity_gap.md`).
   One residual nit, not blocking: the `name.isEmpty && config.isEmpty` branch still falls
   back to a sharing-aware `findById`, so an empty-body `PATCH` from a non-owner grantee
   returns 200 rather than 404. Harmless (no write occurs) but inconsistent with the
   documented "non-owner sees 404" contract, and untested. Listed as a suggestion.
2. **`OutputService.delete` non-owner-grantee ACL gap** (`OutputService.scala:128-139`).
   Also real and correctly root-caused: `panelRepo.deleteByOutputIdInternal` and
   `outputRepo.deleteInternal` are both `withSystemContext` (ACL-bypassing) writes with no
   RLS backstop, so the prior sharing-aware-only check let an *editor grantee* delete another
   user's Output and cascade away their panels. The fix adds an explicit
   `output.ownerId != user.id → NotFound` arm before those privileged calls. Guarded by
   "404 for a non-owner grantee, leaving the Output intact", which asserts both the 404 and
   that the row survives — deleting the ownership arm turns that green test red.

Neither test is a same-spec twin of the code (no inlined re-implementation of the ACL rule),
neither depends on a superuser connection, and both assert persisted state rather than only
the response status. These are proper regression guards.

### Other code observations

- CONTRIBUTING.md compliance: no inline fully-qualified names anywhere in the diff
  (`OutputService` imports `PanelRepository`/`OutputRepository` and refers to them bare);
  no `@deprecated`, alias, or shim; comments explain *why* and are dereferenceable.
- `mergeConfig` (HEL-877) is a clean one-level-deep merge over a named
  `mergeableSubObjects` set — no magic strings scattered, no premature abstraction.
- The `Option`-instead-of-`Option[Option[T]]` simplification for `name`/`config` (task 2.3a)
  is correctly reasoned and explicitly flagged: neither field has a null-clearing variant,
  so the HEL-362/623 absent-vs-null idiom would be ceremony. Agreed.
- No dead code, no leftover TODO/FIXME, no untyped escape hatches, no `any`-equivalents.
- **[stale comment, non-blocking]** `OutputRoutes.scala:16-19` claims the class is "Mounted
  twice in `ApiRoutes.scala` (once under the `pipelines` prefix via `PipelineRoutes` sibling
  `outputsRoutes`, once under the top-level `outputs` prefix)". It is mounted **once**, as
  `concat(nestedRoutes, topLevelRoutes)` at `ApiRoutes.scala:729`. The comment describes a
  design that was not built.
- **[dead comment, non-blocking]** `ApiRoutes.scala:184-187` is a comment placeholder
  announcing `outputServiceOpt` will be "constructed below" — the actual construction is 40
  lines later with its own comment. One of the two should go.

## Phase 3: UI Review — N/A

Stated explicitly, per the ticket's own UI Gate section: this row is backend/contract only.
Confirmed by `git diff --name-only main...HEAD` — the diff touches only
`backend/src/**`, `schemas/outputs/**`, and `openspec/changes/**`. **Zero `frontend/**`
files, and no change to `backend/.../ApiRoutes.scala`'s response shapes for any
frontend-consumed route.** Dev servers were therefore not started and no browser checks
were run. This is a deliberate N/A, not a skipped gate.

## Overall: FAIL

Not because of defects in what shipped — that work is clean, well-tested and gate-green —
but because the ticket's acceptance criteria are 5-of-9 unmet and the largest single
deliverable (the `PipelineAnalyzeService` per-node projection, inherited from HEL-905 task
6.4) is absent, which in turn blocks capabilities-at-node and every HEL-895/638/644/892
regression AC that depends on it.

## Change Requests

Ordered as the critical path below; each is a task from `tasks.md` that must actually land.

1. **Implement per-node (trunk + every tail) schema projection in `PipelineAnalyzeService`**
   (task 3.3). Test must assert a tail's projection *differs* from the trunk's when the tail
   drops a column — a same-shape assertion proves nothing. This unblocks CRs 2, 3 and 8.
2. **Add `GET /api/pipelines/:id/capabilities?stepId=`** (task 3.4), evaluating
   `OutputBindingSpec` against CR 1's projection. Tests: metric/chart numeric-only case,
   unknown-`stepId` 404, and the owner/grantee/other ACL triad.
3. **Land the four absorbed-bug regression tests** (tasks 3.5/3.6, AC 2/3): metric Output
   over `sum`/`avg` binds (HEL-895/638); grep-enumerate *every* field-type-string producer
   (`aggResultType`, the `running_sum` case, and any others the grep finds) and assert each
   emits only the seven canonical `DataFieldType` values, one test per producer; a
   `select`-produced numeric column survives projection (HEL-644); an unknown or mis-typed
   `fieldMapping` slot name returns 400 naming the valid slots for that kind (HEL-892).
4. **Implement the single-call transactional `POST /api/pipelines`** (task 3.1): inline
   source | `sourceId`, `steps[]` with `parentStepId`, `outputs[]`, one Slick transaction.
   Rollback tests for a failing step *and* a failing Output (AC 1). Plus task 3.2
   (`parentStepId` on step create; splice removed-placement count on step DELETE) and the
   schemas in task 1.2.
5. **Implement `GET /api/outputs/:id/assertion-status`** (task 2.5, AC 6), including the
   alert-rule create/read path against `targetOutputId`.
6. **Rewire `PublicDashboardRoutes.scala:51-56`** off `findLastRunAtByOutputDataTypeId` to
   `panel → output → pipeline.lastRunAt` (task 4.3), and **drop
   `outputDataTypeId`/`outputDataTypeName`** from the `PipelineRepository`/`PipelineService`
   create/list path (task 4.4) — the `pipeline-list-api` spec delta already in this change
   dir currently describes behavior the code does not have.
7. **Add the AC-5 404 route test** (task 4.1) asserting `GET /api/types/*`, `/api/metrics/*`,
   `/api/panels/bound` and `/api/panels/:id/query` are absent. No production change is
   needed (I verified by grep that `ApiRoutes.scala` holds only HEL-904 comments), but the
   AC asks for the assertion, and without it nothing stops a future re-mount.
8. **Remaining route/contract surface**: `GET /api/outputs/:id/rows` (task 2.4),
   `POST /api/pipelines/:id/preview` (3.7, with the "run state unchanged" assertion),
   `POST /api/pipelines/:id/validate-expression?stepId=` (3.9),
   `POST /api/pipeline-shapes/:id/expand` `{steps, outputs?}` envelope + `parentStepId`
   (3.8 — BREAKING, update every existing `PipelineShapeRoutes` test),
   `DataSource.inferredSchema` on `DataSourceResponse` (3.10 + schema 1.3), the decision-15
   server-owned panel layout append in the panel-insert transaction (2.7, with a rollback
   test), lean paginated `/api/outputs` + `/api/dashboards` (2.6), `config.format` for
   HEL-876 (2.3b), and the `output-capabilities-response`/`preview-outputs-response`
   schemas (rest of 1.1).
9. **Add an HTTP test for `GET /api/outputs/:id/panels`** and correct task 2.4's claim that
   it is already tested. Owner/grantee/other triad, like its siblings.
10. **Run the full HEL-910 sweep grep** (task 4.5) across every file the *completed* ticket
    touches, not just cycle 1's, and record out-of-scope hits for the PR body.

## Critical Path (ordered — what unblocks the most)

1. **CR 1 — `PipelineAnalyzeService` per-node projection.** Single highest-leverage item.
   It is a hard prerequisite for capabilities-at-node (CR 2), for three of the four absorbed
   bug ACs (CR 3), and for `validate-expression` (CR 8). Nothing downstream of it can be
   verified until it exists. It is also the HEL-905 handoff, so it is owed to P1.4 as well.
2. **CR 2 — capabilities-at-node route.** Immediately consumes CR 1 and is the vehicle AC 2
   and AC 9 are graded through.
3. **CR 3 — the four regression tests.** Closes AC 2 and AC 3 outright once CR 1/2 land.
4. **CR 4 — single-call `create_pipeline` + `parentStepId`.** Independent of CR 1-3 and the
   other large deliverable; closes the remaining half of AC 1. Could be worked in parallel
   with CR 1 if the cycle has room.
5. **CR 5 / CR 6 — assertion-status and the P1.1 breakage rewire.** CR 6 in particular
   should not slip further: `PublicDashboardRoutes` and the `pipeline-list-api` delta are
   currently inconsistent with shipped code, and P1.7 assumes this is done.
6. **CR 7 / CR 9 / CR 10 — cheap assertions and bookkeeping.** Low effort, close AC 5 and the
   tasks.md overclaim; do them alongside whatever else lands.
7. **CR 8 — remaining route/contract surface.** Largest by count, lowest per-item risk;
   most of it is mechanical once CR 1 and CR 4 exist.

## Non-blocking Suggestions

- `OutputRepository.updateOwned:194` — the `name.isEmpty && config.isEmpty` no-op branch
  returns a sharing-aware `findById`, so an empty-body `PATCH` from a non-owner grantee is a
  200 rather than the documented 404. Consider returning `None` (or short-circuiting to a
  `BadRequest("no fields to update")`) so the owner-only contract holds uniformly.
- `OutputRoutes.scala:16-19` — the "Mounted twice in `ApiRoutes.scala`" comment describes a
  design that was not built; it is mounted once via `concat`. Correct or delete.
- `ApiRoutes.scala:184-187` — placeholder comment announcing a construction that happens 40
  lines later with its own comment. Drop one of the two.
- `OutputRoutesSpec` is already 288 lines and will keep growing as CRs 1-9 add coverage;
  consider splitting per route family before it joins the 134-file soft-budget warning list.
