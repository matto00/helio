## Context

See proposal.md for motivation. `PipelineRunRegistry` (`.../api/routes/pipelines/PipelineRunRegistry.scala`)
is a `ConcurrentHashMap[String, ActorRef]`; `subscribe` overwrites, `publish` reaches only the latest ref.
`PipelineRunService.publish` (lines 920-1324) calls it synchronously in-process — confirmed (premise
validation) that both auto-run (`PipelineSchedulerService.processAutoRunDebounce`) and manual submit run
their whole publish sequence on whichever instance executed them, with no mid-run instance migration.
Prod: `--max-instances=2`, no affinity (`cd-backend.yml`). App pool + privileged pool = 10 HikariCP
connections/instance (`application.conf`), already tuned against `db-g1-small`'s budget (comment: "3+
instances previously exhausted it under load"). `pipeline-run-sse` spec already declares events ephemeral
(not persisted). ACL gate: `PipelineRunStreamRoutes` → `pipelineExistsShared`, at subscribe time only.

## Goals / Non-Goals

**Goals:**
- Every live subscriber for a pipeline (any instance, any tab/session) receives every published event.
- No cross-tenant leak introduced by the cross-instance mechanism.
- No blocking of Pekko actor-system threads; subscribers cleaned up on disconnect.

**Non-Goals:**
- No change to the SSE wire format, `RunStatusEvent` JSON shape, or frontend fan-out.
- No general pub/sub abstraction beyond pipeline run-status events.
- No event replay/persistence — events remain ephemeral (existing spec requirement, unchanged).

## Decisions

**D1 — Mechanism: Postgres LISTEN/NOTIFY, one dedicated connection per instance (owner-resolved
escalation, `escalation_id=HEL-1168-1790214379716-d1f700`, answer `listen-notify`).** Alternative
considered: a DB-polling events table — rejected (adds a migration + cleanup sweep + up to ~1s latency,
undermining HEL-1094's "visibly updates without manual refresh" AC, for a smaller connection cost than
LISTEN/NOTIFY's one dedicated connection). A new infra dependency (Redis/Pub-Sub) was ruled out without a
separate escalation — Postgres is already the shared substrate; no new infra class needed.

**D2 — Connection budget.** One dedicated `LISTEN` connection per instance, held OUTSIDE the two existing
HikariCP pools (a raw `DriverManager` connection, never checked out from/into a pool — blocking wait on
`getNotifications` is incompatible with pool checkout semantics). Per instance: 5 (app) + 5 (privileged) +
1 (listen) = 11. At `--max-instances=2`: **2 × 11 = 22**, under the ~30 that previously exhausted
`db-g1-small` (the existing comment's "3+ instances" = 3×10 = 30; this inferred figure — whether "3+
instances" originally meant the privileged pool alone or the full per-instance total — is noted as an
assumption in the PR body, not a confirmed Cloud SQL `max_connections` value). **Two comments go stale
once this ships, both must be updated (skeptic round 1: `application.conf`'s own comment was missed in the
first pass):** `cd-backend.yml`'s `--max-instances=2` comment currently cites only the privileged pool's
5/instance, and `application.conf` (near the privileged-pool config) separately states "total max
connections per instance is 10 (5 app + 5 privileged)" — both need updating to the full 11/instance
(app+privileged+listen) and the 22-total arithmetic, so neither is left understating per-instance
connections after this change.

**D3 — Credentials/role.** The LISTEN connection uses the plain, non-privileged app role/credentials
(`helio.db.user`/`password` — same as `Database.initApp`), NOT `helio_privileged`. LISTEN/NOTIFY needs no
table access and no BYPASSRLS; granting it privileged credentials would be an unnecessary escalation. No
Flyway/RLS interaction: no new table or role is created (LISTEN/NOTIFY is a session-level Postgres
primitive with no schema object) — **V111 is NOT claimed by this change**, remains free.

**D4 — Cross-tenant safety.** LISTEN/NOTIFY has no RLS awareness — every session that issues `LISTEN` on a
channel receives every payload on it, regardless of role. Mitigation, entirely application-side:
(a) exactly ONE fixed, server-controlled channel name (`pipeline_run_events`), never derived from request
input — no code path lets a client choose or influence a channel name; (b) the NOTIFY payload carries only
`{originInstanceId, pipelineId, event}` (never user/tenant identity); (c) the ACL gate stays exactly where
it is today — `pipelineExistsShared` at SSE-subscribe time. A received NOTIFY is routed ONLY to the local,
already-ACL-checked subscriber set for that `pipelineId` (`PipelineRunRegistry`'s in-memory map) — it is
never forwarded to a browser directly. No new tenant-identifying data crosses the NOTIFY channel.

**D5 — Local multi-subscriber fix.** `refs: ConcurrentHashMap[String, ActorRef]` becomes
`ConcurrentHashMap[String, java.util.Set[ActorRef]]` (`ConcurrentHashMap.newKeySet()` per key). `subscribe`
adds to the set; the materialized `Source` is wrapped with `watchTermination()` so client disconnect (or
stream completion) removes that specific ref from the set — closes the existing "no cleanup on disconnect"
gap the ticket's "must hold" list calls out. `publish` iterates the set; a terminal event clears the entry
after notifying every member.

**D6 — Cross-instance wiring: `PipelineRunNotifyBus`, nullable-optional collaborator.** New class,
constructed once in `Main.scala` from `helio.db.url/user/password`, passed into
`new PipelineRunRegistry(eventBus = ...)`. Mirrors this codebase's established nullable-optional pattern
(`PipelineSchedulerService.pipelineRunGuardRepo`, `ApiRoutes.alertRuleRepo`, etc.) — a fixture/test that
doesn't pass one gets pure local-only broadcast (D5 alone), unchanged from today's local-only tests
(`PipelineRunRegistrySpec`). `PipelineRunRegistry.publish` first broadcasts locally (D5), then, if an
`eventBus` is wired, calls `eventBus.notifyRemote(pipelineId, event)`.

**D7 — Duplication guard (self-echo).** `PipelineRunNotifyBus` generates one random `instanceId`
(`UUID.randomUUID()`) at construction. `notifyRemote` sends `pg_notify('pipeline_run_events', payload)`
via a short-lived statement on the ordinary app pool (`db.run(sql"SELECT pg_notify(...)"...)`  — no need
for the dedicated connection to *send*). Postgres delivers that NOTIFY to every session currently
LISTENing on the channel, including this instance's OWN dedicated listen connection. The receive-side
handler drops any notification whose `originInstanceId` matches its own — the originating instance's
local subscribers were already served synchronously by D5's direct broadcast, so re-delivering would
double-fire the same event to the same local `ActorRef`s.

**D8 — Listener loop: dedicated thread, not an actor-system dispatcher.** A single daemon `Thread` per
instance opens the raw `DriverManager` connection, issues `LISTEN pipeline_run_events`, then loops
blocking on `PGConnection.getNotifications(timeoutMillis)` (Postgres JDBC driver, already a dependency).
Deliberately NOT run on any Pekko dispatcher (actor threads must never block — CONTRIBUTING.md). On
`SQLException`/disconnect: log a WARN naming the start of a "lost connection window", retry with capped
exponential backoff, re-issue `LISTEN` on reconnect, log an INFO closing the window. A missed notification
during that window is accepted — matches the spec's existing "events are ephemeral" contract; the affected
pipeline's status is still correctly observable on next reconnect/poll since terminal state isn't lost, only
an intermediate progress tick might be. **Skeptic-round-1 correction:** a repo-wide grep found zero existing
uses of Pekko `CoordinatedShutdown` anywhere in `backend/src/main/scala/` — the three `system.terminate()`
calls in `Main.scala` are ad-hoc boot-failure branches, not `CoordinatedShutdown` tasks, so there is no
existing graceful-shutdown pattern to "register alongside." This change introduces the FIRST
`CoordinatedShutdown` registration in this codebase, purely for the listener thread/connection. Its value is
best-effort JVM hygiene, not a correctness requirement: Cloud Run's actual instance-teardown path is
SIGTERM-then-kill with no other resource-cleanup precedent today, and a thread that never gets to close its
connection before the process dies causes no data loss (events are ephemeral, D-Context) — the registration
mainly matters for clean `sbt test`/local-dev process exit (no dangling non-daemon-adjacent connection
warning) rather than for production correctness.

**D9 — Payload size guard.** NOTIFY payload is capped at Postgres's 8000-byte limit, which `pg_notify`
enforces on the UTF-8-**encoded byte length** of the payload, not on `String.length` (UTF-16 code units).
**Skeptic-round-1 correction:** truncating by character count (as originally written) does not bound the
byte size for non-ASCII content (CJK, emoji, etc., which can be up to 4 bytes/char) and could still overflow
the limit. `notifyRemote` MUST truncate `errorLog` by UTF-8 byte length: encode to UTF-8 first, then trim to
a fixed byte budget (e.g. 4000 bytes) at a valid UTF-8 boundary (never splitting a multi-byte sequence —
e.g. via `java.nio.charset` `CharsetEncoder` with `CodingErrorAction.IGNORE`, or trim-and-verify-decodable),
append a trailing marker (e.g. `"...[truncated]"`), leaving headroom for `originInstanceId`/`pipelineId`/JSON
overhead within the 8000-byte total. This truncation applies ONLY to the cross-instance NOTIFY payload — the
originating instance's own local subscribers (D5/D7) already received the untruncated `errorLog` directly,
before any NOTIFY is sent. A unit test constructs an event with an oversized `errorLog` — including a
variant containing non-ASCII (e.g. CJK or emoji) content, not only ASCII — and asserts the encoded NOTIFY
payload stays under 8000 UTF-8 bytes and that `pg_notify` does not throw for either variant.

## Risks / Trade-offs

- [An instance's dedicated LISTEN connection drops silently] → capped-backoff reconnect (D8) + logged
  window; ephemeral-event contract already tolerates a gap; no user-facing error surfaces to a healthy
  subscriber on the SAME instance as the run (local broadcast, D5, is unaffected by DB connectivity).
- [Truncated `errorLog` reaches a subscriber on a different instance than the one that ran the pipeline] →
  documented, accepted trade-off (D9); the 8000-byte NOTIFY limit is a hard Postgres constraint, not a
  choice. Noted in the PR body as a known, bounded UX difference.
- [11th connection/instance narrows the existing headroom further] → D2's arithmetic (22 of ~30) leaves
  margin; `cd-backend.yml` comment updated (D2) so a future change to `--max-instances` is evaluated
  against the true per-instance count, not last cycle's undercount.

## Migration Plan

No schema migration (D3) — V111 remains free. Deploy is a plain code change: `Main.scala` constructs the
new `PipelineRunNotifyBus` unconditionally; if construction fails (e.g. DB unreachable at boot), it is
treated exactly like today's other required-at-boot dependencies — fail loud at startup, not silently
degrade to local-only (a silent single-instance fallback would reintroduce this exact ticket's bug
invisibly). Rollback is a plain revert (no persisted state to reconcile).

## Planner Notes

Self-approved: exact env-var naming (none introduced — no new env var needed, all values reuse existing
`helio.db.*` config), exact backoff constants for D8, and the specific truncation budget in D9, left to the
executor to choose reasonably and document inline; these do not change the approach or task breakdown.
