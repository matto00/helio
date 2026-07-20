## Skeptic Report — design gate (round 2)

### What I verified (with evidence)

- **Artifacts read (current):** `proposal.md`, `design.md`, `specs/structured-json-logging/spec.md`, `tasks.md`, `ticket.md`. **Ground truth read:** `backend/build.sbt`, `backend/src/main/resources/logback.xml`, root `.env.example`, `openspec/specs/backend-env-config/spec.md`. **Prior report:** `skeptic-design-1.md`.

- **CR1 — encoder version vs Jackson pin + verification signal: RESOLVED.**
  - Design Decision #2 now picks **encoder 7.4 primary** (declares `jackson-databind 2.15.2`, matching Spark's forced pin — `build.sbt` overrides Jackson to 2.15.4, lines 124–130), with **8.0 as documented fallback** if a logback linkage error surfaces. The forward-downgrade risk the round-1 report flagged is now explicitly analyzed rather than hand-waved.
  - Verification is now correctly a **runtime** check: Decision #2 and task 2.6 both state the encoder is instantiated reflectively from `logback.xml`, so `sbt compile`/`evicted` cannot catch a linkage break; the gate is "start with `LOG_FORMAT=json`, emit a line, assert valid JSON with no `NoSuchMethodError`/`NoClassDefFoundError`." Task 4.1 adds an encoder-level test. Matches what CR1 required.

- **CR2 — "unrecognized value falls back to plain text" now satisfiable: RESOLVED, and the mechanism is correct against ground truth.**
  - Mechanism switched from `${LOG_FORMAT:-plain}` ref-substitution to Janino `<if condition='p("LOG_FORMAT").equalsIgnoreCase("json")'><then>json</then><else>plain</else></if>` with two top-level appenders (`plain`, `json`). True equality means *any* non-`json` value → else → plain, satisfying the spec scenario. Task 1.2 adds `org.codehaus.janino:janino`; task 2.4 wires the `<if>`; task 2.5 verifies a typo yields plain.
  - **Load-bearing check I reproduced against the real jar** (`logback-core-1.5.18-sources.jar`, the version pinned in `build.sbt` line 90): `PropertyWrapperForScripts.property(k)`/`p(k)` → `OptionHelper.propertyLookup`, which falls back to `System.getenv(key)` (OptionHelper.java line 130) after local/context/system-property scopes. So `p("LOG_FORMAT")` **does** read the OS env var Cloud Run sets via `--set-env-vars`, and when unset returns `""` (not null, line ~48), giving `"".equalsIgnoreCase("json") == false` → plain, with no NPE. The design's claim that unset → plain and typo → plain is verified in source, not just asserted.

- **CR3 — `.env.example` + reconciliation: RESOLVED.**
  - Root `.env.example` currently has a Logging section (lines 31–37) with only `LOG_LEVEL`; task **3.2** adds `LOG_FORMAT` (values `plain`|`json`, default `plain`) there, satisfying `backend-env-config`'s "`.env.example` lists every supported env var" content requirement. Reconciliation is documented in design Planner Notes: the requirement is about file content (not spec text), so no MODIFIED delta to `backend-env-config` is needed, and `LOG_FORMAT` is scoped to the new `structured-json-logging` capability. Defensible OpenSpec modeling.

- **AC trace:** all five ticket ACs map to spec requirements + tasks (dependency → 1.1; prod-JSON/dev-plain env switch → 2.1–2.4; config-only flip → Janino `<if>`, no recompile; MDC → 2.2 + spec req 2; severity → 2.3 + spec req 3; LOG_LEVEL preserved → 2.4 + spec req 4). No uncovered AC, no scope drift.

### Verdict: CONFIRM

### Non-blocking notes

- Task 1.3 still says "Run `sbt compile`" — harmless as a build step, and the design correctly designates task 2.6 (runtime) as the real linkage gate. No change needed, just don't let the executor read 1.3 as the verification signal.
- Decision #3 severity: `WARN` vs GCP `WARNING` gap remains disclosed; the spec's severity scenario only asserts ERROR (which matches GCP), so it stays satisfiable. Carry the level→severity value-map idea to the Observability milestone if WARN alerting is later needed.
