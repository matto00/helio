## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed HEAD `4b839f9aebbe37ded376ecd04122e50dfb090404` against live-resolved base `03588796bbef47de0b48bedd201ae3e49739a191` (origin/main).

### Gates (my own fresh run, in WORKTREE_PATH)

| Gate | Result |
| --- | --- |
| `npm run lint` | exit 0 |
| `npm run format:check` | exit 0 |
| `npm run typecheck` | exit 0 |
| `npm test` (`--maxWorkers=3`) | exit 0. 498 suites, 5205 tests passed |
| `npm --prefix frontend run build` | exit 0 |
| `cd backend && sbt testFull` (`nice -n 19`) | exit 0. 6456 succeeded, 0 failed, 4 canceled. `AdminUsageTotalsSpec`, `ProductEventMonthlyActiveSpec`, `ProductUsageRepositoryRoleSpec` and `AdminUsageRoutesSpec` all ran and passed by name |
| `npm run check:scala-quality` | clean. Soft warnings only, none on files this change touched |

### Phase 1: Spec Review — FAIL

The acceptance criteria are covered:
- **totalUsers = 8 on the prod-like fixture.** Verified at `AdminUsageTotalsSpec.scala:476-505`. The fixture has 8 users aged 53..166 days plus the system user. The spec deletes every other `users` row first and asserts `COUNT(*) FROM users = 9` directly, so C1 is honoured.
- **Red-first.** The red run in `red-first-AdminUsageTotalsSpec.txt` shows 6 failures, including `0 was not equal to 8` and a missing `monthly_active_users` column.
- **Response stays identifier-free.** Guarded in both the service spec and the route spec. Schema `additionalProperties:false` on `totals` is tested to reject extra fields.
- **Owner-only.** The 403-before-parse check is extended with `days=366`.

The constraints are honoured:
- **C2.** The 7d and 30d counts are distinct and non-zero (2 and 4). The fixture includes a two-day user, a user one day before the window and a user after `rolled_through`.
- **C3.** ajv `^8.20.0` is an explicit devDependency, and the lock already resolves 8.20.0.

Owner rulings are reflected:
- **Q1-A.** V121 adds `monthly_active_users`.
- **Q2-A.** The users count excludes `SystemUserId`.
- **Q3-A.** The cap is 365, with presets 7/30/90/180/365.

All tasks are marked done.

**COALESCE deviation (executor asked for a ruling).** The implementation is correct and the design was wrong. Before this change, the non-WAU branch's `ON CONFLICT` updated only `daily_active_users`, so an earlier non-null WAU was already kept. Design Decision 5's "both ON CONFLICT updates overwrite it" would have nulled a WAU computed while still inside retention whenever a re-roll happened after the window left retention. That would regress WAU and under-report MAU in exactly the case the null rule exists to protect. `COALESCE(EXCLUDED.x, old.x)` keeps WAU behaviour unchanged: when the value is computable, EXCLUDED is a non-null COUNT and it overwrites. When it is not computable, the old value is kept. `ProductEventMonthlyActiveSpec.scala:368-376` covers this.

The planning artifacts were not updated to match:
- `design.md:36-37` (Decision 5) still says "Both INSERT branches set it and both `ON CONFLICT` updates overwrite it". There is now one statement, and it keeps the prior value.
- `specs/product-telemetry/spec.md` ("Monthly active users rollup") says the value "SHALL be `null` when the 30-day window's first day is not inside raw-event retention at rollup time". The implementation and the spec's own test (`keep an earlier value once the window has partly left retention`) do the opposite on a re-roll. The spec scenario "Not computable outside retention" only holds for a first roll.

This is a spec-to-implementation divergence in a SHALL statement. See CR 3.

### Phase 2: Code Review — FAIL

The backend is sound:
- `activeUsersUpsert` is now one parameterised statement using `Option.when` window starts. No injection: every value is bound.
- `totalUsers` is a single `COUNT(*)` on `withSystemContext`, and the role spec proves the `users` grant is the access path, including a revoke red check.
- `nullingNones` writes explicit nulls, and the schema is validated against the real serialised body, nulls included.
- The empty (`rolled_through` null) path still computes `totalUsers`.

The frontend is mostly sound:
- `Stat` extraction is a behaviour-preserving move. Page size is unchanged at 302 lines.
- `UsageTotals` is small and typed.
- A null count renders as an em dash with "not yet available", never 0.
- No `any`, no TODO, no inline FQNs.

Two problems:

1. **[DESIGN.md §4, mechanical] Non-canonical breakpoint.** `frontend/src/features/adminUsage/ui/AdminUsagePage.css:154` adds `@media (max-width: 600px)`. The canonical set is 1440/1100/768/430 only ("CSS media queries use these values only. [mechanical]").
2. **The totals-grid rule loses the cascade at desktop.** `AdminUsagePage.css:38-40` declares `.admin-usage__stats--totals { grid-template-columns: repeat(3, ...) }` before `.admin-usage__stats { grid-template-columns: repeat(4, ...) }` at `:42-47`. Both have equal specificity, so the later 4-column rule wins above 1100px. I measured this in the running app at 1440px: computed `grid-template-columns: 276px 276px 276px 276px` with 3 cards, leaving an empty fourth track. The 3-column modifier only works inside the 1100px media block because there it comes after the base override. This is a mechanical defect, not taste: the author's own rule has no effect at desktop. Evidence: `/home/matt/Development/helio/.concertino/runs/HEL-1420/evidence/.concertino-evidence-tmp/eval1-dark-1440.png` and `.../eval1-light-1440.png`. The executor's own `usage-*-30d.png` screenshots show the same gap.

### Phase 3: UI Review — FAIL

Setup:
- Servers were started with `start-servers.sh` and `assert-phase.sh servers` returned PASS.
- I registered a throwaway user, `71f3e507-f086-4939-83b5-88320bbbfaab` (`hel1420-eval-1791580297@eval.local`). Before promotion, `GET /api/admin/usage` returned 403.
- I promoted it to `owner` by an exact-id DB update, not via `HELIO_OWNER_EMAILS`; see the note below.
- After review I deleted it by exact id (`DELETE 1`, re-count 0). No leftover executor owner-tier throwaway was found.

API checks:
- `days` absent, 180 and 365 return 200, with 365 points at 365.
- `days=366` and `days=abc` return 400 "days must be an integer between 1 and 365".
- `totals` against the shared dev DB is `{totalUsers: 12913, activeLast7Days: 5251, activeLast30Days: null, asOf: 2026-10-07}`. A null 30-day value is expected, because the column is not backfilled.
- The body contains no throwaway id, email or `userId`.
- Response: `/home/matt/Development/helio/.concertino/runs/HEL-1420/evidence/.concertino-evidence-tmp/eval1-api-admin-usage-days365.json`.

Page checks:
- **Happy path works in both themes.** The data-through notice is prominent and includes the lag sentence. The totals card shows "—" with "not yet available" for the null 30-day value. The keyboard-driven window change to "Last 365 days" works.
- **Accessibility.** The totals `section` has an accessible name ("All-time totals" via `aria-labelledby`).
- **Console.** No console errors on :6852 after login. The only errors were the two expected pre-login `401 /api/auth/me`. Other ports' entries belong to other lanes sharing the browser.
- **Breakpoints:**
  - 1100: 3 columns.
  - 768: 3 columns.
  - 390: 1 column.
  - No horizontal overflow at any width.
  - 1440: 4 tracks for 3 cards (Phase 2 item 2), so the totals row is visibly short of the row below it.

### Overall: FAIL

### Change Requests
1. `frontend/src/features/adminUsage/ui/AdminUsagePage.css:38-40`: make the totals modifier win at every width. Either move the `.admin-usage__stats--totals` rule below the base `.admin-usage__stats` rule (`:42-47`), or raise its specificity to `.admin-usage__stats.admin-usage__stats--totals`. Then delete the now-redundant re-declaration inside `@media (max-width: 1100px)` (`:143-145`). Verify in the running app at 1440px that the computed `grid-template-columns` of `.admin-usage__stats--totals` has 3 tracks.
2. `frontend/src/features/adminUsage/ui/AdminUsagePage.css:154`: replace `@media (max-width: 600px)` with a canonical DESIGN.md §4 breakpoint, either `768px` (fold into the existing `768px` block at `:148`) or `430px` (fold into `:160`). No other width is allowed.
3. Planning artifacts must match the shipped COALESCE behaviour. This affects documentation only; the code is correct and should stay as it is.
   - `openspec/changes/owner-usage-alltime-totals/design.md:36-37` (Decision 5): replace "Both INSERT branches set it and both `ON CONFLICT` updates overwrite it" with the real rule. A computable roll writes and overwrites the value. A non-computable roll writes NULL on insert, but on conflict keeps a previously computed value (`COALESCE`), the same as the pre-existing WAU behaviour. Record why: an overwrite would null a value that was computed while still inside retention.
   - `openspec/changes/owner-usage-alltime-totals/specs/product-telemetry/spec.md`: amend the "Monthly active users rollup" SHALL sentence to match, and add a scenario for "a re-roll after the window has left retention keeps the earlier value". Its test already exists at `ProductEventMonthlyActiveSpec.scala:368`.

### Non-blocking Suggestions
- **`HELIO_OWNER_EMAILS` not being honoured is not a defect of this change.** It is a pre-existing env-precedence trap. `backend/build.sbt:140` appends `loadDotEnv(baseDirectory.value)` to `Compile / run / envVars`, and the run is forked (`build.sbt:116`). A key present in `backend/.env` therefore overrides the same variable exported in the launching shell. The worktree `.env` is byte-identical to the main checkout's and does contain a `HELIO_OWNER_EMAILS` key (I checked the key name only, never the value). So a shell export is silently ignored, which matches what the executor saw. Its `set Compile / run / envVars` session override was a reasonable workaround. I inferred this from build.sbt and did not reproduce the override end to end. Consider filing a follow-up or a `MISTAKES.md` entry; it does not belong in this ticket.
- **For the skeptic:** in the window stats row, "WAU (latest)" now always equals the new "Active, last 7 days" headline, both reading `weekly_active_users` at `rolled_through`. Whether that duplication is acceptable is a judgment call.
- **The frontend contract test validates a hand-written fixture with `validateFormats: false`.** It is still a real seam guard, since a missing `totals`, a missing null or an extra field all go red. The backend spec validating the real serialised body is the stronger half.
