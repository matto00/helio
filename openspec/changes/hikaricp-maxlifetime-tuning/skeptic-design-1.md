## Skeptic Report — design gate (round 0, skeptic-design-1.md)

### What I verified (with evidence)

**Current state (`application.conf`) matches what ticket.md/design.md describe as the incident config**
- `backend/src/main/resources/application.conf:57-61,90-94` — confirmed both `helio.db` and
  `helio.db.privileged` currently have `maximumPoolSize=5`, `minimumIdle=2`, `idleTimeout=30000`,
  `maxLifetime=60000`, and the stale in-file comment ("well within Cloud SQL's idle-connection
  timeout, preventing unexpected connection reset errors") that task 1.3 says to replace.
- `openspec/specs/hikaricp-pool-config/spec.md` — confirmed current canonical spec still says
  `minimum idle of 0` and `max lifetime of 60 000 ms`, i.e. the pre-existing `minimumIdle`
  doc-drift design.md calls out is real, not invented.

**Version chain claimed in design.md — verified exactly**
- `backend/build.sbt:98` → `"com.typesafe.slick" %% "slick-hikaricp" % "3.5.2"`.
- `backend/build.sbt:121` → `"com.google.cloud.sql" % "postgres-socket-factory" % "1.21.0"`.
- `slick-hikaricp_2.13-3.5.2.pom` (coursier cache) declares a direct dependency on
  `com.zaxxer:HikariCP:5.1.0` — confirms design.md's "HikariCP 5.1.0 transitive dependency" claim
  is not an assumption, it's the actual resolved/pinned version, and matches the single HikariCP
  jar coursier has cached (`HikariCP-5.1.0.jar`).

**HikariCP 5.1.0 source claims — extracted `HikariCP-5.1.0-sources.jar` and checked each citation directly, all exact:**
- `HikariConfigMXBean.java` `getMaxLifetime()` javadoc — the quoted text ("even if recently used"
  / "only when it is idle will it be removed") is a **verbatim, exact match** to the source.
- `HikariPool.java:66` — `private final long housekeepingPeriodMs = Long.getLong(..., SECONDS.toMillis(30));`
  — exact line, exact value (30s default sweep). No override of
  `com.zaxxer.hikari.housekeeping.periodMs` exists anywhere in `backend/src` (checked via grep),
  so the 30s default genuinely applies in this codebase.
- `HikariConfig.java:55` — `private static final long MAX_LIFETIME = MINUTES.toMillis(30);` —
  exact, confirms HikariCP's own default is 30 min, as claimed.
- `HikariConfig.java:1044-1046` — `if (maxLifetime != 0 && maxLifetime < SECONDS.toMillis(30)) { ... setting to default ...}`
  — exact line numbers, exact behavior (values under 30s get silently reset to the 30-min
  default with a warning).
- `HikariConfig.java:1086` — the `idleTimeout`-disabling condition
  (`idleTimeout + 1s > maxLifetime && maxLifetime > 0 && minIdle < maxPoolSize`) is exact
  (design.md's paraphrase drops the always-true `maxLifetime > 0` clause but that doesn't change
  the conclusion). With the proposed `idleTimeout=30000` / `maxLifetime=1800000`, `31000 <<
  1800000`, so this condition stays false and `idleTimeout` is correctly **not** disabled by the
  change — design.md's claim here checks out.

**Cloud SQL Java connector claims — extracted `jdbc-socket-factory-core-1.21.0-sources.jar`, verified:**
- `RefreshCalculator.java:31` — `static final Duration DEFAULT_REFRESH_BUFFER = Duration.ofMinutes(4);`
  — exact match to design.md's "4 minutes" claim.
- `DefaultConnectionInfoRepository.java:335-337` — javadoc: "Uses the Cloud SQL Admin API to
  create an ephemeral SSL certificate that is authenticated to connect the Cloud SQL instance
  **for up to 60 minutes**." — confirms the "~1hr validity window" claim (design.md didn't cite
  this file/line explicitly but the underlying fact is accurate).
- `Connector.java:46-47` — `private final ConcurrentHashMap<ConnectionConfig, ConnectionInfoCache> instances`,
  populated via `computeIfAbsent` (line 145) — confirms the connector caches ephemeral-cert
  material **per target instance**, refreshed on its own background schedule
  (`RefreshAheadStrategy`), and reused across separate physical JDBC connections. This is
  stronger direct evidence for design.md's central claim than what it cited: a new JDBC
  connection created by recycling a pooled connection does **not** trigger a fresh Cloud SQL
  Admin API call or a fresh cert fetch — it reuses the cached, independently-refreshed
  credential. Recycling the physical connection buys no credential-freshness benefit, exactly as
  claimed.

**Conclusion on the core technical argument:** every specific, checkable citation in design.md
(javadoc quotes, file:line references, default values) was verified against the actual vendored
source and is accurate, including line numbers. The causal chain — `minimumIdle=2` keeps 2
idle connections in the pool → the 30s housekeeper sweep retires any idle connection past
`maxLifetime` regardless of use → `maxLifetime=60000` forces a fresh TLS handshake on a ~60-90s
cadence independent of traffic → raising `maxLifetime` to HikariCP's own 30-min default cuts
that forced-recycle frequency ~30x without disabling `idleTimeout` or creating any known Cloud
SQL/connector-side staleness risk — is internally consistent and evidence-backed, not just
plausible-sounding. The choice of exactly 30 min (HikariCP's own documented default, within the
ticket's suggested 25-30 min range) is well-justified as "least arbitrary defensible value," not
asserted on faith.

**Acceptance criteria traced**
- AC1 (raise `maxLifetime` to 25-30 min on both pools) → `tasks.md` 1.1/1.2, `design.md`
  "Decision: Target value" — both pools, `1800000`. Covered.
- AC2 (reasoning cross-checked against HikariCP + connector behavior before changing the number)
  → `design.md` Decisions section, verified above. Covered, and the verification held up.
- AC3 (backend-only, `sbt test` + lint gates, no Playwright) → `proposal.md` Impact section and
  `tasks.md` 2.1/2.2 confirm; no `frontend/**` paths appear anywhere in the plan. Covered.
- AC4 (post-deploy `gcloud logging read` verification, explicitly non-blocking for merge) →
  `proposal.md` Non-goals and `design.md` Non-Goals both correctly scope this out of the PR gate,
  matching the ticket's own framing. Covered.

**Scope check** — `design.md`'s "Planner Notes" self-approves two additions beyond the literal
ticket text: (1) correcting the `minimumIdle` spec-doc drift alongside the `maxLifetime` delta,
and (2) picking exactly HikariCP's default over an arbitrary in-range number. Both are minor,
same-requirement-block, low-risk additions with explicit rationale — not scope creep that needs
a separate ticket.

### Verdict: CONFIRM

The technical reasoning is sound and, unusually for this kind of citation-heavy design doc, it
actually survives independent verification against the real vendored sources rather than just
reading persuasively. I found no fabricated or misattributed citation, no internal contradiction
between proposal/design/tasks/spec-delta, and no AC left uncovered.

### Non-blocking notes

1. **Spec delta doesn't touch the `## Purpose` line, which will still contradict the corrected
   Requirements after sync.** `openspec/specs/hikaricp-pool-config/spec.md`'s Purpose line reads
   "...zero minimum idle, short idle and max-lifetime timeouts..." The delta only rewrites the
   `## MODIFIED Requirements` bodies (correctly, to `minimumIdle=2`/`maxLifetime=1800000`), and
   the sync tooling (`sync-specs.js`: "Preserve scenarios/content not mentioned in the delta")
   will leave Purpose untouched. Post-archive, Purpose will say "zero minimum idle" (already
   wrong today, and this change had already decided to fix that exact wording elsewhere) and
   "short...max-lifetime timeouts" (now actively wrong once `maxLifetime` is 30 min) side-by-side
   with a Requirements section that correctly says 2 and 30 min. Since this change explicitly
   frames itself as fixing spec-doc drift, it would be worth adding one line to the delta (a
   `## Purpose` override, or a task-list item) so it doesn't reintroduce the same class of drift
   it's fixing elsewhere in the same file. Not blocking — doesn't affect the production fix,
   `application.conf`, or any test.
2. Task 1.3's phrasing ("Update the tuning comment block above both stanzas") is slightly
   ambiguous — there are two separate comment blocks in `application.conf` (a full explanatory
   one above `helio.db`, and a short one above `helio.db.privileged` that just says "see app
   pool's comment above"). Only the first contains the stale "connection reset errors" sentence
   that needs rewriting; the second's cross-reference continues to work as-is. Worth a word of
   clarification for the executor, but the file itself makes this obvious on inspection — not
   blocking.
3. **Process note (not a design defect):** this worktree's `scripts/concertino/` is missing
   `next-report-number.sh`, `persist-evidence.sh`, and `emit-event.sh` (present in the main
   checkout's `scripts/concertino/`, byte-identical siblings like `assert-phase.sh`/`cleanup.sh`
   are present here). I worked around it by invoking the main checkout's copies with cwd set
   inside this worktree (both scripts resolve paths via `git rev-parse`, not their own location,
   so this is safe and produced a correct `READY` result) rather than guessing a fallback
   filename. Flagging in case worktree setup for this ticket should be re-run/patched so a live
   execution/evaluation cycle doesn't hit the same gap without a fallback available.
