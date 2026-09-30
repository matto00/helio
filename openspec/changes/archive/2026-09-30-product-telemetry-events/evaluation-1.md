## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed HEAD 0a8e2896abb18971b9b57eb23b7150f29f79c5a0 against base fe124863.

### Phase 1: Spec Review — PASS
Issues: none blocking.
- All ACs addressed: allow-list rejection (registry + whole-batch 400, live-verified: unknown property -> 400, client `signup_completed` -> 400, no auth -> 401); RLS owner policy + FORCE; rollup/TTFD fixtures; purge with injected `now`; `track()` non-blocking; non-superuser harness.
- Google OAuth path (`AuthService.scala:207` `upsertGoogleUser`, `wasCreated`) does NOT record `signup_completed`. Ticket text and spec scope it to `AuthService.register` only, so this is in literal scope and not a FAIL. But it is an undocumented limitation: Google signups are missing from signups/day and excluded from TTFD (no signup row). Not mentioned in proposal/design/spec. See suggestion 1.
- Design deviation (purge exemption for `signup_completed`/`first_dashboard_rendered`) is documented in proposal/design/spec and called out; reasoning sound (TTFD + dedupe).
- Constraints C1-C4 honoured in the diff (no scripts/concertino edits; injected time; scratch harness).

### Phase 2: Code Review — PASS
Gates run fresh in WORKTREE_PATH (CLEAN_WORKTREE not set):
- `npm run lint` clean; `format:check` clean; `typecheck` clean; `npm --prefix frontend run build` OK.
- `npm test`: 388 suites / 4062 tests pass. No HEL-1215 flake seen.
- `sbt test`: 5020 tests, 0 failed, 0 aborted (incl. V113 applied in every harness).

Focus areas:
- V113 prod-role: `ProductTelemetryDbHarness` runs Flyway and the app pool as NOSUPERUSER NOBYPASSRLS table owner, with FORCE RLS, and the privileged pool via `SET ROLE helio_privileged` (BYPASSRLS). Repository spec asserts cross-user read isolation, refusal of a mismatched-user insert, cascade delete. Migration has explicit GRANTs to helio_privileged (no reliance on default privileges). Rollup tables carry no RLS by documented design (aggregates only, no user id). Sound.
- Purge exemption: `purgeAction` deletes `event <> ALL(exempt)`; tested that 91-day-old signup/first_dashboard rows survive. Rollup of uncovered days precedes delete and advances high-water mark; `rollupDayAction` refuses to recompute a covered+partly-purged day; WAU only written when window start is inside retention.
- Rollup idempotence/lock: delete-then-insert / ON CONFLICT upserts inside a single transaction under `pg_advisory_xact_lock`; "run twice unchanged" test present. Tick piggybacks on `PipelineSchedulerService.tick` (`telemetryWork` zipped in; tickAt swallows/logs failures; null-default keeps other fixtures compiling). `Main.scala` wires it.
- track() never blocks/throws: queued synchronously in try/catch, flush on timer/visibility/online, warn once, bounded queue 200; Live check: browser load as dev user produced no console errors. Live API check: register -> 202/400/400/202/202(dedupe)/401 and exactly one row each of signup_completed, first_dashboard_rendered, provenance_opened; test user deleted by exact id (cascade verified 0 rows remaining).
- Mutation-based red-first evidence: I did not re-run the executor's mutations. Judged by reading the tests: they assert hand-computed values (median 600, p90 28800, histogram, DAU/WAU 7/8, template buckets), CHECK==registry set equality, FORCE-RLS under a non-bypass role, and survive/deleted exemption rows, so they would catch the protected regressions; RLS tests are non-vacuous because the harness role is non-superuser.

### Phase 3: UI Review — PASS
Non-visual change (no markup/style). Servers started via canonical script. Dashboard loads without console errors; `PanelCardBody` hook is no-op for unauthenticated/public view (userId null) and for non-output/zero-row panels (wiring test covers). Responsive/a11y unaffected (no UI elements added).

### Overall: PASS

### Change Requests
none

### Non-blocking Suggestions
1. Google OAuth new-user creation (`AuthService.scala` ~207, `wasCreated`) emits no `signup_completed`, so signups/day and TTFD undercount Google users. Either file a follow-up ticket or add a one-line "known limitation" to design.md/spec so HEL-1211 consumers aren't misled.
2. `track.ts` localStorage queue is not user-scoped: events queued by user A then flushed after user B logs in are attributed to B; and `useFirstDashboardRendered` sets its flag immediately after `track()`, so a dropped (4xx) event is never re-emitted. Low impact; consider noting.
