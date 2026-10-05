## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed head: c6fb73fa4f4f4339f3af22e13744a6c7063e6198 (b0b33973 impl + c6fb73fa spec-text alignment).

### Phase 1: Spec Review — PASS
Issues: none.
- Scope matches the ticket: history route, D6 resolution, public allow-listed variant, compare validation, schemas.
- C1: no new history SQL, no migration. C2: Main.scala untouched; ApiRoutes +9/-1 (service val, import, ctor args), JsonProtocols +1.
- Every config write path covered: OutputService.create/update (merged config), PatchSetPreviewProjection, PipelineService.validateOutputFieldMapping (single-call create + proposal grounding), patch-set apply/rollback route via OutputService.update. PatchSetUndoService re-insert deliberately left alone (documented, design D2).
- c6fb73fa claims verified: V94:845 `panels_output_kind_requires_output_id` check constraint exists (so the "not an Output panel / Output deleted" wording is right); proposal grounding reports a per-Output validationError (mutation of the PipelineService hunk turns the "report an invalid compare on a proposed Output as that Output's validationError" test red).

### Phase 2: Code Review — PASS
Gates (own runs, WORKTREE_PATH, c6fb73fa):
- `HEL924_TEST_GROUP_CONCURRENCY=2 nice -n 19 sbt testFull`: 5902 tests, 0 failed, 411 suites, 0 aborted. No FirstRunRoutesSpec timeout (the only "timed out" lines are unrelated log text). The first background launch produced no sbt output (environmental, a concurrent sbt server); re-run in the foreground was clean.
- `npm run check:schemas`: in sync. `npm run check:scala-quality`: clean (only pre-existing soft warnings).
- Statement counts measured in my run: authenticated 3 pts app=4 priv=3, 150 pts app=4 priv=3 (=7); public app=0 priv=9 at both 3 and 150 pts. Matches the evidence claim.
- NOSUPERUSER/rolbypassrls posture test is the first test in OutputHistoryRoutesSpec (line 79) and the harness throws if the role bypasses RLS.
- Explicit-null seam: hand-written writers emit JsNull for every nullable field; schemas strict (additionalProperties false); public response built field-by-field with no runId/triggerSource/ownerId (public type has no such field).

Mutation sample re-run by me (each restored via `git checkout -- src/main`; worktree clean afterwards):
| Mutation | Spec | Result |
|---|---|---|
| target from `Instant.now()` instead of latest point (D6) | OutputHistoryRoutesSpec | RED x3 (T-8d, limit=1, custom/1d) |
| `availableFrom = earliest` (no +w) | OutputHistoryRoutesSpec | RED (availableFrom test) |
| per-point extra `earliest` read | OutputHistoryQueryCountSpec | RED x3: (4,6) vs (4,33); 8 > 7; (0,12) vs (0,39) |
| `findById` -> `findByIdInternal` (non-grantee 404) | OutputHistoryRoutesSpec | RED (grantee/non-grantee test) |
| OutputService.update `validateConfig` -> `validateFieldMapping` | OutputCompareWriteValidationSpec | RED x2 |
| PipelineService compare check removed | OutputCompareWriteValidationSpec | RED x2 (single-call create, proposal grounding) |
Each failed for the stated reason. The remaining rows of the 24-mutation table were not re-run (sample covered the D6, availableFrom, ACL, write-site and query-count classes requested).

Non-blocking: PublicDashboardRoutes.scala is now 506 lines (was 463; CONTRIBUTING says propose a split in the PR description at ~400). Design already notes this; ensure the PR body carries the split proposal.

### Phase 3: UI Review — N/A
No frontend/** change. ApiRoutes/schemas triggers are backend wiring only; no UI surface.

### Overall: PASS

### Change Requests
none

### Non-blocking Suggestions
- Put the PublicDashboardRoutes split proposal in the PR body (see above).
