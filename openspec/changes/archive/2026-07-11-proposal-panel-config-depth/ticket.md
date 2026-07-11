# HEL-293: Proposal & panel config depth: content, chart sub-type, axis labels, colors, unit

Part of HEL-291 (https://linear.app/helioapp/issue/HEL-291/agent-native-dashboard-usability-panel-aggregation-config-depth-and).

## Description

The `dashboard-proposal` schema (and the panel config it applies) is too thin for an agent to produce a finished-looking dashboard — everything needs manual touch-up in the UI afterward.

### Gaps observed during prod validation

- **No content for non-data panels.** The proposal panel has no `content`/`url`/`orientation` field, so **text / markdown / image panels apply blank** ("No content yet"). An agent literally cannot author a markdown roadmap or a header.
- **No appearance.** Charts all apply as the **default line type** with a literal **"Y Axis"** label — no way to set chart sub-type (bar / pie / scatter / line), axis names, or colors from a proposal. "Titles by Maturity Rating" should have been a bar.
- **Metric** `unit` **ignored** and `label` **semantics confusing** — see the renderer ticket; this ticket covers exposing them through the proposal/config surface.

## Change

Extend the proposal schema + `propose_dashboard`/`apply_proposal` + apply service + panel config types to carry, per panel type:

- text/markdown → `content`; image → `url`; divider → `orientation`
- chart → `chartType`, axis titles, series color(s)
- metric → `unit`, literal `label`

## Acceptance criteria

- An agent can propose a markdown panel with real content and it renders that content on apply.
- An agent can propose a **bar** chart with named axes and it applies as a bar with those axes.
- No post-apply manual editing required to match the agent's intent for the Netflix overview.
