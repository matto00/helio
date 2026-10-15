## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed: worktree HEAD 1ebf23fd0dab625242d9e03e4c46f494939409ef plus the uncommitted planning artifacts under
`openspec/changes/restate-remaining-stale-panel-specs/` (ticket, proposal, design, tasks, 4 delta specs).

### What I verified (with evidence)

- Spawn-cwd guard: `assert-cwd.sh` printed `READY ambient=/home/matt/Development/helio branch=task/restate-remaining-stale-panel-specs/HEL-1598`.
- `openspec validate restate-remaining-stale-panel-specs --type change --strict` printed `Change ... is valid`, rc=0.
- REMOVED/MODIFIED headers exist byte-exact in the living specs (checked with `grep -n '^### Requirement:'`):
  - mcp: "Proposal config passthrough is backward compatible" (:27), "Panel composition tools accept image caption and chart annotation" (:43) and "update_panel MCP tool" (:86).
  - panel-polling: :6 and :28.
  - dashboard-export-import: "Export dashboard endpoint" (:10).
  - panel-type-rendering: the selectors at :28 and :36.

**Round-1 CR1 (export self-contradiction): fixed.**
- `DashboardSnapshotPanelEntry` (`DashboardProtocol.scala:103-110`) has exactly these fields: snapshotId, id, title, type, appearance and config.
- `fromDomain` (:198-211) sets `snapshotId = id = panel.id.value` and `config = PanelConfigCodec.encodeConfig(panel)`.
- `encodeConfig` (`PanelConfigCodec.scala:29-37`) is per-kind. `OutputPanelConfig` writes `outputId` and `controls` (`OutputPanel.scala:129-137`). `FormPanelConfig` carries `dataSourceId` (`FormPanel.scala:200-204`).
- `DashboardSnapshotDashboardEntry` (:111-115) has only name, appearance and layout, so the dashboard has no id field.
- The delta now keeps the reference ids that config carries, bans only the dashboard's own id and the panels' own ids outside `id`/`snapshotId`, and names the `snapshotId` derivation. All of this matches the code.

**Round-1 CR2 (update_panel contradiction): fixed with option (a).** The stale requirement is REMOVED and "update_panel MCP tool edits a panel in place" is ADDED. I checked each claim:
- **Arguments.** `write.ts:766-806` takes panelId, title, type (an enum), config and appearance. There is no w/h/position argument.
- **Type change is rejected.** `PanelServiceHelpers.resolvePatch:21-30` returns 400 "cannot change panel type". The batch path at :124 does the same, which also backs the panel-type-rendering "no panel update path accepts a type change" sentence.
- **Rebinding is allowed.** The rebind goes through `OutputPanel.Patch.decode` and `applyPatch` (`OutputPanel.scala:181-232`). The existence check runs through `PanelUpdateValidation.scala:38` (`rejectMissingOutput`), which backs "a different existing Output".

**Round-1 CR3 (flat-field case): fixed.** `buildCreateRequest` (`ProposalPanelSupport.scala:249-265`) branches on `panel.outputId`:
- `buildDataConfig` (:315-322) returns `{outputId}` for an output panel and `{outputId, fieldMapping}` otherwise.
- `buildNonDataConfig` (:324-333) handles content, url (stored as `imageUrl` with `imageFit: "contain"`) and orientation.
- `mergeConfig` re-applies `outputId`, and `withSourceBinding` re-applies `dataSourceId`.
- `ProposalPanel` (`DashboardProposalProtocol.scala`) carries every listed legacy field.
- The delta now conditions seeding on "no flat `outputId`" and states that those fields are dropped otherwise. It is also consistent with the sibling "Inert panel-level proposal fields are marked deprecated" requirement (living spec :140-157).

**Caption/annotation ADDED requirement**
- `placements.ts:84` documents `caption`. `write.ts` documents the image `caption` patch semantics.
- `OUTPUT_CONFIG_KEYS_DOC` lists `annotation` (`outputs.ts:78`) and is used by both `add_output` (:147) and `update_output` (:175).
- `ChartOutputPanel.tsx:150` passes `cfg.annotation` to `ChartRenderer`, which renders `.chart-panel__annotation` (:131).

**Panel-polling deltas**
- The hook (`usePanelPolling.ts:12-63`) no-ops on a falsy interval or binding and re-runs when either changes.
- The caller passes `outputId` (`PanelCardBody.tsx:155`).
- The only non-test `refreshInterval` hit is the type at `panel.ts:288`, with its frontend-only comment at :275.
- The "unset (no numeric value)" wording avoids the null-vs-undefined question raised in round 1.
- Task 1.4 explicitly has the executor settle whether the binding-removed requirement is reachable. Its fallback (restate it as the hook's contract) is concrete.

**Panel-type-rendering selector MODIFIED blocks:** both keep their scenario names. The "fixed at creation" claim is backed by the two rejection sites above.

**Plan coverage**
- Every ticket item maps to a task: items 1-3 to tasks 1.x, 3.x and 4.1, and the unexamined specs to 2.x.
- The echarts deferral is recorded as C3/D4.
- D2's direct-edit exception is still scoped and probe-gated.
- I found no placeholders, contradictions or uncovered acceptance criteria.

### Verdict: CONFIRM

### Non-blocking notes
- mcp scenario "Legacy chart flat fields are inert on an output panel" says the created panel's config "is `{ outputId }`". The request config is `{ outputId }`. The persisted config is not: `OutputPanelConfig.format.write` always emits `controls` (`OutputPanel.scala:135-137`), so it reads back as `{outputId, controls: []}`.
  - The operative clause ("the same as the same proposal without those fields") is true.
  - Under task 1.2/1.6, the executor should either word this as "the same config as ... (`{ outputId }` plus the default empty `controls`)" or drop the literal shape.
  - The same applies to the requirement body's phrase "the derived config is `{ outputId }` only", which is accurate for the pre-merge derivation. A flat `controls` field is also merged in via `withControls` (:255-257); mention it if the sentence is read as the final config.
- Export: the layout's `panelId` values are also the real panel ids, because `snapshotId` equals the id. The delta covers this by saying layout references are keyed by `snapshotId` and that `snapshotId` is derived from the id. No change is needed. The evidence should cite `DashboardSnapshotRepository.scala:85-103`.
- panel-polling: in practice no panel ever has a numeric `refreshInterval`, so the ADDED "SHALL re-fetch" requirement is a hook contract for real panels. The body says this, which is acceptable. If task 1.4 finds the binding-removed path unreachable, keep the same framing.
- Carried from round 1: the PR body should disclose the direct (non-delta) edits to `write-path-audit` and the Purpose lines.
