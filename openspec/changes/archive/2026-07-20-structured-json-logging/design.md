## Context

The backend logs through SLF4J → Pekko-slf4j → Logback. `backend/src/main/resources/logback.xml` currently
defines a single `ConsoleAppender` (`STDOUT`) with a fixed human-readable pattern, and a root level driven by the
`LOG_LEVEL` env var (default `INFO`). In production the backend runs on Cloud Run; stdout is captured by Cloud
Logging. Plain text becomes an opaque `textPayload`, so `level`, `logger`, `thread`, and MDC context are not
queryable. Cloud Logging automatically promotes fields of a JSON line (notably `severity`) into structured,
filterable log entries. Jackson is already on the classpath and pinned to 2.15.4 via `dependencyOverrides`.

## Goals / Non-Goals

**Goals:**
- Emit structured JSON logs in production, human-readable plain text in dev, switchable via configuration only.
- Include MDC entries and a Cloud Logging-recognized `severity` field in the JSON payload.
- Preserve existing `LOG_LEVEL` behavior in both formats.

**Non-Goals:**
- No new instrumentation, MDC population, or changes to what is logged.
- No log-shipping infra beyond Cloud Logging's built-in JSON parsing.

## Decisions

**1. Encoder switch via Janino `<if>` equality on `LOG_FORMAT` (typo-safe).**
Define two top-level appenders — `plain` (existing pattern) and `json` (LogstashEncoder) — and select the root's
`<appender-ref>` with `<if condition='p("LOG_FORMAT").equalsIgnoreCase("json")'><then>…json…</then><else>…plain…</else></if>`.
Dev defaults to `plain` (env unset → `property()` returns `""` → condition false); production sets `LOG_FORMAT=json`.
- *Why not bare `<appender-ref ref="${LOG_FORMAT:-plain}"/>`:* `${…:-plain}` only substitutes the default when the var
  is **unset/empty**. A non-empty unrecognized value (typo, e.g. `LOG_FORMAT=jsonn`) resolves to a dangling `ref`, and
  Logback drops it → the root logger ends up with **no appender** and logs go nowhere. That silently loses all logs on
  a prod env-var typo and cannot satisfy the spec's "unrecognized value falls back to plain text" scenario.
- `<if>`/`<then>`/`<else>` needs Janino on the classpath (`org.codehaus.janino:janino`), a small self-contained lib
  (no transitive deps) that is logback's standard conditional-config engine. True equality means *any* non-`json` value
  (including typos) resolves to `plain` — never silence.
- *Alternative — two separate config files via `logback.configurationFile`:* duplicates config and drifts; rejected.
  Env var name `LOG_FORMAT` (values `plain`|`json`, default `plain`) is self-documenting and complements `LOG_LEVEL`.

**2. `net.logstash.logback:logstash-logback-encoder` — version chosen against the Jackson pin, runtime-verified.**
The build hard-pins Jackson to **2.15.4** via `dependencyOverrides` because Spark 3.5.5 bundles Jackson 2.15.x. The
encoder's Jackson must run against that pin:
- Published POMs: encoder **7.4** declares `jackson-databind 2.15.2` (matches the pin) + `logback-classic 1.3.7`;
  encoder **8.0** declares `jackson-databind 2.17.2` (two minors *ahead* of the pin) + `logback-classic 1.5.6`.
- **Primary choice: 7.4** — its Jackson exactly matches Spark's forced 2.15.x, eliminating the linkage-error risk on
  the Jackson axis. The only open risk is 7.4 running on our `logback-classic 1.5.18` (it declares 1.3.7); the
  `Encoder`/`CoreConstants` API surface it uses is stable across logback 1.3→1.5, but this MUST be confirmed at runtime.
- **Fallback: 8.0** — if 7.4 shows a logback linkage error at runtime, use 8.0 and accept its Jackson being run against
  the older-pinned 2.15.4, then re-run the same runtime check (the encoder uses jackson-core's stable streaming API).
- **Verification is a RUNTIME check, not `sbt compile`/`evicted`.** The encoder is instantiated *reflectively* by
  Logback from `logback.xml`, so compilation can never surface a Jackson/logback API break, and `dependencyOverrides`
  makes `evicted` report clean by silently downgrading. The only valid signal is: start the backend with
  `LOG_FORMAT=json`, emit a log line through the `json` appender, and assert it serializes to valid JSON with no
  `NoSuchMethodError`/`NoClassDefFoundError`. The `json` appender uses `net.logstash.logback.encoder.LogstashEncoder`,
  which includes MDC by default.

**3. Map log level onto Cloud Logging `severity`.**
Cloud Logging reads a top-level `severity` field. Configure the encoder's `<fieldNames>` to rename the level field to
`severity` (or add a `severity` field) so entries are classified. Logback's `WARN` differs from GCP's `WARNING`; this
is a minor cosmetic mismatch Cloud Logging tolerates and is documented as a known trade-off, not blocking.

**4. Document `LOG_FORMAT` as a production env var** in `CLAUDE.md` / deployment docs and set it in the deploy path
(`infra/deploy-backend.sh` or equivalent) so production actually emits JSON. Default-off keeps dev/test unchanged.

## Risks / Trade-offs

- [encoder Jackson vs pinned 2.15.4] → choose encoder 7.4 (Jackson 2.15.2 == pin); verify at RUNTIME that a JSON line
  serializes (compile/`evicted` cannot catch reflective-load linkage breaks). Fallback 8.0 if logback linkage fails.
- [encoder 7.4 declared against logback 1.3.7 while we run 1.5.18] → runtime check (emit + parse a JSON line) is the
  gate; fall back to 8.0 (declares logback 1.5.6) if a logback `NoSuchMethodError` appears.
- [Janino adds a dependency] → self-contained, no transitive deps; it is logback's standard `<if>` engine. Worth it to
  guarantee any non-`json` value (incl. typos) yields plain text instead of silently dropping all logs.
- [`WARN` vs GCP `WARNING`] → cosmetic; Cloud Logging still ingests the entry. Left as-is to avoid custom mappers.
- [Env var not set in prod → plain text in Cloud Logging] → mitigated by documenting + wiring `LOG_FORMAT=json` into
  the deploy script; the default is intentionally safe (plain) for local/dev/test.
- [Multi-line stack traces] → LogstashEncoder serializes stack traces into a single JSON string field, resolving the
  multi-line fragmentation that plain text suffers in Cloud Logging.

## Planner Notes

- Self-approved: adding `logstash-logback-encoder` (+ `janino` for conditional config) are standard, widely-used
  logging libraries (not novel external services) and stay within ticket scope, so no human escalation.
- Self-approved: env var name `LOG_FORMAT` and default `plain` chosen to mirror the existing `LOG_LEVEL` convention.
- `.env.example` reconciliation: `backend-env-config`'s "`.env.example` lists every supported env var" requirement is
  satisfied by *adding* `LOG_FORMAT` to the root `.env.example` (Logging section) — the requirement is about file
  content, not the spec text, so no MODIFIED delta to `backend-env-config` is needed. `LOG_FORMAT` is a
  logging-output concern owned by the new `structured-json-logging` capability; core runtime knobs stay in
  `backend-env-config`.
