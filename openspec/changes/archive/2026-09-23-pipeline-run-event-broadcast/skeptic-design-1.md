## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence)

- **Spawn-cwd guard**: `pwd -P` → `/home/matt/Development/helio`; `scripts/concertino/assert-cwd.sh` returned
  `READY ambient=/home/matt/Development/helio branch=feature/cross-instance-run-event-broadcast/HEL-1168`.
- Read `ticket.md`, `workflow-state.md` (including all C1-C9 constraints and the C9/`DESIGN_ESCALATION_RESOLVED`
  record confirming `answer=listen-notify` was owner-resolved), `proposal.md`, `design.md`, `tasks.md`, and
  `specs/pipeline-run-sse/spec.md` (the delta) plus the pre-existing `openspec/specs/pipeline-run-sse/spec.md`
  (baseline) for contradiction-checking.
- `npx openspec validate pipeline-run-event-broadcast --strict` → `Change 'pipeline-run-event-broadcast' is valid`.
- Read the live `PipelineRunRegistry.scala` — confirmed the `ConcurrentHashMap[String, ActorRef]` /
  `refs.put` overwrite / `Option(refs.get(...)).foreach` single-subscriber bug the ticket and design describe is
  real and matches design.md's Context section exactly.
- Read `PipelineRunStreamRoutes.scala` — confirmed `pipelineExistsShared` is the sole ACL gate, checked once at
  subscribe time, exactly as D4 claims.
- Read `application.conf` (lines 1-133) — confirmed the app pool (`maximumPoolSize=5`) + privileged pool
  (`maximumPoolSize=5`) = 10 connections/instance today, with an explicit comment ("total max connections per
  instance is 10 (5 app + 5 privileged)") — corroborates D2's `5+5=10` baseline and the `+1 listen = 11` /
  `2×11=22` arithmetic C9 mandates.
- Read `.github/workflows/cd-backend.yml`'s `--max-instances=2` comment — confirmed it currently states only the
  privileged pool's 5/instance figure, as D2/task 2.7 claim, and needs updating.
- Confirmed the codebase's nullable-optional-collaborator convention (`alertRuleRepo: AlertRuleRepository = null`,
  `pipelineRunGuardRepo: PipelineRunGuardRepository = null` in `ApiRoutes.scala`, always wired non-null from
  `Main.scala`) — D6's "mirrors this codebase's established pattern" claim checks out.
- Confirmed `registry: PipelineRunRegistry` is itself already nullable in `PipelineRunService` (`if (registry !=
  null) registry.publish(...)`) — consistent with D6.
- Confirmed `org.postgresql:postgresql:42.7.13` is a build.sbt dependency (supports `PGConnection.getNotifications`)
  and `io.zonky.test.db.postgres.embedded.EmbeddedPostgres` is already used in
  `V100ZeroRootGuardNonSuperuserSpec.scala` (real Postgres binary, so task 3.3's two-registry-one-embedded-DB
  cross-instance proof is technically feasible, not hand-waved).
- **Ran `grep -rn "CoordinatedShutdown" backend/src/main/scala/` — zero hits.** Checked all three
  `system.terminate()` call sites in `Main.scala` (lines 93, 148, 274) — each is an ad-hoc boot-failure-path call,
  none registered with Pekko `CoordinatedShutdown`. Re-ran the grep a second time to rule out a stale/flaky read;
  same zero-hit result both times.
- Read `PipelineRunRegistrySpec.scala` (existing local-only tests) — confirms today's registry has no disconnect
  cleanup and no multi-subscriber test, consistent with the ticket's "must hold" gap list.

### Verdict: REFUTE

The core mechanism choice (Postgres LISTEN/NOTIFY, per C9) is not in question, and the local multi-subscriber fix
(D5), ACL reasoning (D4), and connection-budget arithmetic (D2, matches the live `application.conf`/`cd-backend.yml`
values) are sound and grounded in the actual tree. However, three concrete, fixable gaps remain in `design.md`
before this is safe to implement against:

### Change Requests

1. **D9's `errorLog` truncation is character-count-based, not byte-based, and does not actually guarantee the
   8000-byte NOTIFY limit it exists to enforce.** `design.md` D9 says: "truncates `errorLog` ... to a fixed budget
   (e.g. 4000 chars)". A Scala/Java `String`'s length is UTF-16 *code units*, not bytes; once JSON-encoded to UTF-8
   (the encoding `pg_notify` ultimately sends), any non-ASCII content — e.g. an exception message containing
   non-Latin identifiers, quoted user data, or emoji from a connector error — can expand to up to 4 bytes per
   character. A 4000-*character* `errorLog` of such content can byte-encode to well over 8000 bytes, which is
   exactly the failure D9 claims to prevent ("`pg_notify` does not throw"). Task 3.5's described test ("constructs
   an event with an oversized `errorLog`") is not specified to include multi-byte content, so as currently scoped
   it would not catch this. **Required revision:** D9 must specify truncation by UTF-8 **byte** length (encode
   first, or use a codec-aware truncation that never splits a multi-byte sequence), not `String.length`/char count,
   and task 3.5 must explicitly include a non-ASCII (e.g. CJK or emoji-bearing) oversized `errorLog` in its test
   fixture, not just an oversized ASCII one.

2. **D8's `CoordinatedShutdown` claim misdescribes the live codebase.** D8 states the listener thread "is stopped
   via a `CoordinatedShutdown` task registered alongside `Main.scala`'s existing `system.terminate()` paths." A
   repository-wide grep for `CoordinatedShutdown` in `backend/src/main/scala/` returns **zero** matches (verified
   twice). The three `system.terminate()` calls in `Main.scala` are ad-hoc boot-failure branches (missing env var,
   unknown uploads backend, HTTP bind failure) — none are `CoordinatedShutdown` tasks, and there is no existing
   graceful-shutdown-on-SIGTERM pattern anywhere in this codebase to "register alongside." This isn't fatal
   (`CoordinatedShutdown` is a real Pekko API the executor can add fresh), but the design's premise is factually
   wrong and would send the executor looking for infrastructure that doesn't exist. **Required revision:** D8 must
   be corrected to state this is a **new** `CoordinatedShutdown` registration (the first in this codebase), and
   should explicitly note that Cloud Run's actual shutdown path is SIGTERM-then-kill with no other resource
   cleanup precedent today — i.e., justify (or scale back to "best-effort, not load-bearing for correctness")
   why this cleanup step matters in production versus purely for local/test JVM hygiene (e.g., `sbt test` process
   exit).

3. **Task 2.7 leaves `application.conf`'s own now-stale connection-count comment unaddressed.**
   `application.conf` (lines 111-112) currently states: "Match app-pool Cloud Run tuning so total max connections
   per instance is 10 (5 app + 5 privileged)." Once the dedicated LISTEN connection ships, this becomes an
   inaccurate comment (true count is 11, not 10) sitting right next to the pool config it's describing — precisely
   the kind of stale, misleading connection-budget comment C9 was written to close out (it only names
   `cd-backend.yml`'s comment, task 2.7). **Required revision:** add updating this `application.conf` comment
   (or an equivalent one near the privileged-pool config) to task 2.7 (or a new 2.8), so both places that assert
   "total connections per instance" stay consistent with the true post-change count of 11.

### Non-blocking notes

- The `2×11=22` budget claim rests on interpreting `cd-backend.yml`'s "3+ instances previously exhausted it under
  load" comment as referring to the *total* 10/instance figure (yielding a ~30 exhaustion point), but the comment's
  literal wording ties that history to the *privileged pool alone* (5/instance). This ambiguity predates this
  change and C9 explicitly pre-approved documenting exactly this `2×11=22` arithmetic, so I am not blocking on it
  — but worth a one-line acknowledgment in the PR body that the "~30" exhaustion figure is inferred, not a
  confirmed Cloud SQL `max_connections` value for `db-g1-small`.
- `notifyRemote`'s `pg_notify` call should use Slick's `sql"..."` parameter-binding interpolation (not string
  concatenation of `errorLog`/`pipelineId` into the SQL text) to avoid injection via pipeline-error-derived
  content — standard practice already followed elsewhere in this codebase; design.md doesn't need to spell this
  out, but it's worth the executor double-checking at implementation time.
- The pre-existing `pipeline-run-sse` spec's "PipelineRunRegistry publishes status events... in-memory registry"
  requirement text is not marked MODIFIED even though delivery is no longer purely single-instance-in-memory once
  the NOTIFY bus ships. Each instance's registry is still in-memory (the statement remains true), so this is a
  wording nitpick, not a contradiction — not blocking.
