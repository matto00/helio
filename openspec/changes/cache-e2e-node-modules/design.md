## Context

Evidence (run 39711300255, job 119610619080 `e2e-prod-build`): `~/.npm` cache HIT (`node-cache-Linux-x64-npm-4d15...`,
107 MB) at 02:52:31, then root `npm ci` "added 619 packages in 7m" (02:59:35), `npm --prefix frontend ci` 8 s, job
cancelled at 03:00:29 by `timeout-minutes: 8`. So the download cache the ticket offers as an alternative ("or `~/.npm`")
already exists (`actions/setup-node@v7` `cache: npm` in `.github/actions/e2e-setup/action.yml`) and did not bound the
install. The variance lives inside `npm ci` itself (network metadata / tarball fetches the cache did not cover, or
runner I/O); the only lever that removes it is not running `npm ci` at all.

`openspec/specs/ci-actions-cache-budget` already governs large caches: main-only, one-job saves; a janitor with an
explicit family allowlist; closed-PR cache deletion. The existing sbt caches show the pattern
(`actions/cache/restore@v6` everywhere, `actions/cache/save@v6` guarded by
`github.event_name == 'push' && github.ref == 'refs/heads/main' && <one job> && cache-hit != 'true'`).

For item 2: since HEL-1691, `scripts/e2e-prod-build.mjs` serves `vite preview` on DEV_PORT (not another port) and
refuses to start if DEV_PORT answers. The lane's backend start (`concertino.config.json` -> `start-servers.sh`) is
`PORT=$BACKEND_PORT CORS_ALLOWED_ORIGINS=http://localhost:$DEV_PORT sbt run`, so a preview on DEV_PORT already
matches the lane's CORS; the 7065 workaround in HEL-1632 came from DEV_PORT being occupied by the lane's dev server.
The real gap: freeing DEV_PORT requires `stop-servers.sh`, which stops the backend too, and there is no documented
backend-only start. `Main.scala` reads `PORT` (then `HELIO_HTTP_PORT`, default 8080) and `CORS_ALLOWED_ORIGINS`
(default `http://localhost:5173`). `scripts/e2e-backend.sh` (HEL-1288, used by the action) already starts `sbt --server
run` under `setsid` with a fail-fast health wait, but hardcodes `/tmp/backend.log`, `/tmp/backend.pgid` and health
port 8080, and passes neither `PORT` nor CORS. `stop-servers.sh` stops (1) process groups recorded in
`$(git rev-parse --absolute-git-dir)/concertino-servers/<label>.pid`, then (2) listeners on the ports (listener pid
only; the group only when the listener leads it).

## Goals / Non-Goals

**Goals:**
- e2e jobs skip both `npm ci` steps on an exact cache hit; install time on a hit is a cache restore, not `npm ci`.
- A lane runs `npm run e2e:prod-build` end to end with documented scripts, and stops everything via `stop-servers.sh`.
- CI behaviour of `e2e-backend.sh` byte-for-byte equivalent in effect (same port, origin, log path).

**Non-Goals:**
- Raising any `timeout-minutes` (owner call; not done here).
- Caching installs for non-e2e jobs (`ci.yml` lint/frontend/security jobs, `cd-frontend.yml`) — follow-up candidate.
- Changing the concertino-rendered `start-servers.sh`/`stop-servers.sh` (gitignored, upstream-owned; a backend-only
  mode there is a concertino follow-up candidate).
- Caching `~/.cache/ms-playwright` (HEL-1288 measured and dropped it).

## Decisions

**D1. Cache `node_modules`, not just `~/.npm`.** Paths `node_modules` and `frontend/node_modules`. Key
`e2e-node-modules-v1-${{ runner.os }}-${{ runner.arch }}-node${{ steps.<setup-node id>.outputs.node-version }}-${{ hashFiles('package-lock.json', 'frontend/package-lock.json') }}`.
No `restore-keys`: a partial `node_modules` from another lockfile must never be used without `npm ci`. The resolved
Node version is in the key because native/platform packages (esbuild, rollup) and `npm ci`'s layout can vary with Node;
a Node minor bump costs one miss. `v1` lets the key be invalidated deliberately. Alternative rejected: keeping only
`~/.npm` — refuted by the run above.

**D2. Skip both `npm ci` steps on an exact hit** (`if: steps.<restore id>.outputs.cache-hit != 'true'`). Both trees are
one entry, so either both are restored or neither. The setup-node `cache: npm` stays (it still speeds a miss).
`prepare: husky` not running on a hit is irrelevant in CI.

**D3. Save once, from main, from ci.yml `e2e` leg 1, immediately after install** — a new action input
`save-node-modules-cache` (default `"false"`); ci.yml `e2e` passes `${{ matrix.shard == 1 }}`; the save step runs only
when that input is `'true'` AND `github.event_name == 'push' && github.ref == 'refs/heads/main'` AND the restore missed.
`e2e-prod-build` and `e2e-slow.yml` only restore. Saving right after install (not as a post-job step) means a later
test failure does not prevent the save. Alternative rejected: saving from PR runs — violates
`ci-actions-cache-budget` and multiplies ~large entries per lockfile-changing (dependabot) PR.
Consequence: a PR's own runs (including this one) always miss until main has an entry; the hit-side evidence is
collected after merge (the merge's main run saves; a re-run / later runs hit).

**D4. Janitor allowlist** gains `{ name: "e2e-node-modules", re: /^e2e-node-modules-v\d+-/, keep: 1 }` plus a selftest
case. Closed-PR deletion needs nothing (no PR entries are written).

**D5. A separate, explicit lane subcommand: `scripts/e2e-backend.sh lane-start`. The CI subcommands `start` and
`wait` are left byte-for-byte unchanged** (skeptic design-1 CR1: a `CI`-unset trigger would fire from
`npm run selftest:ci-sbt`, whose harness runs `start` locally, and overwrite a real lane record). `lane-start`:
- requires `DEV_PORT` and `BACKEND_PORT` (fails with usage otherwise);
- resolves the git admin dir from the SCRIPT'S OWN repo root
  (`git -C "$(dirname "$0")/.." rev-parse --absolute-git-dir`), which is the worktree whose copy of the script runs and
  therefore the same dir `stop-servers.sh` computes from that worktree's WORKTREE_PATH (CR2); the README invokes the
  worktree's own `scripts/e2e-backend.sh`, so the two agree;
- refuses (non-zero, names the file and pid) if `<admin>/concertino-servers/backend.pid` exists and that pid is alive
  (`kill -0 <pid>`, signal 0 only) — a live `start-servers.sh` record is never overwritten; a stale record (dead pid)
  is replaced;
- refuses if `BACKEND_PORT` already answers `/health`;
- sets `PORT=$BACKEND_PORT`, `CORS_ALLOWED_ORIGINS=http://localhost:$DEV_PORT` (shell env wins over `.env` per
  `backend/project/DevEnv.scala`), `HEALTH_URL=http://localhost:$BACKEND_PORT/health`, and lane-local
  `BACKEND_LOG`/`BACKEND_PGIDFILE` under `<admin>/concertino-servers/` (never shared between worktrees, never committed);
- launches exactly as `start` does (`setsid sbt --server run`), writes the setsid PID (= PGID) to both the pgid file and
  `<admin>/concertino-servers/backend.pid`, then runs the existing `wait` logic (fail-fast) against those values.
So one documented command starts and health-waits a lane backend, and `stop-servers.sh` step 1 stops its whole group.
No new kill path: only signal-0 liveness probes. A selftest wired into an npm `selftest:*`/`check:*` script proves: `start` writes no `backend.pid`;
`lane-start` refuses a live record and replaces a dead one; `lane-start` without DEV_PORT/BACKEND_PORT fails. **The
selftest never touches the real git admin dir** (skeptic design-2 CR): it copies `scripts/e2e-backend.sh` and
`scripts/lib/ci-sbt-diag.sh` into a throwaway `git init` repo under its own tmp dir (same relative layout) and runs
the copy there, with a stub `SBT_CMD`; no admin-dir override env var is added. Its own evidence includes the real
worktree's `concertino-servers/backend.pid` being byte-identical (or still absent) before and after a selftest run
with lane servers up. Implementation note: `lane-start` sets its env, `mkdir -p`s `concertino-servers`, then reuses
the unchanged code paths (e.g. `"$0" start` then `exec "$0" wait`) so `start`/`wait` stay byte-identical. Alternatives rejected: an env
flag on `start` (easy to set by accident, CI path no longer untouched); a new helio `lane-backend.sh` duplicating the
fail-fast wait; making `e2e-prod-build.mjs` own the backend lifecycle.

Thin-client hazard (CR4): the lane's normal backend is `start-servers.sh`'s `sbt run` (sbt 2 thin client), which may
leave a background sbt server after `stop-servers.sh`; that server could block or be reused by `sbt --server run`.
The executor MUST test the sequence starting from a `start-servers.sh` state. If a lingering sbt server interferes, the
fix must be expressible with documented scripts only (e.g. a documented `sbt shutdown`/`sbtn shutdown` in the backend
dir), otherwise escalate — never a pattern kill.

**D6. Document the in-lane sequence** in `e2e/README.md` (`@prod-build` section) and the `e2e-prod-build.mjs` header:
```
scripts/concertino/stop-servers.sh "$WORKTREE_PATH" "$DEV_PORT" "$BACKEND_PORT"
DEV_PORT=<dev> BACKEND_PORT=<backend> scripts/e2e-backend.sh lane-start
DEV_PORT=<dev> BACKEND_PORT=<backend> npm run e2e:prod-build
scripts/concertino/stop-servers.sh "$WORKTREE_PATH" "$DEV_PORT" "$BACKEND_PORT"
scripts/concertino/start-servers.sh "$WORKTREE_PATH" "$DEV_PORT" "$BACKEND_PORT"   # resume ordinary lane work
```

## Measurement plan

- Before: per-job durations of the two `npm ci` steps in the e2e jobs of the last >= 5 main/PR runs before merge
  (`gh run view --job <id> --log` timestamps), including run 39711300255's 7 m outlier.
- Local: `du -sh node_modules frontend/node_modules` to size the entry against the 10 GB repo budget.
- Pre-merge (this PR): the miss path — both `npm ci` steps still run on a miss, no PR-scoped `e2e-node-modules-*`
  entry is written (`gh cache list --ref refs/pull/<N>/merge`), and the save step is skipped. The PR body states AC1's
  hit side is unproven at merge (constraint C1) and that a lockfile-changing PR still runs `npm ci` under the
  unchanged 8-minute timeout.
- After (owner: the orchestrator, before hand-back): the merge's main push run (miss + one save, record entry size via `gh cache list`), then >= 5 runs that
  restore it (main re-run + later PR/main runs): restore-step duration and confirmation both `npm ci` steps were
  skipped.
- Lane: one verbatim README-sequence run, output captured, plus post-stop process-group check.

## Risks / Trade-offs

- Entry size (est. several hundred MB uncompressed) adds to the 10 GB budget -> keep: 1 in the janitor; measured
  after merge.
- A corrupted/partial restore would skip `npm ci` -> exact-key only; actions/cache verifies the archive; a later
  failing step surfaces it and the `v1` prefix allows invalidation.
- Pre-merge CI cannot show a hit (D3) -> evidence for the hit side is post-merge; stated in the PR body.
- `e2e-backend.sh` is also the CI path -> D5 leaves `start`/`wait` untouched; `check-ci-sbt-no-pattern-kill` and
  `npm run selftest:ci-sbt` must pass.
- On a hit, setup-node's `~/.npm` restore still costs ~3 s for nothing; accepted (it still helps a miss).
- Coupling to `stop-servers.sh`'s pidfile convention (`concertino-servers/backend.pid`) -> documented in the script,
  follow-up candidate to upstream a backend-only start into concertino.

## Gate-Chain Implications Checklist

Not applicable: no `.husky/**` file and no script `.husky/pre-commit` invokes is changed.
