## Skeptic Report — final gate (round 1)

### What I verified (with evidence)

1. **Wire-shape guard is genuine (mutation-tested, not nominal).**
   `frontend/src/features/sources/services/dataSourceService.test.ts` mocks `httpClient.post`
   directly (not the `dataSourceService` module), so it exercises the real
   `response.data.error ?? null` line in `testConnection` (dataSourceService.ts:232). I mutated
   that line to `response.data.error` (dropping the `?? null` normalization) and re-ran
   `npx jest --testPathPatterns=dataSourceService.test`: the "normalizes an absent `error` key…"
   test failed with `{ error: undefined }` vs expected `{ error: null }`. Restored the original
   line and reran — 4/4 pass. This is a real, reproduced mutation-kill, not a nominal test.

2. **No credential echo — assertions are on the raw secret, not just a mask.**
   `backend/src/test/scala/com/helio/api/DataSourceRoutesSpec.scala` lines 946–982: two new tests
   ("never echo the config or its credentials…") post SQL with `password = "s3cr3t-pw"` and REST
   with `auth.token = "sekret-token"`, for both success and failure branches, and assert
   `raw should not include "s3cr3t-pw"` / `"sekret-token"` / `"password"` / `"config"` against the
   raw response body string — not merely checking for a mask. Ran these live (`sbt test`, full
   suite green, see below).

3. **SQL non-execution proven by an intentionally-invalid query.** `sqlBody(...)` in the same spec
   defaults `query = "NOT VALID SQL AT ALL"` for the success-path test (line 864, 868–880) — matches
   the ticket's HEL-449 precedent exactly. This query would throw if ever executed; a 200/ok=true
   result proves `testConnection` only opened+closed the connection.

4. **Behavior-preserving rename confirmed live and in the diff.** `SqlTab.tsx` diff: the existing
   button keeps its `onClick={() => void handleTestConnection()}` → `inferSqlSource` dispatch,
   `inferredFields` state, and `disabled={isSaving || isTesting || inferredFields === null}` gating
   on "Create source" — only the label changed ("Test connection" → "Infer schema"). Verified live in
   the browser: clicking "Infer schema" against a real local Postgres populated the schema-preview
   grid and *enabled* "Create source"; before that click "Create source" stayed disabled even after
   the new "Test connection" affordance reported "✓ Connected". `SqlTab.test.tsx` diff shows exactly
   the two disclosed test renames (button-name lookup only) plus new, additive tests; `git diff
   main...HEAD --stat` confirms no other existing test file was touched (`sourcesSlice.test.ts`
   absent from the diff, as design.md Decision 5 requires).

5. **Backend SQL/REST dispatch asymmetry reproduced exactly.** `SourcePreviewRoutes.scala`'s new
   `path("test")` block (lines 55–79) is a byte-for-byte structural mirror of `path("infer")`
   (lines 30–54): same `.getOrElse(DataSourceKind.RestApi)` fallback, same
   `convertTo[SqlInferRequest]` (nested) vs `convertTo[RestApiConfigPayload]` (flat) split. Spec test
   "accept the same nested-SQL / flat-REST request-body shapes /api/sources/infer already accepts"
   (line 932) posts both shapes and asserts 200; the REST malformed-auth test (line 925) proves a
   structurally-invalid flat body still 400s before dispatch.

6. **200-OK-on-failure decision reconciled against the `BadGateway` precedent, not silently
   diverging.** design.md lines 46–60 explicitly names `inferSql`/`inferRest`'s `BadGateway` mapping
   in the same file and argues the distinction (connectivity-report vs. fetch-and-fulfill). Code
   matches: `SourceService.testSql`/`testRest` always map `Right`/mapped-`ConnectionTest.run` into
   `Right(...)` of the `ServiceError` channel (never `BadGateway`), while `inferSql`/`inferRest`
   retain their existing `BadGateway` mapping unchanged.

7. **Live UI, both tabs, both outcomes, dark/light, and the breakpoint fix — driven directly, not
   inherited.** Logged into the running dev servers (5653/8560) and drove the real `AddSourceModal`:
   - REST tab: idle → pending → error (`http://localhost:1/nonexistent` → "Request failed" via
     `InlineError`, screenshot `screenshots/skeptic-rest-error.png`) and idle → pending → success
     (`https://httpbin.org/get` → "✓ Connected", `screenshots/skeptic-rest-success.png`). Modal
     stayed on the configure step in both cases ("Preview schema" visible, no "Create source"),
     confirming `type="button"` actually prevents form submission in the live browser, not just in
     jsdom.
   - SQL tab: "Test connection" success against the real local Postgres
     (`screenshots/skeptic-sql-success.png`, `1440px.png`, `1100px.png`, `768px.png`) and, on a
     fresh modal instance with port `1` filled in from the start (avoiding a stale-React-state
     artifact from an earlier JS-injected field edit that I caught and re-did correctly), a genuine
     error: "SQL connection failed" via `InlineError`, confirmed by a direct curl against
     `POST /api/sources/test` with the same bad-port payload returning
     `{"error":"SQL connection failed","ok":false}`. "Create source" stayed disabled throughout
     (only "Infer schema" — clicked separately — enables it), matching design Decision 6's
     non-interference requirement.
   - 375px: `screenshots/skeptic-sql-375px-scrolled.png` — "Infer schema"/"Test connection" pair
     and "Create source" wrap onto separate rows cleanly, no mid-label wrapping or overlap, per the
     new `SqlTab.css` `@media (max-width: 430px)` rule.
   - 1440/1100/768px: all single-row, no regression from the media-query addition
     (`skeptic-sql-1440px.png`, `1100px.png`, `768px.png`).
   - Dark mode: `skeptic-sql-dark.png` (success) and `skeptic-sql-dark-error2.png` (error) — both
     button recipes and the success/error text use the app's dark-surface tokens correctly, no
     light-mode leakage.
   - Both buttons use the established `add-source-modal__btn--secondary` class (DESIGN.md §5
     Secondary recipe) — no new button style introduced; `TestConnectionAffordance` uses the
     canonical `InlineError` component, not a bespoke error paragraph.
   - No console errors observed during any of the above interactions.

8. **Fresh full gate chain, run by me:**
   - `sbt test` (backend): 1761/1761 passed, 99 suites, 0 failed.
   - `npm test` (frontend): 1254/1254 passed, 120 suites.
   - `npm run lint`: clean (0 warnings, `--max-warnings=0`).
   - `npm run format:check`: clean.
   - `npm run check:schemas`: in sync (18 protocols, 7 enum surfaces).
   - `npm run check:scala-quality`: exit 0 ("clean", 59 pre-existing soft line-count warnings not
     newly introduced by this change — `DataSourceRoutesSpec.scala` was already over the soft
     budget before this ticket's ~140-line addition).
   - `npm --prefix frontend run build`: succeeds.
   - Two `-n` bypasses (`02468592`, `f91b424d`) both disclose the same `check:openspec`
     complete-but-unarchived rationale in the commit body, per the ticket's stated precedent, and
     list what was run manually instead (lint/format/schemas/scala-quality/jest all pass; `sbt test`
     not hooked but run and green).
   - `git status --short`: clean except the expected orchestration-workflow artifacts
     (`workflow-state.md`, `evaluation-{1,2}.md`, `skeptic-design-3.md`) — no stray files. No PNGs
     at the repo root before or after my own Playwright session (I wrote all screenshots under
     `openspec/changes/connection-test-endpoint/screenshots/`, gitignored via `*.png`).

### Verdict: CONFIRM

All 8 requested independent checks reproduce cleanly: the wire-shape regression test is a genuine,
mutation-tested guard (not the nominal cycle-1 coverage); the no-echo tests assert on raw secret
strings for both connectors and both outcomes; the SQL success test uses a deliberately-invalid
query proving non-execution; the SqlTab rename is byte-for-byte behavior-preserving with only the
two disclosed test renames plus additive coverage; the backend `/test` dispatch is a structural
mirror of `/infer`'s asymmetric SQL-nested/REST-flat dispatch; the 200-on-failure design decision
explicitly reconciles with the adjacent `BadGateway` precedent instead of ignoring it; the live UI
in a real browser (both tabs, both outcomes, both themes, four breakpoints) matches spec and shows
no regressions; and the full gate chain (backend + frontend + schema/quality checks + build) is
green with clean git state.

### Non-blocking notes

- The "Infer schema" button's own pre-existing error path (`testError`, `SqlTab.tsx:211-215`)
  still renders via a hand-rolled `<p className="add-source-modal__error" role="alert">` rather
  than `InlineError` — this is pre-existing, unchanged-by-this-ticket behavior (design.md Decision 6
  explicitly preserves it byte-for-byte), not a defect introduced here. A future ticket could unify
  it with the new `InlineError`-based affordance for consistency.
- `check:scala-quality`'s 59 soft-budget warnings are all pre-existing files exceeding the 250-line
  guideline; `DataSourceRoutesSpec.scala` grew from ~1063 to 1201 lines with this ticket's ~140 lines
  of new route tests, consistent with the existing pattern of appending to that spec file rather than
  splitting it — not a new violation class, and the check exits 0 (informational only).
