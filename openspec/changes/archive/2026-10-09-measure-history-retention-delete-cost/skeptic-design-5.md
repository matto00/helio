## Skeptic Report — design gate (round 5, skeptic-design-5.md)

Reviewed HEAD `023aa4bbe4144436c871cdd41d57c71f2a275bb8` (= origin/main). The only change on the branch is the untracked change dir.

### What I verified (with evidence)

- **Spawn-cwd guard.** `assert-cwd.sh` printed `READY ambient=/home/matt/Development/helio branch=task/measure-history-thinning-delete/HEL-1284`.
- **Round-4 CR1(a), fail-stop guard: applied and sound.**
  - D5 now requires the script to open with `\set ON_ERROR_STOP on` and then a `DO ... RAISE EXCEPTION` check on `current_database()`.
  - It also correctly rejects `\if`/`\quit`, because that path exits 0.
  - I reproduced this read-only in a scratchpad file: `\set ON_ERROR_STOP on`, the DO/RAISE guard, then `\echo MARKER_AFTER_GUARD`, run with `PGOPTIONS='-c default_transaction_read_only=on' psql -X -w -d helio -f`.
  - Output was `ERROR: refusing: helio`, the marker was absent, and psql exited with status 3. D5's claim ("ends psql with exit 3") is accurate.
- **Round-4 CR1(b), read-only refusal test: applied.** Task 1.2 and D5 require all of the following:
  - running against `helio` only under `default_transaction_read_only=on`;
  - a non-zero exit;
  - the post-guard marker absent;
  - `users`/`pipelines`/`output_snapshot_history` counts unchanged.
- **Round-4 CR1(c): applied.** C2 now states that the script runs against `helio` only for the read-only refusal test. The same text appears in workflow-state.md CONSTRAINTS.
- **Round-4 notes: applied.**
  - D5 states the measuring role: `matt`, superuser, so RLS is bypassed as with BYPASSRLS `helio_privileged`.
  - D2 states the payload size distribution.
  - The Risks section counts the SET NULL trigger time. I verified the FK at V116:62: `payload_id UUID NULL REFERENCES node_payload_history(id) ON DELETE SET NULL`.
  - D5 covers `TRUNCATE ... CASCADE` and the `pipeline_roots` parents. V99 references `pipeline_roots`.
  - The Risks section covers V120-after-V119 merge sequencing and `sbt shutdown`.
- **Migration numbering, re-checked after `git fetch`.** No ref under `refs/remotes/origin/*` carries V119 or later. The worktree's migrations end at V118, so V120 still matches the driver's assignment.
- **Carried-over checks from round 4.** These are still consistent with the current text, which I re-read in full:
  - the statement inventory against `OutputHistoryRepository.thinAndPurge` and `NodePayloadHistoryRepository.purge`;
  - D2 row arithmetic: free/beta/owner 455/515/790 rows per Output; scenarios S1 ≈ 0.49M, S2 ≈ 4.9M, S2-owner ≈ 7.9M, S3 ≈ 2.0M rows;
  - D1's `.env` avoidance via `sbt assembly` plus jshell Flyway;
  - AC coverage: AC1 → 2.1/2.2, AC2 → 3.x with C1, AC3 → 2.2/4.1 with D7.
- **No placeholders or TBDs. No contradictions** between proposal, design and tasks.

### Verdict: CONFIRM

The design is safe to execute and covers every acceptance criterion. The one safety defect left from round 4 (a guard that did not stop psql) is now fail-stop by construction. I reproduced that under a read-only session.

### Non-blocking notes

- If the committed script ever reconnects (`\c`) or is split into several files, each file or connection must re-run `\set ON_ERROR_STOP on` and the guard. Simplest is to keep it one file with no `\c`.
- Keep `DROP DATABASE helio_hel1284_scratch` out of the committed script. Run it as a separate, exact-name command from a session connected to another database. Task 4.2 already does this; just don't fold it into the script.
- Write the D4 rows-read versus deleted numbers, and the per-transaction lock hold times, into measurements.md as a table per scenario, so the final gate can check C1 mechanically.
- Measuring as superuser `matt` also bypasses `SET LOCAL ROLE` privilege checks. Plans are comparable, but say in the evidence that grant/ownership paths were not exercised. This matters for the D6 ownership assumption.
