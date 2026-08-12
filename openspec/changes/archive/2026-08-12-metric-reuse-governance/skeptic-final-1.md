## Skeptic Report — final gate (round 1, skeptic-final-1.md)

### What I verified (with evidence)

**Ground truth re-established** — read `ticket.md`, `design.md`, `tasks.md`, `files-modified.md`,
`evaluation-1.md` (as claims, not fact) and `git diff main...HEAD --stat` (52 files changed) myself.

**1. The most-scrutinized decision — `schemas/panel.schema.json`'s `metricDeprecated` placement
(4 design-gate rounds).** Independently re-verified, NOT trusting the evaluator's pasted ajv output —
built my own `ajv` 2020-12 validation harness (`frontend/node_modules/ajv` 8.20.0, all 47 `schemas/*.json`
loaded so `$ref`s resolve) and round-tripped full, schema-complete payloads (not truncated fragments):
- `panel.schema.json`, `type: metric|chart|table`, `config.metricId` present, `metricDeprecated` **absent**
  → **fails** with `missingProperty: "metricDeprecated"` at
  `#/oneOf/{0,1,2}/properties/config/allOf/1/then/required`, for all three types.
- Same payloads with `metricDeprecated` present → **pass**.
- Unbound `config: {}` (no `metricId`) → **passes** with no `metricDeprecated` required.
- `create-panel-request.schema.json`, `metricId`-bound, **no** `metricDeprecated` → **passes** cleanly
  (metric and chart types both checked) — confirms a client is never required to send it.
- `create-panel-request.schema.json` payload that *does* include `metricDeprecated` → also passes
  (declared-but-ignored, matches the shared-`$def` non-required contract).
- `bound-panel-response.schema.json` (wraps `panel.schema.json` via `$ref`) → inherits the same
  conditional for free: fails without `metricDeprecated`, passes with it.
- `git diff main...HEAD -- schemas/create-panel-request.schema.json schemas/bound-panel-response.schema.json`
  → zero hits, confirmed untouched.
- `$defs.MetricConfig/ChartConfig/TableConfig` `required` arrays are `None` (Python-checked) — no
  unconditional requirement leaked into the shared `$defs`.

This independently reproduces (and extends, with chart/table/unbound/create/bound-response cases the
evaluator's transcript didn't all show) the evaluator's claim. **The design.md D6 / round-3-REFUTE fix
is correctly implemented.**

**2. Backend implementation read in full** (not just diffed): `PanelServiceHelpers.withMaterializedMetric`
(sets `metricDeprecated` for `MetricPanel`/`ChartPanel`/`TablePanel` alike, only when a resolved
`MetricDefinition` exists), `PanelService.resolveOne`/`resolveSingleBinding` (both call sites confirmed),
`withMetricCleared` (clears `metricId`, doesn't need to touch `metricDeprecated` since it's never
persisted), `MetricPanel/ChartPanel/TablePanel.scala` (`jsonFormat6→7`, `decode`/`applyPatch` build the
case class positionally without `metricDeprecated` — a client can never set it), `PanelRowMapper.scala`
(grep-confirmed zero mentions of `metricDeprecated` — it is never a DB column, always server-materialized
fresh on read). `MetricRepository.usage`/`countBoundPanels`, `MetricService.usage`/`delete`,
`MetricRoutes` (`GET /:id/usage`, `DELETE` + `X-Unbound-Panel-Count` via new
`ServiceResponse.runNoContentWithHeader`), `MetricProtocol`/`api/package.scala` wire DTOs, `domain/model.scala`
(`MetricUsage`/`MetricUsagePanel`) — all match design.md D1–D3 exactly.

**3. Gates re-run fresh in this worktree** (not trusted from the evaluator's pasted output):
- `cd backend && sbt "testOnly com.helio.infrastructure.MetricRepositorySpec com.helio.api.routes.MetricRoutesSpec com.helio.api.routes.PanelMetricBindingRoutesSpec"` → **67/67 passed**, including
  "should reflect a metric rename on every subsequent panel read with no PATCH /api/panels/:id call" (AC2)
  and "should surface config.metricDeprecated = true for a ChartPanel/TablePanel bound to a deprecated
  metric" (AC3).
- `cd backend && sbt test` (full suite) → **2464/2464 passed**, 0 failed (98s) — matches evaluator exactly.
- `npx jest --passWithNoTests` (root/helio-mcp) → **112/112 passed**.
- `cd frontend && npx jest` (full) → **1505/1505 passed**.
- `cd frontend && npm run build` → succeeds.
- `npm run lint` → 0 warnings. `npm run format:check` → clean.
- `npm run check:schemas` → in sync. `npm run check:scala-quality` → clean (84 informational soft-budget
  warnings, `MetricRoutesSpec.scala`/`MetricRepositorySpec.scala` included, matching evaluator's claim).
- `npm run check:openspec` → expected "complete but not archived" (exit 1), matches disclosed precedent.

**4. AC traceability** (`ticket.md`):
1. "Where used" query, owner-scoped — `MetricRepository.usage`, `GET /api/metrics/:id/usage`,
   `MetricRepositorySpec`/`MetricRoutesSpec`. Traced to code + fresh passing tests.
2. Rename reflected without re-binding — `PanelMetricBindingRoutesSpec`'s dedicated test, traced above.
3. Deprecated excluded from grounding catalog + picker default, bindings still resolve —
   `helio-mcp/src/context.ts` filter + `useMetricBindingState.ts` filter, live-verified in the browser
   (below).
4. Delete communicates affected count — `X-Unbound-Panel-Count` header + frontend pre-check via
   `GET .../usage`, live-verified in the browser (below).
5. `sbt test` passes, no FQNs — verified above; independent grep across the diff's new/changed Scala
   lines found no inline FQNs outside `import`/`package` lines.

**5. Live UI review** (Playwright, `DEV_PORT=5992`/`BACKEND_PORT=8899`, `scripts/concertino/start-servers.sh`
+ `assert-phase.sh servers` both `PASS`):
- **Delete-confirm real usage count**: clicked "Delete" on the metrics list → network tab confirmed
  `GET /api/metrics/28d0d.../usage` → `200`, UI rendered "Delete? Not bound to any panels." (real count,
  not generic copy).
- **Picker excludes deprecated (new selection)**: deprecated the test metric, opened a chart panel's
  "Bind to metric" picker (never previously bound) → dropdown showed only "— None —", metric correctly
  excluded.
- **Bound-metric exception**: un-deprecated → bound the metric to the chart panel → saved → re-deprecated
  → reopened the panel editor: selection still showed "Eval Test Metric" (not reverted), dropdown still
  offered both "— None —" and "Eval Test Metric", and a "deprecated" badge rendered next to the "Bind to
  metric" label — screenshot-confirmed (amber pill, matches `MetricListTable.tsx`'s `.metric-status--deprecated`
  visual pattern) in **both dark and light theme** (parity confirmed, screenshots captured).
- **Read materialization via raw API**: after clearing the binding and saving, reopening the editor showed
  no `metricDeprecated`/no badge — confirmed absent-when-unbound.
- Zero console errors throughout (`browser_console_messages`, level=error, all=true → 0).
- Test data restored to pre-review baseline before finishing (panel unbound, metric un-deprecated,
  theme back to dark).

### An issue the evaluator's test suite did not catch (found via live interaction, not component tests)

While live-testing the bound-metric exception flow, I found a **real, reproducible UI bug** in the exact
feature area this ticket added, in a path none of `BindingEditor.metricBinding.test.tsx`'s new
"HEL-560" tests exercise:

**Repro**: bind a chart/metric panel to a metric, deprecate that metric (so the panel shows the
"deprecated" badge — correct, per AC3), then in the *same edit session* change the "Bind to metric"
selection to "— None —" (clearing it) **without saving yet**. The "deprecated" badge next to the "Bind
to metric" label **stays visible** even though the live selection is now "— None —" (unbound).
Screenshot: `stale-deprecated-badge-after-clear.png` (also reproduced via accessibility snapshot:
`generic [ref=f1e373]: deprecated` sibling to a combobox showing `"— None —"`). The bug is purely
in-session — saving and reopening correctly shows no badge (confirmed), so it never reaches the backend
or persists, but it is misleading, contradicts the ticket's own "surface indicator on panels **bound to**
a deprecated metric" wording (this panel, in this dirty state, is bound to nothing), and no existing test
(unit or the evaluator's live pass) exercises this exact clear-after-deprecated-bind sequence — the
existing `BindingEditor.metricBinding.test.tsx` "clearing the metric selection reveals the raw Field/
Reduce controls again" test uses an *active* (non-deprecated) metric, so it can't catch this.

**Root cause** — `frontend/src/features/panels/ui/editors/BindingEditor.tsx:163-164`:
```ts
const metricDeprecated =
  metricBinding.selectedMetric?.deprecated ?? panel.config.metricDeprecated ?? false;
```
`useMetricBindingState.ts` returns `selectedMetric = metrics.find(m => m.id === selectedMetricId) ?? null`.
When the user clears the selection, `selectedMetricId` becomes `null`, so `selectedMetric` is explicitly
`null` (not "not yet loaded") — but `null?.deprecated` is `undefined`, and the `??` chain can't
distinguish "explicitly cleared" from "metrics list hasn't loaded yet", so it falls through to the stale
`panel.config.metricDeprecated` from the panel's last server-fetched materialization.

### Verdict: REFUTE

The implementation is otherwise excellent — the ticket's single most-scrutinized decision (schema
placement) is correctly and robustly implemented, all four ACs trace to real passing tests, every gate
re-runs clean, and the live delete/exclude/bound-exception flows all work exactly as designed. But a
live-only, previously-uncaught, specific and reproducible UI-correctness bug in this ticket's own new
"deprecated indicator" surface is real and in scope to fix before shipping.

### Change Requests

1. **`frontend/src/features/panels/ui/editors/BindingEditor.tsx:163-164`** — the `metricDeprecated`
   fallback must not use the panel's stale `config.metricDeprecated` once the user has explicitly cleared
   the binding in this edit session. Gate the fallback on the selection being untouched, e.g.:
   ```ts
   const metricDeprecated =
     metricBinding.selectedMetricId === null
       ? false
       : (metricBinding.selectedMetric?.deprecated ?? panel.config.metricDeprecated ?? false);
   ```
   (`metricBinding.selectedMetricId` is already exposed on `MetricBindingState`.) Add a regression test
   to `BindingEditor.metricBinding.test.tsx` under the existing "HEL-560" describe block: start a
   panel bound to `deprecatedMetric`, clear the selection to "— None —", assert
   `screen.queryByText("deprecated")` is no longer in the document — this is the exact sequence the
   current suite's "clearing the metric selection..." test doesn't cover (it uses an active metric).

### Non-blocking notes

- `frontend/src/features/panels/ui/PanelDetailModal.binding.css`'s new `.panel-detail-modal__metric-deprecated`
  uses hardcoded `padding: 2px 7px; border-radius: 999px;` instead of `var(--app-radius-pill)` (defined in
  `theme.css`) — but this is a byte-for-byte duplication of the pre-existing `.metric-status`/`.metric-status--deprecated`
  pattern in `MetricsPage.css` (D7's explicit intent), and the same `999px` hardcoding already appears in
  4+ other pre-existing files (`SourceDetailPanel.css`, `RunHistoryModal.css`, `PipelinesPage.css`,
  `MetricsPage.css`) predating this ticket. Not this ticket's regression to fix alone; flagging for the
  pre-existing repo-wide badge-token cleanup rather than blocking this change.
- Evaluator's two non-blocking suggestions (spec-file soft-budget split; disable "Confirm delete" while
  usage is loading) are reasonable and still apply; not blocking.
