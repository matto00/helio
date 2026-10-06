## Evaluation Report — Cycle 2 (evaluation-2.md)

**Commit reviewed:** `889b43984cb59c929c71a4177373daffcfaba028` (base `b16bfa1b3`, resolved live).

**Delta reviewed:** `41f33803a..889b43984`.

### Phase 1: Spec Review — PASS

Cycle-1 change requests:

1. **CR1 (JVM flags): resolved.**
   - `isolatedBackend.ts` `JAVA_OPTIONS` now holds 14 flags: the 13 project-level flags (`build.sbt:107-121`) plus the `sun.util.calendar` addendum. This set equals the Dockerfile ENTRYPOINT's `--add-opens` flags plus `sun.util.calendar`.
   - The doc comment now states where the list comes from.
   - evidence-probes.md 1.3 is corrected.
2. **CR2 (harness PID): resolved.**
   - Teardown now calls `stopPid(harness.pid, 10s, 5s)`. That function sends SIGTERM to the recorded PID, waits, then sends SIGKILL to the same PID.
   - If the PID is still alive afterwards, teardown pushes `harness pid N still running` into `failures`, which makes the exit non-zero. This matches the spec delta.
3. **CR3 (C3 wording): resolved.** design.md D3 "Port and identity" now says three things:
   - The listener-identity proof runs before any write, including register.
   - The psql user-row check is a second confirmation, run after register.
   - Register is itself a write.

Cycle-1 non-blocking suggestions were also applied: the C3 log fallback now matches `listening on /127.0.0.1:<port>`, a stale-jar warning was added, and the README pointer was fixed.

Constraint status:
- C1–C4 are still honoured.
- No forbidden or out-of-scope files are touched. `git diff --name-only` shows nothing under `backend/`, `frontend/`, `ci.yml`, `playwright.config.ts`, `.gitignore` or any `package-lock.json`.
- No dependency change.

### Phase 2: Code Review — PASS

Gates, re-run fresh in WORKTREE_PATH:

| Gate | Result |
| --- | --- |
| `npm run lint` | exit 0 |
| `npm run format:check` | exit 0 |
| `npm run check:helio-mcp-types` | exit 0 |
| `npx jest helio-mcp` | 39 suites / 375 tests pass |

Live run (one, after a fresh `npm run build` in helio-mcp; `nice -n 19 npm run verify:isolated`):
- **Exit code:** 0.
- **Resources:** DB `helio_verify_21724fa040a8`, JVM pid 208922 (port 35153), harness pid 209210.
- **Startup:** the backend booted with the 3 added flags, and the second scheduler tick was observed before register.
- **History read:** `points=30 sparkline=30`, then `VERIFY OK`.
- **Teardown:** the log shows `stopped harness pid 209210`, the bootstrap PAT revoked (401), the JVM stopped, the DB dropped, and `ISOLATED VERIFY OK (teardown confirmed)`.
- **Independent check:** `kill -0` reports no such process for both PIDs, and `dbExists` returns false.
- **Stale-jar warning:** no WARNING was printed. That is correct, because backend source is unchanged since the jar was built.

The refactor (`stopBackend` → `stopPid` + `stopBackend`) preserves behaviour. Nothing new was found in DRY, typing, error handling or dead code.

### Phase 3: UI Review — N/A

No UI-trigger paths changed.

### Overall: PASS

### Non-blocking Suggestions

- **Harness PID reuse:** `isolatedRun.ts` teardown calls `stopPid(harness.pid)` even after the harness has exited normally, and `stopPid` uses a raw `process.kill`.
  - The cycle-1 code used `ChildProcess.kill`, which Node turns into a no-op after exit.
  - In the new code, if the kernel reused that PID during teardown, a SIGTERM could reach an unrelated process. The odds are negligible, given default `pid_max` and the seconds-long window.
  - Fix: guard with `harness.exitCode === null && harness.signalCode === null` before `stopPid`. Then a normally-exited harness logs "already exited" rather than "stopped".
- **D3 stale phrase:** design.md D3 still says javaOptions are "exported from sbt and recorded VERBATIM". The Implementation Notes record that the sbt export printed nothing, so that phrase is stale.
