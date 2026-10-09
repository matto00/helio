## Standing Constraints

- [C1] Every bug-bullet test must fail on the pre-fix code for the user-visible defect itself (not merely a wire-shape difference such as "" vs null); record the red output. A test pinning existing behaviour is a guard and must be shown failable by a mutation.

## 1. Red-first tests

- [x] 1.1 Add failing sheet-level frontend tests asserting the `updateOutput` PATCH payload, and record each one's red output against current code:
  - collection stored `layout: "list"`, change only format → no `layout` in config;
  - timeline stored `sort: "desc"`, change only field mapping → no `sort`;
  - metric stored literal `label`/`unit`, switch both to field mode and bind → `label: null`, `unit: null`, bindings in `fieldMapping`;
  - table stored `columnOrder`, make every column visible in natural order → `columnOrder: null`;
  - table stored `["b","a"]` over fields `a,b,c`, move `a` above `b` → `columnOrder: ["a","b"]` (c stays hidden);
  - chart stored `fieldMapping.annotation`, remove the binding / switch to literal → `fieldMapping` has no `annotation`, other keys intact;
  - already-damaged chart (literal `annotation` + stale `fieldMapping.annotation`) and metric (literal `label` + stale `fieldMapping.label`), untouched save → repaired `fieldMapping` sent (for the metric, together with the paired `aggregation`, D4a) and no other key; fixtures for untouched-save tests elsewhere use no null/empty slot values;
  - untouched open+save of every kind (incl. chart with bound annotation) → no `config` in the payload;
  - aggregated metric stored in the canonical `{fieldMapping:{value:"amt"}, aggregation:{agg:"sum"}}` shape: (a) untouched save → no `config`; (b) bind only the label to a field → payload carries `fieldMapping` with `value: "amt"` and `label`, AND `aggregation` (D4a), and the shallow merge of stored config with the payload (done in the test as `{...stored, ...payload.config}`) still has the metric bound — this case passes on today's code, so per C1 it is a GUARD: show it fails under a mutation (e.g. dropping the D4a pairing), then revert;
  - table untouched save both BEFORE capabilities resolve (fetch pending, stored `columnOrder` present) and AFTER → no `config`/`columnOrder`.
- [x] 1.2 Create-mode tests: collection/timeline create still send `layout: "grid"`/`sort: "asc"`; table create with a hidden column (no reorder) sends the visible array.

## 2. Implementation

- [x] 2.1 Chart `fieldMapping` base excludes stored `annotation`; slots only from editor state (D4); verify the annotation tests pass.
- [x] 2.2 Metric `label`/`unit` emit `null` in field mode and for an emptied literal (D3); metric `fieldMapping.value` always carried when a field is chosen and `fieldMapping`/`aggregation` sent together (D4a); verify metric tests pass.
- [x] 2.3 `useOutputTableColumns`: "default" only when all columns visible in natural order; stored order returned as-is before capabilities load (D3); verify table tests pass and `useOutputTableColumns.test.ts` updated.
- [x] 2.4 Edit-mode Save sends only top-level keys changed vs an open-time baseline (D1/D2), `fieldMapping` additionally sent when the raw stored mapping has a stale slot key (D4, stale-slot detection only), `config` omitted when empty, full config on create and on a kind change; update the markdown comment (D7); verify all 1.x tests and existing outputEditor tests pass.

## 3. Seam proof

- [x] 3.1 Backend GUARD test pinning PATCH `/api/outputs/:id` merge semantics (omitted key preserved, `null` stored as `null`, `fieldMapping` replaced whole); show it fails under a mutation of `mergeConfig`, then revert — record both runs.
- [x] 3.2 Live check through the running app: DB `outputs.config` rows before/after real edit-mode saves for collection `layout: "list"`, metric literal→field label clear, an aggregated metric in the `{agg}` + `fieldMapping.value` shape (untouched save and label-binding-only edit — still bound afterwards), table `columnOrder` reset, and chart annotation removal; record before/after rows. Clean up any created rows by exact id.

## 4. Gates

- [x] 4.1 `npm run lint`, `npm run typecheck`, `npm test` (outputEditor + panels suites), `npm run format:check`, and the backend test subset all pass.
