## Context

See proposal.md — Why. Every metric-value path on main resolves the field by key:
- Server: `OutputSummaryReducer.metricField` (`backend/.../domain/history/OutputSummaryReducer.scala:90`) =
  `fieldMapping.value` orElse `aggregation.value`. Used by `metricOf` (history summary / headline) and by
  `OutputFilteredMetric.compute`, which both `OutputService.rows` and `PublicPanelRowsResolver` call. The config it
  reads comes from `OutputRepository.findConfigsByIdsInternal` — i.e. straight out of Postgres jsonb.
- Client: `resolveServerMetricField` (`frontend/.../panels/history/metricHistoryView.ts`) mirrors that rule;
  `MetricOutputPanel.tsx` uses it for the loaded-rows value (`firstRow[valueColumn]` / `computeAggregate`), for matching
  the server `filteredMetric` identity, and (via `selectMetricHistoryView`) for the history headline identity.
- `CollectionRenderer.buildMetricItem` maps each `[slot, column]` entry to `item[slot]` — order-independent.

Postgres jsonb stores object keys sorted by length, then bytewise: `unit` < `label` < `value`. So ANY config written
as `{value, label}` reads back as `{label, value}` — exactly HEL-588's observation, and the reason the DB-backed tests
below exercise the reordered shape by construction.

## Goals / Non-Goals

**Goals:** a red-provable test on each path above with a non-`value`-first `fieldMapping`. **Non-Goals:** production
changes (unless a test exposes a real order dependence — then fix it in scope and say so), chart/table slots.

## Decisions

**D1 — Discriminating fixture (no vacuous guard).** In every test the `label` (and `unit` where used) column MUST hold
a numeric-coercible value DIFFERENT from the `value` column (e.g. `value` column `amount` = 42/10/5, `label` column
`rank` = 7/8/9), so a wrong pick yields a plausible but wrong number rather than coincidentally the same result or an
easily-ignored blank. Assert the exact expected number, not just non-empty.

**D2 — Both orders, same expectation.** Each test case runs the mapping in at least the label-first order (and
unit-first / unit+label-first where the slot exists) and asserts the result equals the value-first baseline. Parametrise
rather than copy-paste.

**D3 — Precondition on the order `metricField` actually receives.** The server route tests (authenticated rows and
public panel rows) seed metric Outputs written in several key orders, then read the stored config back through
`OutputRepository.findConfigsByIdsInternal` (the same path `OutputFilteredMetric` uses) and ASSERT its `fieldMapping`
first key is NOT `value` before asserting the metric. Correction after probing: the stored config is read through a
spray-json parse, whose `JsObject.fields` iterates alphabetically (`label` < `unit` < `value`), so the precondition holds
whatever Postgres jsonb does and does NOT detect a change in jsonb ordering. What it guarantees is that every case hands
`metricField` a non-value-first map, so no case can degrade into a value-first test. Cases written label-first and
value-first both appear, for documentation of the written shape.

**D4 — Server unit level (corrected by probe).** The original plan assumed `Map1..Map4` preserve insertion order. A
probe showed spray-json's parsed `JsObject.fields` iterates alphabetically, so `value` is never first at `metricField`,
including the case whose JSON text is written value-first (that case is a baseline control by text only, and still goes
red under a positional pick). `OutputSummaryReducerSpec` therefore asserts, per case, `fields.keys.head` is not
`"value"` on the parsed config as the precondition.

**D5 — Client level.** Plain JS objects preserve string-key insertion order, so `{ label: "rank", value: "amount" }` is
label-first. Cover: `resolveServerMetricField` (unit test in `metricHistoryView.test.ts`); `MetricOutputPanel` through
the existing `PanelContent.metricHistory.test.tsx` harness (or a new `MetricOutputPanel.keyOrder.test.tsx` beside it
reusing its helpers) for (a) loaded-rows first-row value, (b) loaded-rows aggregate value, (c) a server
`filteredMetric` whose `field` is the value column is accepted (not discarded as an identity mismatch), (d) the history
headline is used (identity matches). `CollectionRenderer.test.tsx`: label-first mapping renders each item's value from
the value column. New test files preferred over editing `PanelCard*` tests.

**D6 — Red proof by mutation, recorded.** The executor records, per path, the mutation applied and the failing test
names: client — replace `nonEmptyString(mapping?.value)` with the first `Object.values(mapping)` string; server —
replace `stringField(config, "fieldMapping", "value")` with the first `fieldMapping` field's string value;
CollectionRenderer — a positional variant is not natural (the renderer is per-slot); its test is a GUARD and MUST be
labelled as such, with a mutation that makes it red (e.g. assign `item.value` from `Object.values(fieldMapping)[0]`).
Every mutation is reverted before commit; the evidence (diff + failing output excerpt) goes in the executor's report.

## Risks / Trade-offs

- [Mutation exercises a different branch than claimed] → D6 requires the failing test names per mutation; evaluator
  re-runs at least one mutation.
- [Shared dev DB residue] → route specs use the existing spec harness's seeding/cleanup (as `OutputFilteredMetricRoutesSpec`
  already does); no new persistent data.
- [Contention with HEL-1313/HEL-1365] → files listed in proposal Non-goals are out of bounds; tests only.

## Gate-Chain Implications Checklist

Not applicable: no `.husky/**` or pre-commit-invoked script is touched.

## Planner Notes

- Self-approved: MODIFIED requirement (adds a key-order scenario to an existing requirement) rather than `skip_specs`,
  since key-order independence is an observable contract that was never stated.
- Restated scope was answered by the driver under overnight delegation (not the owner) — see ticket.md.
