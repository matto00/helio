## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed HEAD: 87ac4093066c28851ac6ce2003ee9a3feeadc5b2 (base 945128faac04e3a1ef3b82628323af5a9558dc61, resolved live).
Diff: 14 files, +565/-0. Zero production files changed: everything is a test, a shared fixture, or under the change dir.

### Phase 1: Spec Review — FAIL

- ACs (restated scope): met. AC1/AC3 already hold on main (HEL-1275/HEL-1326). AC2 is delivered as key-order tests on
  every listed path: `resolveServerMetricField`, `MetricOutputPanel` (a)-(d), `CollectionRenderer` (GUARD),
  `OutputSummaryReducer.metricField`/`metricOf`, `OutputFilteredMetric` through the authenticated rows route and the public
  panel-rows route, plus a seam case in `shared-test-fixtures/output-summary-reducer.json`.
- Tasks: all marked done, and they match the diff.
- Scope: no out-of-bounds files. `usePanelData.ts`, `outputConfigTypes.ts`, `schemas/`, `PanelCard.tsx` and `PanelCard*`
  tests are untouched (grep of `git diff --name-only` returned nothing).
- Constraints: C1 honored (test-only). C2 honored; see the mutation evidence in Phase 2. C3 honored by the evaluator's own runs.
- Delta spec: the added "Label or unit mapped before value" scenario is accurate.
- **Issue (planning artifact doesn't match what was built): `design.md` D3/D4 are factually wrong for what shipped.**
  - `design.md:39-42` (D4) says the reducer spec builds order-controlled `JsObject`s and relies on Scala `Map1..Map4`
    keeping insertion order. The spec doesn't do that. It parses JSON text, and spray-json's parsed `JsObject.fields`
    doesn't keep insertion order. I confirmed this independently. The `"value-first"` reducer case writes
    `{"value":..,"label":..}`, yet its precondition `fields.keys.head should not be "value"` passes. Under the
    positional mutation that case also goes red.
  - `design.md:35-36` (D3) says "If jsonb ever stopped reordering, that precondition fails loudly." The precondition
    (`OutputFilteredMetricRoutesSpec.scala:255-260`) reads the config through `findConfigsByIdsInternal`, which goes
    through the same spray parse. So `value` is never first there whatever jsonb does. The precondition is still a
    true check on the input `metricField` actually receives, but the reason the design gives for it is false.
  - The probe correction appears only in a test comment (`OutputSummaryReducerSpec.scala` "D4 (probe-corrected)"). The
    design doc that gets archived still carries the disproven claim.

### Phase 2: Code Review — PASS

Gates (evaluator's own fresh runs in WORKTREE_PATH, nice -n 19, max 3 workers):
- `npm run lint`: 0 warnings, exit 0.
- `npm run format:check`: clean.
- `npm run typecheck`: clean.
- `npm --prefix frontend run build`: succeeded.
- Root Jest: 42 suites / 396 tests passed.
- Frontend Jest (`npx jest --maxWorkers=3`): 466 suites / 4937 tests passed, 0 failed.
- `sbt testFull`: 440 suites, 6138 passed, 0 failed, 4 canceled (pre-existing), exit 0.
- Targeted run: `sbt "testOnly *OutputSummaryReducerSpec *OutputFilteredMetricRoutesSpec"` gave 50/50 passed.

Mutation re-runs by the evaluator. Each was reverted with `git -C <wt> checkout -- <file>`, and `git status --short`
was empty afterwards.
1. **Server**: `metricField` changed to take the first `fieldMapping` field's string instead of
   `stringField(config,"fieldMapping","value")`. Result: 26 failed.
   - All 12 new `OutputSummaryReducerSpec` HEL-1182 cases failed, including "value-first", because of spray's ordering.
   - All 8 new route cases failed (4 authenticated `GET /outputs/:id/rows`, 4 public
     `GET /dashboards/:d/panels/:p/rows`).
   - Pre-existing HEL-1326 cases also failed.
2. **Client resolver**: `nonEmptyString(mapping?.value)` changed to `nonEmptyString(Object.values(mapping)[0])`. Result: 30 failed.
   - The 12 label-first, unit-first and unit+label-first `MetricOutputPanel` (a)-(d) tests failed.
   - The 9 matching `resolveServerMetricField` HEL-1182 tests failed.
   - The new shared-fixture case "label and unit listed before value (HEL-1182 ...)" failed in `aggregate.fixture.test.ts`.
   - Pre-existing HEL-1326 cases also failed.
3. **CollectionRenderer**: after the slot loop, `item.value` was set from `Object.values(fieldMapping)[0]`. Result: 3
   GUARD tests failed (label-first, unit-first, unit+label-first).

As expected, the value-first client cases and the four `precondition:` fixture tests stay green under these
mutations. They're controls/baselines, as D2 intends (see suggestions).

Executor claims checked:
- **spray alphabetical / reducer spec not vacuous**: confirmed. Every reducer case reaches `metricField` with `value`
  not first. The precondition asserts this per case, and every case flips red under a positional pick. The spec
  separates positional from by-key picks. The `"value-first"` case name describes the JSON text, not the map
  `metricField` sees; the block comment says so (see suggestions).
- **Route D3 precondition**: present (`OutputFilteredMetricRoutesSpec.scala:255-260`). It asserts the stored first key
  != `value` and that `value` is present. It's non-vacuous as a check on what `metricField` receives. Its stated
  rationale is wrong (Phase 1 issue).
- **D1 discriminating fixtures**: `rank` is numeric and differs from `amount` everywhere. Sums are 55 vs 1055 in the
  reducer and eastSum vs rankEastSum in the routes. The client uses 42/52 vs 7/15, with injected 999/1,204 that differ
  from both. Assertions are exact numbers.
- **Test residue**: none. `OutputFilteredMetricRoutesSpec` runs on a per-suite EmbeddedPostgres. The run log shows
  `EmbeddedPostgres ... shut down postmaster` and a fresh Flyway migrate to v116. No rows reach the shared dev DB, so
  no ids to list.
- **The 11 Jest failures the executor saw on its first run (e.g. `PipelineDetailPage.test.tsx:1022`)**: no
  HEL-1182-touched file is involved; the change adds only isolated new test cases/files. My full frontend run at
  `--maxWorkers=3` passed 4937/4937. I judge it to be load flake from an uncapped worker count, unrelated to this change.

Code-quality review: the new tests reuse existing harnesses (`seedPipelineWithOutput`, `seedPublicPanel`,
`renderWithStore`, `makeOutputPanel`, `makeHistory`). Parametrization uses `foreach`/`it.each`/`describe.each`
(no copy-paste). No `any`. No dead code or TODOs. No inline FQNs. The GUARD is labelled as required.

### Phase 3: UI Review — N/A

The `frontend/**` trigger matched only on test files (`*.test.ts(x)`). The diff contains zero production frontend,
route, schema or `openspec/specs/**` files, so the running app is byte-identical to main and there is no UI surface to
review. The orchestrator also judged Playwright unnecessary. The rendered metric paths are covered by the
component-level tests above, which were mutation-proven.

### Overall: FAIL

### Change Requests
1. `openspec/changes/guard-metric-fieldmapping-key-order/design.md:39-42` (D4): rewrite to match what shipped.
   - The reducer spec parses JSON text, and spray-json's parsed `JsObject.fields` does NOT keep insertion order. It was
     observed alphabetical: `label` < `unit` < `value`.
   - So `value` is never first in any case, including the `{"value":..,"label":..}` text case.
   - The per-case `keys.head != "value"` precondition pins that.
   - Remove the `Map1..Map4` insertion-order claim, or record it explicitly as disproven by the probe.
2. `openspec/changes/guard-metric-fieldmapping-key-order/design.md:35-36` (D3): replace "If jsonb ever stopped
   reordering, that precondition fails loudly" with the true mechanism.
   - The stored config is read through the same spray parse, so the precondition checks the order `metricField`
     actually receives. That order is non-value-first whatever jsonb does (jsonb's length-then-bytewise sort and
     spray's ordering both put `value` last for these mappings).
   - The explicit label/unit-first-written cases keep the test independent of either mechanism.

### Non-blocking Suggestions
- `backend/src/test/scala/com/helio/domain/history/OutputSummaryReducerSpec.scala:159`: rename the `"value-first"` case
  to `"value-first text"` (or similar) so test names don't imply `metricField` sees a value-first map.
  `OutputFilteredMetricRoutesSpec` already uses "... written".
- `frontend/src/features/panels/history/metricHistoryView.test.ts:237`: the comment "these are deliberately
  non-value-first" is false for the first (`value-first`) entry. Say the value-first entry is the baseline/control.
- The value-first client cases are controls, so a first-entry pick can't turn them red. A one-line label such as
  "baseline (control)" would make C2 accounting explicit.
- `OutputFilteredMetricRoutesSpec.scala:255`: the scaladoc says "the config as Postgres returns it". More precisely, it
  is the config as `findConfigsByIdsInternal` returns it after the spray parse.
