## Standing Constraints

- [C1] NEVER read/cat/grep/source/print any .env file; no env-dumping commands; only scripts/concertino/.concertino.env may be read by scripts, never printed; never copy .env files or trees containing them.
- [C2] Quoted heredocs only (<<'EOF').
- [C3] No pkill/pgrep/killall; exact PIDs only; stop servers with stop-servers.sh; test residue deleted by exact id.
- [C4] jest 3 workers, Playwright 2 workers, sbt -J-Xmx3g, nice -n 19.
- [C5] Bash timeout 600000; sbt testFull in shards that fit; no background run past the tool timeout.
- [C6] Red first with mutations; run full spec files; commit the red run before implementation code.
- [C7] Scratch in .concertino/scratch/HEL-1795/; follow-up-relevant evidence in .concertino/runs/HEL-1795/evidence/.
- [C8] Lane-private DB helio_hel1795 for any server/e2e/jest-touching-DB run; any lane backend started with ANTHROPIC_API_KEY exported empty.
- [C9] No prod, release, concertino sync or MCP deploy; no claude.ai session link in commits.

## 1. Probe and red

- [x] 1.1 Probe the real path: confirm a later-added Output on a patch-set-created pipeline reaches no Phase-1 blocker today (no `PATCH_SET_STALE`/fingerprint pre-emption) and is deleted by the undo; confirm whether an editor can add a step to a shared pipeline; confirm the chosen legacy fallback (D2) with a test rather than a probe (the source answers it: all timestamps are JVM `Instant.now()`). Record results in `.concertino/runs/HEL-1795/evidence/probes.md`.
- [x] 1.2 Write the red spec on `helio_app_test` (asserting `rolbypassrls = false`): A applies a pipeline-create patch set, editor B adds an Output, A undoes, and the spec asserts the 409 + nothing changed. Run it, see it fail because B's Output is deleted, save the run output to `.concertino/runs/HEL-1795/evidence/red-run.txt`, and commit spec + evidence before any implementation.

## 2. Implementation

- [x] 2.1 Journal `createdChildren` (step and Output ids) on `pipeline` create edits at apply time via an `edit.index`-keyed accumulator (D2); optional field, default `None`; verify an old-shape journal row still parses (unit test), and that the `/apply` response for a pipeline create is unchanged in shape (no new key; the existing apply contract/schema test still passes).
- [x] 2.2 Extend the shared doomed computation (D1) and add the Output/step blocker with the excused set (D2, incl. legacy fallback) wired into `PatchSetUndoConflictCheck`'s guarded create arms; verify with the red spec turning green.
- [x] 2.3 Message per D3 (names readable Outputs, counts the rest, steps by op/position, no ids), sharing `describeBlocking`'s naming structure; verify with message tests.
- [x] 2.4 Extend `ifStillUnbound`'s Phase-2 re-check (D4) with a fixed-phrase count failure; verify with a test.

## 3. Coverage, mutations, surfaces

- [x] 3.1 Add the D5 scenario tests (same-user Output, later step, pipelineStep-create arm, end-to-end inline-create success, helper-level D2-point-1 test labelled unreachable via apply, combined step+Output+panel message, legacy rows, no-ids message, Phase-2 phrase, a route-level 409) and run each touched spec file in full.
- [x] 3.2 Mutation runs (drop blocker, drop `createdChildren` excusal -> the end-to-end inline-only success case goes red, break legacy fallback) each turn a named test red; record in `.concertino/runs/HEL-1795/evidence/mutations.md`.
- [x] 3.3 Re-read the REST route, helio-mcp `undo_patch_set` description and the web undo-refusal toast; record whether "the whole undo is refused" still holds (change wording only if plainly false).
- [x] 3.4 Run the backend patch-set/pipeline spec shards and frontend gates per the pre-commit hook, under C4/C5; commit.
