# HEL-1333: Payload trim SET NULL cascade vs concurrent thinAndPurge: residual deadlock window

## Description

origin_kind: followup
origin_ticket: HEL-1276

HEL-1276's PR body (#780) discloses a residual deadlock window. During a run, the per-node payload trim deletes the
oldest excess `node_payload_history` row, which cascades `ON DELETE SET NULL` onto
`output_snapshot_history.payload_id`. At the same time, the hourly `thinAndPurge` (HEL-1272, privileged pool, HEL1272
advisory lock) may be deleting history points or payloads. If Postgres picks the run-side transaction as the deadlock
victim, that node fails and so does the run (D9: same transaction).

## Acceptance Criteria

- Reproduce it with a deterministic probe: force the interleave with two connections.
- Fix it with a consistent lock order. Options include making the run-side trim respect the HEL1272 advisory lock (for
  example a try-lock that skips the trim), or deferring the trim to the purge. Explain the choice.
- Add a test that is red without the fix.
- A run must never fail because of retention housekeeping.

## Driver constraints (this run)

- Prove the RLS behaviour on the two-role setup (helio_app_test NOSUPERUSER/no-BYPASSRLS + helio_privileged), as
  HEL-1272/HEL-1276 did; superuser-only proofs are vacuous.
- Prefer a code-only fix: a migration (V117) needs an owner ruling and parks overnight.
- HEL-1326 (parked) plans to touch `NodeSnapshotRepository` and the history schemas -- avoid both if possible; if
  `NodeSnapshotRepository.scala` must change, keep the HEL-1282 encoding-guard exemption table and selftest consistent.
- Do not touch `ci.yml`, `playwright.config.ts`, `.gitignore`. Use EmbeddedPostgres only, never the owner's account.
- `nice -n 19 sbt testFull`, Bash timeout 600000, at most 2 workers.
