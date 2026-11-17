## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed: ticket.md, proposal.md, design.md, tasks.md (incl. Standing Constraints) at HEAD
54b18b7ce54d9e87cf969f9db947811b415065c1 (artifacts untracked). Each claim below was checked against the code.

### What I verified (with evidence)

**Mechanism (proposal Why, design Context)**
- The spec's `putRows` (`e2e/hel1277-output-history-scrubber.spec.ts:39-45`) is called at :117 and :125 (test 1) and :267
  (test 2). Each call comes after the pipeline's first manual run, so a downstream pipeline exists when the write lands.
- `DataSourceService.replaceRows` (`:887`) takes the `DatasetSource` branch. It awaits `triggerAutoRunAwaited` (`:899`,
  defined `:126`), which calls `AutoRunTriggerService.triggerAutoRun` (`:61`). That calls `evaluateAndSchedule` (`:73`),
  which calls `upsertDebounce(pipelineId, now + debounceSeconds)` (`:78`). The upsert happens before the PUT returns 200,
  so a delete issued right after the 200 sees the row. The design cites `DataSourceService.scala:894`, but the method is
  at 887 and the call at 899. This is cosmetic.
- A scheduling failure is logged and swallowed (`:130-133`). If that happens, no row is armed. D1's assert-exactly-one-row
  then fails loudly instead of passing silently, which is the right behavior.

**Round-1 CR1 (authority): resolved.** Proposal Why and Non-goals, D1's alternatives and D2 now rest on
`openspec/specs/dataset-write-auto-run/spec.md:10-16`. I re-read those lines: a successful dataset write SHALL schedule a
debounced auto-run, and no manual-run cancellation is described. The archived rearm design (`design.md:124`) is now
described accurately as the in-flight-run case only. I checked the lines and they match. No "owner-accepted" attribution
remains in the artifacts.

**Round-1 CR2 (RLS shape): resolved and correct.** `V110__pipeline_auto_run_debounce.sql` has `pipeline_id TEXT PRIMARY KEY`
and `claimed_at`, ENABLE and FORCE RLS, and an owner policy through
`pipelines.owner_id = current_setting('app.current_user_id')::uuid`. The planned
`BEGIN; SET LOCAL app.current_user_id; DELETE ... WHERE pipeline_id = ... AND claimed_at IS NULL RETURNING pipeline_id; COMMIT;`
has the same shape as the existing `backdateHistory` (`e2e/support/historySeed.ts:22-44`). That helper uses the same `psql`
(`-q -At`, `ON_ERROR_STOP`), and `SAFE_ID`/`UUID` are already defined at `:11-12`. The only other migration that touches
the table is V125 (adds `guard_retry_count`), so no second piece of auto-run state is missed. The pipeline row is deleted
in `finally`, and the FK `ON DELETE CASCADE` removes any debounce residue.

**Round-1 CR3 (bounded forced-wait): resolved.** D0.3 and D3 fix the poll at 1 s steps for at most 50 s. That covers the
5 s debounce, one full 30 s tick, the run time and a margin. Only the temporary variant may raise `test.setTimeout`; the
committed spec stays at 120_000. The green re-run in task 2.3 covers at least one tick after `fire_at`, so it tests the
mechanism and does not just shrink the timing window. Neither CI workflows nor e2e config override
`DATASET_WRITE_DEBOUNCE_SECONDS` or `SCHEDULER_TICK_INTERVAL_SECONDS`. The only mention is a comment in
`e2e/hel1094-sse-fan-out-panel-refresh.spec.ts:10-18` that confirms the 30 s and 5 s defaults.

**Falsifiability and ACs**
- AC1: D0.1 tries the CI artifact. D0.2 reads the thinning code to rule the UTC theory in or out. D0.3 is a forced probe
  with a stop-and-report branch if the hypothesis fails (no 4th point, or a 4th point whose `triggerSource` is not
  `auto-run`). No retries, sleeps or longer committed timeouts are planned.
- AC2: red comes from D0.3. Green is `--repeat-each=20 --workers=2` (2 themes x 20 = 40 per test), within the Playwright
  cap of 2 workers.
- AC3: answered by D2 with evidence. A real duplicate-point finding sends the plan back for revision and a new gate.
- Standing Constraint C1 encodes the labelling rule ("forced repro of the mechanism").
- Test 2's exposure is real: a landed auto-run would make the `previous_run` baseline equal the current data. Task 2.2
  covers both tests.
- No API, schema or contract change. Test-only scope matches the ticket.

### Verdict: CONFIRM

### Non-blocking notes
- The design says `DataSourceService.scala:894`. The method is at :887 and the awaited trigger call at :899. Correct this
  if the line is reused in the PR body.
- In tasks.md, the "### Tests" heading sits under "## 1. Probe", but its tasks are numbered 2.x. It is cosmetic, and the
  hygiene check counts checkboxes only.
- When implementing the helper's returned-id check, filter psql's output lines for exact equality with `pipelineId`, like
  `setUserTierForTest` does. Do not use a UUID regex unless pipeline ids are confirmed to be UUIDs.
