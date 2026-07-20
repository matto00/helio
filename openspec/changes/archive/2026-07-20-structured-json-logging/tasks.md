## 1. Backend dependencies

- [x] 1.1 Add `net.logstash.logback:logstash-logback-encoder` v7.4 (Jackson 2.15.2, matches the Spark-forced 2.15.4 pin) to `backend/build.sbt`
- [x] 1.2 Add `org.codehaus.janino:janino` (enables logback `<if>` conditional config; self-contained, no transitive deps)
- [x] 1.3 Run `sbt compile`; if 7.4 shows a logback linkage/API break at runtime later (task 2.6), fall back to encoder 8.0 and note it in design Decision #2

## 2. Backend Logback config

- [x] 2.1 In `logback.xml`, keep the existing plain `ConsoleAppender` but name it `plain`
- [x] 2.2 Add a `json` `ConsoleAppender` using `LogstashEncoder` (MDC included by default)
- [x] 2.3 Configure the `json` encoder `fieldNames` so the level maps to a top-level `severity` field for Cloud Logging
- [x] 2.4 In `<root>`, select the appender via `<if condition='p("LOG_FORMAT").equalsIgnoreCase("json")'><then><appender-ref ref="json"/></then><else><appender-ref ref="plain"/></else></if>`; keep `LOG_LEVEL` on the root level
- [x] 2.5 Confirm a typo/unrecognized `LOG_FORMAT` (e.g. `jsonn`) still yields plain text (never a dangling ref / no-appender root)
- [x] 2.6 RUNTIME verify: `sbt run` with `LOG_FORMAT` unset prints plain text; with `LOG_FORMAT=json` prints valid JSON lines and does NOT throw `NoSuchMethodError`/`NoClassDefFoundError` (the only signal that catches reflective-load linkage breaks)

## 3. Docs / deploy wiring

- [x] 3.1 Document `LOG_FORMAT` (values `plain`|`json`, default `plain`) in `CLAUDE.md` production env-var table
- [x] 3.2 Add `LOG_FORMAT` to the root `.env.example` Logging section (satisfies backend-env-config's "lists every env var")
- [x] 3.3 Set `LOG_FORMAT=json` in the backend deploy path (`infra/deploy-backend.sh` `--set-env-vars`)

## 4. Tests

- [x] 4.1 Add a test that drives the `json` appender / `LogstashEncoder` directly (e.g. `JoranConfigurator` on a test config or an encoder+`ListAppender`) and asserts the emitted line parses as JSON containing `severity` and an MDC field — avoid relying on process-level env flipping
- [x] 4.2 Add a test asserting the `plain` path produces the human-readable pattern (not JSON)
- [x] 4.3 Run `sbt test`; confirm the full suite passes
