# HEL-624: Chart panel aggregation silently ignored for pie and scatter chart types

## Context

HEL-292 shipped panel-level aggregation for chart panels (`{groupBy, agg, yField}`), so a chart can group N rows into categories with an aggregate per group instead of plotting one mark per raw row.

But the guard in `frontend/src/features/panels/ui/ChartPanel.tsx` restricts it to two chart types:

```ts
const useAggregate = chartAggregate != null && (chartType === "bar" || chartType === "line");
```

So a **pie** or **scatter** chart with a valid `aggregation` spec silently falls back to raw-row plotting. The spec is accepted, persisted, and then ignored at render time with no warning anywhere — the chart just renders wrong (one mark per source row) and the author has no signal why.

Found while building a dashboard via the MCP: the agent wanted a pie chart of status distribution, discovered the limitation by reading `ChartPanel.tsx`, and avoided pie entirely. An agent that had not read the frontend source would have shipped a broken panel. Nothing in the panel schema, the MCP tool descriptions, or the UI communicates the restriction.

Pie is arguably the chart type where aggregation matters MOST — a pie of raw un-grouped rows is almost never what anyone wants.

## Scope

Decide and implement one of:

* **Support it** — extend `useAggregate` to pie (grouped slices with an aggregate per category, the obvious semantic) and decide whether scatter is meaningful (it may legitimately want raw points, in which case say so explicitly rather than leaving it implicit).
* **Reject it loudly** — if pie/scatter aggregation is deliberately out of scope, surface it: validate at panel create/update so an unsupported combination is a visible error, and document the restriction in the panel schema and the MCP `create_panel` tool description.

Silent ignoring is the one option to rule out.

## Acceptance criteria

- [ ] A pie chart with an `aggregation` spec either aggregates correctly, or fails visibly at configuration time with a clear message.
- [ ] Same decision applied consistently to scatter, with the rationale recorded.
- [ ] The behaviour is discoverable without reading `ChartPanel.tsx` — reflected in the panel schema and the MCP tool description.
- [ ] Test coverage for whichever behaviour is chosen.

## Orchestrator design-gate brief (from human pre-brief)

The ticket offers two directions. Pick one deliberately and justify it — do not split the difference into something half-done.

- **Support it** — extend aggregation to pie (grouped slices with an aggregate per category is the obvious semantic). Decide scatter separately and on its merits: a scatter plot may *legitimately* want raw points rather than aggregated ones, in which case say so explicitly rather than leaving it implicit.
- **Reject it loudly** — if pie/scatter aggregation is genuinely out of scope, make it visible: validate at panel create/update so an unsupported combination is a clear error, and document the restriction.

**Silent ignoring is the one outcome to rule out.** Whatever chosen, the behaviour must be discoverable without reading `ChartPanel.tsx`.

Also settle:
1. **Discoverability surfaces.** The panel JSON schema and the MCP `create_panel` tool description are where an agent learns what's possible. Whichever direction is taken must be reflected there. Note the MCP `dist` in this repo is stale versus source, but that's a deployment concern — update the source only.
2. **Consistency with HEL-365.** `GET /api/types/:id/panel-capabilities` + `PanelBindingSpec` now answer "what can bind to this DataType." If that surface says anything about chart types or aggregation, keep it consistent — two divergent answers about what a chart can do would be a real defect.
3. **Backward compatibility.** Existing panels with pie/scatter + a stray aggregation spec currently render as raw rows. If honouring the spec begins, those panels' rendering changes. Decide whether that's acceptable (arguably it's the fix) and call it out.

Frontend standards (binding): `DESIGN.md` for frontend work, `CONTRIBUTING.md` for code quality including co-located `*.test.tsx`. Zero-warnings lint, Prettier, Husky runs ESLint + Prettier + Jest on commit. Never inline fully-qualified names.
