## Standing Constraints

- [C1] Every factual claim in every delta, Reason/Migration and direct spec edit made by this change has a verification command and its output recorded in this change's evidence.md; a claim that fails verification is corrected to match ground truth, never the reverse.
- [C2] No file outside `openspec/` is modified (docs/specs only, no behaviour change); `git diff --stat origin/main...HEAD` shows only `openspec/` paths.
- [C3] `openspec/specs/echarts-chart-panel/spec.md` is not edited (an open parked change, HEL-1572, carries a delta for it).

## 1. Verify the planned deltas (no code change)

- [x] 1.1 Verify every design.md "Code facts" bullet with a command; record command + output in evidence.md
- [x] 1.2 Verify every sentence of the mcp-panel-composition-tools delta (both REMOVED Reasons/Migrations, both ADDED requirements and their scenarios): `buildCreateRequest`/`buildDataConfig`/`buildNonDataConfig`/`mergeConfig`, the "decoded but never applied" field list in proposal.ts and the proposal schema, `create_content_panel`/`update_panel` caption docs, `add_output`/`update_output` + `OUTPUT_CONFIG_KEYS_DOC` annotation, and how `ChartOutputPanel`/`ChartRenderer` render `annotation`; the `update_panel` argument list, type-mismatch 400 and `config.outputId` rebind (`OutputPanel.Patch`); the backend proposal path's handling of a `divider` panel; record
- [x] 1.3 Verify the panel-type-rendering selector delta: find every panel type selector/creation entry point in `frontend/src` and confirm `markdown`/`image` are offered; confirm no panel update path accepts a `type` change (`PATCH /api/panels/:id` decode, batch update, MCP `update_panel`); record
- [x] 1.4 Verify the panel-polling delta: the hook, its caller, every `refreshInterval` producer in `frontend/src` (non-test) and the backend (no column/field), whether an output panel's `outputId` can become null on the client (if unreachable, restate the binding-removed requirement as the hook's contract), and whether a backend-loaded panel's `refreshInterval` is `null` or `undefined` (the delta's wording must match); record
- [x] 1.5 Verify the dashboard-export-import delta against `DashboardSnapshotPanelEntry` and the export code path (and the published snapshot schema, if any); record
- [x] 1.6 Amend any delta wording a probe contradicts; `openspec validate restate-remaining-stale-panel-specs --type change --strict` passes

## 2. Re-derive the unexamined specs (design D3)

- [x] 2.1 `collection-panel-type`: per requirement, a command-backed ACCURATE/RESTATE/REMOVE verdict; write the delta; record
- [x] 2.2 `collection-panel-rendering`: same; record
- [x] 2.3 `collection-config-editor`: same; record
- [x] 2.4 `timeline-panel-type`: same; record
- [x] 2.5 `timeline-panel-rendering`: same; record
- [x] 2.6 `metric-panel-trend-indicator`: same (including whether any caller sets `data.trend`, and how the HEL-1272 comparison marker shares the trend classes); record
- [x] 2.7 If any spec would be left with zero requirements, run the D3 throwaway-copy probe first and follow its result; record

## 3. Content the delta grammar cannot address (design D2)

- [x] 3.1 Confirm with a command that OpenSpec deltas cannot modify `## Purpose` or a non-requirement section; record
- [x] 3.2 Restate `panel-type-rendering`'s Purpose, and the Purpose of any D3 spec found false or `TBD`, directly in `openspec/specs/<cap>/spec.md`; record before/after + verification commands
- [x] 3.3 write-path-audit: verify whether any UI path PATCHes a panel binding today; restate or remove row 9 and payload detail 9 per design D2, directly; record before/after + commands

## 4. Gates and records

- [x] 4.1 `grep -n typeId openspec/specs/{dashboard-export-import,panel-polling,write-path-audit}/spec.md` returns only intentional historical mentions (classify each); echarts excluded per C3; record
- [x] 4.2 Record "Out of scope, observed" stale statements (including the deferred echarts `typeId` line) in evidence.md for Delivery triage
- [x] 4.3 `openspec validate restate-remaining-stale-panel-specs --type change --strict` green; `openspec validate --specs --strict` green; `git diff --stat origin/main...HEAD` shows only `openspec/` paths (C2); commit
