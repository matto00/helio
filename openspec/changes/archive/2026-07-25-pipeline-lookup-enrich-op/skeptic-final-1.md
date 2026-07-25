## Skeptic Report — final gate (round 1)

Cold review at HEAD (`7cd82500dc0f6060116380ed33a9d8d45bae4271`). All findings below are from
commands/files/screenshots I ran and read myself in this session — evaluation-1.md/evaluation-2.md
were treated as claims and independently reproduced, not trusted.

### What I verified (with evidence)

1. **Ticket/design/spec/tasks read** — `ticket.md`, `design.md` (11 decisions), `tasks.md` (25
   items, all checked), `specs/pipeline-lookup-op/spec.md` (10 requirement blocks with scenarios).
   No placeholders/TBDs found; Decision 11's frontend free-text deviation from the ticket's
   "selects"/"multi-select" prose is explicitly flagged in Planner Notes (not silently narrowed)
   and was already accepted at the design gate (`skeptic-design-1.md`, CONFIRM).

2. **Fresh full gate suite, all green:**
   - `sbt test` (from `backend/`): **1924/1924 passed**, 0 failed — includes the 25 new lookup
     backend tests + 2 cycle-2 regression tests. Flyway log confirms migration "72 - add lookup op"
     applied cleanly to schema version v72.
   - `npm --prefix frontend test`: **1361/1361 passed** (131 suites).
   - `npm run lint` (zero-warnings `eslint . --max-warnings=0`): clean.
   - `npm run format:check`: clean.
   - `npm run check:schemas`: "schemas in sync... (18 checked across 22 protocol files)... panel-type
     enums in sync (7 surfaces)".
   - `npm run check:scala-quality`: clean, **64 soft-budget warnings** (all pre-existing large
     files; none reference `LookupStep.scala`/`LookupConfig.tsx`/any new file).
   - `npm --prefix frontend run build`: succeeds (only the pre-existing >500kB chunk-size advisory,
     unrelated).
   - `npm run check:openspec`: fails with **only** the expected "complete (25/25) but not archived"
     hygiene note — nothing else.
   - Item 8 (pre-commit bypass scope) confirmed: both commit messages (`7564b178`, `7cd82500`)
     document `-n` scoped to `check:openspec` only; independently reproducing every other check
     standalone (above) confirms this — nothing else was silently skipped.

3. **Item 1 — fresh lookup step via the picker, live.** Navigated to
   `/pipelines/e3c19110-ab84-4dd5-af84-22f0e8d8bf8a` (backend process confirmed started at 20:11:20,
   *after* HEAD's commit timestamp of 19:51:59 — not a stale binary). Clicked "+ Add transformation
   step" → "Lookup / enrich": network trace showed `POST
   /api/pipelines/.../steps => 201 Created` (not 404). Reloaded the page — the new step (5th step)
   was still present. Confirms the cycle-2 fix holds live, not just in tests.

4. **Item 3 — full editor round-trip, live.** Expanded the new step: selected "A-source3" in the
   reference-source picker (`PATCH .../pipeline-steps/b6a97ae8... => 200`), selected `a` for "Match
   on field", typed `a` into "Reference match field", added a column row and typed `b`. Reloaded and
   fetched `GET /api/pipelines/.../steps` directly — the persisted step showed
   `{"referenceDataSourceId":"42df704e-...","sourceKey":"a","lookupKey":"a","columns":["b"]}`,
   confirming every field genuinely round-trips through PATCH and survives reload.

5. **Item 2 — cross-tenant ACL boundary, live, not weakened.** Registered a fresh second user
   (`skeptic-hel386-b@helio.dev`) via `/api/auth/register`, created a static data source owned by
   them (`c2240477-b610-41fb-9c2a-55be84e2cf31`). From user A's session (`X-Helio-Requested-With: 1`
   CSRF header + session cookie):
   - `POST /api/pipelines/.../steps` with `type: lookup` and that cross-user id →
     `404 {"message":"Data source not found: c2240477-..."}`.
   - `PATCH /api/pipeline-steps/b6a97ae8...` (my own real, populated lookup step) setting the same
     cross-user id → `404`, and a follow-up `GET` confirmed the step's persisted config and
     `updatedAt` were **byte-for-byte unchanged** — the PATCH truly had no effect.
   - This directly confirms the `if lc.referenceDataSourceId.nonEmpty` guard (read at
     `PipelineService.scala:302` `addStep` and `:415` `updateStep`) only widens the allow-path for
     the empty case; the non-empty cross-user case still hits `findByIdOwned` and still 404s, on
     both verbs, exactly as claimed.

6. **Item 4 — execution semantics.** Read `InProcessPipelineEngineSpec.scala:1019-1181` — 7 lookup
   tests exercise the real engine (`engine.execute`, not stubbed assertions) against a mocked
   `DataSourceRepository`: match-only-named-columns, unmatched-null-fill, duplicate-keys-first-match
   (asserting `result should have size 1` — no row multiplication), column-collision-reference-wins,
   only-named-columns-dropped-others, missing-ref-id error, unresolvable-ref-id error. All match
   spec.md's scenarios verbatim and all passed in the fresh `sbt test` run above (item 2).

7. **Item 5 — analyze_pipeline, live.** PATCHed a step's config to
   `{"referenceDataSourceId":"","sourceKey":"a","lookupKey":"code","columns":["label","category"]}`
   and called `GET /api/pipelines/.../analyze`: the step's `outputSchema` was exactly `[a, b, label,
   category]` (all four fields, `label`/`category` typed `string`), and no `validationError` key was
   present anywhere in the response. Matches spec.md's "Analyze appends the requested columns typed
   string" scenario exactly. Also confirmed `inferLookup` (`PipelineAnalyzeService.scala:433-439`)
   is a genuine dedicated dispatch case at line 87, distinct from the `"filter" | "limit" | "sort" |
   "dedupe" | "fillnull" | "union"` identity-passthrough group at line 73 (read directly, not just
   task-checkbox trust).

8. **Item 6 — migration + union untouched, diff review.** `V72__add_lookup_op.sql` follows the
   documented drop/re-add pattern, full accumulated op list including `'lookup'`; confirmed V72 is
   genuinely the max migration file (`ls .../db/migration | sort | tail`). `git diff ad3fb28c..HEAD
   -- .../steps/UnionStep.scala` returned **zero lines** — `UnionStep`'s runtime is byte-for-byte
   untouched. `git diff ... -- .../PipelineService.scala` shows `unionCheckF`'s own code block is
   untouched; only new `lookupCheckF` blocks and its append to the `aclCheckF` chain were added
   around it (confirmed by reading the full diff, not a grep).

9. **UI/design judgment.** Screenshotted the expanded `LookupConfig` editor in both dark and light
   theme (`.playwright-mcp/lookup-light.png`... actually saved as `lookup-light.png` /
   `lookup-light-theme.png` at repo root). The editor reuses existing shared classnames
   (`pipeline-detail-page__compute-field`, `__aggregate-section`, `__aggregate-groupby-row`, shared
   `Select`/`TextField` components) — no new one-off styling, consistent spacing/typography with
   sibling steps (Union/Filter), and visually parallel in both themes (same borders, accent color,
   input backgrounds shift correctly light↔dark). No hardcoded colors found in `LookupConfig.tsx`.
   No console errors beyond the pre-existing, unrelated `/schedule` 404 (present on this pipeline
   before this ticket, confirmed by evaluation-2.md and re-observed here).

10. **Toast fix (cycle 2) sanity-checked in code.** `PipelineDetailPage.tsx:292-301`'s
    `handleAddStep` catch block now calls `pushToast({variant: "error", ...})` instead of silently
    swallowing the failure — read directly, not just the evaluator's claim. A genuine regression
    test exists (`PipelineDetailPage.test.tsx:355-368`) asserting `store.getState().toasts.items`
    contains an error-variant toast after a rejected `createPipelineStep`, wired via a real
    `toastsReducer` in the test store (not a mocked assertion).

### Verdict: CONFIRM

All 8 focus items were independently reproduced live or via fresh test/gate runs, not inherited
from the evaluator's narrative. The cycle-1 defect (empty-default 404) is genuinely fixed and the
fix does not weaken the cross-tenant ACL boundary for real reference ids — verified on both POST and
PATCH with a freshly-registered second user. `unionCheckF`/`UnionStep` are confirmed untouched by
diff. All gates pass fresh with only the expected archive-hygiene note. The frontend editor is a
faithful, design-consistent reuse of existing patterns in both themes.

### Non-blocking notes

- `unionCheckF` has the identical latent defect (empty-default 404) as `lookupCheckF` had before
  the cycle-2 fix — correctly left untouched here per explicit scope instruction, with a spinoff
  (HEL-620, per the commit body) tracking it. Confirmed this is a real pre-existing gap, not
  something this change should have silently expanded scope to fix.
- `LookupConfig.tsx`'s `columns` row list uses `key={rowIndex}` (matches `UnpivotConfig.tsx`'s
  existing precedent) — a codebase-wide revisit candidate, not specific to this ticket.
- Two screenshots (`lookup-light.png`, `lookup-light-theme.png`) were saved to the repo root during
  this review's visual check; harmless but should be cleaned up before merge (same
  parallel-Playwright-session artifact hazard as previously logged for this project).
