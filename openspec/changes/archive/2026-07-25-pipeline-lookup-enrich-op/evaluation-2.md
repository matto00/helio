## Evaluation Report — Cycle 2

Re-evaluation at commit `7cd82500dc0f6060116380ed33a9d8d45bae4271`, addressing evaluation-1.md's
blocking Phase 3 finding. Diff reviewed: `7564b178..7cd82500` (cycle-1 → cycle-2 commit).

### Phase 1: Spec Review — PASS
Issues: none.

- `tasks.md` unchanged (no new task items — this was change-request remediation, not new scope);
  `files-modified.md` gained a "Cycle 2" section documenting the root-cause probe (systematic-
  debugging evidence: read `PipelineService.scala:294-301` pre-fix, traced `defaultConfigFor
  ("lookup")` against the unguarded `lookupCheckF` match arm, reproduced the 404 with a new test
  before the fix, confirmed 201 after) — this is genuine probe-before-fix evidence, not just a
  claim.
- `specs/pipeline-lookup-op/spec.md` gained two new scenarios ("Lookup step creation with the
  picker's empty-default reference source succeeds" / "Clearing a lookup step's reference source
  back to empty on update stays allowed") that precisely match the two new
  `PipelineStepRoutesSpec` tests — verified both live (see Phase 3) and via the test file diff.
- No scope creep: the diff touches exactly `PipelineService.scala` (the ACL guard),
  `PipelineStepRoutesSpec.scala` (regression tests), `PipelineDetailPage.tsx`/`.test.tsx` (toast
  surfacing), plus the openspec artifacts — nothing outside the change-request scope.
- `unionCheckF` deliberately left untouched, confirmed by diff (only comment-line changes near it,
  zero code changes) — matches the commit's stated "out of scope, spinoff HEL-620" note.

### Phase 2: Code Review — PASS
Issues: none blocking.

- Gates re-run fresh (not trusting the commit's self-reported numbers):
  - `sbt test`: **1924/1924** passed (1922 cycle-1 baseline + 2 new regression tests) — matches
    the expected delta exactly.
  - `npm --prefix frontend test`: **1361/1361** passed (1360 + 1 new regression test) — matches
    the expected delta exactly.
  - `npm run lint` (zero-warnings): clean.
  - `npm run format:check`: clean.
  - `npm run check:schemas`: clean (18 protocols / 7 surfaces, unchanged).
  - `npm run check:scala-quality`: clean, same 64 pre-existing soft budget warnings as cycle 1 —
    zero new warnings from the touched files.
  - `npm run check:openspec`: fails with only the expected "complete (25/25) but not archived"
    hygiene note — confirms the commit's `-n` bypass is still scoped to exactly that rule (see
    commit body: "committed with `-n` to skip only the aggregate Husky pre-commit chain's
    `check:openspec` hygiene rule... All other pre-commit checks were run standalone above and
    pass cleanly" — independently reproduced).
- The fix (`if lc.referenceDataSourceId.nonEmpty` guard on both `addStep`'s and `updateStep`'s
  `lookupCheckF` arms) is minimal, symmetric, and directly matches evaluation-1.md's Change
  Request 1 recommendation.
- The toast fix reuses the pre-existing shared `useToast`/`toasts` feature
  (`frontend/src/features/toasts/`, present since HEL-245) rather than inventing new UI —
  DRY-compliant, no new component.
- Error handling: the previously-silent `catch {}` now surfaces a user-visible, accessible
  (`role="alert"`, `aria-live="assertive"`) error toast — closes the Phase-2 "no silent failures"
  gap flagged in cycle 1.

### Phase 3: UI Review — PASS
Issues: none.

Live re-verification against the running dev stack (dev_port 5559 / backend_port 8466; backend
process was fully restarted from the cycle-2 commit before testing, since `sbt run` does not
hot-reload — confirmed the old cycle-1 binary was still resident and killed/restarted it to avoid
testing stale code):

1. **Picker-add regression, the exact cycle-1 defect — CONFIRMED FIXED.** Added a fresh `lookup`
   step via "+ Add transformation step" → "Lookup / enrich" on `union-eval-pipeline`
   (`/pipelines/e3c19110-ab84-4dd5-af84-22f0e8d8bf8a`): `POST
   /api/pipelines/.../steps => 201 Created` (was `404` in cycle 1). No console errors beyond the
   pre-existing unrelated `/schedule` 404. The step card rendered, and **survived a full page
   reload** (previously it vanished, since it was never persisted).
2. **PATCH round-trip on a real persisted step — CONFIRMED.** Selected "A-source3" in the
   reference-source picker on the newly created step: `PATCH
   /api/pipeline-steps/ac31816f-... => 200 OK`.
3. **ACL boundary re-verified live, not weakened — CONFIRMED.** Registered a second user
   (`eval-user-b@helio.dev`), created a data source owned by them
   (`09300917-46f6-4afa-b2bd-8aa5433220e2`), then from user A's session:
   - `POST /api/pipelines/.../steps` with `type: "lookup"` and that cross-user id →
     `404 {"message":"Data source not found: 09300917-..."}`.
   - `PATCH /api/pipeline-steps/ac31816f-...` setting the same cross-user id →
     `404`, and a follow-up `GET` confirmed the step's persisted config was **unchanged**
     (`referenceDataSourceId` still `"42df704e-..."`, `updatedAt` timestamp unmoved).
   - Directly confirms the fix's guard (`if lc.referenceDataSourceId.nonEmpty`) only widens the
     allow-path for the *empty* case — the non-empty cross-user case still hits
     `findByIdOwned` and still 404s, on both verbs.
   - Also confirmed via curl: `POST` with the picker's exact empty-default config (`{
     "referenceDataSourceId": "", "sourceKey": "", "lookupKey": "", "columns": [] }`) →
     `201 Created`, matching the new backend test precisely.
4. **Toast error surface — CONFIRMED live with a genuine (non-mocked) failure.** Killed the
   backend process, then added a step via the picker: DOM inspection of `.toast-viewport` showed
   `<div class="toast toast--error" role="alert" aria-live="assertive">` containing `"Failed to
   add limit rows step: Request failed with status code 502"`. Confirmed the toast does **not**
   fire on a successful add (added a "Filter rows" step with the backend healthy — 201, no toast).
   Restarted the backend afterward and re-confirmed health before continuing.
5. No new console errors observed in any of the above flows beyond the pre-existing, unrelated
   `/schedule` 404 on this test pipeline (present before this ticket's changes, not caused by it).

### Overall: PASS

### Change Requests
(none)

### Non-blocking Suggestions
- Carried over from cycle 1 (still applicable, not blocking): `LookupConfig.tsx`'s `columns` row
  list uses `key={rowIndex}`, matching `UnpivotConfig.tsx`'s existing precedent — worth a
  codebase-wide revisit at some point, not specific to this ticket.
- The commit body notes a spinoff ticket (HEL-620) for `unionCheckF`'s identical pre-existing
  defect — good practice; not independently verified to exist in Linear as part of this review
  (out of scope for a mechanical re-evaluation of HEL-386).
