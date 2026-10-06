## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed at HEAD d9473814f16df0c54ef76117c00ce9c071297b2b (change dir untracked; artifacts read from disk).

### What I verified (with evidence)

- **Owner rulings Q1/Q2**: `.concertino/runs/HEL-1276/events.jsonl` carries `escalation.answered` with
  `sub_answers ["1mib-skip","output-config"]`, `answer_source: human`. Treated as settled.
- **V116 free**: `backend/src/main/resources/db/migration` tops out at `V115__output_snapshot_history.sql`.
- **D9 seam exists without editing NodeSnapshotRepository**: `NodeSnapshotRepository.overwriteRowsWith(..., andThen: DBIO[Unit])`
  (NodeSnapshotRepository.scala:113-120) runs replace+andThen in one `withSystemContext` transaction;
  `PipelineRunService.scala:1435-1452` is the only caller. Composing `payloadAction.flatMap(insertAction)` into
  `andThen` keeps D9 with no edit to the HEL-1282-guarded files. Claim holds.
- **Privileged pool**: `DbContext.withSystemContext` (DbContext.scala:53-63) is the `helio_privileged` BYPASSRLS pool;
  the tier lookup (`pipelines JOIN users`) on that pool mirrors L2's `thinAndPurge` (OutputHistoryRepository.scala:98-115).
- **RLS / prod Flyway**: V115 is ENABLE+FORCE with four `helio_can_access_pipeline` policies plus explicit GRANT to
  `helio_privileged`; D-1 mirrors it. ALTERing `output_snapshot_history` as `helio` is fine (helio owns both tables
  as creator). Adding the FK on an all-NULL new column validates trivially; RI checks/actions bypass RLS (they run as
  the referencing table's owner with FORCE ignored), so `ON DELETE SET NULL` from a privileged-pool payload delete
  updates FORCE-RLS `output_snapshot_history` correctly. `FlywayNonSuperuserMigrationSpec` already runs the whole
  chain as NOSUPERUSER/NOBYPASSRLS table owner and has a FORCE-check list (line ~342) to register V116 in.
  `OutputHistoryRlsSpec` (helio_app_test NOSUPERUSER) and `RlsPrivilegedDmlSpec`/`RlsPolicyGuardSpec` are the right
  precedents (tasks 1.2, 6.5). Sound.
- **D5**: payload path rides the summary path inside `onUnblockedRunSuccess` (reached at PipelineRunService.scala:1290
  only); dry/blocked/failed runs never enter it. Sound.
- **Config validation sites**: `OutputService.scala:460` and `PipelineService.scala:684` are the two
  `OutputCompare.validateConfig` call sites, as claimed.
- **Retention**: L2 tier resolution via pipeline owner and fail-closed unknown tier confirmed in
  OutputHistoryRepository.scala:92-115; D-5's own advisory key and post-thinning unreferenced-payload purge are
  coherent and do not settle HEL-1285.
- **Public path**: `PublicOutputHistoryPoint` is a separate allow-list type (OutputHistoryProtocol.scala:28) and
  `PublicDashboardRoutes` gains nothing. Sound as designed, but under-tested (CR 3).
- **Wire contract (failed)**: `OutputHistoryPointResponse(capturedAt, runId, triggerSource, rowCount, summary)`
  (OutputHistoryProtocol.scala:12) and `schemas/outputs/output-history-response.schema.json` `historyPoint`
  (`required` at line 257, `additionalProperties: false` at line 258) expose **no point id** and no payload
  indicator. Nothing in proposal/design/tasks/spec changes that.

### Verdict: REFUTE

### Change Requests

1. **The new endpoint can't be reached through the API.** `GET /api/outputs/:id/history/:point/rows` takes a history
   point UUID, but no response anywhere returns point ids. The authenticated `historyPoint` shape has no `id`, and the
   schema is `additionalProperties: false`. A client also cannot tell which points have a payload. As planned, L7 (the
   stated consumer) could only call the route with ids pulled straight from the DB. Required changes:
   - Add `id` (UUID) and `hasPayload` (boolean) to the **authenticated** point only: `OutputHistoryPointResponse`,
     its writer in `OutputHistoryProtocol`, and `output-history-response.schema.json` `historyPoint`
     (properties + required).
   - Add a MODIFIED delta for the `output-history-api` capability. proposal.md currently says
     "Modified Capabilities: (none)", which is then false.
   - Add a task and a route-spec assertion that the history listing returns ids that resolve on the rows route.
   - Leave `PublicOutputHistoryPoint` and `public-output-history-response.schema.json` explicitly unchanged.
2. **Missing contract deltas** (CLAUDE.md: "Keep schema updates in the same change"; schemas are the source of truth):
   - Add a new response schema for `GET /api/outputs/:id/history/:point/rows`, e.g.
     `schemas/outputs/output-history-payload-response.schema.json`, covering
     `{pointId, outputId, capturedAt, runId, triggerSource, rowCount, rows}` with explicit-null handling stated.
   - Document `config.historyPayloads` (`boolean | null`) in `schemas/outputs/create-output-request.schema.json`,
     `update-output-request.schema.json` and `schemas/pipelines/create-pipeline-transactional-output-request.schema.json`,
     next to `compare`, which HEL-1273 documented in all three.
   - Add tasks for these and run `npm run check:schemas`.
3. **Make the public-dashboard AC concrete** (ticket AC: "public dashboards never receive payloads"). Spec scenario
   "any payload path under the public dashboard routes" and task 6.6 "public dashboard path returns no payload" are
   ambiguous. Specify and test both of these on a shared dashboard whose panel's Output has a stored payload:
   - (a) `GET /api/dashboards/:d/panels/:p/history` returns JSON with no `id`, `hasPayload`, `payloadId` or `rows`
     key on any point. This guards CR 1's new fields from leaking.
   - (b) `GET /api/dashboards/:d/panels/:p/history/<realPointId>/rows`, anonymous and with a valid share token, is
     `404` with no row data.

### Non-blocking notes

- D-3/D-5 trim and purge predicates: state explicitly that `pipeline_id = ?` is always included alongside the
  node predicate. The index leads with it, so this is presumably intended.
- Add a test that deleting a pipeline with payloads succeeds. Two cascade paths converge on `output_snapshot_history`
  (outputs → points CASCADE, and pipelines → payloads CASCADE → points SET NULL); prove the statement does not error.
- L2 thinning keeps one point per bucket, so on an active pipeline the retained payload count will usually sit well
  below the D4 "30 runs" cap. That is fine as a cap, but say so in Planner Notes so L7 doesn't assume 30 consecutive runs.
- Gate-defect check (CON-160): not applicable, since no evidence directories or mtime claims were involved.
