## Context

See proposal.md and ticket.md. Premise re-derived 2026-10-15 against main 1ebf23fd0
(`.concertino/runs/HEL-1598/evidence/premise-validation.md` in the main checkout): every named item is real except
that no spec is literally named "metric-trend"; the nearest is `metric-panel-trend-indicator`.

Code facts the planned deltas rest on (each re-verified by the executor with a command, constraint C1):
- Canonical panel kinds are `text/markdown/image/divider/output/form`; `collection`, `timeline`, `chart`, `metric`
  and `table` are Output kinds rendered inside an `output` panel (`OutputPanelContent.tsx` kind dispatch, lines ~242-254).
- Polling: `PanelCardBody.tsx:155` calls `usePanelPolling(refresh, panel.refreshInterval ?? null, outputId)`; the
  hook's third parameter is still named `typeId`. `panel.ts` (~275-288) says `refreshInterval` is frontend-only,
  ignored by the backend on PATCH, and `null` for any panel hydrated from the backend.
- Proposal flat fields: `ProposalPanelSupport.buildCreateRequest` derives config from `outputId` (output panel:
  `{outputId}` only) or, for non-data panels, flat `content` (text/markdown), `url` (image -> `imageUrl` +
  `imageFit: "contain"`), `orientation` (divider); passthrough `config` wins on conflict except the flat
  `outputId`/`dataSourceId`. `chartType`/`xAxisLabel`/`yAxisLabel`/`seriesColors`/`sort` are "decoded but never
  applied" (`helio-mcp/src/tools/proposal.ts` ~57-62); `fieldMapping`/`aggregation`/`label`/`unit` are already covered
  by the "Inert panel-level proposal fields are marked deprecated" requirement.
- Caption/annotation: image `caption` is documented on `create_content_panel` (`placements.ts` ~84) and
  `update_panel` (`write.ts` ~793); `annotation` is a chart-kind Output config key (`OUTPUT_CONFIG_KEYS_DOC`,
  `outputs.ts` ~78; backend `OutputBindingSpec.scala` ~71-76), set via `add_output`/`update_output`.
- Export snapshot panel entries: field list to be read from the export protocol/case class (executor).

## Goals / Non-Goals

**Goals:** every named item re-derived with a recorded command; every stale statement restated or removed with text
that is itself verified; items found accurate dropped with evidence; `openspec validate --strict` green.

**Non-Goals:** see proposal.md.

## Decisions

D1. Delta shape (HEL-1466/HEL-1592 pattern). Same meaning, wording wrong -> MODIFIED with the header copied byte-exact.
Meaning changes (the requirement's subject no longer exists in that form) -> REMOVED with Reason/Migration grounded in
the tree, plus ADDED under a new name when a true replacement exists. `openspec validate --strict` refuses a MODIFIED
block that drops or renames an existing scenario, so any requirement whose scenario NAME is stale (e.g. "No polling
when typeId is unset") must be REMOVED + ADDED. Applied: mcp "Proposal config passthrough is backward compatible" and
"Panel composition tools accept image caption and chart annotation" REMOVED + ADDED ("Proposal flat fields seed
non-data panel config and are inert on output panels"; "Image panel caption and chart Output annotation are set
through their own MCP tools"); the two selector requirements MODIFIED; panel-polling's two `typeId` requirements
REMOVED + ADDED; "Export dashboard endpoint" MODIFIED (its `config` field list read from
`DashboardSnapshotPanelEntry` in `DashboardProtocol.scala`).

D2. Content the delta grammar cannot address. OpenSpec deltas operate on `### Requirement:` blocks only; a spec's
`## Purpose` and any non-requirement top-level section (write-path-audit's `## Write Path Reference`) have no delta
operation. The executor first confirms this with a command (openspec's own docs/help or a probe delta in a throwaway
copy, recorded). If confirmed, those few lines are edited directly in `openspec/specs/<cap>/spec.md` in this change,
each with a before/after diff and its verification command in evidence.md, and the PR body says so explicitly (the
ticket asked for deltas; this is the stated exception). If a delta CAN address them, use the delta instead. Purposes in
scope: `panel-type-rendering` (named), plus the Purpose of any spec in D3 whose Purpose is false or a `TBD` placeholder
(`metric-panel-trend-indicator`'s is `TBD`). write-path-audit: only the `typeId` row 9 and payload detail 9 are in
scope. If the UI still PATCHes a panel's binding, restate row 9 and payload detail 9 to that write's real trigger and
payload (from the thunk/service that sends it). If no UI path does, remove row 9 and payload detail 9 and say where
binding is set now. Other rows are not renumbered. Other stale rows observed go to "Out of scope, observed".

D3. The six unexamined specs (`collection-panel-type`, `collection-panel-rendering`, `collection-config-editor`,
`timeline-panel-type`, `timeline-panel-rendering`, `metric-panel-trend-indicator`). For each requirement, the
executor records a command-backed verdict: ACCURATE (leave, evidence recorded), RESTATE (the behaviour exists on the
Output path; MODIFIED, or REMOVED+ADDED per D1 if the subject changes), or REMOVE (no code path; REMOVED with
Reason/Migration). Rules:
  - "panel" wording that is true of the Output kind rendered in an `output` panel is RESTATE, not REMOVE.
  - A requirement naming a removed tool (`create_panel`, `bind_panel`), the `dataTypeId`/`typeId` binding, or an
    editor that no longer exists is REMOVE unless a current equivalent exists (then RESTATE against it).
  - Renderer behaviour still present but unreachable from any current caller (e.g. `MetricRenderer`'s legacy
    `data.trend` path if no caller sets `trend`) is stated as exactly that, never as user-visible behaviour; prefer
    RESTATE to "the renderer SHALL ..." if a test pins it, REMOVE if neither caller nor test exists.
  - A spec whose every requirement would be REMOVED: before writing that, probe in a throwaway copy of the repo
    whether `openspec archive` + `openspec validate --specs --strict` accept a spec left with zero requirements.
    If not, keep the one most accurate requirement restated (or restate one to point at the spec that now owns the
    behaviour) rather than deleting the spec directory by hand; record the probe.
  The executor writes these deltas under `specs/<cap>/spec.md`.

D4. echarts-chart-panel deferred: not edited (driver rule: an open parked change, HEL-1572, carries a delta for it).
Recorded in evidence.md for the Delivery follow-up triage, with the line and command.

D5. Evidence. evidence.md records, per claim in every delta/direct edit, the command and its output (C1); per item
the verdict (stale/accurate/deferred). No code is edited, so no code gates beyond `openspec validate` and the
repo's spec hygiene check; the executor runs `git diff --stat origin/main...HEAD` to show only `openspec/` paths.

## Risks / Trade-offs

- [A restated sentence is itself false] -> C1, every sentence has a command.
- [REMOVED/MODIFIED header mismatch aborts archive] -> headers copied byte-exact; `openspec validate --strict`.
- [Direct spec edits bypass the delta review trail] -> limited to D2's non-addressable lines, each diffed in
  evidence.md and called out in the PR body.
- [Concurrent lanes editing the same specs] -> premise check found no open change touching these specs besides
  HEL-1572's echarts delta (deferred); re-check every worktree's `openspec/changes/*/specs` at Delivery.

## Planner Notes

Self-approved: the D2 direct-edit exception (the ticket's "through deltas" cannot apply to Purpose/reference sections);
deferring echarts (driver rule); including `collection-panel-rendering`, `collection-config-editor` and
`timeline-panel-rendering` under "the collection, timeline ... specs" (the ticket names the families, and HEL-1592's
evidence lists them as unexamined). No escalation: docs/specs only, all reversible.

Design gate round 1 (REFUTE, skeptic-design-1.md) addressed: (1) export delta no longer bans the reference ids a
panel `config` carries (`outputId`, `dataSourceId`, control ids) and names the `snapshotId` derivation; (2) the living
"update_panel MCP tool" requirement (false: no w/h, rebinding allowed) brought into scope as REMOVED + ADDED "update_panel
MCP tool edits a panel in place"; (3) flat-field requirement now conditions seeding on "no flat `outputId`". Smaller
notes folded into tasks 1.2 (backend accepts divider on the proposal path) and 1.4 (reachability of a null `outputId`;
`null` vs `undefined` for backend-loaded `refreshInterval`, wording follows what is verified).
