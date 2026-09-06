## Evaluation Report — Cycle 1 (evaluation-1.md)

Commit under review: `4d4cb817` (base `75f59b04`).

### Phase 1: Spec Review — PASS

- **AC1 (create/update refused for loopback / link-local / private):** met. `SourceService.createSql` guards before
  persisting (`SourceService.scala:64-72`), `Disallowed`/`Invalid` → `BadRequest`. Blocked-class coverage is one
  assertion per class (7 classes incl. IPv6 loopback + ULA), not one representative. The "or updated" half is
  genuinely vacuous, and task 8.1a's re-verification is recorded in `design.md` Decision 4 — confirmed by my own
  grep that no SQL config-update path exists.
- **AC2 (DNS name resolving internal refused at connect time):** met. `SqlConnectorDriver.connect` calls
  `checkConfigEgress` before `DriverManager.getConnection`; the `internal-db.test → 169.254.169.254` test proves the
  resolved address, not the hostname string, is what is classified. Multi-A-record (public + internal) is also refused.
- **AC3 (pin, or document the inability to pin):** met via the documented alternative the AC explicitly sanctions —
  `design.md` Decision 4 and the `outbound-egress-guard` spec delta both state the JDBC socket is not pinned, why the
  REST `ClientTransport` pin does not transfer, and the residual TOCTOU risk.
- **AC4 (legitimate hosts still work):** met, and non-vacuously: the admit-the-test-host end-to-end test opens a real
  JDBC connection to EmbeddedPostgres and reads a real row.
- All 8 task groups marked done and match what is in the diff. No scope creep: every non-`SqlConnectorDriver` main-source
  edit is override-forwarding required to make the seam reach `connect`. The explicit non-goals (error-channel change →
  HEL-953, `admitLocalhost` hoist → HEL-954, JDBC pinning) were honoured. No API-shape or schema change; spec deltas
  present for both modified capabilities.

### Phase 2: Code Review — FAIL

**Gates (my own fresh runs, in `WORKTREE_PATH`; `CLEAN_WORKTREE` not set):**

- `cd backend && sbt test` → **green**: 3873 tests, 255 suites, 0 failed, **0 ignored**, 0 canceled (274 s).
- `npm run check:scala-quality` → clean (156 pre-existing soft size warnings; none introduced by this diff).
- `npm run check:openspec` → clean. `npm run check:spec-structure` → 350 canonical specs, 0 issues.
- `npm run check:no-credential-leak` → 0 violations.
- Frontend gates not run: `git diff --name-only main...HEAD` matches zero `frontend/**` paths.

**Requested deep checks:**

1. **Evidence files say what the executor claims — yes, and the strongest one is self-proving.**
   `task-2.2-ssrf-reachable.txt` shows the pre-guard test green against the spec's own EmbeddedPostgres. The
   short-circuit worry (the "reaches example.com with a null ActorSystem" failure mode) is *ruled out by the RED
   transcript itself*, which prints the actual value returned:
   `Right(List(Map("one" -> 1))) was not an instance of scala.util.Left`. Those are real rows from a real JDBC
   connection to a live loopback Postgres — the fixture demonstrably reaches a database rather than failing before
   any connection. This is a materially better proof than a bare green line.
   `task-7-mutation-check-RED.txt` shows the failure landing on the refusal assertion
   (`SqlConnectorEgressGuardSpec.scala:69`, `result shouldBe a[Left]`), not a timeout / missing driver / fixture error.
   `task-7-mutation-check-GREEN-restored.txt` shows 15/15 restored.

2. **The single-failure mutation is LEGITIMATE, not evidence of tautological tests.** The mutation neutralised the
   refusal branch at the connect call site (`SqlConnectorDriver.connect`'s `case Left(msg) => throw`), which is
   exactly the "neutralise the refusal branch" the design specified. The blocked-class tests call
   `checkConfigEgress` directly and never reach `connect`, so their staying green is the expected blast radius —
   `design.md` Decision 5.8 anticipates precisely this and says so in advance. They are not tautological: they invoke
   the real `checkConfigEgress` → `checkEgressHost` → `checkResolvedHost` with the **real** `isBlockedAddress`
   (only the resolver is injected), so removing the `addresses.exists(isBlocked)` refusal would turn every one of
   them red. The spec's own task-7 test is the tautology-killer that proves this directionally: same method, same
   loopback config, `isBlocked = (_, _) => false` ⇒ `Right`. A `shouldBe a[Left]` that can be flipped to `Right` by
   changing only the guard input is not vacuous. **No FAIL on this point** — but see CR2 for the comment that
   misdescribes it.

3. **`ContentSourceSupport` refactor is behaviour-preserving.** `RestConnectorEgressGuardSpec.scala` is **byte-identical**
   to `main` (empty diff). `ContentSourceSupportSpec.scala` is **purely additive** — the diff contains only new
   `checkEgressHost` tests; not one existing assertion, fixture, or expected string was touched. The extracted
   `checkResolvedHost` moves the resolve/classify block verbatim; the only new degree of freedom is the defaulted
   `noun` parameter, defaulted to `"URL host"` so `checkEgress`'s message strings are unchanged.

4. **No spec was repaired by deletion, `ignore`, or routing around the guard.** `git diff main...HEAD -- '*.scala'`
   yields **zero** removed test declarations and **zero** added `ignore(`; the full-suite run reports `ignored 0`.
   All 9 affected specs were repaired through the task-2a seam with a narrow admit-one-known-test-host override
   (`(host, addr) => if (host == "localhost") false else ContentSourceSupport.isBlockedAddress(addr)`), which leaves
   the real denylist in force for every other host: `ApiRoutes.sqlUrlIsBlocked` (AuditMutationInstrumentationSpec,
   PipelineApplyProposalSpecBase, DataSourceRoutesSpec), `SourceService.sqlIsBlocked` (SourceServiceSpec,
   PipelineAnalyzeProposalRoutesSpec), `InProcessPipelineEngine.sqlIsBlocked` (InProcessPipelineEngineSpec),
   `PipelineRunService.isBlocked` (PipelineRunRoutesSpec, PipelineRunServiceSpec), and the driver parameter
   (SqlConnectorDriverSpec). Task 2a.3 is satisfied: no mutable global, system property, or env var is used as a hook.

5. **Host-identity defence is sound.** `SqlConnectorDriver.buildJdbcUrl` interpolates `config.host`;
   `checkConfigEgress` passes that **same** `config.host` to `checkEgressHost`, which runs the charset gate
   (`^[A-Za-z0-9.\-:\[\]]+$`) and the `URI` round-trip check on that string and then hands **that same string** (not
   `uri.getHost`) to `resolveHost`. So the validated string is character-for-character the interpolated string.
   The injection forms are covered and each asserts `Invalid` with a `resolveHost` that *fails the test if called*,
   proving refusal precedes resolution: `evil.test/@internal`, `evil.test#@internal`, `evil.test?x@internal`,
   `a:b@internal`, `host,other` (MySQL multi-host failover), and a whitespace host. The `seenHost shouldBe Some(host)`
   test pins the exact-string-validated property directly. IPv6 `::1` / `[::1]` round-trip and are correctly
   `Disallowed` rather than falsely `Invalid`.

6. **No Flyway migration** (`git diff --name-only` matches nothing under `db/migration/`). No real credential and no
   real internal hostname: fixture hosts are `localhost` / `*.test`, addresses are documentation/reserved-range
   literals, and the only password literal is EmbeddedPostgres's `"postgres"`.

**Other code-quality observations:** DRY is respected (no second denylist; `isBlockedAddress` untouched); error
handling fails closed on `Disallowed`/`Invalid`/`Unresolvable` at connect time; the typed `SqlEgressRefusedException`
avoids substring-matching a raw JDBC message; no dead code, no `any`-equivalent escape hatch, no over-abstraction.

**Blocking issues:** see Change Requests 1 and 2.

### Phase 3: UI Review — N/A

`git diff --name-only main...HEAD` matches none of the Phase-3 triggers: zero `frontend/**` files, no
`backend/src/main/scala/routes/ApiRoutes.scala` (the touched file is `.../com/helio/api/ApiRoutes.scala`, a backend
route-composition class with no wire-shape change in this diff), no `schemas/**`, and the only `openspec/**` files are
this change's own artifacts. This is a backend-only security change with no frontend surface. Per the delivery
constraint, Playwright and e2e specs were **not** run and no dev server was started — HEL-972 holds Playwright and the
dev database.

### Overall: FAIL

The security substance is sound and I would pass it on the guard alone. The two items below are small, mechanical, and
must not ship as-is — one is a binding `CONTRIBUTING.md` rule, the other is a factually false claim about this
security change's own evidence.

### Change Requests

1. **Inline fully-qualified names — `CONTRIBUTING.md` "Imports & Qualifiers" (binding, mechanical).**
   - `backend/src/main/scala/com/helio/services/pipelines/PipelineService.scala:1531` — replace
     `(h: String, addr: java.net.InetAddress)` with `addr: InetAddress` and add `import java.net.InetAddress` to the
     file's top-level imports. (The parameter `h` is also unused; `(_: String, addr: InetAddress)` reads better.)
   - `backend/src/test/scala/com/helio/api/routes/pipelines/PipelineAnalyzeProposalRoutesSpec.scala:143` — replace
     `(String, java.net.InetAddress) => Boolean` with `(String, InetAddress) => Boolean` and add
     `import java.net.InetAddress` at the top of the file.
   Every other file in this diff already imports `InetAddress` correctly, so these two are inconsistent with the
   change's own convention.

2. **`backend/src/test/scala/com/helio/domain/connectors/SqlConnectorEgressGuardSpec.scala:172-176` documents the
   mutation check incorrectly.** The comment states the captured transcript is from "running this suite with
   `isBlockedAddress` itself neutralised (task 7.1's 'disable the guard' at the policy source, not the call site)".
   That is provably not what `evidence/task-7-mutation-check-RED.txt` records: had `isBlockedAddress` been neutralised
   at the policy source, all seven blocked-class tests plus the DNS-name and multi-A-record tests would have gone red,
   because they call `checkConfigEgress` with the default `isBlocked`. They are all green in that transcript; exactly
   one test failed, and it failed inside `execute` — i.e. the mutation was at the **connect call site**, which is what
   `design.md` Decision 5.6 actually asked for. Rewrite the comment to describe the mutation that was really performed
   (neutralising `connect`'s `case Left(msg) => throw SqlEgressRefusedException(msg)`), and state — as `design.md`
   Decision 5.8 already does — that the hermetic `checkConfigEgress` tests are deliberately outside that mutation's
   blast radius and are covered instead by the in-spec inverse assertion. This is the repo's recurring
   confidently-false-documentation trap, and it matters more than usual here: this comment is the artifact a future
   reader will use to judge how strong the mutation evidence was.

### Non-blocking Suggestions

- The blocked-class tests assert only `result shouldBe a[Left[_, _]]`. A `Left` from `checkConfigEgress` can also mean
  `Invalid` (charset / round-trip) or `Unresolvable`, so the assertion does not pin *why* the host was refused. It is
  not vacuous today (`victim.test` is charset-clean, round-trips, and resolves), but asserting the message
  (`err should include("resolves to a disallowed address")`) would make these tests immune to a future refactor that
  starts refusing them for an unrelated reason.
- The charset gate excludes `_`, so a SQL host like `my_db.internal` becomes `Invalid` where previously the SQL path
  did no validation at all. `ContentSourceSupport.scala:238-244` documents this deliberately and it matches existing
  REST behaviour, so it is defensible — but it is a behaviour change for SQL specifically and would be worth a line in
  the release note.
- `design.md` Decision 5.8's insight (that the loopback red/green pair is the *only* end-to-end proof, and must not be
  weakened by a later cycle) would be worth restating as a comment on the flipped test itself, where a future editor
  will actually see it.
