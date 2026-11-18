## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD: `1d84cbd58ca99375b332a87060ee152b93c4526c`. Diff base resolved live with `resolve-review-base.sh`:
`36735a24aef109328a3c1909ecb63721cc5fa2ff`. After a fresh `git fetch`, this is `origin/main`, and HEAD contains it.

### What I verified (with evidence)

- **Spawn-cwd guard:** `READY ambient=/home/matt/Development/helio branch=feature/insight-render-store-read-api/HEL-1742`.
- **Migration number:** after the fresh fetch, the two highest migrations on `origin/main` are V141 and V144. The
  branch adds `V145__output_insights.sql`, which is ascending, so it needs no outOfOrder. Driver constraint C1 holds.
- **AC "non-grantee gets the same 404 as an unknown id":**
  - Code: `OutputInsightReadService.authorized` returns the same `NotFound("Output not found")` for three cases: a
    failed `outputRepo.findById(id, user)`, an Output the user cannot access, and an Output whose kind is not
    `insight`.
  - Tests that pass in my run (through `ApiRoutes`' production wiring, via `OutputInsightApiHarness`):
    - `OutputInsightRoutesSpec` "answer a non-grantee with exactly the 404 an unknown id gets". It checks both status
      and body, and also runs for history.
    - `OutputInsightRoutesSpec` "answer an accessible non-insight Output with the same 404".
  - Red run on record: mutations.md M1 and M4.
- **AC "public route's schema test shows no cost, model or run-id fields":**
  - Schema: `schemas/outputs/public-output-insight-response.schema.json` sets `additionalProperties: false` at all
    three object levels. Its only fields are render, markdown, citations, renderedAt, and per citation id, field,
    number, date, capturedAt and isPct.
  - Projection: `OutputInsightResponses.public` builds a separate allow-list type field by field. It does not filter a
    copy of the full record.
  - Test: `OutputInsightPublicRoutesSpec` builds a row with every column populated and checks four things:
    - the exact key sets at each level;
    - that the response validates against the schema;
    - that no leak marker appears in the raw body (model, run id, digest, cited Output id, token counts, cost,
      trigger, status);
    - that no schema key matches cost, token, runid or digest.
  - It passes in my run. M3 is the recorded red run.
- **AC "deleting the Output cascades":**
  - The migration declares `output_id TEXT NOT NULL REFERENCES outputs(id) ON DELETE CASCADE`.
  - Outputs are hard-deleted (`OutputRepository.deleteOutputsCoreAction`, `table.filter(...).delete`).
  - Test: `OutputInsightRlsSpec` "disappear with its Output (ON DELETE CASCADE)" passes in my run. M12 is the
    recorded red run.
- **AC "reads never regenerate; no model client by construction":**
  - The constructor is exactly `(OutputRepository, OutputInsightRepository)(ExecutionContext)`.
  - The repository read methods are SELECT only, and the service has no write call.
  - Wiring: `ApiRoutes` builds the service from `outputRepo` and a new `OutputInsightRepository(dbContext)`. It does
    not depend on `OutputService`.
  - Tests that pass in my run:
    - `OutputInsightReadServiceShapeSpec` checks the constructor parameters and the declared field types.
    - `OutputInsightRoutesSpec` "never create or change a row".
  - M15 is the recorded red run.
- **AC "live RLS as the non-BYPASSRLS role":**
  - I read the `rls-live-check.md` transcript. Inside one transaction that was rolled back, it shows `helio_app`
    with rolsuper = f and rolbypassrls = f. The owner and grantee each see 2 rows, the stranger sees 0, a stranger
    INSERT fails with an RLS violation, a request with no user context sees 0, and nothing remains afterwards.
  - I did not re-run that psql script. It applies DDL to the shared dev DB inside a transaction, and the brief forbids
    applying this migration there.
  - Instead I re-ran `OutputInsightRlsSpec`, which runs the same checks as the non-BYPASSRLS role `helio_app_test`.
    Its first test asserts `rolsuper OR rolbypassrls = false` for `current_user`. All of its tests pass.
- **Ticket table and RLS requirements:**
  - The columns match the ticket's list.
  - RLS: ENABLE and FORCE, plus four policies on `helio_can_access_pipeline(pipeline_id)`. I compared these line by
    line with V115's policies, including the UPDATE policy being USING-only, as V115 has it.
  - There is an explicit `GRANT ... TO helio_privileged`.
  - `RlsPolicyGuardSpec.rlsTables` gains `"output_insights" -> None`.
- **Three endpoints:**
  - `OutputRoutes` serves `path("insight")` and `path("insight" / "history")`. The history route reuses
    `OutputHistoryQueryParsing`, so an out-of-range value is a 400 and is never clamped.
  - `PublicDashboardRoutes` serves `Segment / "insight"`, wrapped in `authorizeResourceWithSharing("dashboard", ...,
    token)` before the resolver runs, the same way the `history` route is.
  - Public tests that pass: private dashboard (an anonymous caller and a signed-in stranger both get the same response
    as an unknown dashboard), a share token (200, and a wrong token gets 404), a panel from another dashboard (404), a
    non-insight panel (404), and an insight Output with no ok render (`{render:null}`, no status leak).
- **Retention per tier on the scheduler tick:**
  - The insight purge is a third part of `OutputHistoryRetentionService.runPass` and is included in the `failed`
    precedence. `insightRepo` has no default value, so `Main` must wire it, and it does.
  - I read the purge SQL:
    - a row must be older than both the shortest tier cutoff and its own tier's cutoff (`COALESCE` falls back to the
      shortest cutoff when the tier is missing);
    - the newest row of any status is kept (`EXISTS` a newer row);
    - the newest ok row is kept (`NOT (ok AND NOT EXISTS a newer ok)`);
    - all values are bound as parameters.
  - `OutputInsightRetentionSpec` covers the tier ages and both keep rules, and passes. `OutputHistoryRetentionServiceSpec`
    (failure precedence) passes. M9, M10, M11, M16 and M17 are the recorded red runs.
- **AC "update CLAUDE.md":**
  - Three endpoint bullets are added at CLAUDE.md lines 171-173.
  - The `ANTHROPIC_API_KEY` row no longer says "no route consumes this yet". It now lists the AI steps, authoring,
    refinements and the assistant.
  - The stale wording in the `ClaudeClient.scala` scaladoc is updated too.
- **Gates, re-run by me on `1d84cbd58`:** `nice -n 19 sbt -J-Xmx3g testOnly` over the 7 suites (OutputInsightRoutesSpec,
  OutputInsightPublicRoutesSpec, OutputInsightRlsSpec, RlsPolicyGuardSpec, OutputInsightReadServiceShapeSpec,
  OutputInsightRetentionSpec, OutputHistoryRetentionServiceSpec). ScalaTest's own totals:
  `Suites: completed 7, aborted 0` / `Tests: succeeded 185, failed 0, canceled 0, ignored 0, pending 0` /
  `All tests passed.`
  - Log: `/home/matt/Development/helio/.concertino/scratch/HEL-1742/skeptic-final-tests.log`.
  - For the full suite I rely on the evaluator's pasted totals (9783 succeeded, 0 failed, 5 canceled HELIO_MEASURE
    specs), which are unambiguous.
- **UI judgment:** not applicable. No `frontend/**` file changed, so DESIGN.md does not apply. I started no servers, so
  the shared dev DB is untouched.
- **Mutation evidence:** I read mutations.md as a claim. M1-M17 each record a red ScalaTest total that matches the
  test that should fail. I did not repeat them, because code changes are out of scope for this role.

### Verdict: CONFIRM

### Non-blocking notes

- `OutputInsightReadService.read` runs `latestOk` and `latestAttempt` as two separate statements. If L4 inserts a row
  between them, `render` can be newer than `lastAttempt` for that one response. The effect is cosmetic, so it is worth
  a note for L4/L5 rather than a fix here.
- CLAUDE.md puts the insight retention sentence inside the public-route bullet. It would be easier to find in its own
  bullet or next to the `OUTPUT_HISTORY_MAX_AGE_DAYS_*` rows.
- `rls-live-check.md` was recorded when the migration was named V142. The evaluator confirmed that the rename changed
  only the header comment (lines 13-14) and none of the DDL, and the automated RLS spec runs against the V145 file.
- `OutputRoutes.scala` remains slightly over the 250-line soft budget (a soft warning, already noted by the evaluator).
- No gate defect: none of the evidence here depends on mtime ordering.
