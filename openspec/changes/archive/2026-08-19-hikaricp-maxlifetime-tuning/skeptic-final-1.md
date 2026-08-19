## Skeptic Report — final gate (round 1, skeptic-final-1.md)

### What I verified (with evidence)

**Diff is exactly what's claimed, nothing else**
- `git diff main...HEAD --stat`: only `backend/src/main/resources/application.conf`
  (31 insertions across two `maxLifetime` value changes + two comment blocks) plus
  `openspec/changes/hikaricp-maxlifetime-tuning/**` planning artifacts. No Scala
  source, no frontend, no schema files touched.
- Read the full diff and the full resulting file
  (`backend/src/main/resources/application.conf`, both `helio.db` and
  `helio.db.privileged` stanzas). Confirmed line-by-line: `maxLifetime` is the
  only value that changed (`60000` → `1800000` in both stanzas); `numThreads`,
  `maximumPoolSize=5`, `minimumIdle=2`, `idleTimeout=30000` are byte-identical
  to `main` on both pools. `git status` shows no other unstaged/untracked
  production files.

**HikariCP 5.1.0 source claims — re-extracted and re-verified independently (not trusting design-gate skeptic's or evaluator's prior extraction)**
- `HikariConfigMXBean.java:106-108` — `setMaxLifetime` javadoc verbatim: "even if
  recently used, it will be retired from the pool. An in-use connection will
  never be retired, only when it is idle will it be removed." Exact match.
- `HikariConfig.java:55` — `MAX_LIFETIME = MINUTES.toMillis(30)`. Exact.
- `HikariConfig.java:1044-1046` — sub-30s `maxLifetime` silently reset to the
  30-min default with a warning. Exact.
- `HikariConfig.java:1086` — `idleTimeout + SECONDS.toMillis(1) > maxLifetime &&
  maxLifetime > 0 && minIdle < maxPoolSize` disables `idleTimeout`. With the
  shipped values (`idleTimeout=30000`, `maxLifetime=1800000`), `31000 <<
  1,800,000`, so this condition is false and `idleTimeout` is **not** disabled —
  confirms the design.md/AC concern the user specifically asked me to check.
- `HikariPool.getConnection()` (`HikariPool.java:154-186`) — on every borrow, a
  connection idle longer than `aliveBypassWindowMs` gets an `isConnectionDead()`
  liveness check before being handed out. This directly substantiates design.md's
  stated risk mitigation ("HikariCP's connection test on borrow... already
  covers" mid-lifetime Cloud SQL restarts) — I checked this claim myself rather
  than accepting it on the design doc's word.

**One real inaccuracy I found that design-gate skeptic + evaluator both missed**
`application.conf`'s new comment (and `design.md`'s "Root-cause verified" section)
states the mechanism as: "HikariCP's housekeeper (30 s sweep) proactively retires
every *idle* pooled connection once it hits maxLifetime" — i.e., framing the 30s
`housekeepingPeriodMs` sweep as what performs `maxLifetime` eviction, with the
observed 60-90s error cadence explained as "landing at the first sweep depending
on sweep phase."

I read the actual eviction code path (`HikariPool.java:456-468`,
`createPoolEntry()`): `maxLifetime` eviction is **not** driven by the 30s
housekeeper sweep at all. Each physical connection gets its own dedicated
`MaxLifetimeTask`, scheduled via `houseKeepingExecutorService.schedule(...,
maxLifetime - variance, MILLISECONDS)` at connection-creation time, where
`variance` is a random jitter of up to 2.5% of `maxLifetime` (`HikariPool.java:465`,
comment: "2.5% variance ... to ensure there is no massive die-off"). This is a
precisely-scheduled per-connection task, independent of `housekeepingPeriodMs`
— the 30s housekeeper sweep only governs `idleTimeout` eviction and pool-state
logging (`HikariPool.java:797-810`), not `maxLifetime` eviction.

Practically: this does **not** change whether the fix is correct or safe —
raising `maxLifetime` from 60000→1,800,000 still cuts the forced-recycle cadence
by ~30x either way, and the core diagnosis (idle pooled connections get force-
recycled independent of actual use, on a cadence tied to `maxLifetime`) is still
right. But the specific "why 60-90s, not exactly 60s" narrative in the shipped
comment is not accurate to the real mechanism, and it's the kind of comment a
future on-call engineer will read verbatim during the next Cloud SQL incident.
Since this is a hotfix explicitly framed as "get the mechanism right before
changing the number," I'm flagging it as a specific, actionable finding (see
Change Requests) — not a blocker, since it doesn't affect the shipped value's
correctness or safety, which I verified independently through other means below.

**Live-boot verification (the check none of the prior 3 reviews actually ran)**
- Started the real backend against the shipped `application.conf` via
  `scripts/concertino/start-servers.sh ... 6180 9087 HEL-748`, confirmed
  `scripts/concertino/assert-phase.sh servers ...` → `PASS servers`.
- `curl http://localhost:9087/health` → `{"status":"ok"}`.
- `.concertino-backend.log`: both pools start clean —
  `helio.db - Starting...` / `Start completed.` and
  `helio.db.privileged - Starting...` / `Start completed.` — **no** HikariCP
  `WARN` lines (no "maxLifetime is less than 30000ms" reset warning, no
  "idleTimeout is close to or more than maxLifetime, disabling it" warning).
  This is direct evidence the shipped value doesn't trip any of HikariCP's
  internal config-validation safety nets, confirmed by actually loading
  `helio.db`/`helio.db.privileged` through `Database.scala`'s real
  `JdbcBackend.Database.forConfig(...)` path (not a test-only hand-built
  `HikariConfig`, which is what `DbContextSpec.scala` actually uses — confirmed
  via `grep` that no Scala test in the repo asserts against the `application.conf`
  pool values directly, so this live boot is the only check that actually
  exercises the real config file end-to-end).

**Other pool-consumer assumptions — checked, none found**
- `grep -rn "maxLifetime\|60000\|1800000"` across `backend/src` and the wider
  repo (excluding this change's own `openspec/changes/**`): zero hits outside
  `application.conf` itself. No test, doc, or other config references or
  depends on the old 60s value.
- `connectionInitSql = "SET ROLE helio_privileged"` on the privileged pool is a
  persistent per-physical-connection session setting (not `SET LOCAL`/
  transaction-scoped) — the file's own pre-existing comment confirms "persists
  for that physical connection until it is closed or recycled," so a
  longer-lived physical connection doesn't create staleness here; the role
  assignment doesn't need periodic refresh.
- `app.current_user_id` (used by `withUserContext`, per `DbContextSpec.scala`'s
  docstring) is `SET LOCAL`-scoped to each transaction, not connection-lifetime-
  scoped — unaffected by how long the underlying physical connection lives.
- No `HELIO_UPLOADS_*`/Spark/scheduler code path assumes short-lived DB
  connections.

**Gates re-run fresh by me, not trusted from the evaluator's report**
- `cd backend && sbt test` (own fresh run, own timing): `Tests: succeeded 3281,
  failed 0, canceled 0` / `All tests passed.` / `Total time: 148s`. Matches the
  evaluator's and executor's claimed count exactly.
- `npm run lint` → clean (zero-warnings policy, no output).
- `npm run format:check` → `All matched files use Prettier code style!`
- `npm run check:openspec` → fails exactly as expected/documented:
  `change "hikaricp-maxlifetime-tuning" is complete (6/6) but not archived` —
  this is the one hook the commit's `-n` bypass skipped, and the commit message
  (`git log -1 --format=%B 8ea2e5fe`) explicitly names it, explains why
  (archiving is a later orchestrator phase), and states every other hook ran
  clean — verified true by my own independent re-run of lint/format/tests.

**Acceptance criteria traced**
- AC1 ("raise maxLifetime substantially, e.g. 25-30 min, on both pools") →
  `application.conf:75,115` — both pools, `1800000` (30 min). Met.
- AC2 ("reasoning cross-checked against HikariCP's own documented behavior and
  Cloud SQL connector guidance before the number is changed") → largely met;
  the target-value reasoning (HikariCP's own 30-min default, `idleTimeout`
  non-interaction, connector cert-refresh independence) is solidly grounded and
  I re-verified each citation myself. The one gap is the mechanism-timing
  narrative described above — the "why 60-90s" explanation is wrong in detail,
  though it doesn't change the correctness of the number chosen. See Change
  Requests below for the specific, actionable fix.
- AC3 ("backend-only... standard sbt test + lint gates, no Playwright") → diff
  confirmed backend-config + openspec-planning only; no `frontend/**` touched.
  Met.
- AC4 ("post-deploy gcloud logging read verification... not blocking for PR
  merge") → correctly scoped out in `proposal.md`/`design.md` Non-Goals. Met.

### Verdict: CONFIRM

The shipped fix — raising `maxLifetime` from `60000` to `1800000` on both
`helio.db` and `helio.db.privileged`, touching nothing else — is correct, safe,
and matches every acceptance criterion. I independently re-derived (not just
re-read) the two safety-critical claims the user asked me to scrutinize: the
`idleTimeout`-disabling condition does not trigger at the shipped values, and
no other code/test/config in the repo depends on the old 60s value. I went a
step further than the prior three reviews by actually booting the real backend
against the shipped `application.conf` (none of executor/evaluator/design-skeptic
did this — `DbContextSpec.scala`'s test hand-builds its own `HikariConfig` and
never exercises the real file) and confirmed both pools start clean with no
HikariCP internal validation warnings. All gates re-run fresh by me match the
evaluator's claimed results exactly.

### Change Requests (non-blocking for this hotfix; recommend a same-day fast-follow, not a re-open of this PR)

1. **`backend/src/main/resources/application.conf:54-58` (and the mirrored
   comment at ~104-110) mischaracterizes the eviction mechanism.** It states
   HikariCP's "housekeeper (30 s sweep) proactively retires every *idle* pooled
   connection once it hits maxLifetime" and implies the 60-90s observed cadence
   comes from sweep-phase alignment. The actual mechanism
   (`HikariPool.java:456-468`, `createPoolEntry()`) is a dedicated
   `MaxLifetimeTask` scheduled per-connection at connection-creation time, firing
   at `maxLifetime` minus up to 2.5% random jitter — entirely decoupled from
   `housekeepingPeriodMs` (which only governs `idleTimeout` eviction, per
   `HikariPool.java:797-810`). Recommend correcting the comment (and the
   matching "Root-cause verified" section in `design.md`) to describe the
   per-connection scheduled-task mechanism instead of a periodic sweep, so a
   future on-call engineer debugging a similar Cloud SQL incident isn't misled
   about how `maxLifetime` actually fires. This does not change the correctness
   of the shipped `1800000` value or require reverting anything already merged.

### Non-blocking notes

1. Carried forward from `skeptic-design-1.md` / `evaluation-1.md`: the spec
   delta under `openspec/changes/hikaricp-maxlifetime-tuning/specs/` only
   rewrites `## MODIFIED Requirements`, not the canonical spec's `## Purpose`
   line ("...zero minimum idle, short idle and max-lifetime timeouts...").
   Post-archive this will read as stale/self-contradictory. Worth a one-line
   `## Purpose` override at archive time.
2. This worktree's `scripts/concertino/` is missing `next-report-number.sh`,
   `persist-evidence.sh`, and `emit-event.sh` (present in the main checkout).
   I worked around it the same way the design-gate skeptic and evaluator did —
   invoking the main checkout's copies with `cwd` set inside this worktree
   (both resolve paths via `git rev-parse`, not their own location, so this
   is safe). `start-servers.sh`/`assert-phase.sh` in this worktree also print a
   non-fatal `No such file or directory` for `emit-event.sh` internally but
   still complete and print correct `READY`/`PASS` results. Worth patching this
   worktree's setup so a future live cycle doesn't hit the same gap.
