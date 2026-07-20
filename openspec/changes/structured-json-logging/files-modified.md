# Files modified — structured-json-logging (HEL-115)

- `backend/build.sbt` — add `net.logstash.logback:logstash-logback-encoder` 7.4 (Jackson 2.15.2, matches the Spark-forced 2.15.4 pin) and `org.codehaus.janino:janino` 3.1.12 (enables logback `<if>` conditional config).
- `backend/src/main/resources/logback.xml` — rename the existing plain `ConsoleAppender` to `plain`; add a `json` `ConsoleAppender` using `LogstashEncoder` (MDC included) with the level field mapped to a top-level `severity` field; select the root appender via `<if condition='p("LOG_FORMAT").equalsIgnoreCase("json")'>` (json/else plain); keep `LOG_LEVEL` on the root level.
- `backend/src/test/scala/com/helio/infrastructure/StructuredJsonLoggingSpec.scala` — new test: drives the `LogstashEncoder` and plain `PatternLayoutEncoder` directly (no process-env flipping), asserting JSON output parses and contains `severity` + MDC fields + standard fields, and the plain path is not JSON.
- `CLAUDE.md` — document `LOG_FORMAT` (values `plain`|`json`, default `plain`) in the production env-var table.
- `.env.example` — add `LOG_FORMAT` to the Logging section.
- `infra/deploy-backend.sh` — set `LOG_FORMAT=json` in the Cloud Run `--set-env-vars` so production emits structured JSON.

## Runtime verification (design Decision #2 — reflective-load linkage)

Encoder version settled on: **7.4** (no fallback to 8.0 needed).

Started the backend with `LOG_FORMAT=json` (`PORT=8195 ... sbt run`). The real
`logback.xml` reflective load evaluated the `<if>` condition to `true`, attached
the `json` appender, and emitted valid JSON log lines with a top-level `severity`
field — with **zero** `NoSuchMethodError`/`NoClassDefFoundError`/`ClassNotFoundException`.
A representative line (sbt `[info]` prefix stripped) parsed cleanly via `json.loads`:

```
{"@timestamp":"2026-07-19T21:00:59.582...","@version":"1","message":"Slf4jLogger started","logger_name":"org.apache.pekko.event.slf4j.Slf4jLogger","thread_name":"helio-pekko.actor.default-dispatcher-3","severity":"INFO","level_value":20000}
```

## Observation (not a blocker) — logback `<if>`-in-`<root>` startup WARN

logback 1.5.18 emits a startup status WARN (`IfNestedWithinSecondPhaseElementSC`:
"`<if>` elements cannot be nested within an `<appender>`, `<logger>` or `<root>`
element") because the mandated structure nests `<if>` inside `<root>`. Despite the
warning logback still processes it correctly (condition evaluated, correct appender
attached, JSON emitted at runtime; plain attached when unset). The mandated
structure (design Decision #1, task 2.4) was honored as specified. A future cleanup
that eliminates the WARN — wrapping two `<root>` branches inside a top-level `<if>`
— would preserve identical typo-safe selection semantics; flagged as a spinoff
candidate rather than deviating from the adversarially-reviewed design here.
