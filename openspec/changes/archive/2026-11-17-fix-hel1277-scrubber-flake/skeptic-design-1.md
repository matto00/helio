## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed: ticket.md, proposal.md, design.md, tasks.md at HEAD 54b18b7ce54d9e87cf969f9db947811b415065c1
(the artifacts are untracked; the code below was read from that tree).

### What I verified (with evidence)

**(a) PUT rows on a static source arms a debounce row, and the tick fires it as a real run that writes a history point. CONFIRMED.**
- The spec creates `type: "static"`. That is a wire alias normalized to `dataset`
  (`DataSource.scala:266-280`; `DataSourceRepository.scala:101` stores `DataSourceKind.Dataset`), so
  `DataSourceService.replaceRows` (`:887`) takes the `DatasetSource` branch and awaits
  `triggerAutoRunAwaited` (`:126`).
- `AutoRunTriggerService.evaluateAndSchedule` (`:73-82`) calls `debounceRepo.upsertDebounce(pid, now + 5s)` when
  the verdict is autoRunnable. The default is 5 s (`:169`). Neither `.github/workflows/*` nor the Playwright config
  overrides `DATASET_WRITE_DEBOUNCE_SECONDS` or the tick interval.
- `PipelineAutoRunDebounceFirer.processAutoRunDebounce` claims due rows and then `submitAutoRun` ->
  `pipelineRunService.submit(..., TriggerSource.AutoRun)`. `PipelineRunSucceededWrites.scala:119-146` writes
  `OutputHistoryInsert` on every successful run. I found no dedupe on unchanged data, so a redundant auto-run does add a point.
- No manual-run path touches the debounce table. Only ApiRoutes/Main (wiring), AutoRunTriggerService,
  the Firer, the SchedulerService and the repository reference it. So "manual runs do not clear the pending row" holds.
- The authenticated history response carries `triggerSource` (`schemas/outputs/output-history-response.schema.json:287`),
  so D0.3's "log its triggerSource" is feasible.

**(b) Rearm design line 124 records redundant auto-runs as an owner-accepted trade. NOT AS CITED.**
- `openspec/changes/archive/2026-10-11-rearm-dropped-dataset-auto-run/design.md:124` reads: "With D1 the in-flight
  run may already have read the write, and the follow-up run is then redundant ... the owner's chosen trade."
  That bullet covers the **D1 active-run case**: a write arrives while a run is in flight, and the claim is
  `unclaim`ed and fires after that run. This spec's case is different. Each manual run starts after the
  write and finishes well before `fire_at`, so at fire time `hasActiveRunInternal` is false and the plain HEL-1093 fire path
  runs. Line 124 does not rule on that case.
- The conclusion still holds, but on a different authority. The living spec
  `openspec/specs/dataset-write-auto-run/spec.md:10-16` requires that a successful dataset write SHALL schedule
  a debounced auto-run of every eligible downstream pipeline. Nothing there lets a manual run cancel it. The 4th point is
  spec-required behavior, not a defect. The artifacts cite the wrong authority and call it "owner-accepted"
  in three places: proposal Why, proposal Non-goals, and design D1 "Alternatives rejected". If they ship as written,
  the PR would carry a false attribution of an owner ruling.

**(c) Exact-id delete of the debounce row. SOUND, with one ambiguity.**
- The table and columns exist: `V110__pipeline_auto_run_debounce.sql:14-18` (`pipeline_id TEXT PRIMARY KEY`, `fire_at`,
  `claimed_at`), plus `guard_retry_count` (V125). There is one row per pipeline (PK), and each test pipeline has one
  root, so "exactly one row deleted" is the right assertion.
- RLS: the table has ENABLE + FORCE RLS. The policy is an owner check through `pipelines.owner_id = current_setting('app.current_user_id')::uuid`.
  CI connects as `helio`, the `POSTGRES_USER` of the service container (`ci.yml:585-599`), which is a superuser, so RLS is bypassed there.
  A non-superuser connection without the setting would see zero rows, or error on `current_setting`. Either way it fails
  loudly, but the design leaves the choice open ("RLS session setting if the table needs one").
- Claim semantics: `claimDue` matches only `fire_at <= now`. `fire_at` is write time + 5 s, and the delete runs right after the
  PUT's 200, so the tick cannot claim first unless more than 5 s pass between the two. If that did happen, `claimed_at IS NULL` makes the
  delete match 0 rows and the helper throws. The failure is loud, not silent. A later `putRows` upserts a fresh row
  (`ON CONFLICT ... claimed_at = NULL`), so cancelling after every write is correct. The design also covers the
  first write's own auto-run, which could land between run 2 and run 3 if the gap exceeded 5 s plus the tick phase.

**(d) The probe can falsify the hypothesis. YES.**
- D0.3 fails the hypothesis in two ways: no 4th point appears within the bound, or the 4th point's `triggerSource` is not
  `auto-run`. The design says to stop and report in either case. D0.2 checks the UTC theory against code: thinning only
  deletes and keeps the newest 101 points (CLAUDE.md, OutputHistoryRepository `thinPass`). D2.3 re-runs the forced-wait
  variant after the fix and expects no 4th point. That tests the mechanism rather than shrinking the timing window.
- One limit, acknowledged in D0.1: the forced repro shows the mechanism can produce this failure. It does not prove it caused
  the CI failure. Only the CI artifact can prove that, if it still exists. This is acceptable for a timing flake. The executor should label it that way
  and should not claim it reproduced the CI run itself.

**Other checks**
- Scope: test-only, matches AC1-3. AC3 is answered with evidence via D2. No retries, sleeps or larger timeouts are planned.
- No contract delta is needed: there is no API or schema change.

### Verdict: REFUTE

Narrow revisions only. The mechanism and fix are sound. The written rationale cites an owner ruling for a case
that ruling does not cover, and the RLS handling is left open.

### Change Requests

1. **Fix the misattributed authority (proposal.md "Why" and "Non-goals"; design.md D1 "Alternatives rejected"; D2).**
   Rest "the extra point is intended behavior / not a product defect" on
   `openspec/specs/dataset-write-auto-run/spec.md:10-16`: a successful write SHALL schedule a debounced auto-run, and
   a manual run does not cancel it. Restate rearm design:124 accurately, as covering the in-flight-run (D1 unclaim) case only.
   Remove "owner-accepted trade" / "owner's recorded trade" wherever it claims an owner ruling for the
   manual-run-then-auto-run case. If the planner believes manual-run-supersedes-pending is worth considering, record that as
   a possible follow-up, not as a ruled decision.
2. **Decide the RLS handling in D1 (design.md D1, tasks 2.1).** Replace "RLS session setting if the table needs one" with
   a fixed shape that matches `backdateHistory`:
   `BEGIN; SET LOCAL app.current_user_id = '<userId>'; DELETE FROM pipeline_auto_run_debounce WHERE pipeline_id = '<id>' AND claimed_at IS NULL RETURNING pipeline_id; COMMIT;`
   Validate both ids (UUID for the user, SAFE_ID for the pipeline) and throw unless exactly one returned id equals the pipeline id.
   This keeps the helper correct on a non-superuser connection, not only on CI's superuser.
3. **Bound the forced-wait variant explicitly (design D0.3 / D3, tasks 1.3 / 2.3).** State the poll bound, at least
   debounce 5 s + one full tick 30 s + run time + margin (for example 50 s), so the green "no 4th point" result in 2.3 comes from a
   wait that must have covered at least one tick after `fire_at`. Confirm it fits under `test.setTimeout(120_000)`, or raise the timeout
   for the temporary variant only, never in the committed spec.

### Non-blocking notes
- D0.3/D3 evidence should say "forced repro of the mechanism", not "reproduced the CI failure", unless the CI trace
  is recovered and shows a 4th point with `triggerSource: auto-run`.
- Test 2 ("vs" overlay) is also exposed. An auto-run landing before its history check would make baseline equal current.
  The plan already covers it in 2.2.
