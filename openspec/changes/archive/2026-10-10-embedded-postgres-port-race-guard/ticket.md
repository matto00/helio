# HEL-1445: CI flake: OutputHistoryPayloadsAvailableSpec aborts with role "helio_app_test_output_history" already exists (shared OutputHistoryApiHarness role name)

## Description

Origin: HEL-1385's PR matto00/helio#891 CI. `OutputHistoryPayloadsAvailableSpec` aborted with `role "helio_app_test_output_history" already exists`; a re-run passed. The role is created by the shared `OutputHistoryApiHarness` under a fixed name. CREATE ROLE is cluster-wide in Postgres, so suites sharing an embedded cluster, or a role left over from an aborted run, collide.

Original acceptance:

* Root-cause with a probe (systematic-debugging law): reproduce by running two harness users concurrently, or by leaving a role behind.
* Fix: per-suite or per-run unique role names, or `CREATE ROLE IF NOT EXISTS`-equivalent DO-block idempotence plus correct DROP in cleanup. Make sure the RLS semantics the harness tests are unchanged.
* Red then green; a loop run stays green (under `nice -n 19`, ≤4 workers).
  Also seen once in the same PR's CI: e2e `hel1028-layout-undo-redo-visual-revert.spec.ts:252` "panel has no bounding box" (passed on re-run). Note it here if it recurs, or file it separately.

## Premise validation and owner ruling (restated scope)

Premise validation (`.concertino/runs/HEL-1445/evidence/premise-validation.md`) refuted the stated root cause. Nothing shares a cluster by design: every `EmbeddedPostgres.builder()...start()` runs a fresh initdb, and a role cannot survive into a new cluster. The real cause, read from PR #891's CI log (run 37969918401 attempt 1, job `backend (2)`), is a port race in zonky embedded-postgres 2.0.7:

1. `detectPort()` binds `ServerSocket(0)`, closes it, and only then starts the postmaster on that port (a TOCTOU window).
2. A postmaster that loses the port (`could not bind ... Address already in use` / `FATAL: could not create any TCP/IP sockets`) dies. zonky ignores pg_ctl's exit, and its readiness check only polls the port, so it **silently adopts whichever other cluster is listening there**.
3. The adopting suite then runs against another suite's database. That produced `role ... already exists` here (the ERROR was logged by the other cluster's postmaster), and `This connection has been closed` in **HEL-1470** (run 38024347503, job `backend (1)`, identical bind-failure signature) when the adopted cluster shut down.

Owner ruling (escalation answered via chat, `proceed-with-restated-scope`): fix the root cause, not the role name.

## Acceptance Criteria (restated, binding)

1. **One shared startup helper.** One helper starts embedded Postgres and verifies the server it reached is its **own** cluster (the server-reported `data_directory` against the helper's own instance data directory). On a mismatch it discards the attempt without stopping the foreign cluster and retries on a fresh port, bounded, failing loudly when attempts run out.
2. **All call sites migrated mechanically.** Move every `EmbeddedPostgres.builder()...start()` call site in `backend/src/test` onto the helper: 226 occurrences across 221 files (223 with `.setConnectConfig("stringtype","unspecified")`, 2 bare, 1 multi-line SSL). Make the migration with a script, and verify it with a script rather than by hand. Outside the helper and the guard, the diff is purely mechanical.
3. **Guard, red-first.** A guard test fails on any direct embedded-Postgres start outside the helper and names the file. Show it is red on a planted direct call before showing it green.
4. **Deterministic reproduction.** A test reproduces the port steal: start cluster A, then start a second instance pinned to A's port. Show that the OLD direct path silently attaches to A (its `data_directory` is A's) and that the helper does not (it ends on its own cluster, and A is still alive and untouched).
5. **RLS semantics unchanged.** Every role name, grant, `SET ROLE` and non-BYPASSRLS property stays byte-identical. Existing `IF NOT EXISTS` role workarounds are kept as-is. An existing RLS assertion (e.g. `assertAppPoolEnforcesRls`) must still go red when RLS is broken (mutation).
6. **Full-suite parity.** `testFull` produces identical per-suite results (suite set, test counts, pass/fail) before and after, plus the new tests. Judge by log, not exit code (HEL-1468).
7. **Loop proof.** A loop run under `nice -n 19` with ≤4 workers stays green, judged by log (`TESTS FAILED` / `*** FAILED` / `RUN ABORTED`).
8. **HEL-1470 becomes fixed-by.** Reference it in the PR body; the driver closes it on merge.
