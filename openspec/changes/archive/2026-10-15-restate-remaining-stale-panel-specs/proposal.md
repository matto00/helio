## Why

HEL-1592 left a named set of living-spec statements that still describe removed panel models (`typeId` binding, chart
panels carrying `annotation`, flat chart fields that "produce the same panels as before", changing a panel's type), plus
three panel-type specs nobody has checked since `collection`/`timeline` stopped being panel kinds. Agents and reviewers
ground on `openspec/specs`, so a false statement there produces wrong work (see `ticket.md`).

## What Changes

- `mcp-panel-composition-tools`: restate "Proposal config passthrough is backward compatible" to what the flat fields do
  today (content/url/orientation seed non-data panel config; the chart/metric flat fields are inert); replace "Panel
  composition tools accept image caption and chart annotation" with a requirement placing `caption` on the image panel
  and `annotation` on the chart-kind Output config.
- `panel-type-rendering`: drop "or changing" from the two type-selector requirements (a panel's type is fixed at
  creation); restate the Purpose line (direct edit, see design D2).
- `panel-polling`: restate the `typeId` gate as the panel's Output binding, and state that `refreshInterval` is a
  frontend-only field.
- `dashboard-export-import`: restate the export panel-entry field list without `typeId`/`fieldMapping`.
- `write-path-audit`: restate the `typeId` row/payload in the Write Path Reference (direct edit, see design D2).
- `collection-panel-type`, `collection-panel-rendering`, `collection-config-editor`, `timeline-panel-type`,
  `timeline-panel-rendering`, `metric-panel-trend-indicator`: re-derive every requirement against the tree; restate,
  remove, or leave each (with evidence) per design D3.
- Deferred, not edited: `echarts-chart-panel`'s `typeId` mention (an open parked change, HEL-1572, carries a delta for
  that spec).

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `mcp-panel-composition-tools`: flat-field back-compat and caption/annotation requirements.
- `panel-type-rendering`: type-selector requirements.
- `panel-polling`: polling gate requirements.
- `dashboard-export-import`: export endpoint field list.
- `collection-panel-type`, `collection-panel-rendering`, `collection-config-editor`, `timeline-panel-type`,
  `timeline-panel-rendering`, `metric-panel-trend-indicator`: whichever requirements task group 2 finds stale.

## Non-goals

- Any runtime behaviour, wire, schema or UI change (including removing the dead-in-practice polling hook).
- Stale text outside the named items; anything found is recorded in evidence.md "Out of scope, observed" for triage.
- `echarts-chart-panel` (deferred, see above).

## Impact

`openspec/specs/*` only (via deltas and archive, plus the direct edits in design D2). No code, API, schema or
user-visible change.
