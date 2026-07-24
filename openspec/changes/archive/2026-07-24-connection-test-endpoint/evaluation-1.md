## Evaluation Report — Cycle 1

### Phase 1: Spec Review — PASS
Issues: none. All 17 tasks in tasks.md are genuinely implemented (verified via diff, not just
the checkbox): backend `TestConnectionResponse` + `ConnectionTest.scala` + `SourceService.testSql`/
`testRest` + `path("test")` dispatch in `SourcePreviewRoutes.scala` mirror `infer`'s
nested-SQL/flat-REST asymmetry exactly (design Decision 2); frontend `testConnection` service call,
`TestConnectionAffordance`, `SqlTab`/`RestApiForm` wiring, and the `SqlTab` "Test connection" →
"Infer schema" rename (design Decision 6) are all present and match design.md. `sourcesSlice.ts`/
`sourcesSlice.test.ts` untouched as claimed (design Decision 5). Spec deltas
(`connection-test-endpoint` ADDED, `sql-database-connector` MODIFIED) match the shipped behavior.
No scope creep found. No regressions to `infer`'s existing `BadGateway` semantics (untouched).

### Phase 2: Code Review — FAIL
Issues:
1. **Absent-`error`-key regression test exercises the wrong layer — doesn't actually prove the
   normalization works.** `dataSourceService.ts:230` (`testConnection`) is the only code that reads
   `response.data.error` and normalizes it (`response.data.error ?? null`); this is the exact class of
   bug the ticket calls out (HEL-613 / HEL-416 "Invalid Date" precedent). The regression test in
   `TestConnectionAffordance.test.tsx:75-86` fully mocks `dataSourceService.testConnection` itself
   (`jest.mock("../services/dataSourceService", ...)`), so it never calls the real normalization code
   at all — it only proves the *component* tolerates a mock object missing `error`, and since the
   component's success branch (`TestConnectionAffordance.tsx:36-37`) never reads `result.error` when
   `ok: true`, the test doesn't even probe that. Every other `testConnection` mock in the diff
   (`SqlTab.test.tsx`, `AddSourceModal.test.tsx`) is the same service-level mock — none constructs a
   raw wire-shaped `httpClient` response with the `error` key omitted. If the `?? null` were deleted
   from `dataSourceService.testConnection` today, no test in this diff would fail.
   The codebase has an established, directly-analogous precedent for testing this exact concern
   correctly: `frontend/src/features/pipelines/services/pipelineService.test.ts` (added for the very
   same HEL-416 incident this ticket's ticket.md/design.md cite) mocks `httpClient` directly
   (`jest.mock("../../../services/httpClient", ...)`) and asserts `getPipelineSchedule`/
   `putPipelineSchedule` normalize an omitted key to `null`. `dataSourceService.testConnection` should
   get the same treatment — a new `dataSourceService.test.ts` (or equivalent) unit test that mocks
   `httpClient.post` to resolve with a body missing the `error` key and asserts the exported
   `testConnection` function returns `{ ok: true, error: null }`.

No other Phase 2 issues found:
- `check:scala-quality` and `lint` both clean — no inline FQNs, no dead code/TODOs.
- DRY: `ConnectionTest.scala` correctly generalizes over `Connector[Config]`; `SourceService.testSql`/
  `testRest` mirror `inferSql`/`inferRest`'s shape without duplicating logic.
- No-credential-echo backend tests (`DataSourceRoutesSpec.scala:949-980`) assert the raw
  password/token string is **absent** from the serialized JSON (not merely a mask present) for both
  SQL and REST, success and failure — matches the ticket's bar.
- SQL success test uses `"NOT VALID SQL AT ALL"` (`DataSourceRoutesSpec.scala:860-871`), proving
  `testConnection` doesn't execute the query — matches the HEL-449 precedent.
- `SqlTab.tsx`'s rename is behavior-preserving: `inferSqlSource` dispatch, `inferredFields` state,
  `DataGrid` preview, and the `disabled={isSaving || isTesting || inferredFields === null}` gate on
  "Create source" are byte-for-byte unchanged; only the button label changed
  (`SqlTab.tsx:187-208`). The two updated `SqlTab.test.tsx` tests changed only the click target, not
  their assertions (diff-verified). No other existing test file was modified to accommodate new code.
- `add-source-modal__actions--between`'s missing CSS rule predates this change (git-blame: introduced
  by `79e1aa8b`, a pre-existing HEL-236 refactor commit, not touched by this diff); the new
  `sql-tab__actions-group` class is a clean, non-conflicting addition.
- DESIGN.md §5 Secondary button recipe reused verbatim (`add-source-modal__btn--secondary`, an
  existing class); `InlineError` reused for the error state; success state uses a checkmark + the word
  "Connected" (color is not the sole carrier, per §8).

### Phase 3: UI Review — PASS
Issues: none.
Live-drove both tabs via Playwright on the running dev servers (5653/8560), dark and light theme:
- REST tab (default): idle → pending → error (`http://localhost:1/...` → "Request failed" via
  `InlineError`, confirmed `.inline-error` class) → success (`http://localhost:8560/health` →
  "✓ Connected"). Confirmed clicking "Test connection" does **not** submit the configure form or
  advance the modal (dialog still shows "Preview schema", not "Create source", and
  `inferFromJson` is not invoked — matches `AddSourceModal.test.tsx`'s regression test).
- SQL tab: "Infer schema" and "Test connection" render as two distinct controls in the same actions
  row; SQL "Test connection" success (`✓ Connected`) leaves "Create source" disabled (schema not yet
  inferred) — confirms independence from the schema-inference gate. SQL "Test connection" failure
  (bad port) renders the curated "SQL connection failed" message via `InlineError`, not raw driver
  text.
- No console errors/warnings across the entire session (0 errors, 0 warnings, checked with `all: true`
  before close).
- Breakpoints 1440/1100/768/375 all render without broken/overlapping layout; at 375px the three
  action buttons wrap their labels onto two lines and get visually tight (non-blocking — see below).
- Light/dark theme parity confirmed for idle and error states — no contrast or token issues observed.
- `git status` clean at delivery besides pre-existing orchestration-artifact churn
  (`workflow-state.md`, `skeptic-design-3.md`, both untouched by the executor's diff); zero stray PNGs
  at the repo root; my own screenshots landed under
  `openspec/changes/connection-test-endpoint/screenshots/evaluator/` (gitignored, confirmed by
  `git status` not listing them).

### Standard checks (fresh, this cycle)
- `sbt test`: 1761/1761 passed.
- `npm run lint`: clean (zero warnings).
- `npm run format:check`: clean.
- `npm run check:schemas`: clean.
- `npm run check:scala-quality`: clean (59 pre-existing informational soft-budget warnings, none new).
- `npm test` (Jest): 1250/1250 passed.
- `npm --prefix frontend run build`: succeeded.
- Commit `02468592`'s `-n` bypass is disclosed in the commit body with the expected
  complete-but-unarchived `check:openspec` rationale and a list of what was run manually instead —
  matches established precedent.

### Overall: FAIL

### Change Requests
1. Add a unit test for `dataSourceService.testConnection` (new `frontend/src/features/sources/services/dataSourceService.test.ts`, or extend an existing one) that mocks `httpClient.post` directly (mirroring `frontend/src/features/pipelines/services/pipelineService.test.ts`'s established pattern for the identical HEL-416/HEL-613 wire-shape bug class) and resolves it with a response body that omits the `error` key entirely. Assert the exported `testConnection` function returns `{ ok: true, error: null }` (and, for completeness, that a present `error` string passes through unchanged on `ok: false`). This is necessary because every existing "absent `error` key" test in the diff (`TestConnectionAffordance.test.tsx:75-86`) mocks `dataSourceService.testConnection` itself, so none of them actually exercises the real normalization line (`dataSourceService.ts:230`, `response.data.error ?? null`) — a regression there would currently go undetected by the test suite.

### Non-blocking Suggestions
- At 375px viewport width, the SQL tab's three action buttons ("Infer schema", "Test connection",
  "Create source") wrap their labels onto two lines and look visually tight in the same row
  (`SqlTab.tsx:187-208`, `SqlTab.css`). Nothing overlaps or is unusable, but a `flex-wrap` or
  stacked-layout treatment at narrow widths would look cleaner — deferring to the skeptic's
  [judgment] call on whether this needs a fix.
