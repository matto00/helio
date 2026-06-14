## Skeptic Report — final gate (round 1)

### What I verified (with evidence)

#### Ground truth established independently

1. **Ticket AC read**: `ticket.md` — 4 ACs: backend method, `dataAsOf` on panel response, frontend indicator via `formatRelativeTime`, hidden when no binding or never run.

2. **Diff scope**: `git diff main...HEAD --name-only` — 32 files changed; all within scope of the ticket. No unrelated files modified.

3. **Backend method (AC #1)**: Read `PipelineRepository.scala:195-209`. `findLastRunAtByOutputDataTypeId` exists, uses `withSystemContext`, filters `lastRunStatus === "succeeded"`, returns `.flatten.maxOption` to handle never-run and failed-only cases correctly.

4. **Panel response field (AC #2)**: Read `PanelProtocol.scala`. `PanelResponse` has `dataAsOf: Option[String]` as 9th field at line 40; `jsonFormat9` at line 146 is correct. `PanelResponse.fromDomain(panel, dataAsOf: Option[String] = None)` at line 89 — default param preserves backward compat for all non-`PublicDashboardRoutes` callers. `PublicDashboardRoutes.scala` assembles `dataAsOf` via `Future.sequence` concurrent lookup on each panel's `dataTypeId`.

5. **Frontend indicator (AC #3)**: Read `PanelCard.tsx:224-231`. `formatRelativeTime` imported at line 4. Renders `<p className="panel-grid-card__freshness">Data as of {formatRelativeTime(panel.dataAsOf)}</p>` below `<h3>` when `panel.dataAsOf` is truthy.

6. **Hidden when unbound/never-run (AC #4)**: `panel.dataAsOf ? (...) : null` at line 227. Backend returns `None` for unbound panels (`dataTypeId = None`) and for pipelines that have only failed or never run.

7. **Schema updated**: `schemas/panel.schema.json` line 20-23 — `dataAsOf` present as `{ "type": ["string", "null"] }`. Not in `required` array (correct — field is absent when `None` per Spray JSON behavior).

8. **Token compliance (DESIGN.md [mechanical])**: `.panel-grid-card__freshness` at `PanelGrid.css:202-207` uses:
   - `color: var(--app-text-muted)` — valid color token
   - `margin: var(--space-1) 0 0` — valid spacing token
   - `font-size: var(--text-xs)` — valid type token
   No hardcoded hex/px values. BEM class name convention followed.

9. **Frontend lint**: `npm run lint` — exited clean, zero warnings.

10. **Frontend format**: `npm run format:check` — "All matched files use Prettier code style!"

11. **Frontend tests**: `npm --prefix frontend test` — 695 tests passed, 60 suites. Includes 3 new tests in `PanelGrid.test.tsx` for HEL-234 (dataAsOf set, null, absent).

12. **Frontend build**: `npm --prefix frontend run build` — "built in 560ms", exit 0.

13. **Backend tests**: `cd backend && sbt test` — 817 tests passed, 49 suites, 0 failures. Includes 5 new `PipelineRepositorySpec` tests (happy path, never-run, failed-only, unknown DataTypeId, multi-pipeline max) and 2 new `ApiRoutesSpec` tests (bound + succeeded → ISO timestamp; unbound → None).

14. **UI — dark mode**: Started servers via `scripts/orchestrator/start-servers.sh`; `assert-phase.sh` returned `PASS servers`. Navigated to "Helio Roadmap (copy)" with ProfitAgg pipeline set to `succeeded`. Screenshot confirmed:
    - "Helio is profitable?" (chart, bound DataType, succeeded pipeline) shows "Data as of 7 minutes ago" below the title in muted styling.
    - "Jan 2026 Profit" (metric, DataType with no succeeded pipeline) shows no freshness indicator.

15. **UI — light mode**: Toggled theme. Screenshot confirmed indicator renders correctly in light mode with same typography and muted styling. No contrast or layout issues.

16. **Console errors**: Only `https://test/snap.png` ERR_NAME_NOT_RESOLVED — pre-existing seed data issue documented in evaluator report, unrelated to this change.

17. **DB restored**: ProfitAgg pipeline restored to `last_run_status = 'failed'` after visual verification.

### Verdict: CONFIRM

All four acceptance criteria are met and traced to real code and running behavior. All Iron Law gates pass with fresh evidence. Token usage is correct per DESIGN.md. Light and dark parity confirmed visually.

### Non-blocking notes

- The `dataAsOf: null` vs. absent-field wire discrepancy (Spray JSON omits `None` fields entirely rather than emitting `"dataAsOf": null`) is a codebase-wide convention, not a defect introduced here. The frontend falsy check handles both correctly. The evaluator's note on this is accurate and appropriate to track as a future cleanup.
- The `line-height: 1.4` in `.panel-grid-card__freshness` is a unitless multiplier (not a token), which is acceptable per DESIGN.md — DESIGN.md only requires tokens for font-size, color, margin/padding/gap, radius, shadow, and transition; unitless line-height is standard CSS practice not covered by the token system.
