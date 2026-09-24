## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed commit `e2e5ffe54e9fd3f4fe6a0cb71ffbecf1920d5a9f` (HEAD, unchanged
across my review). Diff base LIVE-resolved via `resolve-review-base.sh`:
`853fb0a2a08bbf27d7d5f62ddefe2b2f8d3fef03` (matches `origin/main`, matches
the orchestrator's stated base). All verification below is from my own
fresh command runs and file reads, not from the executor's or evaluator's
narrative.

### What I verified (with evidence)

1. **Diff scope matches files-modified.md.** `git diff --stat 853fb0a2...HEAD`
   shows exactly the files claimed: `PipelineRunRegistry.scala`,
   `PipelineRunNotifyBus.scala` (new), `ApiRoutes.scala`, `Main.scala`,
   `application.conf`, `cd-backend.yml`, plus 4 test files and openspec
   artifacts. No frontend files touched (`git diff --stat ... -- frontend/`
   is empty).

2. **Full backend suite, fresh:** `cd backend && sbt -batch test` →
   `Total number of tests run: 4778`, `Suites: completed 323, aborted 0`,
   `Tests: succeeded 4778, failed 0`, `All tests passed.` (328s). Matches
   the evaluator's claimed count exactly.

3. **Full frontend suite, fresh:** `npm test` → helio-mcp `28 suites / 271
   tests` passed, frontend `335 suites / 3652 tests` passed, `1 snapshot
   passed`. Matches evaluator's claim exactly, and confirms HEL-1094's
   `pipelineRunFanout`/`usePipelineRunEvents` consumers are unaffected.

4. **Independently reproduced both required red/green mutation proofs**
   (the evaluator explicitly disclosed it did NOT re-run the put-overwrite
   revert itself — I closed that gap):
   - **Local put-overwrite (task 3.1/3.2):** mutated `subscribe` to
     `subscribers.clear(); subscribers.add(ref)` (simulating the old
     unconditional-overwrite semantics), ran only "deliver a published
     event to BOTH of two concurrently subscribed clients" →
     `*** FAILED *** java.util.concurrent.TimeoutException: Future timed
     out after [5 seconds]`. Restored the file (verified `git status`
     clean on it), re-ran the full targeted spec set (62 tests across
     `PipelineRunRegistrySpec`/`PipelineRunNotifyBusSpec`/
     `PipelineRunCrossInstanceSpec`/`PipelineRunRoutesSpec`) → all green.
   - **Self-echo guard (task 3.4):** mutated `handleNotification`'s
     `if (originInstanceId != instanceId)` to `if (true)`, ran only the
     self-echo test against real `EmbeddedPostgres` →
     `*** FAILED *** List("queued", "queued") was not equal to
     List("queued")` — the exact failure shape `files-modified.md` and
     `evaluation-1.md` both claim. Restored the file, re-ran green (12
     tests across `PipelineRunRegistrySpec`/`PipelineRunCrossInstanceSpec`).
   Both mutations are real fault injections into the actual guarded
   logic, not vacuous — this satisfies MEMORY's "red vs guard" bar.

5. **Cross-instance proof is a genuine two-instance simulation, not a
   mock:** `PipelineRunCrossInstanceSpec` spins up `EmbeddedPostgres`, two
   independent `PipelineRunRegistry`+`PipelineRunNotifyBus` pairs, and
   proves (a) no eventBus → event never crosses (permanent red
   characterization of today's unwired default), (b) wired → event
   published on registry A's bus reaches a subscriber on registry B, (c) no
   cross-pipeline leak, (d) self-echo guard. All read and re-run fresh by
   me; all pass.

6. **ACL scoping — no cross-tenant/cross-pipeline leak via the new NOTIFY
   channel:**
   - `PipelineRunStreamRoutes.scala` (the sole `pipelineExistsShared` gate,
     line 29, `runService.pipelineExistsShared(pipelineId, user)`) is
     **not present in the diff at all** — confirmed via `git diff --stat`.
   - `PipelineRunNotifyBus.encodePayload` (read in full) emits only
     `originInstanceId`, `pipelineId`, `status`, `rowCount`, `errorLog`,
     `nodeId`, `nodeKind` — no user/tenant identity ever crosses the
     channel.
   - `Channel = "pipeline_run_events"` is a `val`, never derived from
     request input.
   - New tests (`PipelineRunCrossInstanceSpec`'s "does not leak across
     pipelines", `PipelineRunRoutesSpec`'s new pipeline-X/pipeline-Y test)
     both pass fresh, proving a NOTIFY for pipeline Y is never delivered
     to a subscriber of pipeline X.

7. **No Flyway migration; V111 remains free:** `ls
   backend/src/main/resources/db/migration | sed -E 's/^V([0-9]+).*/\1/' |
   sort -n | tail -1` → `110`. `git diff --stat` for that directory is
   empty. `PipelineRunNotifyBus` uses no schema object (session-level
   LISTEN/NOTIFY only) — consistent with D3.

8. **Connection-budget comments — correct and mutually consistent.**
   Read `application.conf` lines 83-84 (`maximumPoolSize = 5`, app pool)
   and 129-130 (`maximumPoolSize = 5`, privileged pool) — confirms the
   5+5=10 baseline. The updated comments state: `application.conf` — "total
   max connections per instance is now 11 (5 app + 5 privileged + 1
   dedicated... LISTEN connection...)"; `cd-backend.yml` — "5 app + 5
   privileged + 1 dedicated LISTEN connection... = 11/instance, 2 × 11 =
   22 total". Arithmetic is correct (5+5+1=11, 2×11=22) and both comments
   cross-reference each other and the true post-change shape — matches C9's
   `2x(10+1)=22` mandate exactly.

9. **Design-gate corrections actually shipped (not just narrated):**
   - UTF-8 byte-length truncation: `truncateUtf8` (read in full) encodes to
     UTF-8 first, backs off to a valid character boundary via decode-retry,
     never a raw byte slice or `String.length` count. Tested by
     `PipelineRunNotifyBusSpec`'s CJK/emoji fixtures (re-run, pass) and
     `PipelineRunCrossInstanceSpec`'s live oversized-payload integration
     tests (re-run, pass, including a real `pg_notify` round trip that
     doesn't throw).
   - CoordinatedShutdown claim: `grep -rn "CoordinatedShutdown"
     backend/src/main/scala/` → only the one new registration in
     `Main.scala` — confirms this is genuinely the first use, as the
     comment claims.
   - `application.conf`'s comment was in fact updated (see #8) — the round-1
     miss is fixed.

10. **Gates re-run fresh, all clean:** `npm run check:no-credential-leak`
    (0 violations), `npm run check:schemas` (100 protocol files in sync),
    `npx openspec validate pipeline-run-event-broadcast --strict` → "is
    valid", `npm run check:scala-quality` (clean, only 182 pre-existing
    soft file-size warnings unrelated to this diff), `npm run lint` (0
    warnings), `npm run typecheck` (clean), `npm run format:check` (clean).

11. **Live UI check (design-judgment/functional, no UI changed):** started
    servers via the canonical scripts (`PASS servers`), confirmed via
    `pg_stat_activity` that the running backend process actually holds a
    live `LISTEN pipeline_run_events` connection (pid 969347, idle,
    `query = LISTEN pipeline_run_events`) — i.e. the server under test is
    genuinely running this feature, not stale code. Navigated to the
    evaluator's pre-existing "HEL-1168 eval pipeline" detail page, clicked
    "Run pipeline," and watched the status update live to "Succeeded" via
    the existing SSE hook with no page reload. Cross-checked
    `pg_stat_activity` again and found a fresh `SELECT pg_notify($1, $2)`
    query at the same timestamp as the click — confirming `notifyRemote`
    actually fired on a real user action, not just in a unit test. One
    pre-existing, unrelated console error (`404` on `GET
    /api/pipelines/:id/schedule` for a pipeline with no schedule) —
    untouched route, not a regression.

### AC-by-AC trace

- Multiple concurrent subscribers all receive every event, put-overwrite
  gone → `PipelineRunRegistry.scala` `Set[ActorRef]` per pipeline id;
  proven red-then-green (my own reproduction, #4).
- Cross-instance A→B delivery, proven with two registry/backend instances
  sharing one DB → `PipelineRunCrossInstanceSpec` (#5), genuinely
  reproduced.
- ACL scoping stays exactly as `pipelineExistsShared` has it, no
  cross-tenant leak → confirmed unchanged file + payload contents + new
  leak tests (#6).
- HEL-1094 frontend fan-out and pipeline detail page still work → zero
  frontend diff, full frontend suite green (#3), live browser check (#11).
- No blocking in actor paths, subscribers cleaned up on disconnect →
  `watchTermination()`-based removal (D5), dedicated `Thread` (not a Pekko
  dispatcher) for the blocking `getNotifications` poll (D8), confirmed by
  reading the code and its passing disconnect-cleanup test.

Every AC is traced to real evidence I reproduced myself. No gap found.

### Verdict: CONFIRM

### Non-blocking notes

- Same disclosed assumption carried since design-gate round 1/2: the
  "~30 connections previously exhausted db-g1-small" figure is an inferred
  reading of a historical comment, not a confirmed Cloud SQL
  `max_connections` value. Already disclosed in `design.md`; worth a real
  `SHOW max_connections;` check against prod at some point, not blocking.
- `specs/pipeline-run-sse/spec.md`'s "A third subscriber joining does not
  disrupt existing subscribers" scenario has no dedicated 3-subscriber
  test (only 2-subscriber tests exist). Not blocking — the underlying data
  structure change is a `Set`, which trivially generalizes past 2 members;
  flagging only so a future editor doesn't assume a literal 1:1 test exists
  for that exact scenario.
- No gate-defect finding: I did not rely on any mtime-ordering or otherwise
  fragile evidence from the evaluator's report — every claim I cite above
  was independently reproduced against the live tree.
