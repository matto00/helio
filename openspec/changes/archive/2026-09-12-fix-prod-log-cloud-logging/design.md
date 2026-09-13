## Context

See proposal.md - Why. Corrected findings from live evidence gathered via read-only `gcloud`
(round 2 — round 1's `LOG_FORMAT`-unset theory was REFUTED by the design-gate skeptic and is
now disproven directly, not just disputed):

1. `gcloud run services describe helio-backend --region=us-west1` shows `LOG_FORMAT=json` **is**
   set on the live service today. `.github/workflows/cd-backend.yml` (the actual deploy path)
   still never sets it explicitly in its `--update-env-vars` list, but that list is additive —
   it merges onto whatever `infra/deploy-backend.sh`'s one-time `--set-env-vars` run (which does
   set it) already put there, and Cloud Run env vars persist revision-to-revision. So
   `LOG_FORMAT` is live and correct today, coincidentally, not because CD sets it.
2. `gcloud logging read` against revision `helio-backend-00077-55c`'s `run.googleapis.com/stdout`
   log returns **exactly 13 entries, all plain-text `textPayload`, all from logback's own
   internal status/bootstrap machinery** (`Found logback-core version...` through
   `...configure() call lasted 361 milliseconds`), ending at `00:02:10,272`. **Zero** entries
   appear afterward on stdout — no JSON app/Flyway lines, ever, for this revision's whole
   lifetime (confirmed via an unbounded `--limit=1000` count = 13, not a `--limit` artifact).
3. `run.googleapis.com/stderr` for the same revision shows 4 lines: a `--add-opens` JVM warning,
   then an SLF4J replay warning: *"A number (1) of logging calls during the initialization phase
   have been intercepted and are now being replayed."* This is significant: it confirms SLF4J's
   own binding did buffer at least one early log call — but no replayed content, nor any of the
   several `logger.info` calls `Main.scala` makes synchronously during `guardianSetup` (CORS
   origins, cookie config) or asynchronously after (`HttpServer.start`'s `onComplete`), appear
   anywhere in stdout or stderr for this revision.
3a. The 13 stdout lines, verbatim (all `INFO`-level `StatusManager` entries except the two `WARN`s
   noted): `Found logback-core version 1.5.38` / `No custom configurators were discovered as a
   service.` / `Trying to configure with ch.qos.logback.classic.util.DefaultJoranConfigurator` /
   `Constructed configurator of type class ch.qos.logback.classic.util.DefaultJoranConfigurator`
   / `Could NOT find resource [logback-test.xml]` / `Found resource [logback.xml] at
   [jar:file:/app/helio-backend.jar!/logback.xml]` / `Scan attribute not set or set to
   unrecognized value.` / `value "INFO" substituted for "${LOG_LEVEL:-INFO}"` /
   **`WARN: The 'condition' attribute in <if> element is deprecated...`** / **`WARN: See also
   https://logback.qos.ch/codes.html#conditionAttributeDeprecation`** / `End of configuration.`
   / `Registering current configuration as safe fallback point` / `...configure() call lasted 361
   milliseconds. ExecutionStatus=DO_NOT_INVOKE_NEXT_IF_ANY`. Notably: the resource is found at
   `jar:file:/app/helio-backend.jar!/logback.xml` (confirms the jar's own packaged file is being
   read, not a shadowed dependency copy — for THIS revision at least; still worth confirming via
   Decision (b)'s diff, since round-2 build state may differ once other fixes land), and
   `ExecutionStatus=DO_NOT_INVOKE_NEXT_IF_ANY` is Joran's own normal "configuration succeeded,
   stop" signal — nothing here indicates the appender itself failed to attach. This is why the
   fix must be probe-confirmed rather than inferred from this status text alone: nothing in it
   is anomalous by itself, yet the appender demonstrably never emits anything afterward.
4. `run.googleapis.com/varlog/system` confirms the container's own STARTUP TCP probe succeeded
   ~10 seconds after logback finished configuring (`00:02:19` vs `00:02:10`) — the app did start
   and did become healthy; it just produced no logger-routed output while doing so.
5. **Conclusion**: the defect is not "JSON output not ingested" (the ticket's framing) or
   "LOG_FORMAT unset" (round 1's wrong theory) — it is that **the application's own logger
   output (via Pekko's `system.log` / SLF4J, INFO level, going through logback's configured
   root appender) never reaches stdout/stderr at all**, in prod, despite the appender wiring
   itself looking correct in `logback.xml`. Root cause is still open — see Decisions.

## Goals / Non-Goals

**Goals:**
- Probe-confirm, via local reproduction built from the real Dockerfile/image (not `sbt run`,
  and not a code-reading guess), why application-level logger calls never reach stdout/stderr
  in the containerized runtime, and fix that specific cause.
- Once fixed, demonstrate locally that a startup line and a Flyway line appear on stdout as
  well-formed single-line JSON with `severity` and `message` fields.
- Add `LOG_FORMAT=json` to `cd-backend.yml` explicitly as defense-in-depth/documentation (see
  Decisions) — this is NOT the root-cause fix; it closes a latent fragility (the CD workflow's
  behavior today depends on an untracked, historical, out-of-band env-var write it does not
  itself make or document).

**Non-Goals:**
- Deploying to prod, touching live Cloud Run config/env/secrets, or cutting a release (explicit
  scope limit — the driver verifies against a real deploy after the next release cut).
- Any change to log *content* (what gets logged) beyond what's needed to make the fix
  demonstrable — this is a pipe/wiring fix, not a logging-coverage expansion.
- Any database migration (none expected for this ticket; escalate if one turns out to be needed).

## Decisions

- **Reproduce against the real Dockerfile, with a real throwaway Postgres**, not `sbt run` and
  not env-var stubs: `docker build` the same `Dockerfile` CD builds, start a disposable local
  Postgres (e.g. `docker run postgres:16`), run the built image against it with the full set of
  required env vars (`DATABASE_URL`, `DB_USER`, `DB_PASSWORD`, `GOOGLE_CLIENT_ID`,
  `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`, `COOKIE_SECURE`, `CORS_ALLOWED_ORIGINS`,
  `LOG_FORMAT`), and read
  stdout/stderr directly. A missing real DB would make `Database.initApp`'s Flyway `migrate()`
  fail, hit `Main.scala`'s `guardianSetup` catch block, and `halt(1)` before any Flyway line
  could ever appear — silently reproducing a *different*, misleading "no Flyway output" symptom
  that isn't the one prod is actually exhibiting (prod's health check DID pass).
- **Run the image both with and without `LOG_FORMAT=json`** (not assuming which one reproduces
  the symptom) — round 1 wrongly assumed the unset case was prod's actual state; this round
  treats both as open until observed, and records whichever result actually matches prod's
  13-lines-then-silence signature.
- **Treat the fat-jar packaging as a live suspect, not just the `<if>` block — and inspect
  contents, not just filenames.** `backend/build.sbt`'s `assembly / assemblyMergeStrategy`
  (lines 82-90) is itself the concrete mechanism to check, not a hypothetical:
  `PathList("META-INF", "services", _*) => MergeStrategy.concat` **concatenates** every
  `META-INF/services/org.slf4j.spi.SLF4JServiceProvider` file found across all dependencies into
  one file — so `jar tf` alone will always show exactly one such file even when multiple
  providers are silently listed inside it (`jar tf` proves nothing here; round 2's REFUTE
  correctly caught this). Meanwhile the catch-all `case x => MergeStrategy.first` governs
  `logback.xml` itself — if any dependency (Spark 3.5.x/`log4j-core`, or another transitive dep)
  also bundles its own `logback.xml` or `log4j2.xml`/`log4j2.properties` on the classpath, "first"
  is classpath-order-dependent and could silently package a *different* `logback.xml` than
  `backend/src/main/resources/logback.xml`, or a same-named-but-different config, into the jar.
  Local reproduction must therefore inspect **content**, not just presence: (a) `unzip -p` (not
  `jar tf`) the built fat jar's `META-INF/services/org.slf4j.spi.SLF4JServiceProvider` and print
  every line — more than one line is the smoking gun; (b) `diff` the jar's packaged `logback.xml`
  against the source file at `backend/src/main/resources/logback.xml` — any difference means a
  dependency's config won; (c) scan the jar for any other `logback*.xml`/`log4j2.*` files that
  didn't survive the merge but indicate a competing config existed; (d) re-run the container with
  `-Dslf4j.internal.verbosity=DEBUG -Dlogback.debug=true` appended to `javaOptions` (or via
  `JAVA_TOOL_OPTIONS`) and capture which concrete logging backend SLF4J bound to and which
  config file logback's own Joran configurator reports loading — logback's `StatusManager`
  output (the same mechanism producing prod's 13 status lines) directly answers this when
  `logback.debug=true`; (e) capture the **exact text** of prod's 13 status lines (already fully
  transcribed in this design's Context section above) and re-check them for anything beyond
  routine INFO-level bootstrap narration — logback's `StatusManager` prints WARN/ERROR status
  entries inline with INFO ones, and prod's stdout sample already showed two WARN lines (the
  deprecated `<if condition>` attribute) plus one SLF4J replay notice; local reproduction must
  determine whether debug-level status (enabled via (d)) surfaces a further WARN/ERROR that
  prod's default (non-debug) status level suppressed.
- **Fix whatever the reproduction evidence supports** in `logback.xml`, `build.sbt`'s assembly
  merge strategy, or `application.conf`, rather than pre-committing to one of the above — this
  design intentionally does not guess further; Execution's task list requires the local
  reproduction step to run and produce a concrete, cited finding before any code changes.
- **Add `LOG_FORMAT=json` to `cd-backend.yml` regardless of root cause**, as a separate,
  independently-justified fix: relying on an out-of-band, undocumented env-var write from a
  script that "does NOT reach Cloud Run" (per that script's own comment) for a var the actual
  deploy path depends on is real, live fragility — the next full service recreation or a
  `--set-env-vars` (replacing, not merging) call elsewhere would silently drop it. This is
  explicitly scoped as hardening/documentation, not the fix for the reported symptom.

## Risks / Trade-offs

- [Local Docker repro may not perfectly reproduce Cloud Run's exact log-scraping/ingestion
  pipeline or JVM/container environment] → Mitigate by using the same Dockerfile and by
  asserting only what's controllable and observable locally (stdout content, jar contents);
  state plainly in the PR/ticket that real Cloud Logging ingestion is a separate, still-open
  verification step for the driver.
- [The real defect could be something not enumerated above, e.g. a Pekko logging-adapter startup
  race independent of SLF4J/logback entirely] → Mitigate by keeping task 1.6 open-ended
  ("probe-confirm the cause" rather than "confirm cause X"), so Execution is not forced to
  contort evidence to fit a pre-written theory.

## Gate-Chain Implications Checklist

Not applicable — this change does not touch `.husky/**` or any script invoked by a
pre-commit hook.

## Migration Plan

No schema migration. Rollout is via the ordinary release/tag process already in place
(`.github/workflows/cd-backend.yml`) — this change only adds one explicit env var there and
whatever logging-config fix the local reproduction supports. Rollback is a plain revert of both;
no data or schema is touched.

## Planner Notes

- Self-approved: using live read-only `gcloud logging read`/`gcloud run services describe`
  evidence to correct round 1's design before re-running the design gate, rather than leaving a
  disproven theory in the plan for Execution to discover was wrong.
- Self-approved: keeping the `cd-backend.yml` `LOG_FORMAT=json` addition in scope as
  hardening even though it is now confirmed not to be the reported symptom's root cause — the
  fragility it closes (the CD path's own env-var set not including a var it depends on) is real,
  independently worth fixing, and clearly labeled as such rather than presented as the fix.

## Execution round 2 (skeptic-final-1.md REFUTE, addressed post-implementation)

The final-gate skeptic REFUTEd the first implementation: the executor's `<if>`-removal fix
(`<property name="LOG_APPENDER" value="${LOG_FORMAT:-plain}" />` plus `<appender-ref
ref="${LOG_APPENDER}">`) correctly eliminated `<if>` from the appender-attachment path, but its
exact-string-match substitution regressed the pre-existing, still-binding
"Unrecognized value falls back to plain text" contract
(`openspec/specs/structured-json-logging/spec.md`, `CLAUDE.md`'s `LOG_FORMAT` row): any value
other than the literal string `json` (e.g. `JSON`, `Json`, a typo) resolved `LOG_APPENDER` to an
unresolvable appender name, which Logback treats the same as no appender at all — the very defect
class HEL-1128 exists to fix, just triggered by different `LOG_FORMAT` values.

**Fix**: added `backend/src/main/scala/com/helio/logging/LogFormatPropertyDefiner.scala`, a
Logback `PropertyDefiner` (`ch.qos.logback.core.PropertyDefinerBase`) that reads `LOG_FORMAT` from
`sys.env` and normalizes it case-insensitively to exactly `json` or `plain`. `logback.xml` now
computes `LOG_APPENDER` via `<define name="LOG_APPENDER"
class="com.helio.logging.LogFormatPropertyDefiner" />` instead of a plain `${...:-...}`
substitution. A `PropertyDefiner` runs as ordinary JVM code during Logback's property-resolution
phase — it is not a conditional-processing construct (`<if>`/`<condition>`), so this still
satisfies the confirmed root-cause fix (no conditional gates whether an appender is attached to the
root logger) while restoring the case-insensitive-fallback contract.

**Probe (real Docker image + real throwaway Postgres, same standard of evidence as round 1)**:
- `LOG_FORMAT=JSON` (uppercase) → structured JSON output on stdout, including
  `{"...,"message":"Helio backend listening on /[0:0:0:0:0:0:0:0]:8080","severity":"INFO",...}`.
  Confirms case-insensitive JSON selection now works.
- `LOG_FORMAT=garbage` (unrecognized value) → plain-text output on stdout, including
  `INFO ... Schema "public" is up to date. No migration necessary.` and
  `INFO ... Helio backend listening on /[0:0:0:0:0:0:0:0]:8080` — fallback to plain text, never
  silence. Confirms the regression is fixed.
- Both containers passed `/health` with HTTP 200.
- Regression check: re-ran the round-1 (regressed) `logback.xml` against the extended
  `docs/verify-backend-logging.sh`'s new `garbage` case — it fails exactly as expected ("no Flyway
  line", "no startup line" — silence), confirming the new check would have caught this before
  reaching the skeptic.

**Spec delta**: `skip_specs: true` removed from `.openspec.yaml`. The existing
"Startup emits no Logback config-nesting warning" requirement mandated the very `<if>`-wraps-`root`
structure that caused HEL-1128 (as a means of avoiding a cosmetic Logback startup warning); it is
replaced by "Appender selection uses no conditional-processing construct" in
`specs/structured-json-logging/spec.md`. The case-insensitive-fallback scenario's wording was
already mechanism-agnostic and required no change to its text — only the implementation was
violating it — but round-1's fix broke it in practice, so the spec now states it as an explicit
scenario alongside the new appender-attachment requirement (belt-and-suspenders against a future
regression of either).
