## Skeptic Report — final gate (round 1)

Change: structured-json-logging (HEL-115) · commit 609db058 · backend/infra-only.
Every conclusion below is derived from ground truth I ran/read myself, not from the
executor or evaluator narratives (which I treated as claims).

### What I verified (with evidence)

**Diff scope** — `git diff --stat main...HEAD`: only build.sbt, logback.xml, the new
StructuredJsonLoggingSpec, CLAUDE.md, .env.example, infra/deploy-backend.sh, plus the
change's own openspec artifacts. Matches the proposal's stated impact; no scope drift,
no app-source/API/schema surface touched.

**scala-quality gate** — `node scripts/check-scala-quality.mjs` → `Scala code-quality
check: clean (46 soft warning(s))`, exit 0. The 46 are pre-existing file-size soft
warnings; none for the new 123-line test. No inline FQNs.

**Backend test** — `sbt testOnly com.helio.infrastructure.StructuredJsonLoggingSpec`
→ `Tests: succeeded 5, failed 0`. Note this spec drives the encoders *directly*; it
does NOT exercise the real logback.xml `<if>` selection — so I verified that
separately at runtime (below).

**Runtime verification through the REAL logback.xml** — I extracted the sbt
`runtime:fullClasspath` (confirmed it carries logback-classic 1.5.18,
logstash-logback-encoder 7.4, janino 3.1.12, and `backend/target/scala-2.13/classes`
whose logback.xml is byte-identical to the committed source — `diff` clean). I
compiled a small SLF4J probe (info+warn+error+MDC+exception) and ran it against that
classpath under four env values, capturing stdout:

- `LOG_FORMAT` unset → plain text (`21:14:28.332 INFO [main] com.helio.probe - ...`).
  Config log also shows `Attaching appender named [plain] to Logger[ROOT]`. The
  `<else>` branch fires — NOT a no-appender root.
- `LOG_FORMAT=json` → structured JSON, e.g.
  `{"@timestamp":"...","@version":"1","message":"PROBELINE info hello","logger_name":"com.helio.probe","thread_name":"main","severity":"INFO","level_value":20000,"requestId":"req-xyz-1"}`.
  Top-level `severity` (INFO/WARN/ERROR), MDC `requestId` present, `stack_trace`
  serialized as a single JSON string field, all standard fields present.
- `LOG_FORMAT=jsonn` (typo/unrecognized) → plain text. Fallback holds; logs are NOT
  silently dropped.
- `LOG_FORMAT=JSON` (uppercase) → JSON. `equalsIgnoreCase` confirmed.

**Reflective-load linkage risk (encoder 7.4 on logback 1.5.18)** — stderr of the
`LOG_FORMAT=json` run scanned for `NoSuchMethod|NoClassDefFound|ClassNotFound|Exception|ERROR in`
→ NONE. The encoder instantiates and serializes cleanly; the Jackson-2.15.4-pin choice
holds at runtime. No fallback to 8.0 needed.

**LOG_LEVEL preserved in both formats** — `LOG_LEVEL=WARN LOG_FORMAT=json` emitted only
WARN+ERROR (INFO suppressed); `LOG_LEVEL=WARN` plain emitted only WARN+ERROR. Root level
honored under both encoders.

**`IfNestedWithinSecondPhaseElementSC` WARN** — independently reproduced (fires at
startup because `<if>` nests in `<root>`). Confirmed cosmetic: despite it, appender
selection is correct in all four branches above. The prior gate's ruling holds under my
own testing — it does NOT degrade selection or drop logs under any tested env value.

### Acceptance criteria — traced
- Encoder dependency added → build.sbt L91-96 (7.4 + janino). ✓
- Prod JSON / dev plain, config-only switch → runtime-verified both formats via env var
  only, no recompile. ✓
- MDC included / searchable → `requestId` appears as a JSON field. ✓
- Cloud Logging severity + message + MDC mapped → top-level `severity`, `message`, MDC
  fields present. ✓
- LOG_LEVEL still controls root level (both formats) → verified. ✓
- Spec scenarios (JSON selected, default plain, unrecognized→plain, standard fields,
  MDC, severity, level-under-JSON) → all runtime-verified. ✓

### Verdict: CONFIRM

### Non-blocking notes
- `severity` carries logback's `WARN` rather than GCP's `WARNING`; already acknowledged
  in design Decision #3 as tolerated by Cloud Logging. No action.
- The `IfNestedWithinSecondPhaseElementSC` WARN (3x at startup) is harmless but noisy;
  the executor's suggested spinoff (two `<root>` branches wrapped in a top-level `<if>`)
  would silence it with identical typo-safe semantics. Optional cleanup, not blocking.
- The new spec validates encoders directly but not the `logback.xml` `<if>` wiring; the
  wiring is what I verified at runtime here. A future config-load test (JoranConfigurator
  on the real resource) would guard it in CI. Optional.
