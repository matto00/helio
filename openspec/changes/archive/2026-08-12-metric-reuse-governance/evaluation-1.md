## Evaluation Report — Cycle 1 (evaluation-1.md)

### Phase 1: Spec Review — PASS

Issues: none.

- All 4 ticket ACs addressed explicitly, not partially:
  1. "Where used" query — `MetricRepository.usage`/`countBoundPanels` (owner-scoped panel↔dashboard
     join) + `GET /api/metrics/:id/usage`, covered by `MetricRepositorySpec` (bound/unbound/
     owner-scoped/cross-owner) and `MetricRoutesSpec` (200/404 cases).
  2. Rename safety — `PanelMetricBindingRoutesSpec` adds a test that PATCHes a metric's name and
     asserts the next panel read reflects it with zero `PATCH /api/panels/:id` calls; this is
     test-only per design.md D8 (no production code change needed — correct, since
     `resolveSingleBinding`/`resolveBindingsForRead` already read the live `MetricDefinition`).
  3. Deprecated exclusion — `helio-mcp/src/context.ts`'s `buildWorkspaceContext` now filters
     `deprecated !== true` before mapping (with `list_metrics` explicitly left untouched, verified);
     `useMetricBindingState.ts` filters the picker's options with the bound-metric exception. Both
     covered by tests (`context.test.ts`, `useMetricBindingState.test.ts`).
  4. Delete impact — `MetricService.delete` now computes the pre-delete bound count and
     `MetricRoutes`'s DELETE handler sets `X-Unbound-Panel-Count` via a new
     `ServiceResponse.runNoContentWithHeader` helper; response stays `204`/body-less (non-breaking).
- No AC silently reinterpreted. One judgment call worth noting (not a reinterpretation): D5's
  "currently-bound metric stays visible" exception is implemented against the panel's *persisted*
  `metricId` (`initialMetricId`), not the live/dirty in-progress selection — a reasonable and
  explicitly-commented reading of design.md's own "currently-bound" wording, exercised directly by
  `useMetricBindingState.test.ts`.
- All 27/27 `tasks.md` items marked `[x]` and match what was actually implemented — verified by
  reading the diff for every task's target file (schema placement, materialization, routes, frontend
  filtering/indicator, tests) rather than trusting the checkmarks.
- No scope creep — every changed file maps directly to `files-modified.md` and the ticket's declared
  impact surface (`MetricRepository`/`MetricRoutes`/`MetricService`, `helio-mcp/src/context.ts`,
  `frontend/src/features/{metrics,panels}/**`, the two schema files). No unrelated refactors.
- No regressions to existing behavior: `withMaterializedMetric`'s pre-existing `MetricPanel` raw-vs-
  materialized precedence logic is untouched (only extended with the new `metricDeprecated` set,
  additively, for all three panel kinds); `resolveOne`/`resolveSingleBinding` control flow unchanged.
- API contract updated correctly and precisely — see the schema deep-dive under Phase 2 below.
- Planning artifacts (proposal.md/design.md D1–D8, spec deltas) match the final implemented behavior
  exactly; no drift found between design.md's decisions and the diff.

**Verified in particular detail — the `schemas/panel.schema.json` `metricDeprecated` placement**
(explicitly flagged as the most scrutinized decision in this change): confirmed by reading the diff
and by independently round-tripping real payloads through `ajv` (draft 2020-12) against the actual
schema files in this worktree:
- `$defs.MetricConfig`/`ChartConfig`/`TableConfig` each gained `metricDeprecated: {"type":"boolean"}`
  in `properties`, with **no** `required` change at the `$def` level (`python3 -c "... d['$defs']..."`
  confirms `required=None` on all three).
- The conditional `"if": {"required":["metricId"]}, "then": {"required":["metricDeprecated"]}` lives
  only in `panel.schema.json`'s own top-level `oneOf` branches (`metric`/`chart`/`table`), wrapped via
  `allOf` around the existing `$ref`, matching tasks.md 2.3's literal snippet.
- `schemas/create-panel-request.schema.json` and `schemas/bound-panel-response.schema.json` are
  **unmodified** by this diff (confirmed via `git diff` — zero hits) and still `$ref` the shared
  `$defs` directly, so they do **not** inherit the conditional requirement.
- Live `ajv` validation: `{type:"metric", config:{metricId:"m1"}}` (no `metricDeprecated`) **fails**
  `panel.schema.json` with exactly `missingProperty: "metricDeprecated"` at
  `#/oneOf/0/properties/config/allOf/1/then/required`; the same payload **passes**
  `create-panel-request.schema.json` cleanly. `{metricId:"m1", metricDeprecated: false}` passes
  `panel.schema.json`; an unbound `config: {}` also passes (no `metricDeprecated` required). Repeated
  for `chart`/`table` branches with identical results. This is exactly the design.md D6 / round-3
  REFUTE fix, correctly implemented — no regression to either of the two previously-rejected
  placements (unconditional `required`, or conditional-but-in-shared-`$defs`).
- Backend side confirmed consistent: `MetricPanelConfig`/`ChartPanelConfig`/`TablePanelConfig` all
  carry `metricDeprecated: Option[Boolean] = None`, never populated by any `decode`/`decodeCreate`/
  `Patch` path (grep-confirmed — the case class is always built positionally without the field, so a
  client can never set it), and spray-json omits `None` on the wire (matches the schema's
  "absent, not `false`, when unbound" contract).

### Phase 2: Code Review — PASS

Issues: none blocking (two non-blocking suggestions below).

**Fresh gate re-run** (not trusting the executor's report), in `WORKTREE_PATH`
(`EVALUATOR_CLEAN_WORKTREE=false`, matching `workflow-state.md`):
- `cd backend && sbt test` → **2464/2464 passed**, 0 failed (97s).
- `npm run lint` (root, scans whole repo incl. `helio-mcp`) → 0 warnings.
- `npm run format:check` → clean.
- `npm test` (root jest + `npm --prefix frontend test`) → **helio-mcp 112/112**, **frontend 1505/1505**,
  0 failures.
- `npm --prefix frontend run build` → succeeds (vite build, PWA precache generated).
- `npm run check:schemas` → in sync (36 protocols / 7 panel-type-enum surfaces).
- `npm run check:scala-quality` → clean (0 FQN violations; 84 pre-existing informational soft-budget
  warnings, none newly introduced by files this ticket added logic to — `MetricRoutesSpec.scala`
  and `MetricRepositorySpec.scala` do cross the ~250-line soft budget after their new test blocks,
  see non-blocking suggestion below, but the check itself treats this as informational only, per
  `CONTRIBUTING.md`, and correctly reports the run as clean).
- `npm run check:openspec` → reports the expected "complete but not yet archived" condition (exit 1).
  This exactly matches the executor's disclosed, precedented `git commit -n` justification (same
  precedent as commit `9d8c67e5`) — archival is an orchestrator-owned later phase, not a code defect.

**Environmental note (not a code issue, included for the record):** this worktree's `helio-mcp` and
root `node_modules` were not installed (only `frontend/node_modules` existed). Running `helio-mcp`'s
own `tsc` build via bare `npx` (no local `node_modules`) pulled a mismatched, uninstalled-dependency
TypeScript toolchain and produced spurious errors in unrelated, untouched `write.ts` — confirmed as an
artifact of the missing `node_modules`, not a regression: (1) `write.ts` is not in this diff, (2) the
same command succeeds cleanly on `main` in the properly-set-up primary worktree, (3) after `npm ci`
(root and `helio-mcp`, both against their existing, diff-untouched lockfiles) `npm run build` in
`helio-mcp` passes cleanly. All gate re-runs above were performed after installing dependencies for
full-fidelity verification; the leftover `dist/*.test.js` transiently produced by that `tsc` run (the
same class of artifact issue #3 in the executor's own bug list, HEL-650) was cleaned up before the
final `npm test` re-run reported above. `node_modules` was left installed in this worktree afterward
(gitignored, not a code change) since Phase 3 needs it.

**Canonical-standard review** (`CONTRIBUTING.md`, `DESIGN.md` for the `frontend/**` portion):
- **Imports/qualifiers [mechanical]**: no inline FQNs found by an independent grep across the diff's
  new/changed Scala lines (`com.helio.*`, `spray.json.*`, `java.util.*`, `org.apache.pekko.*`,
  `scala.concurrent.*` — zero hits outside `import`/`package` lines), consistent with
  `check:scala-quality`'s clean result.
- **Design-standard [mechanical]**: the new `.panel-detail-modal__metric-deprecated` CSS rule uses
  only canonical tokens (`--space-2`, `--text-xs`, `--weight-medium`, `--app-warning`,
  `--app-warning-surface`), all defined in both the dark and light blocks of `theme.css`; BEM-ish
  class naming followed; plain co-located CSS (no inline `style={{}}`, no new styling system). D7's
  choice to duplicate rather than extract to `shared/ui/` follows the codebase's own established
  "rule of three" convention (already cited by HEL-553's `fieldOptions.ts`) and is only the second
  consumer, so it's correctly not promoted.
- **DRY**: the D1 join query intentionally duplicates `PanelRepository.findById`'s join shape rather
  than introducing a new shared-join abstraction — explicitly flagged and accepted as a
  Risk/Trade-off in design.md, not an oversight.
- **Readable/Modular/Type safety**: clear naming throughout (`MetricUsage`/`MetricUsagePanel`,
  `runNoContentWithHeader`), value-class IDs used consistently at repository/service boundaries, no
  untyped escape hatches (`Option[Boolean]`, no `any` introduced in the TS diff).
- **Security**: owner-scoping enforced at both the service (`findByIdOwned` 404-first) and repository
  (`panel.ownerId === ownerUuid` in the join predicate) layers; `MetricRepositorySpec`'s cross-owner
  test directly proves the join itself — not just the 404 gate — scopes on the caller's own
  `owner_id`.
- **Error handling**: the new frontend usage-fetch has an explicit `"error"` state (never silently
  reported as `0`) rendered as "Couldn't check usage — panels bound to it will lose their resolved
  binding." — verified live in the browser is not directly testable without simulating a network
  failure, but the code path and its dedicated Jest coverage make the intent explicit and correct.
- **Tests meaningful**: new backend integration tests use real embedded Postgres and assert on
  produced SQL-backed results (not mocks) for the join/owner-scoping/materialization paths; frontend
  tests assert on rendered DOM output and network-call arguments, not implementation internals — all
  would catch a real regression (e.g. reverting the D5 filter, or reverting the schema placement,
  would fail at least one test).
- **No dead code**: no unused imports or leftover TODO/FIXME found in the diff.
- **No over-engineering**: `countBoundPanels` is a thin, justified derivation of `usage(...).size`
  rather than a separate SQL `COUNT` query — reasonable given usage volumes; no premature
  abstraction introduced.
- **Behavior-preserving where expected**: `withMaterializedMetric`'s existing `MetricPanel`
  materialization logic (dataTypeId/fieldMapping/aggregation/unit precedence) is unchanged — the
  diff only adds a new independent `metricDeprecated` branch, verified via diff read.

**Non-blocking suggestions** (do not affect PASS):
1. `MetricRoutesSpec.scala` (540 lines) and `MetricRepositorySpec.scala` (537 lines) now clear the
   ~250-line `CONTRIBUTING.md` soft budget after this ticket's additions — informational only per
   the standard, but a future split (e.g. a dedicated `MetricUsageRoutesSpec`) would keep them under
   budget if this area grows further.
2. `MetricDetailPage.tsx`'s "Confirm delete" button is not disabled while the usage count is still
   `"loading"` — a very fast double-click could in principle confirm before the real count renders.
   Not required by the AC text (which asks that the count be *displayed* before confirming, which it
   is), but blocking the confirm button until the fetch settles would tighten the guarantee.

### Phase 3: UI Review — PASS

Issues: none.

Dev servers started via `scripts/concertino/start-servers.sh` / `assert-phase.sh servers` — both
`PASS`/`READY` on `DEV_PORT=5992` / `BACKEND_PORT=8899`.

Exercised live in a real browser (Playwright), covering both new-selection exclusion and the
already-bound exception end to end, not just via component tests:
- **Delete-confirm real usage count**: clicking "Delete" on the metrics list and on the metric detail
  page both call `GET /api/metrics/:id/usage` (confirmed via network tab, `200 OK`) and render
  "Delete? Not bound to any panels." / the real count copy, replacing the old generic text.
- **Deprecate toggle**: toggling a metric's "Deprecated" switch and saving updates the metrics list's
  status badge (`active` ↔ `deprecated`) immediately.
- **Picker excludes deprecated (new selection)**: with the metric deprecated and *not* bound to any
  panel, opening a chart panel's "Bind to metric" picker showed only "— None —" — the deprecated
  metric was correctly excluded from new-selection options.
- **Bound-metric exception**: bound the (then-active) metric to a panel, then re-deprecated it.
  Reopening the panel's binding editor showed the metric still selected (not reverted to "— None —"),
  the picker's dropdown still listed it alongside "— None —" (so the user can keep or change it), and
  a "Bind to metric `deprecated`" badge rendered next to the label — screenshot-confirmed, matching
  `MetricListTable.tsx`'s badge visual pattern (amber pill).
- **Read materialization confirmed via raw API**: after clearing the binding, `GET
  /api/dashboards/:id/panels` showed `metricDeprecated` correctly *absent* (not `false`) from the
  now-unbound panel's `config`, matching the documented "absent when unbound" contract.
- Test data was fully restored to its pre-review state (panel unbound, metric un-deprecated) before
  finishing.
- **No console errors** across any flow (0 errors in every check; the one console warning present
  throughout — an ECharts "Can't get DOM width or height" message — is pre-existing/unrelated to this
  ticket, tied to chart-panel rendering timing, not this diff).
- **Breakpoints** (1440 / 1100 / 768 / 430 — this repo's canonical set per `DESIGN.md` §4, "0" in the
  brief interpreted as the smallest ratified breakpoint): rendered without page-level layout breakage
  at all four; the metrics list's raw `<table>` requires horizontal scroll for the rightmost columns
  at 768/430, which is a pre-existing `MetricListTable.tsx` pattern from HEL-553 that this ticket only
  added text content to (not a structural change), and `document.body.scrollWidth` never exceeded the
  viewport width (no unintended page-level overflow) — a judgment call on whether this narrow-viewport
  table experience should improve is deferred to the skeptic, not flagged here as a mechanical defect.
- **Accessible names**: the metric picker combobox (`aria-label="Metric"`), and the delete-confirm's
  Confirm/Cancel buttons (`aria-label="Confirm delete <metric name>"`) all carry accessible names; the
  new "deprecated" indicator is a non-interactive text badge, no accessible-name requirement applies.
- Feature reachable from both relevant entry points — `MetricDetailPage.tsx`'s and
  `MetricListTable.tsx`'s independent inline delete-confirm affordances — both verified live.

### Overall: PASS

### Non-blocking Suggestions
- Consider splitting `MetricRoutesSpec.scala`/`MetricRepositorySpec.scala` if this area grows further
  (informational soft-budget warning only, not a gate failure).
- Consider disabling "Confirm delete" in `MetricDetailPage.tsx` while `usage === "loading"` to close a
  narrow (very-fast-double-click) window where a delete could be confirmed before the real count
  renders.
