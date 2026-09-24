## Files modified

- `backend/src/main/scala/com/helio/api/routes/pipelines/PipelineRunRegistry.scala` — replaced the single-`ActorRef`-per-pipeline `ConcurrentHashMap` with a `Set[ActorRef]` per pipeline id so every live subscriber receives every event (design.md D5); added `watchTermination()`-based cleanup of a disconnected subscriber's ref; added an optional `eventBus: PipelineRunNotifyBus` collaborator that `publish` calls after the (always-run) local broadcast, and a `subscriberCountForTest` test-only accessor.
- `backend/src/main/scala/com/helio/api/routes/pipelines/PipelineRunNotifyBus.scala` (new) — Postgres LISTEN/NOTIFY cross-instance bus: a dedicated non-privileged `DriverManager` connection (outside both HikariCP pools) on a daemon receive thread, `notifyRemote` via the app pool's parameterized `sql"..."` interpolation, per-instance `instanceId`-tagged self-echo guard, UTF-8 byte-length `errorLog` truncation for the 8000-byte NOTIFY limit, and capped-backoff reconnect with WARN/INFO lost-connection-window logging.
- `backend/src/main/scala/com/helio/api/ApiRoutes.scala` — added a nullable, appended `pipelineRunNotifyBus: PipelineRunNotifyBus = null` constructor param; `runRegistry` now constructs `PipelineRunRegistry(eventBus = pipelineRunNotifyBus)`.
- `backend/src/main/scala/com/helio/app/Main.scala` — constructs the real `PipelineRunNotifyBus` from `helio.db.*` config (fails loud at boot if unreachable, matching every other required-at-boot dependency), passes it into `ApiRoutes`, and registers this codebase's first `CoordinatedShutdown` task (best-effort thread/connection cleanup, not load-bearing for correctness).
- `backend/src/main/resources/application.conf` — updated the privileged-pool's stale "total max connections per instance is 10" comment to the true post-change 11 (5 app + 5 privileged + 1 dedicated LISTEN connection).
- `.github/workflows/cd-backend.yml` — updated the `--max-instances=2` comment from the privileged-pool-only figure to the full per-instance connection count (11) and the `2 × 11 = 22` total.
- `backend/src/test/scala/com/helio/api/routes/pipelines/PipelineRunRegistrySpec.scala` — added tests for: two concurrent subscribers both receiving a published event (task 3.2, closes the red below), a terminal event reaching both subscribers before the map entry clears (task 1.3), and disconnect cleanup not affecting a still-live subscriber (task 1.2).
- `backend/src/test/scala/com/helio/api/routes/pipelines/PipelineRunNotifyBusSpec.scala` (new) — pure unit tests for `PipelineRunNotifyBus.truncateUtf8`'s UTF-8 byte-boundary back-off logic (ASCII, CJK, and emoji fixtures), no database required.
- `backend/src/test/scala/com/helio/api/routes/pipelines/PipelineRunCrossInstanceSpec.scala` (new) — `EmbeddedPostgres`-backed integration tests: cross-instance delivery is absent with no eventBus wired (permanent characterization of the unwired default), present with the real bus wired (task 3.3), no cross-pipeline leak, the self-echo guard (task 3.4, mutation-tested — see below), and the NOTIFY payload byte-size guard for oversized ASCII/non-ASCII `errorLog` (task 3.5).
- `backend/src/test/scala/com/helio/api/routes/pipelines/PipelineRunRoutesSpec.scala` — added a route-level ACL-scoping test (task 3.6): a subscriber for pipeline X never receives an event published for a different pipeline Y sharing the same registry.
- `openspec/changes/pipeline-run-event-broadcast/tasks.md` — all 18 tasks marked complete.

## Red/green evidence (verification-before-completion)

**Task 3.1/3.2 — local single-slot overwrite (pre-fix regression demonstrated live):**
Temporarily reverted `PipelineRunRegistry.scala` to its pre-HEL-1168 single-`ActorRef`-per-pipeline
shape (`git show HEAD:...`) and ran only the new "deliver a published event to BOTH of two
concurrently subscribed clients" test:

```
[info] - should deliver a published event to BOTH of two concurrently subscribed clients for the same pipeline *** FAILED ***
[info]   java.util.concurrent.TimeoutException: Future timed out after [5 seconds]
```

Root cause: `refs.put(pipelineId, ref)` is an unconditional overwrite — the second `subscribe`
call replaces the first subscriber's map entry, so `publish` (`Option(refs.get(pipelineId))`)
never reaches the first subscriber's actor ref again. Restored the fixed implementation and
re-ran: all 6 tests in `PipelineRunRegistrySpec` pass.

**Task 3.4 — self-echo guard (mutation-tested, not vacuous):**
Temporarily disabled the guard in `PipelineRunNotifyBus.handleNotification`
(`if (originInstanceId != instanceId)` → `if (true)`) and re-ran the self-echo test:

```
[info] - should self-echo guard: instance A's own local subscriber receives its own published event exactly once *** FAILED ***
[info]   List("queued", "queued") was not equal to List("queued")
```

Confirms the test actually exercises the guard (per MISTAKES.md "a guard that cannot fail must
not be written"). Restored the real guard and re-ran: all 6 tests in
`PipelineRunCrossInstanceSpec` pass, including this one.

## Design constraints honored (no deviation)

- LISTEN connection: raw `DriverManager` connection outside both HikariCP pools, plain
  non-privileged `helio.db.user`/`password` credentials — never `helio_privileged`.
- No Flyway migration added; V111 remains free.
- Listener loop runs on a dedicated daemon `Thread`, never a Pekko dispatcher.
- `errorLog` NOTIFY truncation is UTF-8 byte-length based (encode then trim at a valid boundary),
  not `String.length`/char-count — verified by a dedicated CJK/emoji back-off unit test and a
  live oversized-payload integration test.
- `pg_notify` call uses Slick's parameterized `sql"..."` interpolation, never string-concatenated
  `errorLog`/`pipelineId` content.
- Self-echo guard: per-instance random `instanceId` tagged on every NOTIFY payload; a received
  notification whose `instanceId` matches this instance's own is dropped before local delivery.
- Both `cd-backend.yml`'s `--max-instances=2` comment and `application.conf`'s "total max
  connections per instance" comment updated to the correct post-change 11/instance, 22 total.
- No frontend changes: `pipelineRunFanout.ts`/`usePipelineRunEvents.ts` untouched (`git diff
  --stat -- frontend/` is empty); full frontend `npm test` suite (335 suites, 3652 tests) run and
  green.
