# HEL-1343: Retention pass can be starved by run-side shared lock; retry sooner when skipped

## Description

origin_kind: followup
origin_ticket: HEL-1333

HEL-1333 (8039c2fd) made the run-side payload trim take the HEL1272 advisory key as a **shared** try-lock, while
retention holds it as an exclusive try-lock. While any run holds the shared key, retention's try-lock fails. By then
`claim()` has already used up the interval, so the whole pass is skipped for an hour. The only effect is
over-retention, never a failure. On a busy instance it could keep happening.

Also noted:

* During a rolling deploy, old instances keep the unguarded trim until they are replaced.
* The regression test models retention as a single point delete. There is no separate test for the thin and age
  deletes under the guard.

## Acceptance Criteria

* When a pass is skipped because the lock is held, retry soon instead of waiting the full interval. Either don't
  consume the claim, or claim a short retry window. (Explain the choice.)
* Add a test where retention is skipped once and then succeeds within the short window.
* Add coverage of the thin and age deletes under the guard.

## Driver constraints (binding for this run)

* Keep HEL-1272's "a failing purge retries hourly, not every 30 s tick" property for genuine failures. A lock-held skip
  is not a failure.
* Prove the RLS/privileged-pool behaviour on the two-role setup, as HEL-1272 and HEL-1333 did.
* Code only — no Flyway migration (V117 would need an owner ruling).
* Do not edit `NodePayloadWiringSpec` (HEL-1334 running), `ci.yml`, `playwright.config.ts`, `.gitignore`.
* `nice -n 19 sbt testFull`, Bash timeout 600000, at most 2 workers; EmbeddedPostgres; no pkill/pgrep/killall.
