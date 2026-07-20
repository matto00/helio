## Skeptic Report — design gate (round 1)

### What I verified (with evidence)

- **Artifacts read:** ticket.md, proposal.md, design.md, specs/structured-json-logging/spec.md, tasks.md.
- **Ground truth read:** `backend/build.sbt`, `backend/src/main/resources/logback.xml`, `openspec/specs/backend-env-config/spec.md`, `openspec/specs/backend-runtime/spec.md`, `infra/deploy-backend.sh`.
- **Env-substitution mechanism (`${LOG_FORMAT:-plain}` in `appender-ref`):** SOUND. The current `logback.xml` already relies on `${LOG_LEVEL:-INFO}` env substitution and it works in prod, so Logback resolving `${...}` against OS env at config-parse time is proven here. The design also correctly plans two *top-level* appenders referenced by `ref` (not nested appenders, which logback ≥1.3 forbids per the 8.0 README). This part is fine.
- **logstash-logback-encoder 8.0 compatibility — REFUTED as stated.** I fetched the published POMs from Maven Central:
  - `logstash-logback-encoder 8.0` declares **`jackson-databind 2.17.2`** and **`logback-classic 1.5.6`** (compile scope).
  - `logstash-logback-encoder 7.4` declares **`jackson-databind 2.15.2`** and **`logback-classic 1.3.7`**.
  - The backend `build.sbt` pins Jackson to **2.15.4** via `dependencyOverrides`, with an explicit comment that this exists because **Spark 3.5.x bundles 2.15.x**. So encoder 8.0 (built/tested against Jackson 2.17.2) would be forced to run against a Jackson **two minor versions older** than it expects. Design Decision #2's claim that 8.0 "uses Jackson, already pinned to 2.15.4" is factually inaccurate — it is a forward-compat *downgrade*, not a match.
- **Severity mapping:** mechanism (`<fieldNames>` renaming level→`severity`) is valid. WARN vs GCP WARNING mismatch is honestly disclosed; the spec's severity scenario only asserts ERROR (which matches GCP), so the spec remains satisfiable. Acceptable.
- **Spec ⇄ ticket AC trace:** the four ADDED requirements cover the ticket ACs (dependency, prod-JSON/dev-plain switch, config-only flip, MDC fields, severity, LOG_LEVEL preserved). But see Change Request #2 for a spec-vs-design contradiction.
- **Deploy wiring:** `infra/deploy-backend.sh` sets env via `--set-env-vars`; task 3.2 is grounded and implementable.

### Verdict: REFUTE

### Change Requests

1. **Resolve the encoder-version / Jackson-pin conflict deliberately, and fix the verification signal.**
   Encoder 8.0 is built against Jackson 2.17.2, but the build hard-pins Jackson to 2.15.4 for Spark 3.5.5. Running 8.0 against 2.15.4 risks `NoSuchMethodError`/`NoClassDefFoundError` at runtime if the encoder touches any Jackson API added in 2.16/2.17. The design treats this as a non-issue and its stated mitigation is wrong: task 1.2 ("run `sbt compile` … confirm no Jackson version conflict") and the design's "verify `sbt evicted`" **cannot** detect this failure — the encoder is instantiated *reflectively* by Logback from `logback.xml` (`class="…LogstashEncoder"`) and is never referenced from Scala source, so compilation cannot surface a Jackson API break; and `sbt evicted` will report *clean* precisely because `dependencyOverrides` silently downgrades the encoder's Jackson to 2.15.4. Required revisions:
   - Pick the encoder version against the real constraints (Spark forces Jackson 2.15.x; project runs logback 1.5.18). Options: (a) pin `logstash-logback-encoder 7.4`, whose declared Jackson is 2.15.2 — but verify it runs on logback 1.5.18 (it declares 1.3.7); or (b) keep 8.0 and explicitly analyze/document whether Spark 3.5.5 + `jackson-module-scala` tolerate bumping the pin to 2.17.x. State the chosen path and its rationale in design Decision #2.
   - Replace the `sbt compile` / `sbt evicted` "no conflict" check with a **runtime** acceptance step that actually exercises the encoder against the pinned Jackson (emit a JSON line via the `json` appender and assert it serializes without a linkage error) — this is the only signal that catches the real failure mode.

2. **Spec scenario "Unrecognized value falls back to plain text" contradicts the chosen mechanism.**
   The spec Requirement "Log output format is selectable via LOG_FORMAT env var" states that for *any* value other than `json` (and its Scenario "Unrecognized value falls back to plain text") the backend SHALL emit plain text. But `<appender-ref ref="${LOG_FORMAT:-plain}"/>` only substitutes `plain` when `LOG_FORMAT` is **unset or empty**. A non-empty unrecognized value (e.g. `LOG_FORMAT=production` or a typo) resolves to `ref="production"`, which matches no appender → Logback drops the reference and the root logger ends up with **no appender** (logs go nowhere), not plain text. Resolve the contradiction: either (a) narrow the spec so only `json` vs unset/empty is guaranteed and drop/rewrite the "unrecognized value" scenario, or (b) choose a mechanism that maps any non-`json` value to plain (which pure `${…:-…}` ref-substitution cannot do). As written, the design cannot satisfy its own spec.

3. **`.env.example` not updated for the new `LOG_FORMAT` var.**
   `backend-env-config` has an existing binding requirement: ".env.example … SHALL exist … listing **every** supported environment variable." Introducing `LOG_FORMAT` without adding it to `.env.example` leaves that requirement unsatisfied. Tasks 3.1 only touches `CLAUDE.md`. Add a task to document `LOG_FORMAT` (values `plain`|`json`, default `plain`) in the root `.env.example`, and reconcile with the fact that a new backend env var is being added while `backend-env-config` (which claims to define all env vars) is declared unmodified — either extend that spec or justify the separate `structured-json-logging` capability explicitly.

### Non-blocking notes

- **Test approach for tasks 4.1/4.2 is under-specified and could be hand-waved.** `LOG_FORMAT` is a process-level env var and `Test / envVars` loads from `.env`, so per-test flipping is awkward. The executor should pick a concrete approach — e.g. drive a `LogstashEncoder`/`ListAppender` directly or load a test logback config via `JoranConfigurator` — rather than relying on process env. Naming the approach in tasks would keep 4.1/4.2 honest.
- **WARN→WARNING severity gap** is disclosed and acceptable, but if WARN-level alerting matters in GCP later, a small level→severity value map (not just a field rename) would be needed. Out of scope for this ticket; noting for the Observability milestone.
