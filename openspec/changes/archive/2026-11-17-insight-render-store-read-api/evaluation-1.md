## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed commit: `5b1b62bb23c4d7a6194b21a61815d1cd12954e02`. Diff base, resolved live: `fd7090bf6`. That is still the
merge-base after fetching `origin/main`, which has since moved to `36735a24a` (HEL-1739).

### Phase 1: Spec Review — FAIL

Most of the work matches the ticket and plan:

- All six acceptance criteria are implemented and tested:
  - A non-grantee gets the same 404 as an unknown id (byte-identical status and body).
  - The public schema and the live response carry no cost, model, token or run-id fields.
  - Deleting an Output cascades to its insight rows.
  - The read service holds no model client, and the shape guard is exact.
  - The live RLS check ran as `helio_app`.
  - The CLAUDE.md endpoint list is updated.
- Tasks 0.1–2.9 match the code, except task 2.6 (issue 2 below).
- No scope creep. The existing specs only gained the new required constructor argument.

Issues:

1. **Binding constraint C1 is violated by the migration number.** `workflow-state.md` C1 (not retired) now reads
   "Migration V145 (driver, after HEL-1739 merged V144); renumber to max+1 before merge if main >= 145". The
   `tasks.md` C1 line was also updated, but that edit is uncommitted. `origin/main`'s highest migration is now
   **V144** (`git ls-tree origin/main backend/src/main/resources/db/migration/`), and the branch still ships
   `V142__output_insights.sql`. Flyway has no outOfOrder, so V142 is below an applied V144 and would not apply.
2. **Task 2.6 is ticked, but the "insight-part failure = Failed" half is not covered.** `OutputInsightRetentionSpec`
   only checks that `purgeIfDue` still returns `Some` when the insight purge throws. That proves the error does not
   escape (M16), not that the failure counts in the next-due precedence.
3. **AC "Fix the stale ANTHROPIC_API_KEY row" is only partly met.** The new CLAUDE.md row lists the consumers as
   "the AI pipeline steps, `POST /api/authoring/dashboard` and the workspace assistant". It leaves out
   `POST /api/refinements`: `ApiRoutes.scala:778-786` builds a `ClaudeClient` for `RefinementService` from the same
   `ClaudeConfig.fromEnv()`. The old row was wrong, and the new one is wrong in a different way.

### Phase 2: Code Review — FAIL

Gates, re-run by me on `5b1b62bb2` in `WORKTREE_PATH`. Only backend, schema and doc files changed, so the frontend
gates do not apply.

- `nice -n 19 sbt -J-Xmx3g testFull`: ScalaTest's own totals are
  `Tests: succeeded 9767, failed 0, canceled 5, ignored 0, pending 0` / `All tests passed.`
  - The 5 canceled tests are the existing measure-only specs gated on `HELIO_MEASURE`.
  - All six new specs ran: OutputInsightRlsSpec, OutputInsightRetentionSpec, OutputInsightPublicRoutesSpec,
    OutputInsightRoutesSpec, OutputInsightReadServiceShapeSpec, and RlsPolicyGuardSpec with the new table.
  - Log: `/home/matt/Development/helio/.concertino/scratch/HEL-1742/eval-testfull.log`.
- These hook checks are all clean (soft warnings only):
  - `npm run check:schemas`: in sync, 147 checked.
  - `check:scala-quality`
  - `check:spec-structure`
  - `check:openspec`
  - `check:repo-integrity`
  - `check:no-credential-leak`
  - `check:test-temp-dir-hygiene`
  - `prettier --check` on the changed JSON and markdown files.

Code review results:

- **No model client can be reached from the read path.**
  - `OutputInsightReadService`'s constructor is exactly `(OutputRepository, OutputInsightRepository)(ExecutionContext)`.
  - `OutputRepository(ctx: DbContext, locks: PipelineDefinitionLocks)` and `OutputInsightRepository(ctx: DbContext)`
    are database-only. `DbContext` wraps two Slick databases.
  - In production, `ApiRoutes.scala:531-532` builds the service from `outputRepo = new OutputRepository(dbContext)`
    (`:260`) and `new OutputInsightRepository(dbContext)`.
  - The repository's reads are SELECT only. The only write is `insertAction` (a DBIO the read service never calls)
    and the retention DELETE.
  - The shape guard checks both the constructor parameter types (exact sequence) and the declared field types.
    Mutation M15 turns it red.
- **ACL.** The authenticated routes go through the sharing-aware `findById`. Unknown, inaccessible and non-insight
  Outputs all fold into one `NotFound`. The public route runs `authorizeResourceWithSharing` before the resolver,
  exactly like the public `history` route.
- **Allow-list.** The public response is a separate case class built field by field, not a filtered copy. The schema
  sets `additionalProperties: false` at every level.
- **SQL.** All values are bound. The tier arrays go through `SetParameter` and `createArrayOf`, so nothing is
  interpolated. `#$Columns` is a constant.
- **Retention.** The DELETE's tier COALESCE falls back to the strictest age for a tier missing from the map. The
  keep-newest-ok and keep-newest-attempt exceptions both compare on `(created_at, id)`.

Issues: Phase 1 issues 1 and 2 are code issues as well. Both are in the change requests below.

**On fail-first (C6), as the orchestrator asked.** `fail-first.md` admits the implementation came before the specs.
I accept mutation-red evidence as satisfying C6 for the 16 guards it covers, because the mutation record is genuine:

- The harness (`.concertino/scratch/HEL-1742/mut.py` + `t.sh`) asserts the original text is present, applies one
  substitution, runs `sbt testOnly`, and always restores the file in `finally`.
- I checked each mutation against the code and the assertion it claims to turn red:

| Mutation | Change | Assertion it turns red |
| --- | --- | --- |
| M1 | `findById` replaced by `findByIdInternal` (exists at `OutputRepository.scala:136`) | Stranger-vs-unknown 404 equality |
| M2 | Public dashboard directive removed | Private dashboard 404 and share-token pass |
| M3 | Cited `outputId` injected | Citation key set and leak marker |
| M4 | Kind guard removed | Non-insight 404 |
| M5 | `latestOk` replaced by `latestAttempt` | Render-vs-attempt test |
| M6 | `since` replaced by the epoch | `r1` appears in the `since=r2, limit=4` case |
| M7, M8 | Wiring removed in `ApiRoutes` | 8 and 4 route tests (the harness builds through `ApiRoutes`) |
| M9 | Keep-newest-ok exception removed | `newestOk` at 50 days deleted |
| M10 | Newer-row EXISTS removed | `skipped_budget` newest attempt deleted |
| M11 | Tier line removed | Strictest 30 days applies to everyone, so `betaKept` at 80 days is deleted |
| M12 | Cascade removed | Cascade test |
| M13 | Table removed from `rlsTables` | Catalog equality |
| M14 | FORCE RLS removed | `relforcerowsecurity` check |
| M16 | `recover` removed | Pass future fails |

The `|| insight == PartResult.Failed` term in `OutputHistoryRetentionService.runPass` has no failable test and no
mutation, so C6 is not met for that branch (CR 2). Some lower-risk tests also have no recorded red: require-auth, the
400 bounds, the CHECK-refusal test, the explicit-null test and the RLS spec's stranger-0 and insert cases. The 400
bounds test reuses `OutputHistoryQueryParsing`, and the RLS behavior is backed by M14 and the live transcript. I
record this as a gap, not a blocker.

**Live RLS transcript (`rls-live-check.md`) against design D9: matches.**

- One transaction applies V141 and V142 inside itself; the shared dev DB is at V140.
- It creates `helio_app NOLOGIN NOSUPERUSER NOBYPASSRLS` with the same grants `helio_app_test` gets.
- `pg_roles` shows `rolsuper f`, `rolbypassrls f`. After `SET LOCAL ROLE`, `current_user` is `helio_app` with
  bypassrls `f` and superuser `f`.
- The user context is set with `set_config('app.current_user_id', …, true)`, exactly as `DbContext.setUserVar` does.
- Row counts: owner 2, grantee 2, stranger 0, no context 0.
- A stranger INSERT is refused with "new row violates row-level security policy". An owner INSERT succeeds.
- After `ROLLBACK`: role count 0, `to_regclass` null, leftover users 0.
- The script in scratch (`rls-live.sql`) matches the transcript. Local only.

### Phase 3: UI Review — N/A

The trigger matched only through `schemas/outputs/*insight*.json` (three new response schemas). No `frontend/**`
file changed, and nothing under `frontend/src` references the new schemas or the `/insight` routes. The panel UI is
L5 (HEL-1744). There is no user-visible surface to exercise.

I deliberately did not start the dev servers. The shared dev DB's applied max is V140, so the backend would apply this
branch's unmerged migration to the shared DB. That migration must be renumbered (CR 1), and its Flyway checksum would
then poison every other lane (MISTAKES / shared-dev-DB Flyway collision hazard). The route behavior is covered by the
specs that build through `ApiRoutes`.

### Overall: FAIL

### Change Requests

1. **Renumber the migration to V145 and rebase (C1).**
   - Rebase onto `origin/main` (`36735a24a`, which contains V144) and `git mv` the file to
     `backend/src/main/resources/db/migration/V145__output_insights.sql`. The file body does not change.
   - Update every `V142` reference to `V145`:
     - CLAUDE.md, the `GET /api/outputs/:id/insight` bullet: "`output_insights` (V142, HEL-1742)".
     - `RlsPolicyGuardSpec.scala`, the comment "V142 — output_insights".
     - The `proposal.md`, `design.md` (D1/D8/D10) and `tasks.md` (1.1, 0.2) wording.
     - The `fail-first.md` and `rls-live-check.md` narrative. The transcript itself can stay, because the DDL body
       is identical; note the renumbering.
     - Any other hit from `grep -rn "V142" backend CLAUDE.md openspec/changes/insight-render-store-read-api schemas`.
   - Commit the already-edited `tasks.md` C1 line.
   - HEL-1739 touched the scheduler tick, so check that the rebased `OutputHistoryRetentionService`, `Main` and
     scheduler specs still compile.
   - Re-run `sbt testFull` and report ScalaTest's own totals.
2. **Pin the insight part's failure precedence (task 2.6, C6).**
   - Add a test to `OutputInsightRetentionSpec`, or to `OutputHistoryRetentionServiceSpec` beside "let a failure win
     over a lock-held payload part (full interval)" at ~line 220, using its counting stub.
   - The test: a failing insight purge combined with a history part that is lock-held or `MoreWork` keeps the next
     pass on the full `purgeInterval`. Concretely, `purgeIfDue` at `retryAt` (or at the next tick) runs nothing, and
     the pass runs again at `intervalAt`.
   - Record its red run in `mutations.md`, mutating `OutputHistoryRetentionService.scala` `runPass` from
     `|| insight == PartResult.Failed` to an empty string.
3. **Correct the ANTHROPIC_API_KEY consumer list.** In the CLAUDE.md `ANTHROPIC_API_KEY` row, add
   `POST /api/refinements` (`RefinementService`, `ApiRoutes.scala:778-786`) to "its consumers are …". Alternatively,
   reword it so it does not enumerate the consumers at all.

### Non-blocking Suggestions

- `backend/src/main/scala/com/helio/infrastructure/ai/ClaudeClient.scala:19-21` still quotes the removed CLAUDE.md
  text "no route consumes this yet" and says "No such route exists yet". It now cites a row that no longer says that.
  Update the comment in the same pass as CR 3.
- `OutputInsightPublicRoutesSpec` uses `"567"` and `"1234"` as leak markers, but `T0` is `now - 2d` truncated to
  millis and appears three times in the raw body (`renderedAt`, `date`, `capturedAt`). When its millisecond field is
  `567`, the test fails spuriously, about 1 run in 1000. Use markers that cannot occur in an ISO instant (for example
  token counts like `987654`), or a fixed `T0`.
- design.md D3 gives `latestOkFor(output): Future[Option[OutputInsightRecord]]`, but the code returns
  `Future[Option[Option[OutputInsightRecord]]]`. That is necessary to tell a non-insight kind apart from "no ok row".
  Update D3, or use a small ADT instead of the nested Option.
- The V142 header comment says "An ok row must carry markdown; every other status may not have any". The CHECK
  enforces only the first half, so the second half reads like a constraint that does not exist. Reword it before
  the file is renumbered, because the file is immutable once applied.
- The comment in the "apply since in SQL before limit" test is muddled. With newest-first ordering, an inclusive
  `since` and `limit` commute, so the test really pins "since is applied" (M6). Simplify the comment.
- `OutputRoutes.scala` is now 262 lines, crossing the 250-line soft budget (a scala-quality soft warning).
- The shape guard pins the direct collaborators only. If a model client were ever added to `OutputRepository`, it
  would not catch it. That is acceptable at this layer, but worth a sentence in the guard's scaladoc.
