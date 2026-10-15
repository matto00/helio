# Evidence: restate-remaining-stale-panel-specs (HEL-1598)

Base 1ebf23fd0 (main). Every command below ran from the worktree root; each block is `$ command` then its output
(truncated where the output was long; the full command is always shown). Constraint C1: every factual claim in the
deltas and direct edits cites a block here. The "Detailed command log" section after the summaries holds the raw blocks.

## A. Verdict per ticket item (re-derived against the tree)

| Ticket item | Verdict | Where handled | Key evidence blocks |
|---|---|---|---|
| mcp: flat-field back-compat requirement | STALE | delta REMOVED + ADDED (mcp-panel-composition-tools) | "ProposalPanelSupport buildCreateRequest...", "Proposal schema ... decoded but never applied", "Backend proposal path accepts divider" |
| mcp: chart `annotation` requirement | STALE (chart is not a panel kind; `caption` half accurate) | delta REMOVED + ADDED | "Canonical panel kinds", "MCP annotation docs", "Backend KnownKeys lists chart annotation" |
| mcp: "update_panel MCP tool" (extra, from skeptic round 1) | STALE (no w/h; rebinding allowed) | delta REMOVED + ADDED | "update_panel tool args", "Type change rejected", "rejectMissingOutput" |
| panel-type-rendering Purpose line | STALE | direct edit (D2, probe A) | "Probes in a throwaway copy..." |
| panel-type-rendering "or changing" (x2) | STALE | delta MODIFIED (both) | "No UI control for changing a panel's type", "Batch update path rejects type change", "OutputPicker content-kind options" |
| `typeId`: dashboard-export-import | STALE | delta MODIFIED | "DashboardSnapshot* case classes", "Import resolves config.outputId" |
| `typeId`: panel-polling (2 requirements) | STALE | delta REMOVED + ADDED | "Polling hook source", "Polling caller", "refreshInterval in non-test..." |
| `typeId`: write-path-audit (row 9 + payload detail 9) | STALE | direct edit (D2) | "patchPanelOutputId body + swapPanelOutput thunk" |
| `typeId`: echarts-chart-panel | STALE, DEFERRED (C3/D4) | not edited | "echarts-chart-panel typeId mention" |
| collection-panel-type (1 requirement) | STALE | delta REMOVED + ADDED; Purpose direct edit | "OutputConfigValidation KnownKeys", "V117 audit table" |
| collection-panel-rendering: One bound row renders one item | STALE wording (DataType); behaviour kept | REMOVED + ADDED | "CollectionRenderer.tsx", "OutputPanelContent kind dispatch" |
| collection-panel-rendering: Literal item options | STALE (itemOptions gone; `metricOptions` has no caller) | REMOVED | "metricOptions passed by any non-test caller?" |
| collection-panel-rendering: Grid and list layouts | ACCURATE, dropped | none | "CollectionRenderer.css grid/list/item rules" |
| collection-panel-rendering: Empty and unbound states | STALE (unbound unreachable; panel-level states differ) | REMOVED + ADDED | "usePanelData noData", "PanelContent output-panel branch states", "outputId required at panel create" |
| collection-panel-rendering: Desktop overflow scrolls | ACCURATE, dropped | none | "CollectionRenderer.css" (`overflow-y: auto`) |
| collection-config-editor: modal editor | STALE (no such editor) | REMOVED + ADDED | "OutputKindConfigCard collection+timeline blocks", "buildOutputConfig collection/timeline" |
| collection-config-editor: one config PATCH | STALE scenario (no layout control) | REMOVED + ADDED | "configPatch.ts", "configPatch test: collection format-only edit & create" |
| collection-config-editor: mobile touch targets | STALE (editor gone; CSS orphaned) | REMOVED | "panel-detail-modal__segmented used anywhere in source?" |
| timeline-panel-type (1 requirement) | STALE (panel.schema has no timeline; create_panel/bind_panel unregistered) | REMOVED + ADDED | "panel.schema.json type enum", "MCP tools create_panel/bind_panel registered?", "schema-drift ... output.schema kind enum" |
| timeline-panel-rendering: list rendering | STALE wording (DataType); behaviour kept | MODIFIED | "TimelineRenderer.tsx", "readTimelineConfig default sort" |
| timeline-panel-rendering: mapping configurable in panel config editor | STALE (no sort control; no panel editor) | REMOVED + ADDED | "buildOutputConfig collection/timeline", "configPatch test..." |
| timeline-panel-rendering: scaling and degradation | STALE wording ("proportionally", "truncate") | MODIFIED | "TimelineRenderer.css lines 60-125" |
| metric-panel-trend-indicator: trend present | STALE framing (no production caller of `data.trend`) | MODIFIED | "trend in non-test frontend source", "data passed to PanelContent by callers" |
| metric-panel-trend-indicator: font-size | STALE values (rem literals -> tokens) | MODIFIED | "CSS for trend font-size and breakpoints", "text token values" |
| metric-panel-trend-indicator Purpose (`TBD`) | STALE | direct edit (D2) | spec diff in section C |
| "metric-trend" spec named in the ticket | no such spec; nearest is `metric-panel-trend-indicator` (premise note) | n/a | "ls openspec/specs" listing |

## B. Skeptic notes folded in
- skeptic-design-2 note 1: scenario "Legacy chart flat fields are inert on an output panel" no longer claims the created config is the literal `{ outputId }`; it says the config is the same as for the same proposal without those fields and omits `chartType`/`xAxisLabel`. Basis: `OutputPanelConfig.format.write` always emits `controls` ("(corrected paths) OutputPanel validateConfig..." and the Skeptic-cited lines in "ProposalPanelSupport buildCreateRequest..."), and the requirement body now says the derivation is `{ outputId }` only "before any config or controls is merged in".
- skeptic-design-2 note 3 / task 1.4: "Reachability of a null outputId" below. The only UI path that changes a panel's `outputId` is the "Swap output" picker, which PATCHes a different Output id (`swapPanelOutput`). The backend would accept `config.outputId: ""` on PATCH (the empty id skips `rejectMissingOutput` via `outputIdFromConfigPatch`'s `s.nonEmpty` guard), but no client sends it. So a null `outputId` is unreachable from the UI and the binding-removed requirement is restated as the hook's contract; the other polling requirement says no panel has a numeric `refreshInterval` today.
- null vs undefined: no non-test code under `frontend/src` sets `refreshInterval` ("Where backend panel JSON is mapped to Panel"), so a backend-loaded panel's value is `undefined` (the property is absent), while `panel.ts`'s comment says `null`. The delta says "carries no numeric value" to be true either way; the caller coerces with `?? null`.
- skeptic-design-2 note 2: export evidence cites `DashboardSnapshotRepository.scala:85-103` ("Export code path & snapshotId derivation in repo").

## C. Direct (non-delta) edits (design D2) and why

Probe A in the log shows a `## MODIFIED Purpose` delta fails validation ("No delta sections found"), so OpenSpec deltas cannot address `## Purpose` or a non-requirement section such as write-path-audit's `## Write Path Reference`. These lines are therefore edited directly in `openspec/specs/<cap>/spec.md`. The PR body must say so. Diff:

```diff
diff --git a/openspec/specs/collection-config-editor/spec.md b/openspec/specs/collection-config-editor/spec.md
index 3b392e9ab..37722623a 100644
--- a/openspec/specs/collection-config-editor/spec.md
+++ b/openspec/specs/collection-config-editor/spec.md
@@ -1,7 +1,7 @@
 # collection-config-editor Specification
 
 ## Purpose
-Defines the detail-modal editor for collection panels: base-type extension point, DataType binding, shared field-mapping slots with bound-or-literal label/unit, layout control, and mobile touch-target sizing.
+Defines how the Output editor sheet edits a collection-kind Output: the item field-mapping slots, the format and conditional-format controls, the grid layout written on create, and which config keys an edit sends.
 ## Requirements
 ### Requirement: Detail modal presents a collection editor
 The panel detail modal SHALL present a collection-specific editor for `collection` panels composing:
diff --git a/openspec/specs/collection-panel-rendering/spec.md b/openspec/specs/collection-panel-rendering/spec.md
index 44716a95e..706ef6942 100644
--- a/openspec/specs/collection-panel-rendering/spec.md
+++ b/openspec/specs/collection-panel-rendering/spec.md
@@ -1,7 +1,7 @@
 # collection-panel-rendering Specification
 
 ## Purpose
-Defines how a collection panel renders one homogeneous item per row of its bound multi-row DataType, in grid or list layout, including empty/unbound states and overflow behavior.
+Defines how an `output` panel bound to a collection-kind Output renders one metric item per loaded row, in grid or list layout, including the empty state and overflow behavior.
 
 ## Requirements
 
diff --git a/openspec/specs/collection-panel-type/spec.md b/openspec/specs/collection-panel-type/spec.md
index 32d9de512..8f7d8ae97 100644
--- a/openspec/specs/collection-panel-type/spec.md
+++ b/openspec/specs/collection-panel-type/spec.md
@@ -1,7 +1,7 @@
 # collection-panel-type Specification
 
 ## Purpose
-Defines the `collection` panel kind: its config shape (base type, shared field mapping, layout, per-base-type item options), persistence contract, and the rule that adding future base types requires no schema changes.
+Defines the `collection` Output kind, rendered inside an `output` panel (there is no `collection` panel kind): the keys its `config` accepts (`fieldMapping`, `layout`, `format`, `conditionalFormats`) and how unknown keys are handled.
 
 ## Requirements
 
diff --git a/openspec/specs/metric-panel-trend-indicator/spec.md b/openspec/specs/metric-panel-trend-indicator/spec.md
index 8d7c48f51..98d4b2428 100644
--- a/openspec/specs/metric-panel-trend-indicator/spec.md
+++ b/openspec/specs/metric-panel-trend-indicator/spec.md
@@ -1,7 +1,7 @@
 # metric-panel-trend-indicator Specification
 
 ## Purpose
-TBD - created by archiving change metric-panel-sizing. Update Purpose after archive.
+Defines `MetricRenderer`'s legacy `trend` string indicator (`.panel-content__metric-trend`): its direction classes and container-query font sizes. No production caller supplies `trend`; the history comparison marker reuses the same classes (see `metric-history-delta-ui`).
 ## Requirements
 ### Requirement: Metric panel renders trend indicator when trend data is present
 When the bound `MappedPanelData` map contains a `trend` key, the metric panel SHALL render a
diff --git a/openspec/specs/panel-type-rendering/spec.md b/openspec/specs/panel-type-rendering/spec.md
index ca05e4e68..b03f8c30c 100644
--- a/openspec/specs/panel-type-rendering/spec.md
+++ b/openspec/specs/panel-type-rendering/spec.md
@@ -1,5 +1,5 @@
 ## Purpose
-Defines how each panel type renders its body content area inside the dashboard grid, including placeholder states when no data is bound and live states when data is present.
+Defines how each canonical panel kind (`output`, `text`, `markdown`, `image`, `divider`, `form`) renders its body content area inside the dashboard grid, including the type badge and creation type selector, and the loading, error, no-data and placeholder states. An `output` panel's body is chosen by the kind of the Output it is bound to.
 
 ## Requirements
 
diff --git a/openspec/specs/timeline-panel-rendering/spec.md b/openspec/specs/timeline-panel-rendering/spec.md
index 01499a2a5..21cab80b7 100644
--- a/openspec/specs/timeline-panel-rendering/spec.md
+++ b/openspec/specs/timeline-panel-rendering/spec.md
@@ -1,7 +1,7 @@
 # timeline-panel-rendering Specification
 
 ## Purpose
-Defines how a `timeline` panel renders its bound rows as a vertical, chronological event list (marker/connector/time/description per entry), the configurable `time` + `event` field mapping and `sort` direction, size-proportional scaling, and graceful degradation for empty / single-row / long-description data.
+Defines how an `output` panel bound to a timeline-kind Output renders its rows as a vertical, chronological event list (marker/connector/time/description per entry), the `time` + `event` field mapping and `sort` direction, height-tiered scaling, and graceful degradation for empty / single-row / long-description data.
 ## Requirements
 ### Requirement: Timeline renders bound rows as a vertical chronological event list
 
diff --git a/openspec/specs/timeline-panel-type/spec.md b/openspec/specs/timeline-panel-type/spec.md
index 8f318e5af..056eebfd1 100644
--- a/openspec/specs/timeline-panel-type/spec.md
+++ b/openspec/specs/timeline-panel-type/spec.md
@@ -1,7 +1,7 @@
 # timeline-panel-type Specification
 
 ## Purpose
-Defines the `timeline` panel kind: its config shape (`dataTypeId`, `fieldMapping`, `timelineOptions.sort`), persistence contract (existing binding columns plus a `timeline_options` JSONB column), tolerant defaults, PATCH absent-vs-null semantics, duplication/export parity, and inclusion in every panel-`type` contract surface (JSON Schema, MCP tools).
+Defines the `timeline` Output kind, rendered inside an `output` panel (there is no `timeline` panel kind): its `fieldMapping` slots (`time`, `event`), its `sort` config key, and its inclusion in every Output-kind contract surface (JSON Schema, MCP tools).
 
 ## Requirements
 
diff --git a/openspec/specs/write-path-audit/spec.md b/openspec/specs/write-path-audit/spec.md
index 677651753..44d6f1199 100644
--- a/openspec/specs/write-path-audit/spec.md
+++ b/openspec/specs/write-path-audit/spec.md
@@ -70,7 +70,7 @@ staged since the last one.
 | 6 | `POST /api/dashboards/import` | POST | Dashboard import from file | `DashboardSnapshot` | 1 per import |
 | 7 | `PATCH /api/panels/:id` | PATCH | Panel title rename commit | `{ title }` | 1 per rename |
 | 8 | `PATCH /api/panels/:id` | PATCH | Panel appearance save | `{ appearance: PanelAppearance }` | 1 per save |
-| 9 | `PATCH /api/panels/:id` | PATCH | Panel data binding save | `{ typeId, fieldMapping, refreshInterval }` | 1 per save |
+| 9 | `PATCH /api/panels/:id` | PATCH | Output panel "Swap output" (detail modal) | `{ config: { outputId } }` | 1 PATCH + 1 GET (refetch) |
 | 10 | `POST /api/panels` | POST | Add panel | `{ dashboardId, title, type? }` | 1 POST + 1 GET (refetch) |
 | 11 | `POST /api/panels/:id/duplicate` | POST | Panel duplicate | _(no body)_ | 1 POST + 1 GET (refetch) |
 
@@ -139,12 +139,13 @@ Fires on Enter or blur. Cancelled by Escape (`titleCancelledRef` in `PanelGrid.t
 }
 ```
 
-**9. Panel data binding** — `PATCH /api/panels/:id`
+**9. Panel output swap** — `PATCH /api/panels/:id`
 
-`typeId` and `fieldMapping` can be `null` (clears binding). `refreshInterval` can be `null`.
+Fires when the user picks a different Output in the detail modal's "Swap output" picker (`swapPanelOutput`); the panel
+keeps its position and size. It then refetches the dashboard's panels (`GET /api/dashboards/:id/panels`).
 
 ```json
-{ "typeId": "dt-abc123", "fieldMapping": { "value": "revenue", "label": "month" }, "refreshInterval": 300 }
+{ "config": { "outputId": "out-abc123" } }
 ```
 
 **10 & 11. Panel create / duplicate** — `POST /api/panels` and `POST /api/panels/:id/duplicate`
```

## D. Out of scope, observed (for Delivery triage; none edited here)
- `echarts-chart-panel` (deferred, C3/D4): `openspec/specs/echarts-chart-panel/spec.md:20` still says "`typeId` is absent". HEL-1572's open change `appearance-type-density-motion` carries a delta for that spec; re-check at Delivery. See block "echarts-chart-panel typeId mention".
- `frontend/src/features/panels/hooks/usePanelPolling.ts` still names its third parameter and its doc comment `typeId` (block "Polling hook source"); a code change, outside this docs-only change (C2).
- `CollectionRenderer`'s `metricOptions` prop has no non-test caller (only `CollectionRenderer.test.tsx` and `MetricRenderer.duration.test.tsx` pass it), and `PanelDetailModal.sections.css` / `PanelDetailModal.mobile.css` still carry `.panel-detail-modal__segmented*` rules referenced only by `PanelDetailModal.css.test.ts` (blocks "metricOptions passed by any non-test caller?" and "panel-detail-modal__segmented used anywhere in source?"). Dead code candidates.
- write-path-audit (rows other than 9 were not in scope): row 8 / payload detail 8 says the appearance `chart` field is "included only for panel type `chart`" (no such panel kind); the "Source Locations" row for `PanelDetailModal.tsx` says "Panel appearance and data binding saves"; the "Session Call-Volume Estimate" table still has a "Panel data binding saves" row; the scenario "Audit covers all panel-level write paths" still says "data binding updates". Not re-derived.
- `openspec/specs/panel-type-rendering/spec.md` "Unknown panel types degrade gracefully" says the fallback is "metric rendering": the code's exhaustiveness fallback is `<MetricRenderer data={data} />` (block "PanelContent MetricRenderer fallback"), which shows a "No data" metric. Roughly true; not re-derived.
- CLAUDE.md says `GET /api/dashboards/:id/panels` is public-only, yet `panelService.fetchPanels` calls it from the authenticated app (block "fetchPanels endpoint"); write-path-audit rows 10/11 and the new row 9 still say "GET (refetch)". Docs disagree; not in scope.

## E. Gates (docs/specs only; no code gates apply)
See the blocks "Pinning frontend tests...", "Simulated archive...", and the final validation/diff blocks at the end of the log.

## Detailed command log

**Other open worktree changes touching candidate specs (conflict check)**
```
$ for d in /home/matt/Development/helio/.claude/worktrees/*/ /home/matt/Development/helio/.claude/worktrees/*/*/; do for s in $d/openspec/changes/*/specs/*; do [ -d "$s" ] && echo "$s"; done; done 2>/dev/null | grep -v restate-remaining | grep -E "mcp-panel-composition|panel-type-rendering|panel-polling|dashboard-export-import|write-path-audit|collection|timeline|metric-panel-trend|echarts" ; echo "rc-done"
rc-done
```

**Other open worktree changes touching candidate specs (conflict check, all worktrees, depth 3)**
```
$ ls -d /home/matt/Development/helio/.claude/worktrees/*/*/* | wc -l; ls -d /home/matt/Development/helio/.claude/worktrees/*/*/*/openspec/changes/*/specs/* 2>/dev/null | grep -v restate-remaining | grep -E "/(mcp-panel-composition-tools|panel-type-rendering|panel-polling|dashboard-export-import|write-path-audit|collection-[a-z-]+|timeline-[a-z-]+|metric-panel-trend-indicator|echarts-chart-panel)$"; echo done
42
/home/matt/Development/helio/.claude/worktrees/feature/appearance-type-density-motion/HEL-1572/openspec/changes/appearance-type-density-motion/specs/echarts-chart-panel
done
```

**Main checkout open changes touching candidate specs**
```
$ ls /home/matt/Development/helio/openspec/changes/ | head; ls -d /home/matt/Development/helio/openspec/changes/*/specs/* 2>/dev/null | grep -E "/(mcp-panel-composition-tools|panel-type-rendering|panel-polling|dashboard-export-import|write-path-audit|collection-[a-z-]+|timeline-[a-z-]+|metric-panel-trend-indicator)$"; echo done
archive
done
```

**Canonical panel kinds (schema enum)**
```
$ grep -n -A12 "\"type\"" schemas/panels/create-panel-request.schema.json | head -30
6:  "type": "object",
7-  "required": ["dashboardId"],
8-  "properties": {
9-    "dashboardId": {
10:      "type": "string",
11-      "minLength": 1
12-    },
13-    "title": {
14:      "type": "string",
15-      "maxLength": 160
16-    },
17:    "type": {
18:      "type": "string",
19-      "enum": ["text", "markdown", "image", "divider", "output", "form"]
20-    },
21-    "config": {
22:      "type": "object"
23-    },
24-    "appearance": {
25-      "$ref": "panel-appearance.schema.json"
26-    }
27-  },
28-  "additionalProperties": false,
29-  "allOf": [
30-    {
31-      "if": {
32-        "properties": {
33:          "type": {
34-            "const": "output"
35-          }
```

**OutputPanelContent kind dispatch**
```
$ grep -n -E "collection|timeline|chart|metric|table" frontend/src/components/OutputPanelContent.tsx | head -40
grep: frontend/src/components/OutputPanelContent.tsx: No such file or directory
```

**OutputPanelContent kind dispatch**
```
$ grep -n -E "kind|collection|timeline|chart|metric|table" frontend/src/features/panels/ui/OutputPanelContent.tsx | sed -n 1,60p
7:import type { ChartClickSelection } from "../../../utils/chartClickSelection";
25:import { chartTruncationNote, chartTruncationNoteShort } from "./chartTruncationNote";
34:/** Dispatches on an output-kind panel's fetched Output `kind`/`config`
36: *  enough info to render). Non-output panel kinds (text/markdown/image/
85:  // renderer for `output.kind` — no NEW fetch, and therefore no fetch-timing
93:  // live, reproducible transient window where a Table-kind sibling panel's
106:  // drives this component's kind-dispatch/cross-filter render — the two can no longer disagree,
132:      output.kind,
161:  const kind = output.kind;
164:  if (kind === "chart") {
186:        truncationNote={chartTruncationNote(truncationArgs)}
187:        truncationNoteShort={chartTruncationNoteShort(truncationArgs)}
190:  } else if (kind === "table") {
218:  } else if (kind === "metric") {
239:  } else if (kind === "markdown") {
242:  } else if (kind === "collection") {
254:  } else if (kind === "timeline") {
267:        <span className="panel-content__state-label">Unsupported output kind</span>
280:          wording the table quick-filter already uses — the shape fits
283:          output kind) rather than inside `TableRenderer` alone, so a table
```

**Polling hook source**
```
$ cat -n frontend/src/features/panels/hooks/usePanelPolling.ts
     1	import { useEffect, useRef } from "react";
     2	
     3	/**
     4	 * Polls `refresh` every `refreshInterval` seconds as long as `typeId` is set.
     5	 *
     6	 * Behaviour:
     7	 * - No-ops when `refreshInterval` is null/undefined or `typeId` is null/undefined.
     8	 * - Pauses (clears the interval) while the browser tab is hidden; resumes
     9	 *   without stacking a duplicate interval when the tab becomes visible again.
    10	 * - Clears the interval on unmount or whenever `refreshInterval`/`typeId` changes.
    11	 */
    12	export function usePanelPolling(
    13	  refresh: () => void,
    14	  refreshInterval: number | null | undefined,
    15	  typeId: string | null | undefined,
    16	): void {
    17	  // Keep a stable ref so the interval callback always calls the latest `refresh`
    18	  // without needing to recreate the interval when the function identity changes.
    19	  const refreshRef = useRef(refresh);
    20	  useEffect(() => {
    21	    refreshRef.current = refresh;
    22	  }, [refresh]);
    23	
    24	  useEffect(() => {
    25	    if (!refreshInterval || !typeId) return;
    26	
    27	    const ms = refreshInterval * 1000;
    28	    let intervalId: ReturnType<typeof setInterval> | null = null;
    29	
    30	    function startInterval() {
    31	      if (intervalId !== null) return; // already running — don't stack
    32	      intervalId = setInterval(() => {
    33	        refreshRef.current();
    34	      }, ms);
    35	    }
    36	
    37	    function stopInterval() {
    38	      if (intervalId !== null) {
    39	        clearInterval(intervalId);
    40	        intervalId = null;
    41	      }
    42	    }
    43	
    44	    function handleVisibilityChange() {
    45	      if (document.visibilityState === "hidden") {
    46	        stopInterval();
    47	      } else {
    48	        startInterval();
    49	      }
    50	    }
    51	
    52	    // Only start immediately if the tab is already visible.
    53	    if (document.visibilityState !== "hidden") {
    54	      startInterval();
    55	    }
    56	
    57	    document.addEventListener("visibilitychange", handleVisibilityChange);
    58	
    59	    return () => {
    60	      stopInterval();
```

**Polling caller**
```
$ grep -n -B2 -A2 usePanelPolling frontend/src/features/panels/ui/PanelCardBody.tsx
15-import { controlResultCountText } from "./controlResultCountText";
16-import type { PanelDataResult } from "../hooks/usePanelData";
17:import { usePanelPolling } from "../hooks/usePanelPolling";
18-import { usePanelRunRefresh } from "../hooks/usePanelRunRefresh";
19-import type { OutputControlSpec, Panel } from "../types/panel";
--
153-  // `PanelCard`, is what actually keeps a Table-kind panel's `paginationRows`
154-  // branch and its `rawRows` fallback in permanent agreement).
155:  usePanelPolling(refresh, panel.refreshInterval ?? null, outputId);
156-
157-  // HEL-1094 (design.md D4/D5) — fans this panel into the shared per-pipeline run-status SSE
```

**refreshInterval in non-test frontend/src and backend**
```
$ grep -rn refreshInterval frontend/src backend/src/main helio-mcp/src --include=* | grep -v -E '\.test\.' | head -30
frontend/src/features/panels/types/panel.ts:275:// `config`. `refreshInterval` is a frontend-only field that the backend
frontend/src/features/panels/types/panel.ts:288:  refreshInterval?: number | null;
frontend/src/features/panels/ui/PanelCardBody.tsx:155:  usePanelPolling(refresh, panel.refreshInterval ?? null, outputId);
frontend/src/features/panels/hooks/usePanelPolling.ts:4: * Polls `refresh` every `refreshInterval` seconds as long as `typeId` is set.
frontend/src/features/panels/hooks/usePanelPolling.ts:7: * - No-ops when `refreshInterval` is null/undefined or `typeId` is null/undefined.
frontend/src/features/panels/hooks/usePanelPolling.ts:10: * - Clears the interval on unmount or whenever `refreshInterval`/`typeId` changes.
frontend/src/features/panels/hooks/usePanelPolling.ts:14:  refreshInterval: number | null | undefined,
frontend/src/features/panels/hooks/usePanelPolling.ts:25:    if (!refreshInterval || !typeId) return;
frontend/src/features/panels/hooks/usePanelPolling.ts:27:    const ms = refreshInterval * 1000;
frontend/src/features/panels/hooks/usePanelPolling.ts:63:  }, [refreshInterval, typeId]);
frontend/src/test/renderWithStore.tsx:219:              refreshInterval: null,
frontend/src/test/panelFixtures.ts:49:  refreshInterval?: number | null;
frontend/src/test/panelFixtures.ts:64:    refreshInterval: overrides.refreshInterval ?? null,
```

**panel.ts comment**
```
$ sed -n 268,292p frontend/src/features/panels/types/panel.ts
  | MarkdownPanelConfig
  | ImagePanelConfig
  | DividerPanelConfig
  | FormPanelConfig;

//
// Common fields live on `PanelBase`; each variant adds `kind` + typed
// `config`. `refreshInterval` is a frontend-only field that the backend
// silently ignores on PATCH (no schema or column exists for it); it is
// preserved here so the `usePanelPolling` hook keeps working until CS3
// removes it. It is `null` for any panel hydrated from the backend.

interface PanelBase {
  id: string;
  dashboardId: string;
  title: string;
  meta: ResourceMeta;
  appearance: PanelAppearance;
  ownerId?: string;
  /** Frontend-only polling interval; not persisted by the backend. */
  refreshInterval?: number | null;
  /** Decision-15 server-owned default grid placement (HEL-909) — present
   *  only on the `POST /api/panels` response for a newly placed `output`
   *  panel; absent everywhere else (layout otherwise lives on the
   *  dashboard's own `layout` field, not re-echoed per panel). */
```

**outputId derivation in PanelCardBody**
```
$ grep -n 'outputId' frontend/src/features/panels/ui/PanelCardBody.tsx | head -20
42:  outputId: string | null;
65:  outputId,
82:  useFirstDashboardRendered(outputId != null && !isLoading && !error && (rawRows?.length ?? 0) > 0);
101:  const { output, isLoading: isOutputMetaLoading } = useOutputMeta(outputId);
123:      outputId ? getDistinctValues(outputId, column).then((r) => r.values) : Promise.resolve([]),
124:    [outputId],
136:    usePanelSortFilter(panel.id, outputId, output, controlFilterOps, crossFilterEq, mountOwnership);
155:  usePanelPolling(refresh, panel.refreshInterval ?? null, outputId);
172:  usePanelRunRefresh(outputId, handleFanoutRefresh);
182:    if (paginationEntry && !paginationEntry.isLoadingMore && outputId) {
186:          outputId,
204:    outputId,
297:      {outputId && (
```

**Panel type: output config outputId type**
```
$ grep -n 'outputId' frontend/src/features/panels/types/panel.ts | head; grep -rn 'outputId' frontend/src --include=*.ts --include=*.tsx | grep -v -E '\.test\.|test/' | grep -E 'outputId: *(null|undefined)|outputId\?: ' | head
8:// `outputId` — everything the old bound configs carried (`fieldMapping`,
186:  outputId: string;
218:// Output — it binds via `dataSourceId`, not `outputId`. `control` is a
344:  outputId: "",
456:  outputId: string;
frontend/src/features/panels/history/outputHistoryService.ts:64:  outputId?: string;
frontend/src/features/panels/state/panelPayloads.ts:42:  outputId?: string;
frontend/src/features/panels/state/panelThunks.ts:98:    outputId?: string;
frontend/src/features/panels/provenance/provenanceService.ts:29:  outputId?: string;
frontend/src/features/panels/services/panelService.ts:44:  outputId?: string,
frontend/src/features/pipelines/services/outputService.ts:252:  outputId?: string,
frontend/src/features/dashboards/types/proposal.ts:27:  outputId?: string;
```

**Where backend panel JSON is mapped to Panel (no refreshInterval set)**
```
$ grep -rn 'refreshInterval' frontend/src/services frontend/src/features/panels --include=*.ts --include=*.tsx | grep -v -E '\.test\.' 
frontend/src/features/panels/types/panel.ts:275:// `config`. `refreshInterval` is a frontend-only field that the backend
frontend/src/features/panels/types/panel.ts:288:  refreshInterval?: number | null;
frontend/src/features/panels/ui/PanelCardBody.tsx:155:  usePanelPolling(refresh, panel.refreshInterval ?? null, outputId);
frontend/src/features/panels/hooks/usePanelPolling.ts:4: * Polls `refresh` every `refreshInterval` seconds as long as `typeId` is set.
frontend/src/features/panels/hooks/usePanelPolling.ts:7: * - No-ops when `refreshInterval` is null/undefined or `typeId` is null/undefined.
frontend/src/features/panels/hooks/usePanelPolling.ts:10: * - Clears the interval on unmount or whenever `refreshInterval`/`typeId` changes.
frontend/src/features/panels/hooks/usePanelPolling.ts:14:  refreshInterval: number | null | undefined,
frontend/src/features/panels/hooks/usePanelPolling.ts:25:    if (!refreshInterval || !typeId) return;
frontend/src/features/panels/hooks/usePanelPolling.ts:27:    const ms = refreshInterval * 1000;
frontend/src/features/panels/hooks/usePanelPolling.ts:63:  }, [refreshInterval, typeId]);
```

**Backend has no refreshInterval/refresh_interval**
```
$ grep -rniE 'refreshInterval|refresh_interval' backend/src schemas helio-mcp/src | head

```

**How PanelCard computes outputId passed to PanelCardBody**
```
$ grep -rn 'outputId' frontend/src/features/panels/ui/PanelCard.tsx | head -20; grep -rn 'outputId=' frontend/src/features/panels/ui/*.tsx | grep -v test | head
101:  const outputId = getOutputId(panel);
111:  useOutputRetention(outputId);
135:  } = usePanelCardInspect(panel, outputId, panelData);
139:  const isDataInvalid = useDataInvalid(outputId);
200:        outputId={outputId}
227:        outputId={outputId}
321:        {outputId && (
325:            outputId={outputId}
frontend/src/features/panels/ui/OutputPanelContent.tsx:168:        outputId={outputId}
frontend/src/features/panels/ui/OutputPanelContent.tsx:194:        outputId={outputId}
frontend/src/features/panels/ui/OutputPanelContent.tsx:222:        outputId={outputId}
frontend/src/features/panels/ui/PanelCard.tsx:200:        outputId={outputId}
frontend/src/features/panels/ui/PanelCard.tsx:227:        outputId={outputId}
frontend/src/features/panels/ui/PanelCard.tsx:325:            outputId={outputId}
frontend/src/features/panels/ui/PanelContent.tsx:223:        outputId={panel.config.outputId}
frontend/src/features/panels/ui/PanelFullscreenOverlay.tsx:194:            outputId={outputId}
```

**Panel config outputId is a non-null string for output kind (panel.ts 180-190, 450-458)**
```
$ sed -n 180,190p frontend/src/features/panels/types/panel.ts; sed -n 452,458p frontend/src/features/panels/types/panel.ts
   *  (`OutputControlsEditor.tsx`) recomputes orphan status live instead of trusting this
   *  potentially-stale snapshot, since it must react to an in-progress rebind. */
  orphaned?: boolean;
}

export interface OutputPanelConfig {
  outputId: string;
  /** Author-configured date-range/dropdown/numeric-range/text controls that parameterize the
   *  read (HEL-1189, leaf 2 of HEL-915). Absent/empty on a pre-existing panel. */
  controls: OutputControlSpec[];
}
 *  `fetchPanelPage.pending` so ops-less hosts (`usePanelData`'s mount dispatch and `refresh()`)
 *  can replay it instead of silently dispatching an unfiltered read. `filter` excludes the
 *  cross-filter term (that is `crossFilterEq`). */
export interface PanelLastQuery {
  outputId: string;
  sort?: OutputRowsSort;
  filter?: OutputRowsFilter;
```

**getOutputId definition (null for non-output kinds; empty-string for default config)**
```
$ grep -rn -A8 'export function getOutputId' frontend/src | head -20
frontend/src/features/panels/state/panelNarrowing.ts:33:export function getOutputId(panel: Panel): string | null {
frontend/src/features/panels/state/panelNarrowing.ts-34-  if (!isOutputPanel(panel)) return null;
frontend/src/features/panels/state/panelNarrowing.ts-35-  const id = panel.config.outputId;
frontend/src/features/panels/state/panelNarrowing.ts-36-  return id.length > 0 ? id : null;
frontend/src/features/panels/state/panelNarrowing.ts-37-}
frontend/src/features/panels/state/panelNarrowing.ts-38-
frontend/src/features/panels/state/panelNarrowing.ts-39-/** Returns text/markdown content, or `null` for other subtypes. */
frontend/src/features/panels/state/panelNarrowing.ts-40-export function getContent(panel: Panel): string | null {
frontend/src/features/panels/state/panelNarrowing.ts-41-  if (isTextPanel(panel) || isMarkdownPanel(panel)) {
```

**Can a panel's outputId change to empty on the client? (rebind/ patch paths set outputId)**
```
$ grep -rn -E 'outputId: *(""|null)' frontend/src --include=*.ts --include=*.tsx | grep -v -E '\.test\.|/test/' | head
frontend/src/features/panels/types/panel.ts:344:  outputId: "",
```

**polling hook tests pin binding removal**
```
$ grep -n -E 'it\(|test\(|describe\(' frontend/src/features/panels/hooks/usePanelPolling.test.ts
20:describe("usePanelPolling", () => {
31:  it("does not set an interval when refreshInterval is null", () => {
42:  it("does not set an interval when typeId is null", () => {
53:  it("does not set an interval when both are null", () => {
64:  it("calls refresh at the correct cadence", () => {
87:  it("clears the interval on unmount", () => {
100:  it("clears the interval when typeId changes to null", () => {
121:  it("pauses polling when the tab becomes hidden", () => {
141:  it("resumes polling when the tab becomes visible again", () => {
171:  it("does not stack duplicate intervals when tab hides and shows repeatedly", () => {
200:  it("does not start the interval when the tab is hidden on mount", () => {
213:  it("always calls the latest refresh callback without recreating the interval", () => {
```

**Context of outputId:"" at panel.ts:344**
```
$ sed -n 336,348p frontend/src/features/panels/types/panel.ts; grep -rn 'DEFAULT_OUTPUT_PANEL_CONFIG\|EMPTY_OUTPUT' frontend/src --include=*.ts --include=*.tsx | grep -v test | head -5
// existing consumers need not rename their type-only imports.
export type PanelType = PanelKind;

//
// Used by `panelPayloads.ts` to build a typed `config` for create requests
// when the caller supplies no subtype-specific configuration.

export const emptyOutputConfig = (): OutputPanelConfig => ({
  outputId: "",
  controls: [],
});

export const emptyTextConfig = (): TextPanelConfig => ({
frontend/src/features/pipelines/ui/LaneColumn.tsx:22:import { EMPTY_OUTPUTS } from "../state/outputsSlice";
frontend/src/features/pipelines/ui/LaneColumn.tsx:238:                outputs={outputsByStepId[step.id] ?? EMPTY_OUTPUTS}
frontend/src/features/pipelines/ui/LaneColumn.tsx:295:              outputs={outputsByStepId[step.id] ?? EMPTY_OUTPUTS}
frontend/src/features/pipelines/ui/PipelineRiverView.tsx:34:import { EMPTY_OUTPUTS } from "../state/outputsSlice";
frontend/src/features/pipelines/ui/PipelineRiverView.tsx:395:                        outputs={outputsByStepId[step.id] ?? EMPTY_OUTPUTS}
```

**Backend: output panel outputId required non-empty / existing on create+patch**
```
$ grep -n -E 'outputId' backend/src/main/scala/com/helio/domain/model/OutputPanel.scala | head -30; sed -n 30,48p backend/src/main/scala/com/helio/services/PanelUpdateValidation.scala
grep: backend/src/main/scala/com/helio/domain/model/OutputPanel.scala: No such file or directory
sed: can't read backend/src/main/scala/com/helio/services/PanelUpdateValidation.scala: No such file or directory
```

**Backend rejects an empty/absent outputId on output panels (validateConfig used at create and patch)**
```
$ grep -rn 'validateConfig' backend/src/main/scala/com/helio --include=*.scala | head -12; grep -n -B2 -A12 'def patchedConfigOf' backend/src/main/scala/com/helio/services/panels/PanelServiceHelpers.scala
backend/src/main/scala/com/helio/domain/history/PayloadOptIn.scala:12:  def validateConfig(config: JsObject): Either[String, Unit] =
backend/src/main/scala/com/helio/domain/history/OutputCompare.scala:52:  def validateConfig(config: JsObject): Either[String, Unit] = fromConfig(config).map(_ => ())
backend/src/main/scala/com/helio/domain/panels/DividerPanel.scala:98:  def validateConfig: Either[String, Unit] =
backend/src/main/scala/com/helio/domain/panels/TextPanel.scala:69:  def validateConfig: Either[String, Unit] = Right(())
backend/src/main/scala/com/helio/domain/panels/OutputPanel.scala:36:   *  `services/pipelines` for a plain kind-membership check. `OutputPanel.validateConfig` is the
backend/src/main/scala/com/helio/domain/panels/OutputPanel.scala:223:  def validateConfig: Either[String, Unit] =
backend/src/main/scala/com/helio/domain/panels/MarkdownPanel.scala:69:  def validateConfig: Either[String, Unit] = Right(())
backend/src/main/scala/com/helio/domain/panels/FormPanel.scala:321:  def validateConfig: Either[String, Unit] = {
backend/src/main/scala/com/helio/domain/panels/ImagePanel.scala:106:  def validateConfig: Either[String, Unit] = Right(())
backend/src/main/scala/com/helio/domain/connectors/SqlConnectorDriver.scala:78:  def validateConfigShape(config: SqlSourceConfig): Either[String, Unit] =
backend/src/main/scala/com/helio/domain/connectors/SqlConnectorDriver.scala:136:   *  config [[validateConfigShape]] refuses, [[SqlEgressRefusedException]] if `checkConfigEgress`
backend/src/main/scala/com/helio/domain/connectors/SqlConnectorDriver.scala:154:    validateConfigShape(config).left.foreach(msg => throw SqlConfigRefusedException(msg))
```

**Frontend: emptyConfigForKind used only to build create payload (panelPayloads.ts)**
```
$ sed -n 55,80p frontend/src/features/panels/state/panelPayloads.ts
}

function seedCreateConfig(
  type: PanelKind,
  outputId: string | undefined,
  configOverride: PanelConfig | undefined,
): PanelConfig {
  if (type === "form" && configOverride !== undefined) {
    return configOverride;
  }
  const base = emptyConfigForKind(type);
  if (type === "output") {
    // `controls` is never seeded at create time — an author adds them later via
    // `OutputControlsEditor`, so a freshly-created output panel always starts with none.
    return { outputId: outputId ?? "", controls: [] };
  }
  return base;
}

//
// PATCH `config` objects are partial — only the fields the user is changing
// appear, so the per-subtype `Patch.decode` on the backend preserves
// absent-vs-null semantics. `null` on a field means "clear to default".

export interface UpdatePanelBody {
  title?: string;
```

**Callers of Panel validateConfig (create/patch)**
```
$ grep -rn '\.validateConfig\|validateConfig *$\|validateConfig)' backend/src/main/scala/com/helio/services backend/src/main/scala/com/helio/api | head
backend/src/main/scala/com/helio/services/panels/PanelCreateBuilder.scala:63:            panel.validateConfig match {
backend/src/main/scala/com/helio/services/pipelines/PipelineProposalAnalyze.scala:271:            SqlConnectorDriver.checkQuery(domainConfig.query).flatMap(_ => SqlConnectorDriver.validateConfigShape(domainConfig)) match {
backend/src/main/scala/com/helio/services/pipelines/PipelineCreatePreflight.scala:207:      .flatMap(_ => OutputCompare.validateConfig(config))
backend/src/main/scala/com/helio/services/pipelines/PipelineCreatePreflight.scala:208:      .flatMap(_ => PayloadOptIn.validateConfig(config))
backend/src/main/scala/com/helio/services/pipelines/PipelineCreatePreflight.scala:209:      .flatMap(_ => ConditionalFormats.validateConfig(kind, config))
backend/src/main/scala/com/helio/services/pipelines/OutputService.scala:135:        OutputService.validateConfig(kind, config, JsObject.empty) match {
backend/src/main/scala/com/helio/services/pipelines/OutputService.scala:209:            req.config.map(patch => OutputService.validateConfig(output.kind, patch, existingConfig, policy)).getOrElse(Right(())) match {
backend/src/main/scala/com/helio/services/pipelines/OutputService.scala:323:  /** Forwarder to [[OutputConfigValidation.validateConfig]]. */
backend/src/main/scala/com/helio/services/pipelines/OutputService.scala:330:    OutputConfigValidation.validateConfig(kind, written, stored, policy)
backend/src/main/scala/com/helio/services/pipelines/PipelineProposalService.scala:218:              SqlConnectorDriver.checkQuery(cfg.query).flatMap(_ => SqlConnectorDriver.validateConfigShape(SqlSourceConfigPayload.toDomain(cfg))).left.map(ServiceError.BadRequest(_))
```

**Frontend can an existing output panel's outputId be set to empty? panel update thunks / OutputPicker**
```
$ grep -rn -E 'outputId' frontend/src/features/panels/ui/*.tsx | grep -v test | grep -E 'updatePanel|config: *\{ *outputId|rebind|onChange' | head

```

**rejectMissingOutput + outputIdFromConfigPatch**
```
$ grep -n -A14 'def rejectMissingOutput' backend/src/main/scala/com/helio/services/panels/PanelUpdateValidation.scala; grep -rn -A6 'def outputIdFromConfigPatch' backend/src/main/scala/com/helio/services/panels/
backend/src/main/scala/com/helio/services/panels/PanelServiceHelpers.scala:182:  private[services] def outputIdFromConfigPatch(json: JsValue): Option[OutputId] =
backend/src/main/scala/com/helio/services/panels/PanelServiceHelpers.scala-183-    json match {
backend/src/main/scala/com/helio/services/panels/PanelServiceHelpers.scala-184-      case JsObject(fields) =>
backend/src/main/scala/com/helio/services/panels/PanelServiceHelpers.scala-185-        fields.get("outputId").collect { case JsString(s) if s.nonEmpty => OutputId(s) }
backend/src/main/scala/com/helio/services/panels/PanelServiceHelpers.scala-186-      case _ => None
backend/src/main/scala/com/helio/services/panels/PanelServiceHelpers.scala-187-    }
backend/src/main/scala/com/helio/services/panels/PanelServiceHelpers.scala-188-
```

**Frontend sends outputId in a panel PATCH anywhere (non-test)?**
```
$ grep -rn 'outputId' frontend/src --include=*.ts --include=*.tsx | grep -v -E '\.test\.|/test/' | grep -i -E 'updatePanel|patch' | head
frontend/src/features/panels/ui/OutputPicker.tsx:130:        // Swap mode PATCHes the panel's own outputId in place (preserving
frontend/src/features/panels/ui/OutputPicker.tsx:134:        await dispatch(swapPanelOutput({ panelId: swapPanelId, outputId, dashboardId })).unwrap();
frontend/src/features/panels/state/panelThunks.ts:134:/** "Swap output" (HEL-909 CR4) — PATCHes an existing panel's own `outputId`
frontend/src/features/panels/state/panelThunks.ts:146:  async ({ panelId, outputId, dashboardId }, { dispatch, rejectWithValue }) => {
frontend/src/features/panels/state/panelThunks.ts:148:      const updated = await patchPanelOutputIdRequest(panelId, outputId);
frontend/src/features/panels/hooks/usePanelData.ts:317:  }, [currentFetchKey, outputId, panel.id, dispatch, refreshToken, paginationEntry]);
frontend/src/features/panels/hooks/usePanelSortFilter.ts:167:    [dispatch, panelId, outputId, pushToast],
frontend/src/features/panels/services/panelService.ts:57:/** PATCH an existing panel's `outputId` in place, preserving its position/
frontend/src/features/panels/services/panelService.ts:59:export async function patchPanelOutputId(panelId: string, outputId: string): Promise<Panel> {
frontend/src/features/panels/services/panelService.ts:147:/** HEL-1189 — PATCH an `output` panel's `controls` list only (add/rebind/remove). `outputId` is
```

**ProposalPanelSupport buildCreateRequest/buildDataConfig/buildNonDataConfig/mergeConfig**
```
$ sed -n 240,345p backend/src/main/scala/com/helio/services/proposals/ProposalPanelSupport.scala
   *  inert (silently ignored by `TextPanelConfig.decodeCreate`/
   *  `MarkdownPanelConfig.decodeCreate`), never a real binding to validate. */
  private def bindingCandidate(panel: ProposalPanel): Option[String] =
    panel.outputId

  /** Build the create-side typed `config` JSON from the proposal panel's
   *  fields and merge the generic `config` passthrough over it (HEL-316) —
   *  see `DashboardProposalService`'s original scaladoc (pre-extraction) for
   *  the full field-by-field rationale, preserved verbatim below. */
  def buildCreateRequest(dashboardId: DashboardId, panel: ProposalPanel): CreatePanelRequest = {
    val derived: Option[JsObject] = panel.outputId match {
      case Some(id) => Some(buildDataConfig(id, panel))
      case None     => buildNonDataConfig(panel).map(_.asJsObject)
    }
    val bindingKey = if (panel.`type` == "output") "outputId" else "outputId"
    val withControls = panel.controls.filter(_.nonEmpty).fold(panel.config) { _ =>
      Some(JsObject(panel.config.fold(Map.empty[String, JsValue])(_.fields) + ("controls" -> JsArray(controlSpecsOf(panel).map(OutputControlSpec.format.write)))))
    }
    val configOpt: Option[JsValue] =
      withSourceBinding(mergeConfig(derived, withControls, panel.outputId, bindingKey), panel.dataSourceId)
    CreatePanelRequest(
      dashboardId = Some(dashboardId.value),
      title       = Some(panel.title),
      `type`      = Some(panel.`type`),
      config      = configOpt
    )
  }

  /** HEL-1148: re-applies the flat `dataSourceId` after the config merge, so it stays authoritative
   *  over any `config.dataSourceId` (same rule as `outputId` in `mergeConfig`). */
  private def withSourceBinding(config: Option[JsObject], dataSourceId: Option[String]): Option[JsObject] =
    dataSourceId.fold(config)(id => Some(JsObject(config.fold(Map.empty[String, JsValue])(_.fields) + ("dataSourceId" -> JsString(id)))))

  /** Merge the passthrough `config` over the derived flat-field config: on
   *  key conflict the explicit `config` wins — EXCEPT the panel's flat
   *  `outputId` (an Output id for an `"output"`-kind panel — HEL-904 task
   *  3.8/3.9) is re-applied, under `bindingKey`, after the merge so it
   *  remains authoritative no matter what `config` supplies. */
  private def mergeConfig(
      derived: Option[JsObject],
      passthrough: Option[JsObject],
      outputId: Option[String],
      bindingKey: String
  ): Option[JsObject] = {
    val merged = (derived, passthrough) match {
      case (Some(d), Some(c)) => Some(JsObject(d.fields ++ c.fields))
      case (Some(d), None)    => Some(d)
      case (None, Some(c))    => Some(c)
      case (None, None)       => None
    }
    outputId match {
      case Some(id) => merged.map(m => JsObject(m.fields + (bindingKey -> JsString(id))))
      case None     => merged
    }
  }

  // HEL-904 task 3.10: the Metric/Timeline literal-folding branches
  // (label/unit/aggregation/timelineOptions) were removed along with the
  // bound panel kinds they targeted. `outputId` remains meaningful ONLY
  // for `"output"`-kind panels (it becomes `outputId`, per task 3.8/3.9
  // below). `fieldMapping` is NOT meaningful on any current panel kind --
  // corrected cycle-9 (round-6 skeptic Finding, deletion-sweep CR1):
  // `buildDataConfig` below emits only `{"outputId": ...}` for an `output`
  // panel, never `fieldMapping`; TextPanelConfig and MarkdownPanelConfig
  // carry no data binding of any kind, so `outputId`/`fieldMapping` on a
  // text/markdown proposal panel is inert, never a real binding.
  //
  // HEL-904 task 3.8/3.9 (renamed HEL-910 task 3.2, dataTypeId -> outputId):
  // an `"output"`-kind proposal panel's flat `outputId` field carries a real
  // Output id (populated by
  // `PipelineProposalService.apply`'s Output creation, or by
  // `CombinedProposalService.resolveOutputRefs`'s `"$pipelineOutput"`
  // sentinel substitution). `OutputPanelConfig.decodeCreate` requires
  // `outputId`, not `outputId`/`fieldMapping`, so an output-kind panel's
  // config must carry that key instead.
  private def buildDataConfig(outputId: String, panel: ProposalPanel): JsObject =
    if (panel.`type` == "output")
      JsObject(Map("outputId" -> JsString(outputId)))
    else
      JsObject(Map(
        "outputId"   -> JsString(outputId),
        "fieldMapping" -> panel.fieldMapping.getOrElse(JsObject.empty)
      ))

  private def buildNonDataConfig(panel: ProposalPanel): Option[JsValue] =
    panel.`type` match {
      case "text" | "markdown" =>
        panel.content.map(c => JsObject("content" -> JsString(c)))
      case "image" =>
        panel.url.map(u => JsObject("imageUrl" -> JsString(u), "imageFit" -> JsString("contain")))
      case "divider" =>
        panel.orientation.map(o => JsObject("orientation" -> JsString(o)))
      case _ => None
    }
}
```

**ProposalPanel case class fields**
```
$ grep -n -B2 -A32 'case class ProposalPanel' backend/src/main/scala/com/helio/api/protocols/proposals/DashboardProposalProtocol.scala | head -70
11-// schemas/dashboards/dashboard-proposal.schema.json.
12-
13:final case class ProposalPanelLayout(x: Int, y: Int, w: Int, h: Int)
14-
15-/** HEL-1193: an output panel's control as a proposal declares it. Same fields as
16- *  `OutputControlSpec` except `id` is optional (a proposal carries no ids; `ProposalPanelSupport`
17- *  mints one when the panel is built) and `label` defaults to the column name. Eligibility is NOT
18- *  decided here — `ProposalPanelSupport` hands the built specs to `OutputControlsValidator`. */
19-final case class ProposalControl(
20-    id: Option[String],
21-    kind: String,
22-    column: String,
23-    label: Option[String],
24-    defaultValue: Option[JsValue]
25-)
26-
27:final case class ProposalPanel(
28-    title: String,
29-    `type`: String,
30-    outputId: Option[String],
31-    fieldMapping: Option[JsObject],
32-    aggregation: Option[JsObject],
33-    content: Option[String],
34-    url: Option[String],
35-    orientation: Option[String],
36-    chartType: Option[String],
37-    xAxisLabel: Option[String],
38-    yAxisLabel: Option[String],
39-    seriesColors: Option[Vector[String]],
40-    label: Option[String],
41-    unit: Option[String],
42-    // HEL-321: legacy flat `sort` field -- decoded and round-tripped, never applied (the
43-    // timeline panel kind was deleted by HEL-903/904); retained on the wire for schema stability.
44-    sort: Option[String],
45-    layout: Option[ProposalPanelLayout],
46-    // HEL-316: generic passthrough merged (over the flat-field-derived config)
47-    // by `ProposalPanelSupport.buildCreateRequest`, decoded by `PanelConfigCodec` like
48-    // `POST /api/panels`'s `config`. Makes every v1.5 panel-config
49-    // surface (collection baseType/layout, chart chartOptions, table
50-    // density/columnOrder) expressible via a proposal without a new flat
51-    // field per surface. See openspec/changes/mcp-proposal-panel-parity.
52-    config: Option[JsObject],
53-    // HEL-1193: first-class output-panel controls; merged into the built panel's
54-    // `config.controls` by `ProposalPanelSupport.buildCreateRequest`.
55-    controls: Option[Vector[ProposalControl]] = None,
56-    // HEL-1148: a source-bound panel kind's (today: `form`) dataset-source binding, the source twin
57-    // of `outputId`. Authoritative over `config.dataSourceId` (re-applied after the config merge by
58-    // `ProposalPanelSupport.buildCreateRequest`); required on a `form`, rejected on any other kind.
59-    dataSourceId: Option[String] = None
```

**helio-mcp proposal.ts: decoded but never applied**
```
$ sed -n 40,80p helio-mcp/src/tools/proposal.ts
// that check:schemas enforces. No `metric`/`chart`/`table`/`collection`/`timeline` either — those panel
// kinds were deleted outright by HEL-904. `form` (HEL-1083) is here because this wire can express its
// required binding, the flat `dataSourceId` (HEL-1148).
// Exported so `replace_dashboard_contents` (write.ts, HEL-363) can reuse the
// exact same agent-facing panel-type set instead of redefining it.
export const PANEL_TYPES = ["text", "markdown", "image", "output", "form"] as const;

const layoutSchema = z.object({
  x: z.number().int().nonnegative(),
  y: z.number().int().nonnegative(),
  w: z.number().int().positive(),
  h: z.number().int().positive(),
});

// Exported so `replace_dashboard_contents` (write.ts, HEL-363) can validate
// its `panels` array with the exact same shape `propose_dashboard`/
// `apply_proposal` use — the backend's `ProposalPanel` wire shape is shared
// verbatim across all three (design.md D2). `aggregation`/
// `chartType`/`xAxisLabel`/`yAxisLabel`/`seriesColors`/`label`/`unit`/`sort`
// are kept on the wire shape for schema stability (dashboard-proposal.schema.json's
// own field descriptions: "legacy field, decoded but never applied") but are
// deliberately NOT part of this tool's description below, since none of
// them do anything anymore.
// HEL-1440: `fieldMapping`/`aggregation`/`label`/`unit` are marked deprecated and ignored (zod 3 has no emitted
// `deprecated` flag, so the description carries it): the settings belong on the Output's `config`.
export const DEPRECATED_PANEL_FIELD_DESCRIPTION =
  "Deprecated and ignored: this panel-level field has no effect on the applied panel; set it on the Output's " +
  "`config` instead. Still accepted so existing callers keep working.";

export const panelSchema = z.object({
  title: z.string().min(1),
  type: z.enum(PANEL_TYPES),
  outputId: z.string().optional(),
  // HEL-1148: a `form` panel's dataset-source binding (the source twin of `outputId`).
  dataSourceId: z.string().optional(),
  fieldMapping: z
    .record(z.string(), z.string())
    .optional()
    .describe(DEPRECATED_PANEL_FIELD_DESCRIPTION),
  aggregation: z
    .record(z.string(), z.unknown())
```

**Proposal schema panel type enum + legacy field descriptions**
```
$ grep -n -E 'enum|decoded but never applied|orientation|"url"|"content"' schemas/dashboards/dashboard-proposal.schema.json | head -30
34:          "enum": ["text", "markdown", "image", "output", "form"],
48:          "description": "Deprecated and ignored: this panel-level field has no effect on the applied panel; set it on the Output's `config` instead. Still accepted so existing callers keep working. Previously: Legacy field, decoded but never applied: buildDataConfig emits only {outputId} for an `output` panel (see the outputId description above) \u2014 fieldMapping is not passed through. Also not used by text/markdown/image panels \u2014 TextPanelConfig/MarkdownPanelConfig carry no data binding to map fields against (pipelines-and-outputs remodel, HEL-903/904)."
53:          "description": "Deprecated and ignored: this panel-level field has no effect on the applied panel; set it on the Output's `config` instead. Still accepted so existing callers keep working. Previously: Legacy field, decoded but never applied: viz-level aggregation belonged to the metric/chart panel kinds, which were deleted by the pipelines-and-outputs remodel (HEL-903/904) along with the aggregation concept those kinds carried. Retained on the wire for schema stability only."
55:        "content": {
59:        "url": {
63:        "orientation": {
65:          "enum": ["horizontal", "vertical"],
66:          "description": "Initial orientation for divider panels. Ignored for other panel types."
70:          "enum": ["bar", "line", "pie", "scatter", "heatmap", "histogram"],
71:          "description": "Legacy field, decoded but never applied: the chart panel kind was deleted by the pipelines-and-outputs remodel (HEL-903/904). Retained on the wire for schema stability only."
75:          "description": "Legacy field, decoded but never applied: the chart panel kind was deleted by the pipelines-and-outputs remodel (HEL-903/904). Retained on the wire for schema stability only."
79:          "description": "Legacy field, decoded but never applied: the chart panel kind was deleted by the pipelines-and-outputs remodel (HEL-903/904). Retained on the wire for schema stability only."
86:          "description": "Legacy field, decoded but never applied: the chart panel kind was deleted by the pipelines-and-outputs remodel (HEL-903/904). Retained on the wire for schema stability only."
91:          "description": "Deprecated and ignored: this panel-level field has no effect on the applied panel; set it on the Output's `config` instead. Still accepted so existing callers keep working. Previously: Legacy field, decoded but never applied: the metric panel kind was deleted by the pipelines-and-outputs remodel (HEL-903/904). Retained on the wire for schema stability only."
96:          "description": "Deprecated and ignored: this panel-level field has no effect on the applied panel; set it on the Output's `config` instead. Still accepted so existing callers keep working. Previously: Legacy field, decoded but never applied: the metric panel kind was deleted by the pipelines-and-outputs remodel (HEL-903/904). Retained on the wire for schema stability only."
100:          "enum": ["asc", "desc"],
101:          "description": "Legacy field, decoded but never applied: the timeline panel kind was deleted by the pipelines-and-outputs remodel (HEL-903/904). Retained on the wire for schema stability only."
127:        "kind": { "type": "string", "enum": ["date-range", "dropdown", "numeric-range", "text"] },
```

**Backend proposal path accepts divider**
```
$ grep -rn -i 'divider' backend/src/main/scala/com/helio/services/proposals/*.scala | head -12
backend/src/main/scala/com/helio/services/proposals/ProposalPanelSupport.scala:34:   *  data-panel binding presence, and a divider panel's `orientation` value
backend/src/main/scala/com/helio/services/proposals/ProposalPanelSupport.scala:45:      _ <- if (panel.`type` == "divider")
backend/src/main/scala/com/helio/services/proposals/ProposalPanelSupport.scala:46:             RequestValidation.validateDividerOrientation(panel.orientation).left.map(msg => s"$where: $msg")
backend/src/main/scala/com/helio/services/proposals/ProposalPanelSupport.scala:330:      case "divider" =>
```

**MCP PANEL_TYPES excludes divider; orientation present in zod panelSchema?**
```
$ grep -n -E 'orientation|content|url' helio-mcp/src/tools/proposal.ts | head
43:// Exported so `replace_dashboard_contents` (write.ts, HEL-363) can reuse the
54:// Exported so `replace_dashboard_contents` (write.ts, HEL-363) can validate
84:  content: z.string().optional(),
85:  url: z.string().optional(),
86:  orientation: z.enum(["horizontal", "vertical"]).optional(),
104:  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }] };
113:        ? `${err.name} (status ${err.status}) for ${err.url}: ${err.message}`
115:    return { content: [{ type: "text", text: message }], isError: true };
143:        "flow as purely presentational chrome — create one with create_content_panel; the backend " +
148:        "place_outputs/create_content_panel uses:\n" +
```

**Backend proposal validation: type set allowed**
```
$ sed -n 28,75p backend/src/main/scala/com/helio/services/proposals/ProposalPanelSupport.scala
 *  constants (package-private) rather than redefining them, so the two
 *  callers can never silently drift apart on which panel types are
 *  data-bound. */
object ProposalPanelSupport {

  /** Per-panel structural checks, run before ANY creation: type, title,
   *  data-panel binding presence, and a divider panel's `orientation` value
   *  (the chartType/aggregation/timeline-sort checks were removed with those panel kinds). */
  def validatePanel(where: String, panel: ProposalPanel): Either[String, Unit] =
    for {
      _ <- PanelType.fromString(panel.`type`).left.map(msg => s"$where: $msg")
      _ <- if (panel.title.trim.isEmpty) Left(s"$where: title is required") else Right(())
      _ <- if (DashboardProposalService.DataPanelKinds.contains(panel.`type`) && panel.outputId.isEmpty)
             Left(s"$where: an ${panel.`type`} panel requires an outputId")
           else Right(())
      _ <- validateSourceBinding(where, panel)
      _ <- validateControlsShape(where, panel)
      _ <- if (panel.`type` == "divider")
             RequestValidation.validateDividerOrientation(panel.orientation).left.map(msg => s"$where: $msg")
           else Right(())
      // HEL-904 task 3.10a: the "chart"/timeline/metric kind-valued predicates
      // that used to gate chartType/aggregation/timeline-sort validation here
      // are deleted outright, along with the code paths they guarded — those
      // panel kinds (and `ChartPanel.rejectsAggregation`) no longer exist.
    } yield ()

  /** HEL-1148: the source-binding shape rules, structural and read-free. A source-bound kind
   *  (`SourceBoundKinds`, today `form`) needs the FLAT `dataSourceId` (a `config.dataSourceId`
   *  passthrough is deliberately not a binding: one source of truth), may not also carry an
   *  `outputId`, and no other kind may carry a `dataSourceId` at all (silently ignoring it would be
   *  the exact unbound-panel failure this change exists to prevent). Existence/ownership/dataset
   *  kind are the DB-backed `preValidateSourceBindings` below. */
  private def validateSourceBinding(where: String, panel: ProposalPanel): Either[String, Unit] = {
    val sourceBound = DashboardProposalService.SourceBoundKinds.contains(panel.`type`)
    if (sourceBound && panel.dataSourceId.forall(_.trim.isEmpty))
      Left(s"$where: a ${panel.`type`} panel requires a dataSourceId (the id of a dataset source; config.dataSourceId is not a binding)")
    else if (sourceBound && panel.outputId.isDefined)
      Left(s"$where: a ${panel.`type`} panel binds a dataSourceId, not an outputId")
    else if (!sourceBound && panel.dataSourceId.isDefined)
      Left(s"$where: dataSourceId is only supported on a ${DashboardProposalService.SourceBoundKinds.toSeq.sorted.mkString("/")} panel")
    else Right(())
  }

  /** HEL-1193: `controls` is an output-panel-only first-class field, and supplying it alongside
   *  `config.controls` would leave two competing sources for the same list — both rejected here,
   *  structurally, before any read or write. Eligibility itself is never decided here. */
  private def validateControlsShape(where: String, panel: ProposalPanel): Either[String, Unit] =
    if (panel.controls.exists(_.nonEmpty) && panel.`type` != "output")
```

**Backend test pinning divider orientation in a proposal**
```
$ grep -rln 'orientation' backend/src/test | head; grep -rn 'divider' backend/src/test/scala/com/helio/services/proposals 2>/dev/null | head -5
backend/src/test/scala/com/helio/domain/model/PanelSpec.scala
backend/src/test/scala/com/helio/api/protocols/proposals/DashboardProposalProtocolSpec.scala
backend/src/test/scala/com/helio/api/ApiRoutesSpec.scala
backend/src/test/scala/com/helio/api/routes/pipelines/ProvenanceRoutesSpec.scala
backend/src/test/scala/com/helio/api/routes/proposals/DashboardApplyProposalSpec.scala
backend/src/test/scala/com/helio/services/proposals/CombinedProposalServiceValidateSpec.scala
backend/src/test/scala/com/helio/services/proposals/DashboardProposalServiceValidateSpec.scala
backend/src/test/scala/com/helio/services/assistant/AssistantServiceSpec.scala
backend/src/test/scala/com/helio/services/assistant/AssistantToolExecutorSpec.scala
backend/src/test/scala/com/helio/services/patchsets/PatchSetUndoInverseSpec.scala
backend/src/test/scala/com/helio/services/proposals/DashboardAuthoringPromptSpec.scala:113:    "instructs the model to emit exactly the panel kinds PanelType.fromString accepts (minus divider, which the proposal flow deliberately excludes as purely presentational chrome)" in {
```

**Tests that apply a divider proposal panel / seed flat content,url**
```
$ grep -n -i -E 'divider|orientation' backend/src/test/scala/com/helio/api/routes/proposals/DashboardApplyProposalSpec.scala backend/src/test/scala/com/helio/services/proposals/DashboardProposalServiceValidateSpec.scala | head -12; grep -rn -E 'imageFit|imageUrl' backend/src/test/scala/com/helio/api/routes/proposals/*.scala backend/src/test/scala/com/helio/services/proposals/*.scala | head -6
backend/src/test/scala/com/helio/api/routes/proposals/DashboardApplyProposalSpec.scala:11: *  HEL-293 markdown/image/divider/chart/metric appearance), and invalid-type /
backend/src/test/scala/com/helio/api/routes/proposals/DashboardApplyProposalSpec.scala:66:    // HEL-293 — content/url/orientation flow through the create-side config
backend/src/test/scala/com/helio/api/routes/proposals/DashboardApplyProposalSpec.scala:68:    "apply markdown content, image url, and divider orientation from a proposal (HEL-293)" in {
backend/src/test/scala/com/helio/api/routes/proposals/DashboardApplyProposalSpec.scala:76:           |    {"title":"Sep","type":"divider","orientation":"vertical"}
backend/src/test/scala/com/helio/api/routes/proposals/DashboardApplyProposalSpec.scala:91:        val divider = panels.find(_.fields("title").convertTo[String] == "Sep").get
backend/src/test/scala/com/helio/api/routes/proposals/DashboardApplyProposalSpec.scala:92:        divider.fields("config").asJsObject.fields("orientation").convertTo[String] shouldBe "vertical"
backend/src/test/scala/com/helio/api/routes/proposals/DashboardApplyProposalSpec.scala:106:    "reject an invalid divider orientation and create nothing" in {
backend/src/test/scala/com/helio/api/routes/proposals/DashboardApplyProposalSpec.scala:110:          |  {"title":"X","type":"divider","orientation":"diagonal"}
backend/src/test/scala/com/helio/api/routes/proposals/DashboardApplyProposalSpec.scala:114:        responseAs[String].toLowerCase should include("orientation")
backend/src/test/scala/com/helio/services/proposals/DashboardProposalServiceValidateSpec.scala:62:      orientation  = None,
backend/src/test/scala/com/helio/api/routes/proposals/DashboardApplyProposalConfigSpec.scala:53:    // (markdown/text `content`, image `imageUrl`/`caption`) — the spec scenario "Literal markdown
backend/src/test/scala/com/helio/api/routes/proposals/DashboardApplyProposalConfigSpec.scala:62:          |    {"title":"Logo","type":"image","config":{"imageUrl":"https://example.com/l.png","caption":"Our logo"}}
backend/src/test/scala/com/helio/api/routes/proposals/DashboardApplyProposalConfigSpec.scala:71:        cfg("Logo").fields("imageUrl") shouldBe JsString("https://example.com/l.png")
backend/src/test/scala/com/helio/api/routes/proposals/DashboardApplyProposalSpec.scala:88:        image.fields("config").asJsObject.fields("imageUrl").convertTo[String] shouldBe "https://example.com/logo.png"
backend/src/test/scala/com/helio/api/routes/proposals/DashboardApplyProposalSpec.scala:89:        image.fields("config").asJsObject.fields("imageFit").convertTo[String] shouldBe "contain"
```

**MCP caption docs**
```
$ grep -n -i 'caption' helio-mcp/src/tools/placements.ts helio-mcp/src/tools/write.ts | head
helio-mcp/src/tools/placements.ts:84:        "`caption` (static string) rendered as a strip beneath the image; omit it for no caption.\n" +
helio-mcp/src/tools/write.ts:715:        "markdown panel's config.content (e.g. `![caption](helio://uploads/image/<id>)`). The " +
helio-mcp/src/tools/write.ts:793:        "`caption` clears on `null` OR a blank/whitespace string.\n" +
```

**MCP annotation docs and add_output/update_output usage**
```
$ grep -n -i 'annotation\|OUTPUT_CONFIG_KEYS_DOC' helio-mcp/src/tools/outputs.ts | head -12
72:export const OUTPUT_CONFIG_KEYS_DOC =
78:  "`aggregation`, `chartOptions`, `annotation`, `referenceLines`, `referenceBands`; metric: `aggregation`, `label`, `unit`, " +
147:        OUTPUT_CONFIG_KEYS_DOC +
175:        OUTPUT_CONFIG_KEYS_DOC +
```

**Chart renders annotation**
```
$ grep -rn 'annotation' frontend/src/features/panels/ui/ChartOutputPanel.tsx frontend/src/features/panels/ui/ChartRenderer.tsx 2>/dev/null | head; grep -rn 'chart-panel__annotation' frontend/src --include=*.tsx | grep -v test | head -3
frontend/src/features/panels/ui/ChartOutputPanel.tsx:150:      annotation={cfg.annotation ?? null}
frontend/src/features/panels/ui/renderers/ChartRenderer.tsx:131:        <p className="chart-panel__annotation" title={trimmedAnnotation}>
```

**image caption rendering**
```
$ grep -rn 'caption' frontend/src/features/panels/ui/*.tsx | grep -v test | head -6
frontend/src/features/panels/ui/ImagePanel.tsx:10:  caption?: string | null;
frontend/src/features/panels/ui/ImagePanel.tsx:45:export function ImagePanel({ imageUrl, imageFit, caption }: ImagePanelProps) {
frontend/src/features/panels/ui/ImagePanel.tsx:47:  const trimmedCaption = caption?.trim();
frontend/src/features/panels/ui/ImagePanel.tsx:91:        <p className="image-panel__caption" title={trimmedCaption}>
```

**backend annotation key on chart Output**
```
$ grep -n -i 'annotation' backend/src/main/scala/com/helio/domain/panels/OutputBindingSpec.scala | head
13: *  every column (`label`/`unit`/`xAxis`/`series`/`annotation`/`event`). */
71:  // chart → {xAxis, yAxis, series?, annotation?} — carried over verbatim
76:    optionalSlots     = Vector("series", "annotation"),
77:    columnEligibility = Map("xAxis" -> Any, "yAxis" -> Numeric, "series" -> Any, "annotation" -> Any)
```

**OUTPUT_CONFIG_KEYS_DOC**
```
$ sed -n 68,84p helio-mcp/src/tools/outputs.ts

/** Per-kind `config` key set and `aggregation` shapes (HEL-1313), appended to every Output-config
 *  write tool. Mirrors the backend's `OutputConfigValidation.KnownKeys`, the sole validator: an
 *  unknown key or malformed aggregation is a 400 naming it. */
export const OUTPUT_CONFIG_KEYS_DOC =
  "Output `config` accepts ONLY these top-level keys (anything else is rejected with a 400 " +
  "naming the key and a did-you-mean hint; this tool does not validate it): every kind: " +
  "`fieldMapping`, `compare`, `historyPayloads`; chart: `chartType` (" +
  CHART_TYPES_PIPE_LIST +
  "), " +
  "`aggregation`, `chartOptions`, `annotation`, `referenceLines`, `referenceBands`; metric: `aggregation`, `label`, `unit`, " +
  "`format`, `conditionalFormats`; table: `columnOrder`, `columnFormats`, `columnSort`, " +
  "`columnFilters`, `pinnedColumns`, `conditionalFormats`; collection: `layout`, `format`, " +
  "`conditionalFormats`; timeline: `sort`; markdown: `content`. " +
  "`aggregation` is null, `{ groupBy, agg, yField }` on a chart (never on a scatter, heatmap or histogram chart), " +
  "or `{ agg }` (the field comes from `fieldMapping.value`) / `{ value, agg }` on a metric; " +
  "`agg` is one of count|sum|avg|min|max and every named field a non-empty string. Chart " +
```

**ChartOutputPanel cfg.annotation type + ChartRenderer**
```
$ grep -rn 'annotation' frontend/src/features/panels/ui/ChartOutputPanel.tsx frontend/src/features/panels/ui/renderers/ChartRenderer.tsx frontend/src/features/pipelines/types/*.ts | head; sed -n 125,135p frontend/src/features/panels/ui/renderers/ChartRenderer.tsx
frontend/src/features/panels/ui/ChartOutputPanel.tsx:150:      annotation={cfg.annotation ?? null}
frontend/src/features/panels/ui/renderers/ChartRenderer.tsx:37:  annotation?: string | null;
frontend/src/features/panels/ui/renderers/ChartRenderer.tsx:39:   *  the annotation footnote's two-line clamp, so at the grid's narrowest width the total is not
frontend/src/features/panels/ui/renderers/ChartRenderer.tsx:70:  annotation,
frontend/src/features/panels/ui/renderers/ChartRenderer.tsx:77:  const trimmedAnnotation = annotation?.trim();
frontend/src/features/panels/ui/renderers/ChartRenderer.tsx:131:        <p className="chart-panel__annotation" title={trimmedAnnotation}>
            compact={compact}
            onDataPointSelect={onDataPointSelect}
          />
        </Suspense>
      </div>
      {trimmedAnnotation ? (
        <p className="chart-panel__annotation" title={trimmedAnnotation}>
          {trimmedAnnotation}
        </p>
      ) : null}
      {truncationNote ? (
```

**image-panel caption in ImagePanelConfig**
```
$ grep -n -B2 -A8 'interface ImagePanelConfig' frontend/src/features/panels/types/panel.ts; grep -n -i caption backend/src/main/scala/com/helio/domain/panels/ImagePanel.scala | head -5
198-}
199-
200:export interface ImagePanelConfig {
201-  imageUrl: string;
202-  imageFit: string;
203-  /** Optional static caption rendered as a strip beneath the image.
204-   *  Absent/blank hides it; send `null` to clear. HEL-318. */
205-  caption?: string | null;
206-}
207-
208-export interface DividerPanelConfig {
11: *  `caption` (HEL-318) is optional static literal text rendered as a strip
14:final case class ImagePanelConfig(imageUrl: String, imageFit: String, caption: Option[String] = None)
24:  /** Normalize a caption input to the cleared/set state: absent, null, empty,
25:   *  and whitespace-only all collapse to `None` so a blank caption round-trips
27:  private def normalizeCaption(value: Option[JsValue]): Option[String] = value match {
```

**Backend KnownKeys lists chart annotation**
```
$ grep -rn -B3 -A12 'KnownKeys' backend/src/main/scala/com/helio/services/pipelines/OutputConfigValidation.scala | grep -n -i -E 'annotation|KnownKeys|chart' | head
4:22:  val KnownKeys: Map[OutputKind, Set[String]] = Map(
5:23-    OutputKind.Chart      -> (Shared ++ Set("chartType", "aggregation", "chartOptions", "annotation", ChartReferenceMarks.LinesKey, ChartReferenceMarks.BandsKey)),
17:35-  private val Renames = Map("metricLabel" -> "label", "metricUnit" -> "unit", "chartAnnotation" -> "annotation")
20:38:  /** One text block, built from [[KnownKeys]], for every prompt/tool surface that tells Claude how to write
23:41:    val perKind = KnownKeys.toVector.sortBy(_._1.toString).map { case (k, keys) =>
29:47-      "chart aggregation = { groupBy, agg, yField } (all non-empty strings; never on a scatter, heatmap or histogram chart); " +
34:52-      s"chartType is one of ${ChartTypes.AllList}. chartOptions.histogram.binCount, when set, is a whole number from $HistogramBinMin to $HistogramBinMax. ${ChartReferenceMarks.Doc} Chart styling (legend, tooltip, colors) is not Output config: it lives on the panel's appearance.chart. " +
40:59:    val known = KnownKeys.getOrElse(kind, Shared)
49:68-      validateChartType(written, stored).flatMap(_ => validateBinCount(written, stored)).flatMap(_ => ChartReferenceMarks.validate(written, stored)).flatMap(_ => validateAggregation(kind, written, stored))
56:82-      .orElse(Option.when(DeadStyling.contains(key))(s"`$key` (no renderer reads it; chart styling lives on the panel's appearance.chart)"))
```

**Backend test pinning annotation config on chart Output**
```
$ grep -rln 'annotation' backend/src/test | head -5; grep -rln 'annotation' frontend/src --include=*.test.tsx | head -4
backend/src/test/scala/com/helio/domain/model/PanelSpec.scala
backend/src/test/scala/com/helio/api/routes/pipelines/OutputRoutesSpec.scala
backend/src/test/scala/com/helio/infrastructure/persistence/panels/PanelRowMapperSpec.scala
backend/src/test/scala/com/helio/infrastructure/persistence/pipelines/OutputHistoryBatchedThinSpec.scala
backend/src/test/scala/com/helio/infrastructure/persistence/pipelines/V94OutputsMigrationSpec.scala
frontend/src/features/panels/ui/renderers/ChartRenderer.test.tsx
frontend/src/features/panels/ui/editors/ChartDisplayFields.test.tsx
frontend/src/features/panels/ui/PanelContent.chartTruncation.test.tsx
frontend/src/features/panels/ui/PanelCard.crossFilter.test.tsx
```

**update_panel tool args**
```
$ sed -n 760,812p helio-mcp/src/tools/write.ts
  // update_panel_appearance above (same resource, same PATCH endpoint) — the
  // missing fifth resource in the HEL-328 edit-in-place parity set (data
  // source/DataType/pipeline/pipeline step), registered here rather than in
  // the `## Edit-in-place (HEL-328)` block below, whose section comment names
  // that ticket's own fixed four-tool set.
  server.registerTool(
    "update_panel",
    {
      title: "Update panel (title/type/config/appearance) -- placement fields only",
      description:
        "Partially update a panel — title, type, config, and/or appearance — in place " +
        "(PATCH /api/panels/:id), without the delete-and-recreate round trip that churns the " +
        "panel's id and dashboard layout position. `title`/`type`/`config`/`appearance` are each " +
        "independently optional: an OMITTED argument leaves that field unchanged server-side.\n" +
        "`title`, when supplied, is trimmed and rejected (400) if blank.\n" +
        "`type`, when supplied, is validated against the panel's STORED kind: a matching value is a " +
        "harmless no-op, a MISMATCHED value is REJECTED (400, a panel's kind is immutable once " +
        "created) — never silently dropped or applied.\n" +
        "`appearance` is the SAME true partial merge as update_panel_appearance (HEL-362): an " +
        "omitted field keeps its stored value; an explicit `null` clears it. See that tool's " +
        "description for the `chart` sub-object's own field-level merge/clear rules.\n" +
        "`config` is decoded server-side against the panel's EXISTING stored `type` and is ALSO a " +
        "genuine per-field partial merge — the SAME absent/null convention as `appearance`. " +
        "HEL-907: a panel now carries ONLY placement fields — there is no per-bound-kind " +
        "fieldMapping/aggregation config on a panel anymore (that all moved to the Output itself, " +
        '`target.kind: "output"` via update_output). Patchable `config` fields, per the panel\'s ' +
        "stored type:\n" +
        "• output — `outputId` (rebind this placement to a DIFFERENT existing Output; use " +
        "update_output instead if you want to change the CURRENT Output's name/fieldMapping).\n" +
        "• text/markdown — `content`; absent leaves it unchanged, explicit `null` clears it to " +
        '`""` (not "removed").\n' +
        '• image — `imageUrl` clears to "" on `null`; `imageFit` RESETS to the default ' +
        '`"contain"` on `null` (NOT a clear-to-empty) and is enum-validated on a non-null value; ' +
        "`caption` clears on `null` OR a blank/whitespace string.\n" +
        '• divider — `orientation` RESETS to the default `"horizontal"` on `null` (NOT a clear, ' +
        "enum-validated on a non-null value); `weight`/`color` clear on `null`.\n" +
        "Returns the updated panel.",
      inputSchema: {
        panelId: z.string().min(1),
        title: z.string().optional(),
        // Unlike create_content_panel's `type` enum (text/markdown/image/divider only -- no
        // "output", which place_outputs creates instead), this tool's `type` validates against an
        // EXISTING panel's stored kind, so "output" is included here.
        type: z.enum(["output", "text", "markdown", "image", "divider", "form"]).optional(),
        config: z.record(z.string(), z.unknown()).optional(),
        appearance: z.record(z.string(), z.unknown()).optional(),
      },
    },
    ({ panelId, title, type, config, appearance }) =>
      guarded(() =>
        api.updatePanel(panelId, buildUpdatePanelBody({ title, type, config, appearance })),
      ),
  );
```

**Type change rejected (single and batch)**
```
$ grep -n -i 'cannot change panel type' -r backend/src/main/scala/com/helio | head; sed -n 15,32p backend/src/main/scala/com/helio/services/panels/PanelServiceHelpers.scala
backend/src/main/scala/com/helio/services/panels/PanelServiceHelpers.scala:28:                          Left(s"cannot change panel type: stored type is '${existing.kind}', request type is '${PanelType.asString(pt)}'")
backend/src/main/scala/com/helio/services/panels/PanelServiceHelpers.scala:124:            Left(s"cannot change panel type for '${item.id}': stored type is '${panel.kind}', request type is '$t'")
  /** Validate + normalize an `UpdatePanelRequest`. The `config` patch JsValue
   *  is preserved as-is and decoded against the stored panel's typed shape
   *  at apply-time (via [[PanelConfigCodec.applyConfigPatch]]).
   *
   *  Cross-type PATCH lock: if the request carries an explicit `type` that
   *  differs from the stored panel's `kind`, return 400 here. */
  def resolvePatch(request: UpdatePanelRequest, existing: Panel): Either[String, ResolvedPanelPatch] = {
    val trimmedTitle = request.title.map(_.trim)
    for {
      _            <- if (trimmedTitle.contains("")) Left("title must not be blank") else Right(())
      panelTypeOpt <- validatePanelTypeOpt(request.`type`)
      _            <- panelTypeOpt match {
                        case Some(pt) if PanelType.asString(pt) != existing.kind =>
                          Left(s"cannot change panel type: stored type is '${existing.kind}', request type is '${PanelType.asString(pt)}'")
                        case _ => Right(())
                      }
      // HEL-362: merge the payload over the stored appearance rather than
      // rebuilding from defaults — a field absent from the payload preserves
```

**Living update_panel requirement text**
```
$ sed -n 84,100p openspec/specs/mcp-panel-composition-tools/spec.md
- **THEN** the auto-layout request body carries `expectedLayoutVersion` N

### Requirement: update_panel MCP tool
The MCP server SHALL expose `update_panel` accepting only placement fields (`title`, `w`, `h`,
position) — DataType/binding fields SHALL NOT be accepted, since a panel's Output binding is fixed
at placement time and is not mutable via `update_panel`.

#### Scenario: Agent resizes a placed panel
- **WHEN** an agent calls `update_panel` with a valid `panelId` and new `w`/`h`
- **THEN** the tool updates the placement and returns the updated panel

#### Scenario: Attempting to rebind a panel's Output is rejected
- **WHEN** an agent calls `update_panel` with a field attempting to change the panel's bound
  Output
- **THEN** the tool rejects the call before issuing any HTTP request, since `update_panel`'s
  schema does not accept a binding field
```

**Living flat-field + caption requirement text**
```
$ sed -n 25,62p openspec/specs/mcp-panel-composition-tools/spec.md
- **THEN** the tool returns the backend's 413 error message unchanged, not a generic failure

### Requirement: Proposal config passthrough is backward compatible

The `config` field SHALL be optional and additive: a proposal carrying only the existing flat fields
(and no `config`) SHALL produce byte-for-byte the same created panels as before this change. The
shared in-app Proposal Review UI, which posts to the same endpoint, SHALL continue to round-trip
proposals unchanged.

#### Scenario: Flat-field-only proposal is unchanged
- **WHEN** an agent applies a proposal whose panels use only the flat fields (`fieldMapping`,
  `aggregation`, `content`, `chartType`, etc.) and no `config`
- **THEN** the created dashboard and panels are identical to the pre-change behavior

#### Scenario: Proposal Review UI still round-trips
- **WHEN** a proposal is applied through the in-app Proposal Review UI
- **THEN** the dashboard and its panels are created correctly with no regression

### Requirement: Panel composition tools accept image caption and chart annotation

The MCP panel create/update tool surface SHALL accept an optional `caption` on image-panel `config` and
an optional `annotation` on chart-panel `config`, passing each straight through to the panel API so
agent-built dashboards can attach static caption/annotation text. The tool descriptions SHALL document
both fields on the respective panel `config` shapes. Omitting either field SHALL preserve today's
behavior (no caption/annotation).

#### Scenario: Agent creates an image panel with a caption
- **WHEN** an agent calls the create tool with `type: "image"` and `config: { imageUrl: "...",
  caption: "Hero photo — Reuters" }`
- **THEN** the created image panel persists with that `caption` and the dashboard renders its caption
  strip

#### Scenario: Agent sets a chart annotation
- **WHEN** an agent creates or updates a chart panel with `config.annotation: "Source: BLS"`
- **THEN** the panel persists with that `annotation` and renders it as a subtitle/footnote

#### Scenario: Omitting caption/annotation preserves current behavior
- **WHEN** an agent creates an image or chart panel without a `caption`/`annotation`
```

**panel-type-rendering living spec**
```
$ cat openspec/specs/panel-type-rendering/spec.md
## Purpose
Defines how each panel type renders its body content area inside the dashboard grid, including placeholder states when no data is bound and live states when data is present.

## Requirements

### Requirement: Unknown panel types degrade gracefully
If a panel has an unrecognised or missing type value, the grid MUST render a fallback body rather than crashing or leaving the body blank.

#### Scenario: Panel with unknown type falls back to metric rendering
- **WHEN** a panel with an unrecognised type is displayed
- **THEN** the metric placeholder is shown as a safe fallback

### Requirement: Type badge is visible on each panel card
Each panel card in the grid MUST display the panel's type as a small visible label so users can identify the type at a glance without relying solely on the placeholder content.

#### Scenario: Type badge shown on panel card
- **WHEN** any panel is displayed in the grid
- **THEN** a small type badge showing the panel's kind (e.g. "output", "text") is visible on the card

### Requirement: Markdown panel type badge is displayed correctly
The type badge on a markdown panel card SHALL display the label "markdown" (consistent with other
panel type badges).

#### Scenario: Markdown panel shows markdown type badge
- **WHEN** a markdown panel is displayed in the grid
- **THEN** a small type badge reading "markdown" is visible on the card

### Requirement: Panel type selector includes markdown option
The panel type selector (used when creating or changing a panel's type) SHALL include `markdown`
as a selectable option alongside the existing types.

#### Scenario: Markdown appears in type selector
- **WHEN** the panel type selector is opened
- **THEN** `markdown` is listed as a valid selectable type

### Requirement: Panel type selector includes image option
The panel type selector (used when creating or changing a panel's type) SHALL include `image`
as a selectable option alongside the existing types.

#### Scenario: Image appears in type selector
- **WHEN** the panel type selector is opened
- **THEN** `image` is listed as a valid selectable type

### Requirement: Each canonical panel kind renders a visually distinct body

The panel grid MUST render a body for each canonical panel kind (`output`, `text`, `markdown`, `image`, `divider`,
`form`). A content kind (`text`, `markdown`, `image`) SHALL display its literal config when set and a placeholder when
it is empty. An `output` panel's body SHALL be chosen by the kind of the Output it is bound to (`chart`, `table`,
`metric`, `markdown`, `collection`, `timeline`). No panel kind has a `typeId` binding, and a `text` panel has no data
binding of any kind.

#### Scenario: Text panel with literal content renders it
- **WHEN** a panel with `type: "text"` has a non-empty `config.content`
- **THEN** the panel body shows that literal content

#### Scenario: Text panel without content renders placeholder text lines
- **WHEN** a panel with `type: "text"` has a null or empty `config.content`
- **THEN** the panel body shows faded placeholder text lines

#### Scenario: Markdown panel with content renders CommonMark HTML
```

**Panel type selector / creation entry points in frontend/src (non-test)**
```
$ grep -rln -E 'PANEL_TYPE_OPTIONS|panel-type|PanelTypeSelect|CREATABLE|TypeSelector|PANEL_KINDS' frontend/src | grep -v test | head; grep -rn -E '"markdown"|"image"' frontend/src/features/panels/ui/*Create*.tsx frontend/src/features/panels/ui/*Modal*.tsx 2>/dev/null | grep -v test | head
frontend/src/features/panels/README.md
frontend/src/features/panels/ui/OutputPicker.tsx
```

**Type selector references**
```
$ grep -n -i -E 'selector|PANEL_KINDS|CREATABLE' frontend/src/features/panels/ui/OutputPicker.tsx frontend/src/features/panels/README.md | head; grep -rn -E 'createPanel\(|createPanelThunk|value="(markdown|image)"|label: *"(Markdown|Image)"' frontend/src --include=*.tsx --include=*.ts | grep -v -E 'test|\.d\.ts' | head -15
frontend/src/features/panels/ui/OutputPicker.tsx:30:const CONTENT_PANEL_KINDS: { kind: PanelKind; label: string; icon: ReactElement }[] = [
frontend/src/features/panels/ui/OutputPicker.tsx:117:      for (const { kind, label } of CONTENT_PANEL_KINDS) {
frontend/src/features/panels/ui/OutputPicker.tsx:357:              {CONTENT_PANEL_KINDS.map(({ kind, label, icon }) => {
frontend/src/features/panels/ui/OutputPicker.tsx:32:  { kind: "markdown", label: "Markdown", icon: <AlignLeft size={ICON_SIZE.md} /> },
frontend/src/features/panels/ui/OutputPicker.tsx:33:  { kind: "image", label: "Image", icon: <ImageIcon size={ICON_SIZE.md} /> },
frontend/src/features/panels/ui/OutputPicker.tsx:140:          createPanel({ dashboardId, type: "output", title: outputName, outputId }),
frontend/src/features/panels/ui/OutputPicker.tsx:163:      await dispatch(createPanel({ dashboardId, type: kind })).unwrap();
frontend/src/features/panels/ui/DatasetStep.tsx:66:        createPanel({
frontend/src/features/panels/services/panelService.ts:40:export async function createPanel(
frontend/src/features/pipelines/ui/outputEditor/OutputEditorSheet.tsx:53:  { value: "markdown", label: "Markdown" },
```

**OutputPicker content-kind options (the creation selector)**
```
$ sed -n 28,40p frontend/src/features/panels/ui/OutputPicker.tsx
const OPTION_ID_PREFIX = "output-picker-option-";

const CONTENT_PANEL_KINDS: { kind: PanelKind; label: string; icon: ReactElement }[] = [
  { kind: "text", label: "Text", icon: <FileText size={ICON_SIZE.md} /> },
  { kind: "markdown", label: "Markdown", icon: <AlignLeft size={ICON_SIZE.md} /> },
  { kind: "image", label: "Image", icon: <ImageIcon size={ICON_SIZE.md} /> },
  { kind: "divider", label: "Divider", icon: <Minus size={ICON_SIZE.md} /> },
  // HEL-1084 design.md D6 — unlike the other four, activating Form doesn't
  // create a panel directly: it switches the modal into the dataset step
  // (see `datasetStepOpen` below).
  { kind: "form", label: "Form", icon: <ClipboardList size={ICON_SIZE.md} /> },
];
```

**Frontend PATCH body type field: UpdatePanelBody has no type**
```
$ sed -n 76,100p frontend/src/features/panels/state/panelPayloads.ts
// appear, so the per-subtype `Patch.decode` on the backend preserves
// absent-vs-null semantics. `null` on a field means "clear to default".

export interface UpdatePanelBody {
  title?: string;
  appearance?: unknown;
  type?: PanelKind;
  config?: Record<string, unknown>;
}

/** Build the typed `config` PATCH for a Text or Markdown panel's Content
 *  editor save. Literal-only — a bare `content` replacement. */
export function buildContentPatch(content: string): Record<string, unknown> {
  return { content };
}

/** Build the typed `config` PATCH for an image edit. `caption` follows the
 *  absent-vs-null convention (HEL-318): a non-blank string sets it; `null`
 *  clears the stored caption (the editor maps an empty control to `null`). */
export function buildImagePatch(args: {
  imageUrl: string;
  imageFit: ImageFit;
  caption: string | null;
}): ImagePanelConfig {
  return { imageUrl: args.imageUrl, imageFit: args.imageFit, caption: args.caption };
```

**Batch update path rejects type change**
```
$ sed -n 112,128p backend/src/main/scala/com/helio/services/panels/PanelServiceHelpers.scala
    }

  /** Cross-type batch lock: every entry's request `type` (when present) must
   *  match the stored panel's `kind`. */
  private[services] def validateBatchTypeMatch(
      pairs: Vector[(PanelBatchItem, Panel)]
  ): Either[String, Unit] =
    pairs.foldLeft[Either[String, Unit]](Right(())) {
      case (Left(err), _) => Left(err)
      case (Right(_), (item, panel)) =>
        item.`type` match {
          case Some(t) if t != panel.kind =>
            Left(s"cannot change panel type for '${item.id}': stored type is '${panel.kind}', request type is '$t'")
          case _ => Right(())
        }
    }
```

**Any frontend request sending type in a panel PATCH?**
```
$ grep -n -E 'type' frontend/src/features/panels/services/panelService.ts | head -20
3:import type {
15:} from "../types/panel";
16:import type { PagedResult } from "../../../types/models";
17:import type { RowWriteResponse } from "../../sources/types/dataSource";
37:/** Create a panel. `outputId` is required for `type: "output"`; ignored
42:  type: PanelKind,
47:  const body = buildCreatePanelBody({ dashboardId, title, type, outputId, config });
128: *  directly as the Image panel's `imageUrl`, exactly like a typed URL. */
162: *  panel's submit path. `values` are already the typed, submit-ready payload
196: *  branch on "did the server name specific fields" without its own type-narrowing (design.md D5,
205:      typeof e === "object" &&
207:      typeof (e as Record<string, unknown>).field === "string" &&
208:      typeof (e as Record<string, unknown>).reason === "string",
```

**No UI control for changing a panel's type**
```
$ grep -rn -i -E 'change (panel )?type|changeType|panel type (select|change)' frontend/src --include=*.tsx --include=*.ts | grep -v -E '\.test\.' | head; echo ---; grep -rn -E 'updatePanel\(' frontend/src --include=*.ts --include=*.tsx | grep -v test | head -5; grep -rn 'type:' frontend/src/features/panels/state/panelThunks.ts | head
---
96:    type: PanelKind;
```

**DashboardSnapshot* case classes**
```
$ sed -n 98,120p backend/src/main/scala/com/helio/api/protocols/dashboards/DashboardProtocol.scala; sed -n 195,215p backend/src/main/scala/com/helio/api/protocols/dashboards/DashboardProtocol.scala
 *  HEL-368: `id` is an additive, decode-tolerant field carrying the panel's
 *  real (non-remapped) server-assigned id, for programmatic/agent readers
 *  (e.g. the MCP `get_dashboard` tool). `snapshotId` remains the sole handle
 *  the importer uses for layout remapping — `id` is ignored on import and
 *  `Option` so pre-existing exported files (lacking this key) still decode. */
final case class DashboardSnapshotPanelEntry(
    snapshotId: String,
    id: Option[String],
    title: String,
    `type`: String,
    appearance: PanelAppearancePayload,
    config: JsValue
)
final case class DashboardSnapshotDashboardEntry(
    name: String,
    appearance: DashboardAppearancePayload,
    layout: DashboardLayoutPayload
)
final case class DashboardSnapshotPayload(
    version: Int,
    dashboard: DashboardSnapshotDashboardEntry,
    panels: Vector[DashboardSnapshotPanelEntry]
)
   *  delegating the per-subtype payload to [[PanelConfigCodec.encodeConfig]].
   *  Image and Divider config fields now round-trip (closing the pre-existing
   *  data-loss bug — the prior flat shape omitted them from the snapshot). */
  def fromDomain(panel: Panel): DashboardSnapshotPanelEntry =
    DashboardSnapshotPanelEntry(
      snapshotId = panel.id.value,
      id         = Some(panel.id.value),
      title      = panel.title,
      `type`     = panel.kind,
      appearance = PanelAppearancePayload(
        background   = Some(panel.appearance.background),
        color        = Some(panel.appearance.color),
        transparency = Some(panel.appearance.transparency),
        chart        = panel.appearance.chart
      ),
      config = PanelConfigCodec.encodeConfig(panel)
    )
}

object DashboardSnapshotPayload {
```

**Export code path & snapshotId derivation in repo**
```
$ sed -n 80,106p backend/src/main/scala/com/helio/infrastructure/persistence/dashboards/DashboardSnapshotRepository.scala
      case None => DBIO.successful(None)
      case Some(sourceRow) =>
        panelTable.filter(_.dashboardId === id.value).result.map { panelRows =>
          val sourceDash = rowToDomain(sourceRow)

          def layoutItemToSnapshot(item: DashboardLayoutItem): DashboardLayoutItemPayload =
            DashboardLayoutItemPayload(
              panelId = item.panelId.value,
              x       = item.x,
              y       = item.y,
              w       = item.w,
              h       = item.h
            )

          val snapshotLayout = DashboardLayoutPayload(
            lg = sourceDash.layout.lg.map(layoutItemToSnapshot),
            md = sourceDash.layout.md.map(layoutItemToSnapshot),
            sm = sourceDash.layout.sm.map(layoutItemToSnapshot),
            xs = sourceDash.layout.xs.map(layoutItemToSnapshot)
          )

          val snapshotPanels = panelRows.toVector.map { p =>
            DashboardSnapshotPanelEntry.fromDomain(panelRowToDomain(p))
          }

          val snapshotDashboard = DashboardSnapshotDashboardEntry(
            name       = sourceDash.name,
```

**Living export requirement + any snapshot schema**
```
$ sed -n 8,16p openspec/specs/dashboard-export-import/spec.md; ls schemas/dashboards; grep -rn -l 'snapshotId' schemas | head
## Requirements

### Requirement: Export dashboard endpoint
The system SHALL expose `GET /api/dashboards/:id/export` that returns a self-contained JSON snapshot of the dashboard. The snapshot SHALL include the dashboard `name`, `appearance`, `layout` (with panel references keyed by `snapshotId`), a `panels` array with each panel's `snapshotId`, `id`, `title`, `type`, `appearance`, `typeId`, and `fieldMapping`, and a top-level `version` field. The snapshot SHALL NOT include server-assigned IDs, `createdBy`, `createdAt`, or `lastUpdated` fields, **except** each panel entry's `id` field, which is an intentional, additive exception carrying the panel's real (non-remapped) server-assigned id for programmatic/agent identification. `snapshotId` remains the sole handle used for import layout remapping; `id` is informational only and MUST NOT be used by the importer.

#### Scenario: Successful export
- **WHEN** a `GET /api/dashboards/:id/export` request is made for an existing dashboard
- **THEN** the system returns `200 OK` with a JSON body containing `version`, `dashboard`, and `panels`
- **AND** the `layout` panel references match the `snapshotId` values in the `panels` array
create-dashboard-folder-request.schema.json
create-dashboard-request.schema.json
create-share-token-request.schema.json
create-share-token-response.schema.json
dashboard-appearance.schema.json
dashboard-folder-assignment.schema.json
dashboard-folder-list-response.schema.json
dashboard-folder.schema.json
dashboard-layout-item.schema.json
dashboard-layout-patch.schema.json
dashboard-layout.schema.json
dashboard-proposal.schema.json
dashboard.schema.json
move-dashboard-folder-request.schema.json
public-panel-rows-response.schema.json
replace-dashboard-contents-request.schema.json
share-token.schema.json
update-dashboard-folder-request.schema.json
update-dashboard-request.schema.json
```

**typeId mentions in dashboard-export-import spec**
```
$ grep -n typeId openspec/specs/dashboard-export-import/spec.md
11:The system SHALL expose `GET /api/dashboards/:id/export` that returns a self-contained JSON snapshot of the dashboard. The snapshot SHALL include the dashboard `name`, `appearance`, `layout` (with panel references keyed by `snapshotId`), a `panels` array with each panel's `snapshotId`, `id`, `title`, `type`, `appearance`, `typeId`, and `fieldMapping`, and a top-level `version` field. The snapshot SHALL NOT include server-assigned IDs, `createdBy`, `createdAt`, or `lastUpdated` fields, **except** each panel entry's `id` field, which is an intentional, additive exception carrying the panel's real (non-remapped) server-assigned id for programmatic/agent identification. `snapshotId` remains the sole handle used for import layout remapping; `id` is informational only and MUST NOT be used by the importer.
```

**Import resolves config.outputId**
```
$ grep -rn -i 'outputId' backend/src/main/scala/com/helio/services/dashboards/*Import*.scala backend/src/main/scala/com/helio/services/dashboards/*.scala 2>/dev/null | head; grep -rln 'DashboardSnapshotPayload' backend/src/main | head
backend/src/main/scala/com/helio/services/dashboards/DashboardSnapshotImport.scala:59:   *   - Gap A: for an output-kind panel, confirm the bound `outputId` actually resolves via
backend/src/main/scala/com/helio/services/dashboards/DashboardSnapshotImport.scala:89:              PanelServiceHelpers.outputIdFromCreateConfig(createConfig) match {
backend/src/main/scala/com/helio/services/dashboards/DashboardSnapshotImport.scala:90:                case Some(outputId) =>
backend/src/main/scala/com/helio/services/dashboards/DashboardSnapshotImport.scala:91:                  outputRepo.findByIdOwned(outputId, user).map {
backend/src/main/scala/com/helio/services/dashboards/DashboardSnapshotImport.scala:92:                    case None    => Left(ServiceError.BadRequest(s"panel '${entry.snapshotId}': outputId '${outputId.value}' not found"))
backend/src/main/scala/com/helio/services/dashboards/DashboardService.scala:43:    // HEL-910 task 2.1 (design.md Decision 5, Gap A): backs `importSnapshot`'s outputId-existence
backend/src/main/scala/com/helio/services/dashboards/DashboardSnapshotImport.scala:59:   *   - Gap A: for an output-kind panel, confirm the bound `outputId` actually resolves via
backend/src/main/scala/com/helio/services/dashboards/DashboardSnapshotImport.scala:89:              PanelServiceHelpers.outputIdFromCreateConfig(createConfig) match {
backend/src/main/scala/com/helio/services/dashboards/DashboardSnapshotImport.scala:90:                case Some(outputId) =>
backend/src/main/scala/com/helio/services/dashboards/DashboardSnapshotImport.scala:91:                  outputRepo.findByIdOwned(outputId, user).map {
backend/src/main/scala/com/helio/api/protocols/dashboards/DashboardProtocol.scala
backend/src/main/scala/com/helio/api/package.scala
backend/src/main/scala/com/helio/api/routes/dashboards/DashboardSnapshotRoutes.scala
backend/src/main/scala/com/helio/infrastructure/persistence/dashboards/DashboardSnapshotRepository.scala
backend/src/main/scala/com/helio/services/dashboards/DashboardSnapshotImport.scala
backend/src/main/scala/com/helio/services/dashboards/DashboardService.scala
backend/src/main/scala/com/helio/services/dashboards/DashboardServiceValidation.scala
```

**createdBy etc not in snapshot case classes**
```
$ grep -n -E 'createdBy|createdAt|lastUpdated' backend/src/main/scala/com/helio/api/protocols/dashboards/DashboardProtocol.scala | sed -n 1,10p; sed -n 106,110p backend/src/main/scala/com/helio/api/protocols/dashboards/DashboardProtocol.scala
    title: String,
    `type`: String,
    appearance: PanelAppearancePayload,
    config: JsValue
)
```

**encodeConfig is per-kind; Output/Form configs**
```
$ sed -n 25,40p backend/src/main/scala/com/helio/domain/panels/PanelConfigCodec.scala; sed -n 134,138p backend/src/main/scala/com/helio/domain/panels/OutputPanel.scala; grep -n 'dataSourceId' backend/src/main/scala/com/helio/domain/panels/FormPanel.scala | sed -n 1,5p

  /** Encode a `Panel`'s typed config as the wire `config` field. The
   *  per-subtype `RootJsonFormat[*Config]` produced by `jsonFormatN` is the
   *  canonical writer; this method just narrows on the subtype. */
  def encodeConfig(panel: Panel): JsValue = panel match {
    case t:  TextPanel      => t.config.toJson
    case m:  MarkdownPanel  => m.config.toJson
    case i:  ImagePanel      => i.config.toJson
    case d:  DividerPanel    => d.config.toJson
    case op: OutputPanel     => op.config.toJson
    case f:  FormPanel       => f.config.toJson
    case other               => deserializationError(s"Unknown panel kind for encode: '${other.kind}'")
  }


  /** Sealed marker for a per-subtype `*Config` carried through the service
  implicit val format: RootJsonFormat[OutputPanelConfig] = new RootJsonFormat[OutputPanelConfig] {
    def write(c: OutputPanelConfig): JsValue = JsObject(
      "outputId" -> JsString(c.outputId.value),
      "controls" -> JsArray(c.controls.map(_.toJson))
    )
201:    dataSourceId: DataSourceId,
211:  private val AllowedKeys: Set[String] = Set("dataSourceId", "fields", "submit")
215:      "dataSourceId" -> JsString(c.dataSourceId.value),
240:        val dataSourceId = fields.get("dataSourceId") match {
243:          case Some(x)           => deserializationError(s"dataSourceId must be a string, got $x")
```

**Export tests pin config.outputId in snapshot**
```
$ grep -rln 'export' backend/src/test/scala/com/helio/api | head -4; grep -rn 'outputId' backend/src/test/scala/com/helio/api/routes/dashboards/*Snapshot*Spec.scala 2>/dev/null | head -4
backend/src/test/scala/com/helio/api/ApiRoutesSpec.scala
backend/src/test/scala/com/helio/api/routes/panels/PanelContentOwnershipSpec.scala
backend/src/test/scala/com/helio/api/routes/panels/PanelControlsValidationSpec.scala
backend/src/test/scala/com/helio/api/routes/panels/FormPanelRoundTripSpec.scala
```

**OutputPanelContent metric/collection/timeline branches**
```
$ sed -n 214,272p frontend/src/features/panels/ui/OutputPanelContent.tsx
        onFilterChange={onFilterChange}
        totalRowCount={totalRowCount}
      />
    );
  } else if (kind === "metric") {
    content = (
      <MetricOutputPanel
        panelId={panelId}
        outputId={outputId}
        pipelineId={"pipelineId" in output ? output.pipelineId : undefined}
        config={output.config}
        rawRows={filteredRawRows}
        headers={headers}
        // HEL-1408 design D6 -- typed records so a client `count` excludes null like the server.
        records={filteredPaginationRows}
        // HEL-1275 design.md D3 — an applied viewer control filter, or a cross-filter narrowing this
        // panel (server `eq`, or the client-side loaded-rows fallback), hides the unfiltered delta.
        filterActive={viewerFilterActive || crossFilterMode === "server" || isCrossFiltered}
        // HEL-1326 design.md D5/D6 — a client-side cross-filter narrows only the LOADED rows, which
        // the server's filtered value cannot reflect, so that state keeps the loaded-rows value (the
        // HEL-588 disclosure below labels it); otherwise the server's full-filtered-set value wins.
        filteredMetric={isCrossFiltered ? undefined : filteredMetric}
        historySource={historySource}
      />
    );
  } else if (kind === "markdown") {
    const cfg = readMarkdownConfig(output.config);
    content = <MarkdownRenderer content={cfg.content} />;
  } else if (kind === "collection") {
    const cfg = readCollectionConfig(output.config);
    content = (
      <CollectionRenderer
        fieldMapping={cfg.fieldMapping}
        layout={cfg.layout}
        format={cfg.format}
        rawRows={filteredRawRows}
        headers={headers}
        conditionalFormats={cfg.conditionalFormats}
      />
    );
  } else if (kind === "timeline") {
    const cfg = readTimelineConfig(output.config);
    content = (
      <TimelineRenderer
        fieldMapping={cfg.fieldMapping}
        sort={cfg.sort}
        rawRows={filteredRawRows}
        headers={headers}
      />
    );
  } else {
    content = (
      <div className="panel-content panel-content--state">
        <span className="panel-content__state-label">Unsupported output kind</span>
      </div>
    );
  }

  return (
```

**baseType / itemOptions / timelineOptions / dataTypeId anywhere in non-test source & schemas**
```
$ grep -rln -E 'baseType|itemOptions|timelineOptions' frontend/src backend/src/main helio-mcp/src schemas | head; echo ---; grep -rn -E 'baseType|itemOptions' frontend/src backend/src/main schemas helio-mcp/src | grep -v -E '\.test\.' | head -10
frontend/src/features/panels/types/panel.ts
frontend/src/features/panels/ui/renderers/CollectionRenderer.test.tsx
frontend/src/features/panels/ui/renderers/CollectionRenderer.tsx
frontend/src/features/panels/ui/renderers/TimelineRenderer.tsx
frontend/src/features/panels/state/panelPayloads.ts
frontend/src/features/pipelines/ui/outputEditor/outputConfigTypes.ts
frontend/src/features/pipelines/ui/outputEditor/buildOutputConfig.ts
backend/src/main/scala/com/helio/domain/panels/OutputPanel.scala
backend/src/main/scala/com/helio/api/protocols/proposals/DashboardProposalProtocol.scala
backend/src/main/scala/com/helio/services/pipelines/LegacyOutputConfigKeys.scala
---
frontend/src/features/panels/ui/renderers/CollectionRenderer.tsx:12:  /** `baseType: metric` items' numeric display style (HEL-876) — forwarded
frontend/src/features/panels/ui/renderers/CollectionRenderer.tsx:26: *  the mapped column; literal `itemOptions.metric` overrides win over the bound
frontend/src/features/pipelines/ui/outputEditor/outputConfigTypes.ts:137:/** Numeric display style for `metric`/`collection baseType: metric` renderers
frontend/src/features/pipelines/ui/outputEditor/outputConfigTypes.ts:177:  /** `baseType: metric` items' numeric display style (HEL-876) — same
frontend/src/features/pipelines/ui/outputEditor/buildOutputConfig.ts:55:  // HEL-876 — numeric display style, shared by metric and collection (metric baseType).
backend/src/main/scala/com/helio/api/protocols/proposals/DashboardProposalProtocol.scala:49:    // surface (collection baseType/layout, chart chartOptions, table
backend/src/main/scala/com/helio/services/patchsets/RefinementPrompt.scala:42:      "chartType/baseType/layout/timelineOptions of its own at all; those all live on the Output " +
backend/src/main/scala/com/helio/services/patchsets/RefinementEditShape.scala:185:  // `config.outputId` -- nothing else in `config`; fieldMapping/aggregation/chartType/baseType/
backend/src/main/scala/com/helio/services/patchsets/RefinementEditShape.scala:218:      "there is no fieldMapping/aggregation/chartType/baseType/layout/timelineOptions on a panel " +
backend/src/main/resources/db/migration/V117__migrate_v94_dead_output_config_keys.sql:15:--   collectionOptions (whole object)  -                    none       -                                  drop (baseType/itemOptions kept in audit)
```

**CollectionRenderer.tsx**
```
$ cat -n frontend/src/features/panels/ui/renderers/CollectionRenderer.tsx
     1	import "./CollectionRenderer.css";
     2	import type { MappedPanelData } from "../../types/panel";
     3	import type { MetricFormat } from "../../../pipelines/ui/outputEditor/outputConfigTypes";
     4	import { MetricRenderer } from "./MetricRenderer";
     5	import type { ConditionalFormatRule } from "./conditionalFormatting";
     6	
     7	interface CollectionRendererProps {
     8	  /** Bound-column mapping from the Output's `CollectionOutputConfig`. */
     9	  fieldMapping: Record<string, string>;
    10	  layout: "grid" | "list";
    11	  metricOptions?: { label?: string; unit?: string };
    12	  /** `baseType: metric` items' numeric display style (HEL-876) — forwarded
    13	   *  to each item's `MetricRenderer` unchanged. */
    14	  format?: MetricFormat | null;
    15	  /** Fetched snapshot rows (string cells, aligned to `headers`) — one row per
    16	   *  rendered item, the table fetch path. */
    17	  rawRows?: string[][] | null;
    18	  /** Column names aligned to each `rawRows` row. */
    19	  headers?: string[] | null;
    20	  /** HEL-1307 -- threshold rules; each item evaluates them against its own raw value. */
    21	  conditionalFormats?: ConditionalFormatRule[] | null;
    22	}
    23	
    24	/** Map one fetched row to a metric item's `MappedPanelData` (HEL-247 D4).
    25	 *  Each `fieldMapping` slot (value/label/unit) resolves to that row's cell for
    26	 *  the mapped column; literal `itemOptions.metric` overrides win over the bound
    27	 *  slot on every item (HEL-243 literal-wins semantics). */
    28	function buildMetricItem(
    29	  row: string[],
    30	  headers: string[],
    31	  fieldMapping: Record<string, string>,
    32	  metricOptions: { label?: string; unit?: string } | undefined,
    33	): MappedPanelData {
    34	  const item: MappedPanelData = {};
    35	  for (const [slot, column] of Object.entries(fieldMapping)) {
    36	    const idx = headers.indexOf(column);
    37	    item[slot] = idx >= 0 ? (row[idx] ?? "") : "";
    38	  }
    39	  if (metricOptions?.label) item.label = metricOptions.label;
    40	  if (metricOptions?.unit) item.unit = metricOptions.unit;
    41	  return item;
    42	}
    43	
    44	/** Collection body — expands one bound row into one homogeneous item (HEL-247).
    45	 *  v1 ships the `metric` base type only: each item reuses `MetricRenderer` so it
    46	 *  gets the exact Metric visual language. Grid layout wraps responsively (no
    47	 *  horizontal overflow at 390px); list layout is a single divided column. */
    48	export function CollectionRenderer({
    49	  fieldMapping,
    50	  layout,
    51	  metricOptions,
    52	  format,
    53	  rawRows,
    54	  headers,
    55	  conditionalFormats,
    56	}: CollectionRendererProps) {
    57	  // Bound but no rows → "No data" state rather than an empty body.
    58	  if (!rawRows || rawRows.length === 0 || !headers) {
    59	    return (
    60	      <div className="panel-content panel-content--state">
    61	        <span className="panel-content__state-label">No data</span>
    62	      </div>
    63	    );
    64	  }
    65	
    66	  return (
    67	    <div className={`panel-content panel-content--collection panel-content--collection-${layout}`}>
    68	      {rawRows.map((row, index) => (
    69	        <div key={index} className="panel-content__collection-item">
    70	          <MetricRenderer
    71	            data={buildMetricItem(row, headers, fieldMapping, metricOptions)}
    72	            format={format}
    73	            conditionalFormats={conditionalFormats}
    74	          />
    75	        </div>
    76	      ))}
    77	    </div>
    78	  );
    79	}
```

**TimelineRenderer.tsx**
```
$ cat -n frontend/src/features/panels/ui/renderers/TimelineRenderer.tsx
     1	import "./TimelineRenderer.css";
     2	
     3	interface TimelineRendererProps {
     4	  /** Bound-column mapping from the Output's `TimelineOutputConfig`. */
     5	  fieldMapping: Record<string, string>;
     6	  sort: "asc" | "desc";
     7	  /** Fetched snapshot rows (string cells, aligned to `headers`) — one row per
     8	   *  rendered entry, the table fetch path (mirrors `CollectionRenderer`). */
     9	  rawRows?: string[][] | null;
    10	  /** Column names aligned to each `rawRows` row. */
    11	  headers?: string[] | null;
    12	}
    13	
    14	interface TimelineEntry {
    15	  time: string;
    16	  event: string;
    17	}
    18	
    19	/** Compares two `time` cell values for the chronological sort. Numeric
    20	 *  strings compare numerically; everything else (including ISO-8601
    21	 *  timestamps, which sort correctly lexically) compares as plain strings —
    22	 *  no parsing/normalization is attempted (design.md risk note: "the pipeline
    23	 *  produces the shape"). */
    24	function compareTimeValues(a: string, b: string): number {
    25	  const numA = Number(a);
    26	  const numB = Number(b);
    27	  if (a.trim() !== "" && b.trim() !== "" && Number.isFinite(numA) && Number.isFinite(numB)) {
    28	    return numA - numB;
    29	  }
    30	  return a < b ? -1 : a > b ? 1 : 0;
    31	}
    32	
    33	/** Map fetched rows to `{ time, event }` entries using the bound
    34	 *  `fieldMapping.time` / `fieldMapping.event` columns, then sort
    35	 *  chronologically per `timelineOptions.sort`. */
    36	function buildEntries(
    37	  rows: string[][],
    38	  headers: string[],
    39	  fieldMapping: Record<string, string>,
    40	  sort: "asc" | "desc",
    41	): TimelineEntry[] {
    42	  const timeCol = fieldMapping.time ? headers.indexOf(fieldMapping.time) : -1;
    43	  const eventCol = fieldMapping.event ? headers.indexOf(fieldMapping.event) : -1;
    44	
    45	  const entries = rows.map((row) => ({
    46	    time: timeCol >= 0 ? (row[timeCol] ?? "") : "",
    47	    event: eventCol >= 0 ? (row[eventCol] ?? "") : "",
    48	  }));
    49	
    50	  const sorted = [...entries].sort((a, b) => compareTimeValues(a.time, b.time));
    51	  return sort === "desc" ? sorted.reverse() : sorted;
    52	}
    53	
    54	/** Timeline body — renders bound rows as a vertical, chronologically ordered
    55	 *  event list (HEL-317): one marker + connector + time + description per
    56	 *  entry, ordered per `timelineOptions.sort`. The trailing connector is
    57	 *  suppressed on the last entry so a single row degrades cleanly. */
    58	export function TimelineRenderer({ fieldMapping, sort, rawRows, headers }: TimelineRendererProps) {
    59	  // No rows → "No data" state rather than an empty body.
    60	  if (!rawRows || rawRows.length === 0 || !headers) {
    61	    return (
    62	      <div className="panel-content panel-content--state">
    63	        <span className="panel-content__state-label">No data</span>
    64	      </div>
    65	    );
    66	  }
    67	
    68	  const entries = buildEntries(rawRows, headers, fieldMapping, sort);
    69	
    70	  return (
    71	    <div className="panel-content panel-content--timeline">
    72	      <ol className="panel-content__timeline-list">
    73	        {entries.map((entry, index) => (
    74	          <li
    75	            key={index}
    76	            className={`panel-content__timeline-entry${
    77	              index === entries.length - 1 ? " panel-content__timeline-entry--last" : ""
    78	            }`}
    79	          >
    80	            <span className="panel-content__timeline-marker" aria-hidden="true" />
    81	            <div className="panel-content__timeline-body">
    82	              <span className="panel-content__timeline-time">{entry.time}</span>
    83	              <span className="panel-content__timeline-event">{entry.event}</span>
    84	            </div>
    85	          </li>
    86	        ))}
    87	      </ol>
    88	    </div>
    89	  );
    90	}
```

**LegacyOutputConfigKeys**
```
$ grep -n -i -E 'baseType|itemOptions|timelineOptions|collection|timeline' backend/src/main/scala/com/helio/services/pipelines/LegacyOutputConfigKeys.scala | head -20
24:    "metricLabel", "metricUnit", "chartAnnotation", "collectionOptions", "timelineOptions",
32:    "format"       -> Set[OutputKind](OutputKind.Metric, OutputKind.Collection),
42:    "collectionOptions" -> ((OutputKind.Collection, "layout")),
43:    "timelineOptions"   -> ((OutputKind.Timeline, "sort"))
49:    case ("collectionOptions", JsString("grid" | "list")) => true
50:    case ("timelineOptions", JsString("asc" | "desc"))    => true
```

**readCollectionConfig / readTimelineConfig**
```
$ grep -rn -E 'function readCollectionConfig|function readTimelineConfig' frontend/src | grep -v test
frontend/src/features/pipelines/ui/outputEditor/outputConfigTypes.ts:358:export function readCollectionConfig(config: Record<string, unknown>): CollectionOutputConfig {
frontend/src/features/pipelines/ui/outputEditor/outputConfigTypes.ts:367:export function readTimelineConfig(config: Record<string, unknown>): TimelineOutputConfig {
```

**metricOptions passed by any non-test caller?**
```
$ grep -rn 'metricOptions' frontend/src | grep -v -E '\.test\.' ; echo ---tests; grep -rn 'metricOptions' frontend/src | grep -E '\.test\.' | head
frontend/src/features/panels/ui/renderers/CollectionRenderer.tsx:11:  metricOptions?: { label?: string; unit?: string };
frontend/src/features/panels/ui/renderers/CollectionRenderer.tsx:32:  metricOptions: { label?: string; unit?: string } | undefined,
frontend/src/features/panels/ui/renderers/CollectionRenderer.tsx:39:  if (metricOptions?.label) item.label = metricOptions.label;
frontend/src/features/panels/ui/renderers/CollectionRenderer.tsx:40:  if (metricOptions?.unit) item.unit = metricOptions.unit;
frontend/src/features/panels/ui/renderers/CollectionRenderer.tsx:51:  metricOptions,
frontend/src/features/panels/ui/renderers/CollectionRenderer.tsx:71:            data={buildMetricItem(row, headers, fieldMapping, metricOptions)}
---tests
frontend/src/features/panels/ui/renderers/MetricRenderer.duration.test.tsx:103:        metricOptions={{ unit: "s" }}
frontend/src/features/panels/ui/renderers/CollectionRenderer.test.tsx:34:  it("applies a literal metricOptions.unit to every item", () => {
frontend/src/features/panels/ui/renderers/CollectionRenderer.test.tsx:39:        metricOptions={{ unit: "$" }}
```

**outputConfigTypes collection/timeline config shapes**
```
$ sed -n 165,200p frontend/src/features/pipelines/ui/outputEditor/outputConfigTypes.ts; sed -n 340,385p frontend/src/features/pipelines/ui/outputEditor/outputConfigTypes.ts
   *  write `[]`, never omit the key (shallow merge). */
  conditionalFormats?: ConditionalFormatRule[];
}

export interface MarkdownOutputConfig {
  content: string;
  fieldMapping: Record<string, string>;
}

export interface CollectionOutputConfig {
  fieldMapping: Record<string, string>;
  layout: "grid" | "list";
  /** `baseType: metric` items' numeric display style (HEL-876) — same
   *  semantics/values as `MetricOutputConfig.format`, applied per-item via
   *  `CollectionRenderer`'s `MetricRenderer` reuse. */
  format?: MetricFormat | null;
  /** HEL-1307 -- ordered threshold rules (first match wins); flat sibling like every key here. A clear MUST
   *  write `[]`, never omit the key (shallow merge). */
  conditionalFormats?: ConditionalFormatRule[];
}

export interface TimelineOutputConfig {
  fieldMapping: Record<string, string>;
  sort: "asc" | "desc";
}

export function isAggFn(value: string): value is AggFn {
  return (
    value === "count" || value === "sum" || value === "avg" || value === "min" || value === "max"
  );
}

/** Column options for a bound field-select, derived from capabilities-at-node
 *  (task 5.1/5.2) instead of a DataType's fields/computedFields. */
export function columnOptions(capabilities: NodeCapabilities | undefined): SelectOption[] {
  if (!capabilities) return [];
  return {
    fieldMapping: safeRecord(config.fieldMapping),
    aggregation: (config.aggregation as MetricAggregation | null | undefined) ?? null,
    label: typeof config.label === "string" ? config.label : undefined,
    unit: typeof config.unit === "string" ? config.unit : undefined,
    format: isMetricFormat(config.format) ? config.format : null,
    compare: typeof config.compare === "string" ? config.compare : null,
    ...formatsField(config.conditionalFormats, "metric"),
  };
}

export function readMarkdownConfig(config: Record<string, unknown>): MarkdownOutputConfig {
  return {
    content: safeString(config.content),
    fieldMapping: safeRecord(config.fieldMapping),
  };
}

export function readCollectionConfig(config: Record<string, unknown>): CollectionOutputConfig {
  return {
    fieldMapping: safeRecord(config.fieldMapping),
    layout: config.layout === "list" ? "list" : "grid",
    format: isMetricFormat(config.format) ? config.format : null,
    ...formatsField(config.conditionalFormats, "collection"),
```

**Output editor: collection/timeline editing**
```
$ ls frontend/src/features/pipelines/ui/outputEditor/ ; grep -n -i -E 'collection|timeline' frontend/src/features/pipelines/ui/outputEditor/OutputEditorSheet.tsx | head -20
buildOutputConfig.test.ts
buildOutputConfig.ts
ChartCompareField.tsx
ChartSlotFields.tsx
compareOptions.ts
ConditionalFormatsField.seam.test.tsx
ConditionalFormatsField.test.tsx
ConditionalFormatsField.tsx
configPatch.ts
durationFormat.seam.test.ts
formatHistoryPayloadLimits.test.ts
formatHistoryPayloadLimits.ts
HistogramBinCountField.tsx
HistoryPayloadsField.tsx
outputConfigTypes.conditionalFormats.test.ts
outputConfigTypes.hel1410.test.ts
outputConfigTypes.test.ts
outputConfigTypes.ts
OutputEditorFooter.test.tsx
OutputEditorFooter.tsx
OutputEditorSheet.compare.test.tsx
OutputEditorSheet.configPatch.test.tsx
OutputEditorSheet.css
OutputEditorSheet.duration.test.tsx
OutputEditorSheet.fieldTypes.test.tsx
OutputEditorSheet.heatmapHistogram.test.tsx
OutputEditorSheet.history.test.tsx
OutputEditorSheet.kindLock.test.tsx
OutputEditorSheet.labels.test.tsx
OutputEditorSheet.openingState.test.tsx
OutputEditorSheet.referenceMarks.test.tsx
OutputEditorSheet.saveError.test.tsx
OutputEditorSheet.scatterPickers.test.tsx
OutputEditorSheet.test.tsx
OutputEditorSheet.tsx
OutputKindConfigCard.tsx
OutputKindFields.tsx
OutputPlacementsList.tsx
OutputPreviewPane.tsx
OutputSheetPreviewCard.tsx
referenceMarksDraft.test.ts
referenceMarksDraft.ts
ReferenceMarksField.tsx
referenceMarksSeam.test.ts
__snapshots__
useOutputColumnFormats.test.ts
useOutputColumnFormats.ts
useOutputConditionalFormats.ts
useOutputKindState.ts
useOutputSavedStatus.ts
useOutputTableColumns.test.ts
useOutputTableColumns.ts
51:  { value: "collection", label: "Collection" },
52:  { value: "timeline", label: "Timeline" },
145:    (kind === "metric" || kind === "collection" || kind === "table") &&
```

**OutputKindFields collection/timeline UI**
```
$ grep -n -i -E 'collection|timeline|layout|sort|grid|list|slot|label|unit|bound' frontend/src/features/pipelines/ui/outputEditor/OutputKindFields.tsx | head -60
5:// capabilities-at-node column options instead of a bound DataType's fields
8:// `DataType` entities, so the metric-kind slot below is just the field+reduce
9:// value control plus label/unit, matching design.md decision 3's "collapse
10:// into the sheet's metric-kind slot".
19:import { BoundOrLiteralField } from "../../../panels/ui/editors/BoundOrLiteralField";
20:import type { BoundOrLiteralState } from "../../../panels/ui/editors/useBoundOrLiteralState";
30:import { ChartSlotFields } from "./ChartSlotFields";
41:  { value: "line", label: "Line" },
42:  { value: "bar", label: "Bar" },
43:  { value: "pie", label: "Pie" },
44:  { value: "scatter", label: "Scatter" },
45:  { value: "heatmap", label: "Heatmap" },
46:  { value: "histogram", label: "Histogram" },
67:  /** HEL-1311: the stored `fieldMapping` and its setter (heatmap / histogram slot pickers only). */
69:  onChartFieldChange: (slot: string, value: string) => void;
75:  annotationState: BoundOrLiteralState;
127:        <label className="output-editor-sheet__data-label" htmlFor="output-chart-type">
129:        </label>
132:          ariaLabel="Chart type"
139:        <ChartSlotFields
149:          <span className="output-editor-sheet__data-label">Aggregation</span>
187:        isBound={fieldOptions.length > 0}
254:  { value: "number", label: "Number" },
255:  { value: "integer", label: "Integer" },
256:  { value: "currency", label: "Currency ($)" },
257:  { value: "percent", label: "Percent (%)" },
258:  { value: "duration", label: "Duration" },
259:  { value: "durationMs", label: "Duration (ms)" },
268:  labelState: BoundOrLiteralState;
269:  unitState: BoundOrLiteralState;
285:  labelState,
286:  unitState,
302:        <label className="output-editor-sheet__data-label" htmlFor="output-metric-format">
304:        </label>
307:          ariaLabel="Format"
314:        <span className="output-editor-sheet__data-label">Compare</span>
316:          ariaLabel="Compare"
323:        <span className="output-editor-sheet__data-label">Label &amp; Unit</span>
324:        <BoundOrLiteralField
325:          label="Label"
326:          mode={labelState.mode}
327:          onModeChange={labelState.setMode}
329:          fieldValue={labelState.fieldValue}
330:          onFieldChange={labelState.setFieldValue}
331:          literalValue={labelState.literalValue}
332:          onLiteralChange={labelState.setLiteralValue}
335:        <BoundOrLiteralField
336:          label="Unit"
337:          mode={unitState.mode}
338:          onModeChange={unitState.setMode}
340:          fieldValue={unitState.fieldValue}
341:          onFieldChange={unitState.setFieldValue}
342:          literalValue={unitState.literalValue}
343:          onLiteralChange={unitState.setLiteralValue}
357: *  (HEL-1139): `OutputBindingSpec.Markdown` declares no fieldMapping slots
359: *  binding. Data-bound narrative text is HEL-921's planned `insight` kind. */
364:        <span className="panel-detail-modal__mapping-label">Content</span>
369:          aria-label="Content text"
379:  slots: { key: string; label: string }[];
381:  onFieldChange: (slotKey: string, value: string) => void;
```

**OutputKindConfigCard collection/timeline**
```
$ grep -n -i -E 'collection|timeline' frontend/src/features/pipelines/ui/outputEditor/OutputKindConfigCard.tsx frontend/src/features/pipelines/ui/outputEditor/useOutputKindState.ts frontend/src/features/pipelines/ui/outputEditor/buildOutputConfig.ts | head -30
frontend/src/features/pipelines/ui/outputEditor/OutputKindConfigCard.tsx:75:    collectionFieldMapping,
frontend/src/features/pipelines/ui/outputEditor/OutputKindConfigCard.tsx:76:    setCollectionFieldMapping,
frontend/src/features/pipelines/ui/outputEditor/OutputKindConfigCard.tsx:77:    collectionFormat,
frontend/src/features/pipelines/ui/outputEditor/OutputKindConfigCard.tsx:78:    setCollectionFormat,
frontend/src/features/pipelines/ui/outputEditor/OutputKindConfigCard.tsx:79:    timelineFieldMapping,
frontend/src/features/pipelines/ui/outputEditor/OutputKindConfigCard.tsx:80:    setTimelineFieldMapping,
frontend/src/features/pipelines/ui/outputEditor/OutputKindConfigCard.tsx:180:      {kind === "collection" && (
frontend/src/features/pipelines/ui/outputEditor/OutputKindConfigCard.tsx:189:            fieldMapping={collectionFieldMapping}
frontend/src/features/pipelines/ui/outputEditor/OutputKindConfigCard.tsx:190:            onFieldChange={(k, v) => setCollectionFieldMapping((prev) => ({ ...prev, [k]: v }))}
frontend/src/features/pipelines/ui/outputEditor/OutputKindConfigCard.tsx:194:            <label className="output-editor-sheet__data-label" htmlFor="output-collection-format">
frontend/src/features/pipelines/ui/outputEditor/OutputKindConfigCard.tsx:198:              id="output-collection-format"
frontend/src/features/pipelines/ui/outputEditor/OutputKindConfigCard.tsx:200:              value={collectionFormat}
frontend/src/features/pipelines/ui/outputEditor/OutputKindConfigCard.tsx:201:              onChange={setCollectionFormat}
frontend/src/features/pipelines/ui/outputEditor/OutputKindConfigCard.tsx:206:            kind="collection"
frontend/src/features/pipelines/ui/outputEditor/OutputKindConfigCard.tsx:212:      {kind === "timeline" && (
frontend/src/features/pipelines/ui/outputEditor/OutputKindConfigCard.tsx:214:          title="Timeline fields"
frontend/src/features/pipelines/ui/outputEditor/OutputKindConfigCard.tsx:219:          fieldMapping={timelineFieldMapping}
frontend/src/features/pipelines/ui/outputEditor/OutputKindConfigCard.tsx:220:          onFieldChange={(k, v) => setTimelineFieldMapping((prev) => ({ ...prev, [k]: v }))}
frontend/src/features/pipelines/ui/outputEditor/useOutputKindState.ts:67:  // Metric / collection / table threshold rules (HEL-1307)
frontend/src/features/pipelines/ui/outputEditor/useOutputKindState.ts:72:  // Collection / Timeline
frontend/src/features/pipelines/ui/outputEditor/useOutputKindState.ts:73:  collectionFieldMapping: Record<string, string>;
frontend/src/features/pipelines/ui/outputEditor/useOutputKindState.ts:74:  setCollectionFieldMapping: (
frontend/src/features/pipelines/ui/outputEditor/useOutputKindState.ts:77:  timelineFieldMapping: Record<string, string>;
frontend/src/features/pipelines/ui/outputEditor/useOutputKindState.ts:78:  setTimelineFieldMapping: (
frontend/src/features/pipelines/ui/outputEditor/useOutputKindState.ts:81:  collectionFormat: string;
frontend/src/features/pipelines/ui/outputEditor/useOutputKindState.ts:82:  setCollectionFormat: (v: string) => void;
frontend/src/features/pipelines/ui/outputEditor/useOutputKindState.ts:88:  return kind === "metric" || kind === "collection" || kind === "table";
frontend/src/features/pipelines/ui/outputEditor/useOutputKindState.ts:164:  // Collection / Timeline (lighter-weight slots -- task 5.1)
frontend/src/features/pipelines/ui/outputEditor/useOutputKindState.ts:165:  const [collectionFieldMapping, setCollectionFieldMapping] = useState(seed.collectionFieldMapping);
frontend/src/features/pipelines/ui/outputEditor/useOutputKindState.ts:166:  const [timelineFieldMapping, setTimelineFieldMapping] = useState(seed.timelineFieldMapping);
```

**buildOutputConfig collection/timeline**
```
$ grep -n -i -B1 -A12 'collection' frontend/src/features/pipelines/ui/outputEditor/buildOutputConfig.ts | sed -n 1,70p
54-  metricUnitState: BoundOrLiteralValue;
55:  // HEL-876 — numeric display style, shared by metric and collection (metric baseType).
56-  metricFormat: string;
57-  // HEL-1275/HEL-1350 — the Compare picker's value (metric and chart kinds): `"none"` or a
58-  // `config.compare` token (including a pre-existing `previous_run`/`custom:<duration>`, kept verbatim).
59-  compare: string;
60-  // Markdown
61-  markdownContent: string;
62:  // Collection / Timeline
63:  collectionFieldMapping: Record<string, string>;
64:  collectionFormat: string;
65-  timelineFieldMapping: Record<string, string>;
66:  // HEL-1307 -- metric / collection / table threshold rules. Emitted only when there are rules or the stored
67-  // config already had the key (`conditionalFormatsStored`, then `[]` clears -- an omitted key would keep
68-  // the old rules through the shallow config merge), so Outputs without rules build byte-identical configs.
69-  conditionalFormats?: ConditionalFormatRule[];
70-  conditionalFormatsStored?: boolean;
71-}
72-
73-/** HEL-1307 -- the `conditionalFormats` entry of a kind's config, or nothing. */
74-function conditionalFormatsEntry(
75-  params: Pick<BuildOutputConfigParams, "conditionalFormats" | "conditionalFormatsStored">,
76-): { conditionalFormats?: ConditionalFormatRule[] } {
77-  const rules = params.conditionalFormats ?? [];
78-  return rules.length > 0 || params.conditionalFormatsStored ? { conditionalFormats: rules } : {};
--
166-      return { content: params.markdownContent, fieldMapping: {} };
167:    case "collection":
168-      return {
169:        fieldMapping: params.collectionFieldMapping,
170-        layout: "grid",
171:        format: readFormatOrNull(params.collectionFormat),
172-        ...conditionalFormatsEntry(params),
173-      };
174-    case "timeline":
175-      return { fieldMapping: params.timelineFieldMapping, sort: "asc" };
176-    default:
177-      return {};
178-  }
179-}
180-
181-/** task 5.6 -- "Add as tail with aggregate": whether the sheet's currently
182- *  configured chart/metric aggregation fields are complete enough to attach
183- *  as a new `aggregate` pipeline step (design.md decision 5). Only chart and
```

**layout/sort controls anywhere in non-test frontend (grid/list, asc/desc)?**
```
$ grep -rn -E '"list"|layout: *"|sort: *"(asc|desc)"' frontend/src --include=*.tsx --include=*.ts | grep -v -E '\.test\.|/test/' | grep -i -E 'collection|timeline|layout' | head
frontend/src/features/panels/ui/renderers/CollectionRenderer.tsx:10:  layout: "grid" | "list";
frontend/src/features/panels/ui/renderers/TimelineRenderer.tsx:6:  sort: "asc" | "desc";
frontend/src/features/panels/ui/renderers/TimelineRenderer.tsx:40:  sort: "asc" | "desc",
frontend/src/features/pipelines/ui/outputEditor/outputConfigTypes.ts:176:  layout: "grid" | "list";
frontend/src/features/pipelines/ui/outputEditor/outputConfigTypes.ts:361:    layout: config.layout === "list" ? "list" : "grid",
frontend/src/features/pipelines/ui/outputEditor/buildOutputConfig.ts:170:        layout: "grid",
frontend/src/features/pipelines/ui/outputEditor/buildOutputConfig.ts:175:      return { fieldMapping: params.timelineFieldMapping, sort: "asc" };
```

**Collection/timeline slots in backend OutputBindingSpec**
```
$ grep -n -i -B2 -A8 -E 'Collection|Timeline' backend/src/main/scala/com/helio/domain/panels/OutputBindingSpec.scala | sed -n 1,60p
10- *  `Numeric` accepts `integer`/`float` (a metric `value` / chart `yAxis`
11- *  needs a summable column); `Orderable` accepts `timestamp`/`integer`/
12: *  `float` (a timeline `time` needs something sortable); `Any` accepts
13- *  every column (`label`/`unit`/`xAxis`/`series`/`annotation`/`event`). */
14-sealed trait SlotEligibility
15-object SlotEligibility {
16-  case object Numeric   extends SlotEligibility
17-  case object Orderable extends SlotEligibility
18-  case object Any        extends SlotEligibility
19-
20-  def accepts(eligibility: SlotEligibility, fieldType: DataFieldType): Boolean = eligibility match {
--
82-    OutputBindingSpec(OutputKind.Table, Vector.empty, Vector.empty, Map.empty)
83-
84:  // collection → the metric slot set, applied per bound row — carried over
85:  // verbatim from `PanelBindingSpec.Collection`.
86:  val Collection: OutputBindingSpec = Metric.copy(outputKind = OutputKind.Collection)
87-
88:  // timeline → {time, event}, both required — carried over verbatim from
89:  // `PanelBindingSpec.Timeline`.
90:  val Timeline: OutputBindingSpec = OutputBindingSpec(
91:    outputKind        = OutputKind.Timeline,
92-    requiredSlots     = Vector("time", "event"),
93-    optionalSlots     = Vector.empty,
94-    columnEligibility = Map("time" -> Orderable, "event" -> Any)
95-  )
96-
97-  // markdown → no fieldMapping slots and no data binding of any kind: a
98-  // markdown Output's text is the literal `config.content`, and
99-  // `validateFieldMapping` below rejects every `fieldMapping` key for this
--
109-   *  the fixed order the response is built from — successor to
110-   *  `PanelBindingSpec.DataBindable`. */
111:  val All: Vector[OutputBindingSpec] = Vector(Metric, Chart, Table, Collection, Timeline, Markdown)
112-
113-  /** `bindable = false` reason emitted by [[evaluate]] — mirrors
114-   *  `PanelBindingSpec.MissingColumnsReason` verbatim. */
115-  val MissingColumnsReason: String = "missing-required-column-type"
116-
117-  /** Result of evaluating one [[OutputBindingSpec]] against a concrete
118-   *  column set — mirrors `PanelBindingSpec.BindabilityResult`. */
119-  final case class BindabilityResult(
```

**OutputKindConfigCard collection+timeline blocks**
```
$ sed -n 176,232p frontend/src/features/pipelines/ui/outputEditor/OutputKindConfigCard.tsx
      )}
      {kind === "markdown" && (
        <MarkdownKindFields content={markdownContent} onContentChange={setMarkdownContent} />
      )}
      {kind === "collection" && (
        <>
          <SimpleMappingFields
            title="Item fields"
            slots={[
              { key: "value", label: "Value" },
              { key: "label", label: "Label" },
              { key: "unit", label: "Unit" },
            ]}
            fieldMapping={collectionFieldMapping}
            onFieldChange={(k, v) => setCollectionFieldMapping((prev) => ({ ...prev, [k]: v }))}
            fieldOptions={fieldOptions}
          />
          <div className="output-editor-sheet__data-section">
            <label className="output-editor-sheet__data-label" htmlFor="output-collection-format">
              Format
            </label>
            <Select
              id="output-collection-format"
              ariaLabel="Format"
              value={collectionFormat}
              onChange={setCollectionFormat}
              options={METRIC_FORMAT_OPTIONS}
            />
          </div>
          <ConditionalFormatsField
            kind="collection"
            state={conditionalFormats}
            columnOptions={fieldOptions}
          />
        </>
      )}
      {kind === "timeline" && (
        <SimpleMappingFields
          title="Timeline fields"
          slots={[
            { key: "time", label: "Time" },
            { key: "event", label: "Event" },
          ]}
          fieldMapping={timelineFieldMapping}
          onFieldChange={(k, v) => setTimelineFieldMapping((prev) => ({ ...prev, [k]: v }))}
          fieldOptions={fieldOptions}
        />
      )}
    </div>
  );
}
```

**Backend KnownKeys all kinds**
```
$ sed -n 18,34p backend/src/main/scala/com/helio/services/pipelines/OutputConfigValidation.scala
object OutputConfigValidation {

  private val Shared = Set("fieldMapping", "compare", "historyPayloads")

  val KnownKeys: Map[OutputKind, Set[String]] = Map(
    OutputKind.Chart      -> (Shared ++ Set("chartType", "aggregation", "chartOptions", "annotation", ChartReferenceMarks.LinesKey, ChartReferenceMarks.BandsKey)),
    OutputKind.Metric     -> (Shared ++ Set("aggregation", "label", "unit", "format", "conditionalFormats")),
    OutputKind.Table      -> (Shared ++ Set("columnOrder", "columnFormats", "columnSort", "columnFilters", "pinnedColumns", "conditionalFormats")),
    OutputKind.Collection -> (Shared ++ Set("layout", "format", "conditionalFormats")),
    OutputKind.Timeline   -> (Shared ++ Set("sort")),
    OutputKind.Markdown   -> (Shared ++ Set("content"))
  )

  private val Aggs       = Set("count", "sum", "avg", "min", "max")
  private val HistogramBinMin = 2
  private val HistogramBinMax = 100
```

**baseType/itemOptions removed by V117 migration**
```
$ sed -n 1,40p backend/src/main/resources/db/migration/V117__migrate_v94_dead_output_config_keys.sql
-- HEL-1387: repair the dead Output `config` keys that migration V94 (HEL-904) and HEL-877 left behind.
-- Nothing reads them, so Outputs migrated from panels silently lost their label, unit, annotation, timeline sort
-- and collection layout. HEL-1313 rejects writing these keys but tolerates stored ones; this migration repairs the
-- stored data. Owner rulings (2026-10-08): rename where a live equivalent exists (null live key counts as absent),
-- drop the rest, drop V94's wrong-kind keys too, and keep a permanent audit table.
--
-- Mapping (a dead key is dead whatever the Output's id; "live key" must be accepted by the kind):
--
--   dead key                          kinds renamed        live key   rename only if the value is        otherwise
--   metricLabel                       metric               label      a JSON string                      drop
--   metricUnit                        metric               unit       a JSON string                      drop
--   chartAnnotation                   chart                annotation a JSON string                      drop
--   collectionOptions.layout          collection           layout     "grid" or "list"                   drop
--   timelineOptions.sort              timeline             sort       "asc" or "desc"                    drop
--   collectionOptions (whole object)  -                    none       -                                  drop (baseType/itemOptions kept in audit)
--   timelineOptions (whole object)    -                    none       -                                  drop
--   columnWidths, tableDensity        -                    none       -                                  drop
--   legend, tooltip, seriesColors,
--     axisLabels                      -                    none       -                                  drop
--   format on chart/table/timeline/markdown                none       -                                  drop
--   columnOrder on a non-table, chartOptions on a non-chart        none       -                           drop
--
-- A non-null live key is never overwritten. A renamed key is written only when the live key is absent or JSON null.
-- Exactly one audit row is written per removed top-level key (config_value = the full original value of that key),
-- with `action` the first match of: kind-inapplicable, no-live-equivalent, null-value, invalid-value,
-- shadowed-by-live, renamed. `live_key` is set only for `renamed`. `updated_at` is deliberately untouched.
--
-- RLS: `outputs` has FORCE ROW LEVEL SECURITY with missing_ok policies, so an UPDATE by Flyway's `helio` connection
-- (table owner, NOBYPASSRLS, no app.current_user_id) would match zero rows SILENTLY. The bracket below (NO FORCE
-- ... FORCE) is mandatory; the in-migration guard cannot see its absence (it shares the same RLS state), so the spec
-- counts dead keys over a superuser connection. Do not set app.current_user_id and do not use BYPASSRLS.
--
-- Idempotent: the DO block only touches rows that still carry a dead key; every other statement is re-runnable.
-- Additive only -- never edit this file once applied (Flyway checksums comments too).

-- ── 1. Open the migration-context bracket ───────────────────────────────────
ALTER TABLE outputs NO FORCE ROW LEVEL SECURITY;

-- ── 2. Audit table (admin-only: it holds user config values) ────────────────
CREATE TABLE IF NOT EXISTS hel1387_dropped_output_config_keys (
```

**trend in non-test frontend source**
```
$ grep -rn -i 'trend' frontend/src --include=*.ts --include=*.tsx --include=*.css | grep -v -E '\.test\.' | head -40
frontend/src/utils/chartTimePlan.ts:2:// (`buildChartOption`) and the footnote (`ChartRenderer`) both call `resolveChartPlan`, so the axis a chart
frontend/src/utils/chartClickSelection.ts:6:// echarts chunk into the main bundle — see `ChartRenderer.tsx`'s own
frontend/src/features/panels/ui/buildChartOption.ts:136:  // `ChartRenderer` also calls for its "rows not shown" footnote, so the two can never disagree.
frontend/src/features/panels/ui/ChartOutputPanel.tsx:18:import { ChartRenderer } from "./renderers/ChartRenderer";
frontend/src/features/panels/ui/ChartOutputPanel.tsx:42:  /** HEL-1358: precomputed truncation note, forwarded to `ChartRenderer`. */
frontend/src/features/panels/ui/ChartOutputPanel.tsx:50: *  `ChartRenderer` the labelled "vs" overlay when it is valid for what this panel plots. A separate
frontend/src/features/panels/ui/ChartOutputPanel.tsx:142:    <ChartRenderer
frontend/src/features/panels/ui/renderers/MetricRenderer.tsx:17:   *  marker). The legacy `data.trend` string path below is unchanged and wins when both are set. */
frontend/src/features/panels/ui/renderers/MetricRenderer.tsx:118:      className={`panel-content__metric-trend panel-content__metric-trend--${comparison.direction}`}
frontend/src/features/panels/ui/renderers/MetricRenderer.tsx:134:  const trend = data?.trend;
frontend/src/features/panels/ui/renderers/MetricRenderer.tsx:135:  const trendDirectionClass = trend
frontend/src/features/panels/ui/renderers/MetricRenderer.tsx:136:    ? trend.startsWith("+")
frontend/src/features/panels/ui/renderers/MetricRenderer.tsx:137:      ? "panel-content__metric-trend--up"
frontend/src/features/panels/ui/renderers/MetricRenderer.tsx:138:      : trend.startsWith("-")
frontend/src/features/panels/ui/renderers/MetricRenderer.tsx:139:        ? "panel-content__metric-trend--down"
frontend/src/features/panels/ui/renderers/MetricRenderer.tsx:140:        : "panel-content__metric-trend--flat"
frontend/src/features/panels/ui/renderers/MetricRenderer.tsx:181:      {trend && (
frontend/src/features/panels/ui/renderers/MetricRenderer.tsx:182:        <span className={`panel-content__metric-trend ${trendDirectionClass}`}>{trend}</span>
frontend/src/features/panels/ui/renderers/MetricRenderer.tsx:184:      {((!trend && comparison) || (sparkline && sparkline.length >= 2)) && (
frontend/src/features/panels/ui/renderers/MetricRenderer.tsx:187:          {!trend && comparison && <ComparisonLine comparison={comparison} format={format} />}
frontend/src/features/panels/ui/renderers/MetricSparkline.tsx:25:  const trend = last > first ? "rising" : last < first ? "falling" : "flat";
frontend/src/features/panels/ui/renderers/MetricSparkline.tsx:32:      aria-label={`Trend over ${values.length} data points, ${trend}`}
frontend/src/features/panels/ui/renderers/TextRenderer.tsx:1:interface TextRendererProps {
frontend/src/features/panels/ui/renderers/TextRenderer.tsx:6:export function TextRenderer({ content }: TextRendererProps) {
frontend/src/features/panels/ui/renderers/ChartRenderer.tsx:17:// Decision 1: only this internal import becomes lazy; `ChartRenderer`'s own export/signature (and
frontend/src/features/panels/ui/renderers/ChartRenderer.tsx:21:interface ChartRendererProps {
frontend/src/features/panels/ui/renderers/ChartRenderer.tsx:60:export function ChartRenderer({
frontend/src/features/panels/ui/renderers/ChartRenderer.tsx:76:}: ChartRendererProps) {
frontend/src/features/panels/ui/PanelCardBody.tsx:44:   *  `ChartRenderer` so ECharts hides the legend and shrinks axis labels
frontend/src/features/panels/ui/PanelContent.tsx:27:import { TextRenderer } from "./renderers/TextRenderer";
frontend/src/features/panels/ui/PanelContent.tsx:67:  /** HEL-301: forwarded to `ChartRenderer` only — see `ChartPanel`'s
frontend/src/features/panels/ui/PanelContent.tsx:70:  /** HEL-572: forwarded to `ChartRenderer` (chart-kind output panels only)
frontend/src/features/panels/ui/PanelContent.tsx:237:  if (isTextPanel(panel)) return <TextRenderer content={panel.config.content} />;
frontend/src/features/panels/ui/PanelContent.css:264:.panel-content__metric-trend {
frontend/src/features/panels/ui/PanelContent.css:271:.panel-content__metric-trend--up {
frontend/src/features/panels/ui/PanelContent.css:275:.panel-content__metric-trend--down {
frontend/src/features/panels/ui/PanelContent.css:279:.panel-content__metric-trend--flat {
frontend/src/features/panels/ui/PanelContent.css:283:/* HEL-1275 — available-from / filtered-state note, muted like a trend flat state. */
frontend/src/features/panels/ui/PanelContent.css:328:  .panel-content__metric-trend {
frontend/src/features/panels/ui/PanelContent.css:364:  .panel-content__metric-trend {
```

**trend in helio-mcp / backend main**
```
$ grep -rn -i -w 'trend' backend/src/main helio-mcp/src schemas | head -8
backend/src/main/scala/com/helio/services/firstrun/PersonaTemplates.scala:37:        trend  <- FirstRunPlanner.timeSeriesChain(series.title, series.timeField, series.granularity, series.measure, series.fn, series.chartType, parent)
backend/src/main/scala/com/helio/services/firstrun/PersonaTemplates.scala:40:        val chains: Vector[Chain] = Vector(table, trend, ranked)
```

**MetricRenderer trend/comparison**
```
$ sed -n 1,30p frontend/src/features/panels/ui/renderers/MetricRenderer.tsx; sed -n 100,145p frontend/src/features/panels/ui/renderers/MetricRenderer.tsx; sed -n 176,195p frontend/src/features/panels/ui/renderers/MetricRenderer.tsx
import { useId } from "react";

import type { MappedPanelData } from "../../types/panel";
import type { MetricFormat } from "../../../pipelines/ui/outputEditor/outputConfigTypes";
import { FILTERED_NOTE, type MetricComparison } from "../../history/metricHistoryView";
import { formatDuration } from "./formatDuration";
import { MetricSparkline } from "./MetricSparkline";
import { resolveRule, ruleName, type ConditionalFormatRule } from "./conditionalFormatting";
import { ToneGlyph, ToneSrText } from "./ToneGlyph";

interface MetricRendererProps {
  data?: MappedPanelData | null;
  /** Numeric display style (HEL-876) — `undefined`/`"number"` is the
   *  pre-HEL-876 default (2 max fraction digits, no grouping). */
  format?: MetricFormat | null;
  /** HEL-1275 — structured comparison from stored history (delta / available-from / filtered
   *  marker). The legacy `data.trend` string path below is unchanged and wins when both are set. */
  comparison?: MetricComparison | null;
  /** HEL-1275 — values oldest to newest; rendered only with at least two. */
  sparkline?: number[] | null;
  /** HEL-1307 -- threshold rules (first match wins) evaluated against the RAW `data.value`. `undefined`,
   *  `null` and `[]` render exactly as before. */
  conditionalFormats?: ConditionalFormatRule[] | null;
}

/** Cap the metric value slot's rendered decimal precision at 2 fraction digits (no thousands
 *  grouping) so a long/repeating decimal from an `avg` aggregate doesn't overflow the value slot
 *  (HEL-297; see design.md Decision 1). Empty string, non-numeric text, and non-finite results
 *  (e.g. the literal `"Infinity"`) pass through unchanged — only genuinely numeric-looking
 *  strings are reformatted. `format` (HEL-876) selects the `Intl.NumberFormat` shape applied to
      </span>
    );
  }
  if (comparison.kind === "availableFrom") {
    return (
      <span className="panel-content__metric-note">
        {comparison.label} comparison available from{" "}
        {new Date(comparison.availableFrom).toLocaleDateString()}
      </span>
    );
  }
  const magnitude =
    comparison.pct !== null
      ? `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(comparison.pct)}%`
      : (formatMetricValue(String(comparison.absDelta), format) ?? String(comparison.absDelta));
  const spokenDirection = comparison.direction === "flat" ? "unchanged" : comparison.direction;
  return (
    <span
      className={`panel-content__metric-trend panel-content__metric-trend--${comparison.direction}`}
      role="img"
      aria-label={`${spokenDirection} ${magnitude} ${comparison.words}`}
    >
      {GLYPHS[comparison.direction]} {magnitude} vs {comparison.label}
    </span>
  );
}

export function MetricRenderer({
  data,
  format,
```

**Who builds the MetricRenderer 'data' prop; can data.trend be set from fieldMapping/rows?**
```
$ grep -rn 'MetricRenderer' frontend/src --include=*.tsx | grep -v -E '\.test\.' | grep -v '^frontend/src/features/panels/ui/renderers/MetricRenderer.tsx'; grep -n -E 'data=|data:|MappedPanelData' frontend/src/features/panels/ui/MetricOutputPanel.tsx | head
frontend/src/features/panels/ui/renderers/CollectionRenderer.tsx:4:import { MetricRenderer } from "./MetricRenderer";
frontend/src/features/panels/ui/renderers/CollectionRenderer.tsx:13:   *  to each item's `MetricRenderer` unchanged. */
frontend/src/features/panels/ui/renderers/CollectionRenderer.tsx:45: *  v1 ships the `metric` base type only: each item reuses `MetricRenderer` so it
frontend/src/features/panels/ui/renderers/CollectionRenderer.tsx:70:          <MetricRenderer
frontend/src/features/panels/ui/PanelContent.tsx:25:import { MetricRenderer } from "./renderers/MetricRenderer";
frontend/src/features/panels/ui/PanelContent.tsx:253:  return <MetricRenderer data={data} />;
frontend/src/features/panels/ui/MetricOutputPanel.tsx:7:import { MetricRenderer, metricBaselineText } from "./renderers/MetricRenderer";
frontend/src/features/panels/ui/MetricOutputPanel.tsx:130:    <MetricRenderer
frontend/src/features/pipelines/ui/outputHistory/HistorySummary.tsx:2:import { formatMetricValue } from "../../../panels/ui/renderers/MetricRenderer";
frontend/src/features/pipelines/ui/outputEditor/OutputPreviewPane.tsx:6:// `MetricRenderer`) so a saved Output eventually renders identically once
frontend/src/features/pipelines/ui/outputEditor/OutputPreviewPane.tsx:26:import { MetricRenderer } from "../../../panels/ui/renderers/MetricRenderer";
frontend/src/features/pipelines/ui/outputEditor/OutputPreviewPane.tsx:163:      <MetricRenderer
3:import type { MappedPanelData } from "../types/panel";
111:  const data: MappedPanelData = { value, label: cfg.label ?? "", unit: cfg.unit ?? "" };
131:      data={data}
```

**PanelContent MetricRenderer fallback (line 240-255) and when reached**
```
$ sed -n 226,256p frontend/src/features/panels/ui/PanelContent.tsx
        onFilterChange={onFilterChange}
        totalRowCount={totalRowCount}
        filteredMetric={filteredMetric}
        output={output}
        isLoading={outputMetaLoading}
        crossFilterMode={crossFilterMode}
        viewerFilterActive={viewerFilterActive}
        historySource={historySource}
      />
    );
  }
  if (isTextPanel(panel)) return <TextRenderer content={panel.config.content} />;
  if (isMarkdownPanel(panel)) return <MarkdownRenderer content={panel.config.content} />;
  if (isImagePanel(panel)) return <ImageRenderer panel={panel} />;
  if (isDividerPanel(panel)) return <DividerRenderer panel={panel} />;
  if (isFormPanel(panel)) {
    // HEL-1085 design.md D1: dispatches to `FormRenderer`, which renders the
    // "Form not configured" placeholder itself for an empty field list. The
    // if-chain dispatcher is NOT typecheck-protected (C4), so this branch has
    // to be enumerated by hand — proven by mutation (`PanelContent.test.tsx`).
    return <FormRenderer panel={panel} />;
  }

  // Exhaustiveness fallback — this WAS unreachable when the union covered
  // only output/text/markdown/image/divider; it is reachable again the
  // moment a new kind is added without its own branch above (HEL-1083 D10 —
  // this if-chain is not typecheck-protected, unlike an exhaustive switch).
  return <MetricRenderer data={data} />;
}
```

**OutputPreviewPane MetricRenderer data**
```
$ sed -n 155,175p frontend/src/features/pipelines/ui/outputEditor/OutputPreviewPane.tsx
          ? String(first[0]?.[metricField] ?? "")
          : "";
    const data: MappedPanelData = {
      value,
      label: metricLabel ?? "",
      unit: metricUnit ?? "",
    };
    return (
      <MetricRenderer
        data={data}
        format={metricFormatValue}
        conditionalFormats={metricConditionalFormats}
      />
    );
  }

  if (kind === "markdown") {
    return (
      <div className="output-editor-sheet__data-section">
        <pre className="output-editor-sheet__field-hint output-preview-pane__markdown">
          {markdownContent || "(empty)"}
```

**Metric slots in OutputBindingSpec (value,label,unit)**
```
$ grep -n -B2 -A10 'val Metric' backend/src/main/scala/com/helio/domain/panels/OutputBindingSpec.scala | head -24
62-  // metric → {value, label?, unit?} — carried over verbatim from
63-  // `PanelBindingSpec.Metric` (same slot contract, new key).
64:  val Metric: OutputBindingSpec = OutputBindingSpec(
65-    outputKind        = OutputKind.Metric,
66-    requiredSlots     = Vector("value"),
67-    optionalSlots     = Vector("label", "unit"),
68-    columnEligibility = Map("value" -> Numeric, "label" -> Any, "unit" -> Any)
69-  )
70-
71-  // chart → {xAxis, yAxis, series?, annotation?} — carried over verbatim
72-  // from `PanelBindingSpec.Chart`.
73-  val Chart: OutputBindingSpec = OutputBindingSpec(
74-    outputKind        = OutputKind.Chart,
```

**Unit tests that set data.trend (pin)**
```
$ grep -rln 'trend' frontend/src --include=*.test.tsx | head
frontend/src/features/panels/ui/renderers/MetricRenderer.test.tsx
frontend/src/features/panels/ui/renderers/MetricRenderer.conditionalFormats.test.tsx
frontend/src/features/panels/ui/renderers/MetricRenderer.duration.test.tsx
frontend/src/features/panels/ui/PanelContent.test.tsx
```

**PanelContent: definition of data in fallback**
```
$ grep -n -E 'const data|data\b.*=' frontend/src/features/panels/ui/PanelContent.tsx | head
253:  return <MetricRenderer data={data} />;
```

**validateFieldMapping rejects unknown slots**
```
$ grep -n -B2 -A22 'def validateFieldMapping' backend/src/main/scala/com/helio/domain/panels/OutputBindingSpec.scala | head -50
158-   *  `PipelineService`'s single-call mirror, and exercised directly by
159-   *  `OutputBindingSpecSpec`. */
160:  def validateFieldMapping(spec: OutputBindingSpec, fieldMapping: Map[String, String]): Either[String, Unit] = {
161-    val validSlots  = spec.allSlots
162-    val unknownKeys = fieldMapping.keySet.diff(validSlots.toSet)
163-    val kindName    = OutputKind.asString(spec.outputKind)
164-    if (unknownKeys.isEmpty) Right(())
165-    else if (validSlots.isEmpty) Left(
166-      s"'$kindName' has no fieldMapping slots (got: ${unknownKeys.toVector.sorted.mkString(", ")}); " +
167-        "send an empty fieldMapping" +
168-        (if (spec.outputKind == OutputKind.Markdown) " (a markdown Output's text is the literal config.content)" else "")
169-    )
170-    else Left(
171-      s"Unknown fieldMapping slot(s) for '$kindName': " +
172-        s"${unknownKeys.toVector.sorted.mkString(", ")}. Valid slots: ${validSlots.mkString(", ")}"
173-    )
174-  }
175-
176-  /** HEL-907 task 1.4 — grounds a `fieldMapping`'s VALUES (column names) against the actual
177-   *  projected schema AT THE OUTPUT'S OWN NODE (`PipelineAnalyzeService.analyzeNodes` for a
178-   *  step-targeted Output; the source's own `inferredSchema` directly for a source-attached one,
179-   *  `nodeStepId: None` paired with the Output's own `rootId` — `analyzeNodes` omits the source
180-   *  itself from its per-node map, and a bare `null`/`None` `nodeStepId` with no accompanying
181-   *  root is never a valid encoding under multi-root pipelines; see
182-   *  `openspec/changes/archive/2026-09-04-multi-root-pipelines/design.md` R12/R15). A
--
191-   *  the first), mirroring `validateFieldMapping`'s own "whole problem in one round trip"
192-   *  contract. */
193:  def validateFieldMappingColumnsExist(fieldMapping: Map[String, String], schema: Vector[SchemaField]): Either[String, Unit] = {
194-    val columnNames = schema.map(_.name).toSet
195-    val missing     = fieldMapping.values.toVector.distinct.filterNot(columnNames.contains)
196-    if (missing.isEmpty) Right(())
197-    else Left(
198-      s"fieldMapping references column(s) not present at this node: ${missing.sorted.mkString(", ")}. " +
199-        s"Available columns: ${schema.map(_.name).sorted.mkString(", ")}"
200-    )
201-  }
202-}
```

**PanelContent data prop**
```
$ grep -n -w 'data' frontend/src/features/panels/ui/PanelContent.tsx | head; grep -rn '<PanelContent' frontend/src --include=*.tsx | grep -v test | head -4
31:  data?: MappedPanelData | null;
51:   *  instead of the generic "No data available" one. */
120:  data,
154:      <div className="panel-content panel-content--state" aria-label="Loading data">
182:    // plain "No data available" branch below).
205:        <span className="panel-content__state-label">No data available</span>
253:  return <MetricRenderer data={data} />;
frontend/src/features/panels/ui/detailModal/PanelDetailModal.tsx:230:            <PanelContent
frontend/src/features/panels/ui/PanelFullscreenOverlay.tsx:38:   *  feed this component's own `<PanelContent>` and must stay RAW for D7
frontend/src/features/panels/ui/PanelFullscreenOverlay.tsx:217:          <PanelContent
frontend/src/features/panels/ui/PanelCard.tsx:279:          // overlay's OWN `<PanelContent>` and must stay RAW (matching
```

**MetricRenderer.test pins data.trend & PanelContent unknown type fallback test**
```
$ grep -n 'trend' frontend/src/features/panels/ui/renderers/MetricRenderer.test.tsx | head -12; grep -n -i 'trend\|unknown\|fallback' frontend/src/features/panels/ui/PanelContent.test.tsx | head
38:  it("value + label + trend still renders all three lines (regression)", () => {
40:      <MetricRenderer data={{ value: "42", label: "Revenue", trend: "+3.2%" }} />,
44:    expect(container.querySelector(".panel-content__metric-trend")).toHaveTextContent("+3.2%");
70:describe("MetricRenderer — trend direction classes", () => {
71:  it("applies the --up class when trend starts with '+'", () => {
73:      <MetricRenderer data={{ value: "100", label: "Revenue", trend: "+3.2%" }} />,
75:    expect(container.querySelector(".panel-content__metric-trend")).toHaveClass(
76:      "panel-content__metric-trend--up",
80:  it("applies the --down class when trend starts with '-'", () => {
82:      <MetricRenderer data={{ value: "100", label: "Revenue", trend: "-1.1%" }} />,
84:    expect(container.querySelector(".panel-content__metric-trend")).toHaveClass(
85:      "panel-content__metric-trend--down",
61:// HEL-512 — `ChartPanel` is now a `React.lazy` target inside `ChartRenderer` (design.md Decision
361:// HEL-909: the metric trend indicator (`MetricRenderer`'s `data.trend`) has
363:// `trend` field and `OutputPanelContent` computes its metric `data` from
366:// asserting trend rendering via a directly-passed `data` prop tested a path
378:        panel={makeTextPanel({ config: { content: "Static fallback text" } })}
383:    expect(liveEl).toHaveTextContent("Static fallback text");
```

**data passed to PanelContent by callers**
```
$ grep -n -A14 '<PanelContent' frontend/src/features/panels/ui/detailModal/PanelDetailModal.tsx frontend/src/features/panels/ui/PanelFullscreenOverlay.tsx frontend/src/features/panels/ui/PanelCard.tsx | grep -E 'data|PanelContent' | head
frontend/src/features/panels/ui/detailModal/PanelDetailModal.tsx:230:            <PanelContent
frontend/src/features/panels/ui/detailModal/PanelDetailModal.tsx-232-              data={data}
frontend/src/features/panels/ui/PanelFullscreenOverlay.tsx:38:   *  feed this component's own `<PanelContent>` and must stay RAW for D7
frontend/src/features/panels/ui/PanelFullscreenOverlay.tsx-41-   *  through `PanelContent`/`OutputPanelContent`, so it needs the ALREADY
frontend/src/features/panels/ui/PanelFullscreenOverlay.tsx:217:          <PanelContent
frontend/src/features/panels/ui/PanelFullscreenOverlay.tsx-219-            data={data}
frontend/src/features/panels/ui/PanelCard.tsx:279:          // overlay's OWN `<PanelContent>` and must stay RAW (matching
frontend/src/features/panels/ui/PanelCard.tsx-280-          // `PanelCardBody`'s call): `OutputPanelContent` (reached via
frontend/src/features/panels/ui/PanelCard.tsx:281:          // `<PanelContent>`) is the ONE place that applies the cross-filter,
frontend/src/features/panels/ui/PanelCard.tsx-294-          // than going through `OutputPanelContent`. Without this second pair
```

**MappedPanelData type & any producer of 'trend' key**
```
$ grep -n -B2 -A6 'MappedPanelData' frontend/src/features/panels/types/panel.ts | head -20; grep -rn 'MappedPanelData' frontend/src --include=*.ts --include=*.tsx -l | grep -v test
405-}
406-
407:export type MappedPanelData = Record<string, string>;
408-
409-/** Batch update entry mirrors `PATCH /api/panels/batch` wire shape:
410- *  `{ id, title?, appearance?, kind?, config? }` where `config` (when
411- *  present) carries a typed patch determined by `kind`. */
412-export interface PanelBatchItem {
413-  id: string;
frontend/src/features/panels/types/panel.ts
frontend/src/features/panels/ui/renderers/MetricRenderer.tsx
frontend/src/features/panels/ui/renderers/CollectionRenderer.tsx
frontend/src/features/panels/ui/PanelContent.tsx
frontend/src/features/panels/ui/MetricOutputPanel.tsx
frontend/src/features/panels/hooks/usePanelData.ts
frontend/src/features/pipelines/ui/outputEditor/OutputPreviewPane.tsx
```

**Rest of PanelContent.test note on trend (361-370)**
```
$ sed -n 358,372p frontend/src/features/panels/ui/PanelContent.test.tsx
  });
});

// HEL-909: the metric trend indicator (`MetricRenderer`'s `data.trend`) has
// no surviving Output-config source — `MetricOutputConfig` carries no
// `trend` field and `OutputPanelContent` computes its metric `data` from
// the fetched Output's config + rows, never from a passed-through `data`
// prop. A genuine capability drop, not a rename — the prior describe block
// asserting trend rendering via a directly-passed `data` prop tested a path
// no output-kind panel can reach any more; deleted rather than rewritten.

// HEL-1466 — a text panel has no data binding: it renders only its own literal `config.content`.
// The former bound `data.content` path was dead (`usePanelData` always returns `data: null`) and
// removed; the tests asserting it ("displays the bound content", "bound data.content takes
// precedence") were deleted rather than rewritten.
```

**usePanelData always returns data null**
```
$ grep -n -E 'data' frontend/src/features/panels/hooks/usePanelData.ts | grep -i -E 'null|MappedPanelData' | head
25:  data: MappedPanelData | null;
338:      data: null,
367:    data: null,
```

**Comparison marker uses the trend classes; metric history spec**
```
$ sed -n 1,12p openspec/specs/metric-history-delta-ui/spec.md; grep -n -i 'metric-trend' openspec/specs/metric-history-delta-ui/spec.md | head
# metric-history-delta-ui Specification

## Purpose
How a metric Output panel presents its stored run history: the server's all-rows headline, a delta against the
Output's configured comparison, a sparkline, the filtered-state rule, the compare picker, and the provenance
"compared with" detail, on both authenticated and public dashboards.

## Requirements

### Requirement: Metric headline uses the server all-rows value when it matches the current config
A metric panel SHALL display the latest history point's server-computed value (`current.value`) as its headline
when no viewer filter is active, the history response has a non-null `current.value`, and the newest history
```

**CSS for trend font-size and breakpoints**
```
$ sed -n 262,290p frontend/src/features/panels/ui/PanelContent.css; sed -n 320,335p frontend/src/features/panels/ui/PanelContent.css; sed -n 358,370p frontend/src/features/panels/ui/PanelContent.css; grep -n -E '@container' frontend/src/features/panels/ui/PanelContent.css
}

.panel-content__metric-trend {
  font-family: var(--font-mono);
  font-size: var(--text-micro);
  color: color-mix(in srgb, currentColor 60%, transparent);
  letter-spacing: 0.02em;
}

.panel-content__metric-trend--up {
  color: var(--panel-tone-success, var(--app-success));
}

.panel-content__metric-trend--down {
  color: var(--panel-tone-error, var(--app-error));
}

.panel-content__metric-trend--flat {
  color: var(--panel-tone-muted, var(--app-text-muted));
}

/* HEL-1275 — available-from / filtered-state note, muted like a trend flat state. */
.panel-content__metric-note {
  font-family: var(--font-mono);
  font-size: var(--text-micro);
  color: var(--app-text-muted);
  letter-spacing: 0.02em;
}

  .panel-content__metric-label {
    font-size: var(--text-micro);
  }

  .panel-content__metric-unit {
    font-size: var(--text-xs);
  }

  .panel-content__metric-trend {
    font-size: var(--text-micro);
  }

  /* HEL-1275 — the default 3x2 card (~122px) is compact: keep the sparkline, reduced and inline
     beside the delta so the value, delta and footer all still fit. */
  .panel-content__metric-meta {
    flex-direction: row;
  }

  .panel-content__metric-unit {
    font-size: var(--text-base);
  }

  .panel-content__metric-trend {
    font-size: var(--text-xs);
  }
}

/* Container Query: Table compact height (< 180px) */

315:@container panel-card (max-height: 179px) {
348:@container panel-card (min-height: 280px) {
```

**CSS container query blocks 315 & 348 headers**
```
$ sed -n 312,318p frontend/src/features/panels/ui/PanelContent.css; sed -n 346,350p frontend/src/features/panels/ui/PanelContent.css

/* Container Query: Metric compact height (< 180px) */

@container panel-card (max-height: 179px) {
  .panel-content__metric-value {
    font-size: var(--text-xl);
  }
/* Container Query: Metric spacious height (>= 280px) */

@container panel-card (min-height: 280px) {
  .panel-content__metric-value {
    /* F-240: 2.5rem/40px exceeded every --text-* token (scale tops out at
```

**text token values**
```
$ grep -rn -E '^\s*--text-(micro|xs|base):' frontend/src | head -5
frontend/src/theme/theme.css:28:  --text-micro: 0.625rem; /* 10px */
frontend/src/theme/theme.css:29:  --text-xs: 0.75rem; /* 12px */
frontend/src/theme/theme.css:31:  --text-base: 1rem; /* 16px */
```

**CSS-lock test pinning trend sizes?**
```
$ grep -rln 'metric-trend' frontend/src --include=*.test.* | head
frontend/src/features/panels/ui/renderers/MetricRenderer.test.tsx
frontend/src/features/panels/ui/renderers/MetricRenderer.conditionalFormats.test.tsx
frontend/src/features/panels/ui/renderers/MetricRenderer.duration.test.tsx
frontend/src/features/panels/ui/panelCardStyle.tones.test.ts
```

**CollectionRenderer.css**
```
$ cat frontend/src/features/panels/ui/renderers/CollectionRenderer.css
/* Collection panel body (HEL-247). Overrides the base `.panel-content`
   centering so items flow from the top and the body scrolls vertically inside
   the panel on desktop (table-panel precedent). Both layouts use design tokens
   for spacing; the grid wraps responsively so there is never horizontal
   overflow — including at 390px phone width. */

/* F-038 — shared scroll-affordance recipe: every internally-scrolling panel
   body on the desktop grid (this file, `MarkdownPanel.css`, and
   `PanelContent.css`'s `.panel-content--text`/`.panel-content--table`) gets
   the SAME two pieces, verbatim, since the underlying cause is shared —
   react-grid-layout gives every panel a fixed height, so overflow content
   scrolls with zero visual hint that more exists (was `overflow-y: auto`
   and nothing else — no scrollbar styling, no fade, no indicator):
     1. A themed, always-visible thin scrollbar (`scrollbar-width`/-color`
        plus the WebKit pseudo-elements) so the region reads as "scrollable"
        even before the user touches it.
     2. A CSS-only "scroll shadow": two gradient layers that scroll WITH the
        content (`background-attachment: local`, sized/colored to match the
        panel's own surface so they cover the content, not paint over it)
        stacked on two gradient layers fixed to the viewport
        (`background-attachment: scroll`, a faint `currentColor` wash). At
        rest the local layer exactly hides the scroll layer at whichever
        edge has no more content (nothing scrolled past); scrolling reveals
        the shadow only at the edge(s) that do have more content. No JS,
        degrades to plain scrolling if unsupported. (This can't be factored
        into one shared class/file: the renderers that use it live outside
        this package's file ownership for this sweep.) */
.panel-content--collection {
  align-items: stretch;
  justify-content: flex-start;
  overflow-y: auto;
  padding: var(--space-3);
  scrollbar-width: thin;
  scrollbar-color: color-mix(in srgb, currentColor 30%, transparent) transparent;
  background:
    linear-gradient(var(--panel-surface-override, var(--app-surface)) 40%, transparent),
    linear-gradient(transparent, var(--panel-surface-override, var(--app-surface)) 60%) 0 100%,
    linear-gradient(color-mix(in srgb, currentColor 16%, transparent), transparent),
    linear-gradient(transparent, color-mix(in srgb, currentColor 16%, transparent)) 0 100%;
  background-repeat: no-repeat;
  background-size:
    100% var(--space-6),
    100% var(--space-6),
    100% var(--space-2),
    100% var(--space-2);
  background-attachment: local, local, scroll, scroll;
}

.panel-content--collection::-webkit-scrollbar {
  width: 8px;
}

.panel-content--collection::-webkit-scrollbar-thumb {
  background: color-mix(in srgb, currentColor 30%, transparent);
  border-radius: var(--app-radius-pill);
}

.panel-content--collection::-webkit-scrollbar-track {
  background: transparent;
}
```

**TimelineRenderer.css**
```
$ cat frontend/src/features/panels/ui/renderers/TimelineRenderer.css
/* Timeline panel body (HEL-317). A vertical, ordered event list — marker +
   connector + time + description per entry — visually distinct from a
   line/bar chart. Overrides the base `.panel-content` centering so entries
   flow from the top and the body scrolls vertically inside the panel
   (collection/table precedent). */

.panel-content--timeline {
  align-items: stretch;
  justify-content: flex-start;
  overflow-y: auto;
  padding: var(--space-3);
}

.panel-content__timeline-list {
  display: flex;
  flex-direction: column;
  list-style: none;
  margin: 0;
  padding: 0;
}

.panel-content__timeline-entry {
  display: grid;
  grid-template-columns: auto 1fr;
  column-gap: var(--space-2);
  /* The connector is a continuation of the row grid's own left column, drawn
     via the marker's own vertical border below — padding on the entry
     reserves room for the connector to run the full row height. */
  padding-bottom: var(--space-3);
}

.panel-content__timeline-entry--last {
  padding-bottom: 0;
}

.panel-content__timeline-marker {
  position: relative;
  width: 8px;
  height: 8px;
  /* HEL-830: 5px -> 4px, nearest step */
  margin-top: var(--space-1);
  border-radius: var(--app-radius-pill);
  background: var(--app-accent);
  flex-shrink: 0;
}

/* Connector line joining consecutive entries — drawn from the marker down to
   the next entry's marker. Suppressed on the last entry (no dangling line to
   a non-existent next entry). */
.panel-content__timeline-entry:not(.panel-content__timeline-entry--last)
  .panel-content__timeline-marker::after {
  content: "";
  position: absolute;
  top: 8px;
  left: 50%;
  transform: translateX(-50%);
  width: 1px;
  bottom: calc(-1 * var(--space-3));
  background: var(--app-border-subtle);
}
```

**collection grid/list/item CSS**
```
$ grep -rn -E 'collection-grid|collection-list|collection-item' frontend/src --include=*.css; echo ---; grep -n -A8 -E 'collection-grid|collection-list|__collection-item' frontend/src/features/panels/ui/PanelContent.css | head -50
frontend/src/features/panels/ui/renderers/CollectionRenderer.css:65:.panel-content--collection-grid {
frontend/src/features/panels/ui/renderers/CollectionRenderer.css:73:.panel-content--collection-list {
frontend/src/features/panels/ui/renderers/CollectionRenderer.css:78:.panel-content--collection-list .panel-content__collection-item:not(:last-child) {
frontend/src/features/panels/ui/renderers/CollectionRenderer.css:82:.panel-content__collection-item {
frontend/src/features/panels/ui/renderers/CollectionRenderer.css:92:.panel-content__collection-item .panel-content--metric {
frontend/src/features/panels/ui/renderers/CollectionRenderer.css:105:.panel-content__collection-item .panel-content__metric-value {
---
```

**timeline long description / scale CSS (event wrap, container query)**
```
$ grep -rn -E 'timeline' frontend/src --include=*.css | grep -v TimelineRenderer.css | head; grep -rn 'timeline' frontend/src/features/panels/ui/PanelContent.css | head
frontend/src/features/panels/ui/grid/MobilePanelStack.css:60:.mobile-panel-stack__item.mobile-panel-stack__item--timeline {
frontend/src/features/panels/ui/grid/MobilePanelStack.css:66:/* HEL-1022 — `--metric`/`--chart`/`--table`/`--collection`/`--timeline`
frontend/src/features/panels/ui/grid/MobilePanelStack.css:141:.mobile-panel-stack__item--timeline .panel-content--timeline {
```

**CollectionRenderer.css grid/list/item rules (lines 62-115)**
```
$ sed -n 62,115p frontend/src/features/panels/ui/renderers/CollectionRenderer.css
/* Grid: responsive auto-fill columns. `min(140px, 100%)` clamps the track so a
   container narrower than the 140px legibility floor never forces a horizontal
   scrollbar; at ~390px content width this resolves to two columns. */
.panel-content--collection-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(140px, 100%), 1fr));
  gap: var(--space-2);
  align-content: start;
}

/* List: a single column with a hairline divider between items. */
.panel-content--collection-list {
  display: flex;
  flex-direction: column;
}

.panel-content--collection-list .panel-content__collection-item:not(:last-child) {
  border-bottom: 1px solid var(--app-border-subtle);
}

.panel-content__collection-item {
  display: flex;
  min-width: 0;
}

/* Each item reuses `MetricRenderer` (`.panel-content--metric`). Inside a
   collection tile the standalone metric's 3xl value is oversized, so scale it
   to the tile density while keeping the mono tabular-numeral treatment.
   `min-width: 0` lets the metric shrink with its grid track instead of
   dictating the track's minimum via its content. */
.panel-content__collection-item .panel-content--metric {
  padding: var(--space-2) var(--space-3);
  min-width: 0;
  text-align: center;
}

/* Values bound in a collection are often text phrases, not short numerals, so
   the standalone metric's `white-space: nowrap` (W4.4 — sized for a one-line
   numeric band) would overflow the tile and overlap its neighbors. Wrap
   instead: the collection body scrolls vertically, so extra lines are safe.
   `overflow-wrap: anywhere` guards a single unbreakable token; the tightened
   line-height replaces the standalone metric's `line-height: 1`, which would
   collide wrapped lines. */
.panel-content__collection-item .panel-content__metric-value {
  font-size: var(--text-2xl);
  white-space: normal;
  overflow-wrap: anywhere;
  line-height: 1.15;
}
```

**Timeline body/event text CSS (anywhere): time/event classes**
```
$ grep -rn -E 'timeline-(time|event|body)' frontend/src --include=*.css; grep -rn 'timeline' frontend/src/features/panels/ui/grid/MobilePanelStack.css | head -3
frontend/src/features/panels/ui/renderers/TimelineRenderer.css:62:.panel-content__timeline-body {
frontend/src/features/panels/ui/renderers/TimelineRenderer.css:69:.panel-content__timeline-time {
frontend/src/features/panels/ui/renderers/TimelineRenderer.css:77:.panel-content__timeline-event {
frontend/src/features/panels/ui/renderers/TimelineRenderer.css:97:  .panel-content__timeline-event {
frontend/src/features/panels/ui/renderers/TimelineRenderer.css:113:  .panel-content__timeline-time {
frontend/src/features/panels/ui/renderers/TimelineRenderer.css:117:  .panel-content__timeline-event {
60:.mobile-panel-stack__item.mobile-panel-stack__item--timeline {
66:/* HEL-1022 — `--metric`/`--chart`/`--table`/`--collection`/`--timeline`
137:   Collection above. `.panel-content--timeline` (TimelineRenderer.css) sets
```

**Tests pin timeline/collection renderers**
```
$ ls frontend/src/features/panels/ui/renderers | grep -i -E 'collection|timeline'
CollectionRenderer.css
CollectionRenderer.css.test.ts
CollectionRenderer.keyOrder.test.tsx
CollectionRenderer.test.tsx
CollectionRenderer.tsx
TimelineRenderer.css
TimelineRenderer.test.tsx
TimelineRenderer.tsx
```

**TimelineRenderer.css lines 60-125**
```
$ sed -n 60,125p frontend/src/features/panels/ui/renderers/TimelineRenderer.css
}

.panel-content__timeline-body {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  min-width: 0;
}

.panel-content__timeline-time {
  font-family: var(--font-mono);
  font-size: var(--text-micro);
  color: var(--app-text-muted);
  text-transform: uppercase;
  letter-spacing: 0.08em;
}

.panel-content__timeline-event {
  font-size: var(--text-sm);
  color: inherit;
  /* Long descriptions wrap within the entry rather than overflowing the
     panel bounds. */
  overflow-wrap: break-word;
  word-break: break-word;
}

/* Container Query: compact height — tighten spacing and text. */
@container panel-card (max-height: 179px) {
  .panel-content__timeline-entry {
    padding-bottom: var(--space-2);
  }

  .panel-content__timeline-entry:not(.panel-content__timeline-entry--last)
    .panel-content__timeline-marker::after {
    bottom: calc(-1 * var(--space-2));
  }

  .panel-content__timeline-event {
    font-size: var(--text-xs);
  }
}

/* Container Query: spacious height — roomier spacing and text. */
@container panel-card (min-height: 280px) {
  .panel-content__timeline-entry {
    padding-bottom: var(--space-4);
  }

  .panel-content__timeline-entry:not(.panel-content__timeline-entry--last)
    .panel-content__timeline-marker::after {
    bottom: calc(-1 * var(--space-4));
  }

  .panel-content__timeline-time {
    font-size: var(--text-xs);
  }

  .panel-content__timeline-event {
    font-size: var(--text-base);
  }
```

**OutputPanelContent empty/unbound/no-data states**
```
$ grep -n -i -E 'No data|unbound|placeholder|no output|Choose|empty' frontend/src/features/panels/ui/OutputPanelContent.tsx frontend/src/features/panels/ui/PanelContent.tsx | head -20
frontend/src/features/panels/ui/PanelContent.tsx:51:   *  instead of the generic "No data available" one. */
frontend/src/features/panels/ui/PanelContent.tsx:54:   *  never-materialized empty state (HEL-946). */
frontend/src/features/panels/ui/PanelContent.tsx:110:  /** HEL-1275 design.md D3 — true when the caller's built viewer-control filter ops are non-empty
frontend/src/features/panels/ui/PanelContent.tsx:182:    // plain "No data available" branch below).
frontend/src/features/panels/ui/PanelContent.tsx:205:        <span className="panel-content__state-label">No data available</span>
frontend/src/features/panels/ui/PanelContent.tsx:243:    // "Form not configured" placeholder itself for an empty field list. The
```

**PanelContent output-panel branch states**
```
$ sed -n 140,214p frontend/src/features/panels/ui/PanelContent.tsx
  onFilterChange,
  totalRowCount,
  filteredMetric,
  output,
  outputMetaLoading,
  crossFilterMode,
  viewerFilterActive = false,
  historySource,
}: PanelContentProps) {
  if (isLoading) {
    // HEL-528 design.md D6/D7 — a shape-matched skeleton, not the accent
    // spinner: this is the panel's INITIAL structural load (see
    // `Skeleton.tsx`'s division comment), not a short in-place refresh.
    return (
      <div className="panel-content panel-content--state" aria-label="Loading data">
        <PanelBodySkeleton />
      </div>
    );
  }

  if (error) {
    return (
      <div className="panel-content panel-content--state panel-content--error" role="alert">
        {/* announced={false} — this wrapper already carries role="alert";
         *  InlineError's own role would double-announce it. */}
        <InlineError
          error={error}
          variant="banner"
          kind={errorKind ?? "error"}
          onRetry={onRetry}
          retrying={retrying}
          retryVariant={retryVariant}
          announced={false}
        />
      </div>
    );
  }

  if (noData && neverMaterialized) {
    // HEL-946 Bug C(2): this node has never had a successful pipeline run
    // since the Output was added — an ACTIONABLE state, distinct from a
    // node that ran and legitimately returned zero rows (handled by the
    // plain "No data available" branch below).
    return (
      <div className="panel-content panel-content--state" role="status">
        <span className="panel-content__state-label">Not run yet</span>
        <p className="panel-content__state-detail">
          This panel&rsquo;s output hasn&rsquo;t been included in a saved pipeline run yet.
        </p>
        {onGoToPipeline && (
          <button
            type="button"
            className="ui-modal-btn ui-modal-btn--secondary"
            onClick={onGoToPipeline}
          >
            Run pipeline
          </button>
        )}
      </div>
    );
  }

  if (noData) {
    return (
      <div className="panel-content panel-content--state">
        <span className="panel-content__state-label">No data available</span>
      </div>
    );
  }

  // Dispatcher: narrow on the discriminator and pick the renderer.
  if (isOutputPanel(panel)) {
    return (
      <OutputPanelContent
        panelId={panel.id}
```

**Unbound output panel rendering**
```
$ sed -n 60,100p frontend/src/features/panels/ui/OutputPanelContent.tsx; grep -rn -i 'unbound\|not bound\|no output' frontend/src/features/panels/ui/*.tsx | grep -v test | head
  panelId: string;
  rawRows?: string[][] | null;
  headers?: string[] | null;
  appearance: PanelAppearance;
  paginationRows?: Record<string, unknown>[] | null;
  paginationIsLoadingMore?: boolean;
  onLoadMore?: () => void;
  rowsTruncated?: boolean;
  compact?: boolean;
  outputId: string;
  onDataPointSelect?: (selection: ChartClickSelection) => void;
  onSortChange?: (column: string, direction: SortDirection | null) => void;
  onFilterChange?: (filters: TableColumnFilters) => void;
  totalRowCount?: number;
  filteredMetric?: FilteredMetric | null;
  output?: Output | PublicOutputMeta | null;
  isLoading?: boolean;
  crossFilterMode: CrossFilterMode;
  viewerFilterActive: boolean;
  historySource?: HistorySource;
}) {
  // evaluation-1.md CR1/CR2 (cycle 2) — applying the cross-filter HERE,
  // rather than upstream at PanelCard/MobileStackPanelBody, is what makes
  // this genuinely a SINGLE call site: this component's resolved `output` is the
  // SAME ONE this component already needs (unconditionally) to pick a
  // renderer for `output.kind` — no NEW fetch, and therefore no fetch-timing
  // race between two INDEPENDENT `useOutputMeta` instances resolving at
  // different times. That race is exactly what the cycle-1 design (applying
  // the filter in the caller, using the caller's OWN separately-fetched
  // `output`) introduced for `MobileStackPanelBody` specifically — it had no
  // pre-existing `useOutputMeta` call before this ticket, so adding one there
  // for cross-filtering purposes created a second, independent fetch of the
  // same Output that could resolve AFTER this component's own, producing a
  // live, reproducible transient window where a Table-kind sibling panel's
  // rows rendered UNFILTERED right after a desktop-grid/mobile-stack
  // breakpoint remount (probe-confirmed: `page.evaluate` reading rendered
  // `<td>` text immediately after `setViewportSize` at the 768px breakpoint
  // showed all 4 unfiltered rows; the same check after a 300ms settle showed
  // the correct 2 filtered rows — the transient window closes as soon as the
  // slower of the two fetches resolves). Moving filtering to this ALREADY-
  // resolving-exactly-once fetch closes that window entirely.
frontend/src/features/panels/ui/OutputPicker.tsx:293:            title="No output fits?"
frontend/src/features/panels/ui/PanelCard.tsx:100:  // `condition`) has no Output-side equivalent yet.
```

**Zero-row collection test**
```
$ grep -n -E 'it\(|describe\(' frontend/src/features/panels/ui/renderers/CollectionRenderer.test.tsx frontend/src/features/panels/ui/renderers/TimelineRenderer.test.tsx
frontend/src/features/panels/ui/renderers/CollectionRenderer.test.tsx:14:describe("CollectionRenderer — one row per item (HEL-247)", () => {
frontend/src/features/panels/ui/renderers/CollectionRenderer.test.tsx:15:  it("expands N bound rows into N metric items, each with its own mapped value", () => {
frontend/src/features/panels/ui/renderers/CollectionRenderer.test.tsx:34:  it("applies a literal metricOptions.unit to every item", () => {
frontend/src/features/panels/ui/renderers/CollectionRenderer.test.tsx:49:  it("applies the grid layout class for grid collections", () => {
frontend/src/features/panels/ui/renderers/CollectionRenderer.test.tsx:61:  it("applies the list layout class for list collections", () => {
frontend/src/features/panels/ui/renderers/CollectionRenderer.test.tsx:74:describe("CollectionRenderer format (HEL-876)", () => {
frontend/src/features/panels/ui/renderers/CollectionRenderer.test.tsx:75:  it("forwards format to each item's MetricRenderer (baseType: metric)", () => {
frontend/src/features/panels/ui/renderers/CollectionRenderer.test.tsx:91:describe("CollectionRenderer — empty state", () => {
frontend/src/features/panels/ui/renderers/CollectionRenderer.test.tsx:92:  it("shows a No data state when the snapshot has zero rows", () => {
frontend/src/features/panels/ui/renderers/TimelineRenderer.test.tsx:14:describe("TimelineRenderer — chronological ordering (HEL-317)", () => {
frontend/src/features/panels/ui/renderers/TimelineRenderer.test.tsx:15:  it("renders one entry per bound row, each with its own time and event text", () => {
frontend/src/features/panels/ui/renderers/TimelineRenderer.test.tsx:26:  it("orders entries ascending by the time field by default", () => {
frontend/src/features/panels/ui/renderers/TimelineRenderer.test.tsx:40:  it("orders entries descending when sort is desc", () => {
frontend/src/features/panels/ui/renderers/TimelineRenderer.test.tsx:59:  it("suppresses the trailing connector only on the last (chronologically) entry", () => {
frontend/src/features/panels/ui/renderers/TimelineRenderer.test.tsx:70:describe("TimelineRenderer — degradation at the data edges", () => {
frontend/src/features/panels/ui/renderers/TimelineRenderer.test.tsx:71:  it("shows a No data state when there are zero rows", () => {
frontend/src/features/panels/ui/renderers/TimelineRenderer.test.tsx:78:  it("renders a single entry without a trailing connector", () => {
frontend/src/features/panels/ui/renderers/TimelineRenderer.test.tsx:92:  it("renders a long description without truncating the underlying text (CSS wraps it)", () => {
```

**readTimelineConfig default sort**
```
$ sed -n 367,376p frontend/src/features/pipelines/ui/outputEditor/outputConfigTypes.ts
export function readTimelineConfig(config: Record<string, unknown>): TimelineOutputConfig {
  return {
    fieldMapping: safeRecord(config.fieldMapping),
    sort: config.sort === "desc" ? "desc" : "asc",
  };
}
```

**Backend validates collection layout / timeline sort values**
```
$ grep -n -E 'layout|"sort"' backend/src/main/scala/com/helio/services/pipelines/OutputConfigValidation.scala | head
26:    OutputKind.Collection -> (Shared ++ Set("layout", "format", "conditionalFormats")),
27:    OutputKind.Timeline   -> (Shared ++ Set("sort")),
```

**MCP output kind enumeration includes collection/timeline (Output kinds)**
```
$ grep -rn -E 'collection|timeline' helio-mcp/src/tools/outputs.ts | head -8; grep -rn -E 'collection|timeline' schemas/outputs 2>/dev/null | head -5; ls schemas | head -30
55:const outputKindSchema = z.enum(["table", "metric", "chart", "collection", "timeline", "markdown"]);
80:  "`columnFilters`, `pinnedColumns`, `conditionalFormats`; collection: `layout`, `format`, " +
81:  "`conditionalFormats`; timeline: `sort`; markdown: `content`. " +
114:  "Optional `config.conditionalFormats` (metric, table, collection) colours values by threshold: an " +
122:  "whole row); metric and collection rules take no `column` or `target`. Rules compare the raw " +
135:        "which of the bindable shapes this Output represents (table/metric/chart/collection/" +
136:        "timeline/markdown); `config.fieldMapping`, when the kind requires one, MUST use slot " +
schemas/outputs/create-output-request.schema.json:17:      "enum": ["table", "metric", "chart", "collection", "timeline", "markdown"]
schemas/outputs/create-output-request.schema.json:25:      "description": "Output config. `compare` (HEL-1273) selects the history comparison: absent/null (none), `previous_run`, `1d`, `7d`, `30d`, or `custom:<d>` where <d> is a positive ISO-8601 duration in days/hours/minutes/seconds (PnDTnHnMnS, at most 365 days; week/month/year and lowercase/signed forms are rejected). Anything else is a 400. `historyPayloads` (HEL-1276) opts this Output's node into storing each real run's full row payload (boolean, default off; absent/null/false store none): kept only for beta (10 runs / 7 days) and owner (30 runs / 30 days) pipeline owners, never for free, and a node over 1000 rows or 1 MiB stores none. Any non-boolean is a 400. Known top-level `config` keys per kind (HEL-1313; every other key is a 400 naming it, with a did-you-mean hint): every kind - `fieldMapping`, `compare`, `historyPayloads`; chart - `chartType`, `aggregation`, `chartOptions`, `annotation`, `referenceLines`, `referenceBands`; metric - `aggregation`, `label`, `unit`, `format`, `conditionalFormats`; table - `columnOrder`, `columnFormats`, `columnSort`, `columnFilters`, `pinnedColumns`, `conditionalFormats`; collection - `layout`, `format`, `conditionalFormats`; timeline - `sort`; markdown - `content`. A key already stored on the Output (a legacy key such as `metricLabel`) may be re-sent with its stored value unchanged, or cleared with null; introducing or changing any other unknown key is rejected, so `additionalProperties` is deliberately not false here. `aggregation` is null, `{groupBy, agg, yField}` on a chart (never on a scatter, heatmap or histogram chart), or `{agg}` (field from `fieldMapping.value`) / `{value, agg}` on a metric; `agg` is count|sum|avg|min|max and every named field a non-empty string; any other kind or shape is a 400. `chartType` is bar|line|pie|scatter|heatmap|histogram or null. `conditionalFormats` (HEL-1307; metric, table, collection) is null/[] or an ordered list (max 20, first match wins) of rules `{op, value, value2?, tone, label?, column?, target?}`: `op` is gt|gte|lt|lte|between (finite number `value`; between also `value2` >= `value`) or eq|neq (number or text `value`); `tone` is success|warning|error; `label` is optional text (1-60); a table rule needs `column` and may set `target` cell (default) or row; metric/collection rules take neither. Rules compare the raw value. An invalid list is a 400 naming the rule index. `chartOptions.histogram.binCount`, when written, is null/absent or a whole number from 2 to 100, else a 400 naming `binCount`; a heatmap reads Columns/Rows/Value from `fieldMapping` `xAxis`/`series`/`yAxis` and a histogram its numeric field from `xAxis`. `referenceLines` (HEL-1306) is null or at most 5 objects `{value, label?, tone?}` and `referenceBands` null or at most 3 objects `{from, to, label?, tone?}` with `from` less than `to`; `value`/`from`/`to` are finite numbers, `label` is 1 to 60 characters with at least one non-whitespace character, `tone` is neutral|success|warning|error (default neutral), no other item keys; a violation is a 400 naming the key and item index.",
schemas/outputs/create-output-request.schema.json:152:          "description": "Metric and collection kinds. One of number, integer, currency, percent, duration, durationMs (duration reads seconds, durationMs reads milliseconds)."
schemas/outputs/create-output-request.schema.json:170:          "description": "Metric, table and collection kinds (HEL-1307): null/[] or an ordered list of threshold rules; see the config description above."
schemas/outputs/update-output-request.schema.json:14:      "description": "Output config. `compare` (HEL-1273) selects the history comparison: absent/null (none), `previous_run`, `1d`, `7d`, `30d`, or `custom:<d>` where <d> is a positive ISO-8601 duration in days/hours/minutes/seconds (PnDTnHnMnS, at most 365 days; week/month/year and lowercase/signed forms are rejected). Anything else is a 400. `historyPayloads` (HEL-1276) opts this Output's node into storing each real run's full row payload (boolean, default off; absent/null/false store none): kept only for beta (10 runs / 7 days) and owner (30 runs / 30 days) pipeline owners, never for free, and a node over 1000 rows or 1 MiB stores none. Any non-boolean is a 400. Known top-level `config` keys per kind (HEL-1313; every other key is a 400 naming it, with a did-you-mean hint): every kind - `fieldMapping`, `compare`, `historyPayloads`; chart - `chartType`, `aggregation`, `chartOptions`, `annotation`, `referenceLines`, `referenceBands`; metric - `aggregation`, `label`, `unit`, `format`, `conditionalFormats`; table - `columnOrder`, `columnFormats`, `columnSort`, `columnFilters`, `pinnedColumns`, `conditionalFormats`; collection - `layout`, `format`, `conditionalFormats`; timeline - `sort`; markdown - `content`. A key already stored on the Output (a legacy key such as `metricLabel`) may be re-sent with its stored value unchanged, or cleared with null; introducing or changing any other unknown key is rejected, so `additionalProperties` is deliberately not false here. `aggregation` is null, `{groupBy, agg, yField}` on a chart (never on a scatter, heatmap or histogram chart), or `{agg}` (field from `fieldMapping.value`) / `{value, agg}` on a metric; `agg` is count|sum|avg|min|max and every named field a non-empty string; any other kind or shape is a 400. `chartType` is bar|line|pie|scatter|heatmap|histogram or null. `conditionalFormats` (HEL-1307; metric, table, collection) is null/[] or an ordered list (max 20, first match wins) of rules `{op, value, value2?, tone, label?, column?, target?}`: `op` is gt|gte|lt|lte|between (finite number `value`; between also `value2` >= `value`) or eq|neq (number or text `value`); `tone` is success|warning|error; `label` is optional text (1-60); a table rule needs `column` and may set `target` cell (default) or row; metric/collection rules take neither. Rules compare the raw value. An invalid list is a 400 naming the rule index. `chartOptions.histogram.binCount`, when written, is null/absent or a whole number from 2 to 100, else a 400 naming `binCount`; a heatmap reads Columns/Rows/Value from `fieldMapping` `xAxis`/`series`/`yAxis` and a histogram its numeric field from `xAxis`. `referenceLines` (HEL-1306) is null or at most 5 objects `{value, label?, tone?}` and `referenceBands` null or at most 3 objects `{from, to, label?, tone?}` with `from` less than `to`; `value`/`from`/`to` are finite numbers, `label` is 1 to 60 characters with at least one non-whitespace character, `tone` is neutral|success|warning|error (default neutral), no other item keys; a violation is a 400 naming the key and item index.",
admin
agent-memory
alerts
assistant
audit
auth
authoring
dashboards
first-run
hooks
outputs
panels
patch-sets
pipelines
README.md
shared
sources
workspace
```

**panel.schema.json type enum / TimelineConfig def**
```
$ grep -n -E 'timeline|Timeline|"enum"' schemas/panels/panel.schema.json | head; grep -rn -c 'TimelineConfig' schemas | grep -v ':0'
24:      "enum": ["text", "markdown", "image", "divider", "output", "form"]
150:      "description": "Config for the `output` panel kind (HEL-904 task 3.6) \u2014 a placement of one Output. Everything the five retired bound configs (metric/chart/table/collection/timeline) used to carry (fieldMapping, aggregation, chartOptions, columnWidths/density/columnOrder, timelineOptions, metricId, label/unit) now lives on the Output itself (see schemas/outputs/), not on the placement. Tolerant read: an absent/empty outputId decodes to the empty-string sentinel rather than a validation error; the server still 400s an outputId-less output panel at create/update time. `controls` (HEL-1189) is the author-configured date-range/dropdown/numeric-range/text control list that parameterizes the read (leaf 2 of HEL-915); absent/empty decodes to an empty list.",
174:          "enum": ["date-range", "dropdown", "numeric-range", "text"]
219:          "enum": ["contain", "cover", "fill"]
233:          "enum": ["horizontal", "vertical"]
275:          "enum": ["text", "textarea", "number", "date", "select", "checkbox", "file", "counter"]
312:          "enum": ["append"]
```

**MCP tools create_panel/bind_panel registered?**
```
$ grep -rn -E 'registerTool\(\s*"(create_panel|bind_panel)"|"(create_panel|bind_panel)"' helio-mcp/src | head; grep -rn -E 'create_panel|bind_panel' helio-mcp/src | grep -v -E 'test' | head -5; grep -n -o 'registerTool(' -c helio-mcp/src/tools/write.ts
helio-mcp/src/server.test.ts:43:  "bind_panel",
helio-mcp/src/server.test.ts:46:  "create_panel",
helio-mcp/src/tools/placementsHandlers.ts:7: * Replaces `create_panel`/`create_panels`/`bind_panel`/`create_bound_panel`
helio-mcp/src/tools/placementsHandlers.ts:37: *  calling `create_panel` alone always was. */
helio-mcp/src/tools/placements.ts:3: * `create_panel`/`create_panels`/`bind_panel`/`create_bound_panel`. This
helio-mcp/src/tools/placements.ts:43:        "all-or-nothing call (POST /api/panels/batch) — replaces create_panel/create_panels/" +
helio-mcp/src/tools/placements.ts:44:        "bind_panel/create_bound_panel for the data-bound case. Each item's `outputId` MUST be a " +
32
```

**Backend PanelType canonical set**
```
$ grep -rn -A12 'object PanelType' backend/src/main/scala | head -24
backend/src/main/scala/com/helio/domain/model/model.scala:131:object PanelType {
backend/src/main/scala/com/helio/domain/model/model.scala-132-  case object Text     extends PanelType
backend/src/main/scala/com/helio/domain/model/model.scala-133-  case object Markdown extends PanelType
backend/src/main/scala/com/helio/domain/model/model.scala-134-  case object Image    extends PanelType
backend/src/main/scala/com/helio/domain/model/model.scala-135-  case object Divider  extends PanelType
backend/src/main/scala/com/helio/domain/model/model.scala-136-  case object Output   extends PanelType
backend/src/main/scala/com/helio/domain/model/model.scala-137-  case object Form     extends PanelType
backend/src/main/scala/com/helio/domain/model/model.scala-138-
backend/src/main/scala/com/helio/domain/model/model.scala-139-  // HEL-904: was `Output` from the 5-value collapse commit — a genuine bug
backend/src/main/scala/com/helio/domain/model/model.scala-140-  // (not a design decision), since `OutputPanelConfig` REQUIRES a non-empty
backend/src/main/scala/com/helio/domain/model/model.scala-141-  // `outputId` (unlike the old default `Metric`, which tolerated an empty
backend/src/main/scala/com/helio/domain/model/model.scala-142-  // config) — an ordinary `POST /api/panels` with no `type` at all now 400s
backend/src/main/scala/com/helio/domain/model/model.scala-143-  // instead of creating a plain panel. `Divider` is the only kind that is
```

**schema-drift coverage of OUTPUT kinds in schemas/outputs: output.schema kind enum**
```
$ grep -rn -E '"(collection|timeline)"' schemas/outputs/output.schema.json schemas/outputs/*.json | cut -c1-140 | head
schemas/outputs/output.schema.json:27:      "enum": ["table", "metric", "chart", "collection", "timeline", "markdown"]
schemas/outputs/create-output-request.schema.json:17:      "enum": ["table", "metric", "chart", "collection", "timeline", "markdown"]
schemas/outputs/output.schema.json:27:      "enum": ["table", "metric", "chart", "collection", "timeline", "markdown"]
```

**server.test.ts context: bind_panel/create_panel are in the removed-tools list**
```
$ sed -n 30,42p helio-mcp/src/server.test.ts; sed -n 62,80p helio-mcp/src/server.test.ts
const REMOVED_TOOLS = [
  // HEL-907 task 3.9 (this cycle) -- DataType/Metric model retired by HEL-904;
  // every one of these called a route that no longer exists.
  "list_data_types",
  "update_data_type",
  "delete_data_type",
  "get_data_type_rows",
  "list_metrics",
  "get_metric",
  "create_metric",
  "update_metric",
  "delete_metric",
  // Earlier cycles (6-7), also design.md decision 10 "no aliases" removals.
  "analyze_pipeline_proposal",
  "append_dataset_rows",
  "apply_combined_proposal",
  "apply_patch_set",
  "apply_pipeline_proposal",
  "apply_proposal",
  "auto_layout_dashboard",
  "create_connector",
  "create_content_panel",
  "create_csv_data_source",
  "create_dashboard",
  "create_data_source",
  "create_pipeline",
  "create_rest_data_source",
  "create_sql_data_source",
  "delete_dashboard",
  "delete_data_source",
  "delete_dataset_row",
  "delete_output",
```

**No registerTool for create_panel/bind_panel**
```
$ grep -rn -E 'registerTool' -A1 helio-mcp/src/tools/*.ts | grep -E '"(create_panel|bind_panel)"' | head -3; echo rc=$?
rc=0
```

**How REMOVED_TOOLS is used**
```
$ grep -n -B3 -A12 'REMOVED_TOOLS' helio-mcp/src/server.test.ts | sed -n 60,140p

```

**Registered tool names (registerTool first arg)**
```
$ grep -rhn -A1 'registerTool(' helio-mcp/src/tools/*.ts | grep -o '"[a-z_]*",\?$' | tr -d '",' | sort | tr '\n' ' '
add_output add_output_control add_outputs_from_shape add_pipeline_step add_root analyze_pipeline analyze_pipeline_proposal append_dataset_rows apply_combined_proposal apply_patch_set apply_pipeline_proposal apply_proposal auto_layout_dashboard create_connector create_content_panel create_csv_data_source create_dashboard create_data_source create_pipeline create_rest_data_source create_sql_data_source delete_dashboard delete_dataset_row delete_data_source delete_output delete_panel delete_pipeline delete_pipeline_schedule delete_pipeline_step get_dashboard get_dataset_rows get_dataset_schema get_output get_output_assertion_status get_output_capabilities get_output_filter_capabilities get_output_history get_output_panels get_output_provenance get_output_rows get_pipeline get_pipeline_schedule get_workspace_context list_connectors list_connector_types list_dashboards list_data_sources list_outputs list_pipelines list_pipeline_shapes list_source_objects place_outputs preview_outputs propose_dashboard propose_patch_set propose_pipeline remove_output_control remove_root replace_dashboard_contents replace_dataset_rows run_pipeline set_pipeline_schedule teardown_resources undo_patch_set update_dashboard update_dashboard_layout update_dataset_row update_dataset_schema update_data_source update_output update_output_control update_panel update_panel_appearance update_pipeline update_pipeline_step upload_image 
```

**patchPanelOutputId body + swapPanelOutput thunk + OutputPicker swap trigger**
```
$ sed -n 55,70p frontend/src/features/panels/services/panelService.ts; sed -n 132,165p frontend/src/features/panels/state/panelThunks.ts; sed -n 120,136p frontend/src/features/panels/ui/OutputPicker.tsx
}

/** PATCH an existing panel's `outputId` in place, preserving its position/
 *  size ("Swap output" — `specs/panel-detail-modal/spec.md`). */
export async function patchPanelOutputId(panelId: string, outputId: string): Promise<Panel> {
  const response = await httpClient.patch<Panel>(`/api/panels/${panelId}`, {
    config: { outputId },
  });
  return response.data;
}

export async function deletePanel(panelId: string): Promise<void> {
  await httpClient.delete(`/api/panels/${panelId}`);
}

export async function duplicatePanel(panelId: string): Promise<Panel> {
});

/** "Swap output" (HEL-909 CR4) — PATCHes an existing panel's own `outputId`
 *  in place, preserving its position/size, then refetches the dashboard's
 *  panels so the sheet/grid reflect the new binding. `markDashboardPanelsStale`
 *  resets `panels.status` to `"idle"` first so `fetchPanels`'s own dedup
 *  `condition` doesn't skip the refetch (the dashboard is otherwise always
 *  already `"succeeded"` by the time a user reaches Swap output). */
export const swapPanelOutput = createAsyncThunk<
  Panel,
  { panelId: string; outputId: string; dashboardId: string },
  { state: RootState; rejectValue: string }
>(
  "panels/swapPanelOutput",
  async ({ panelId, outputId, dashboardId }, { dispatch, rejectWithValue }) => {
    try {
      const updated = await patchPanelOutputIdRequest(panelId, outputId);
      dispatch(markDashboardPanelsStale(dashboardId));
      await dispatch(fetchPanels(dashboardId));
      return updated;
    } catch {
      return rejectWithValue("Failed to swap output.");
    }
  },
);

export const deletePanel = createAsyncThunk<
  string,
  { panelId: string; dashboardId: string },
  { rejectValue: string }
>("panels/deletePanel", async ({ panelId, dashboardId }, { dispatch, rejectWithValue }) => {
  try {
    await deletePanelRequest(panelId);
    dispatch(markDashboardPanelsStale(dashboardId));
    }
    return items;
  }, [filteredGroups, mode]);

  async function placeOutput(outputId: string, outputName: string) {
    if (isSubmitting) return;
    setIsSubmitting(true);
    setSubmitError(null);
    try {
      if (mode === "swap" && swapPanelId) {
```

**Callers of swapPanelOutput / swapPanelId (what UI triggers swap)**
```
$ grep -rn -E 'swapPanelId|swapPanelOutput' frontend/src --include=*.tsx --include=*.ts | grep -v -E '\.test\.' | head -12
frontend/src/features/panels/ui/detailModal/OutputPanelSection.tsx:79:          swapPanelId={panel.id}
frontend/src/features/panels/ui/OutputPicker.tsx:18:import { createPanel, swapPanelOutput } from "../state/panelThunks";
frontend/src/features/panels/ui/OutputPicker.tsx:54:   *  "swap": replace `swapPanelId`'s own `outputId` in place instead, per
frontend/src/features/panels/ui/OutputPicker.tsx:57:  swapPanelId?: string;
frontend/src/features/panels/ui/OutputPicker.tsx:65:  swapPanelId,
frontend/src/features/panels/ui/OutputPicker.tsx:129:      if (mode === "swap" && swapPanelId) {
frontend/src/features/panels/ui/OutputPicker.tsx:132:        // (`panelService.patchPanelOutputId` + `swapPanelOutput`, HEL-909
frontend/src/features/panels/ui/OutputPicker.tsx:134:        await dispatch(swapPanelOutput({ panelId: swapPanelId, outputId, dashboardId })).unwrap();
frontend/src/features/panels/state/panelThunks.ts:140:export const swapPanelOutput = createAsyncThunk<
frontend/src/features/panels/state/panelThunks.ts:145:  "panels/swapPanelOutput",
```

**Any other frontend PATCH with typeId/fieldMapping/refreshInterval to /panels**
```
$ grep -rn -E 'typeId|fieldMapping' frontend/src/features/panels/services frontend/src/features/panels/state | grep -v test | head
frontend/src/features/panels/state/panelPayloads.ts:5:// configs carried (fieldMapping/aggregation/chartOptions/columnWidths/
```

**collection editor remnants in PanelDetailModal (detail modal)**
```
$ grep -rn -i 'collection' frontend/src/features/panels/ui/detailModal/ frontend/src/features/panels/ui/editors/ 2>/dev/null | grep -v -E '\.test\.' | head; grep -n -i collection frontend/src/features/panels/ui/detailModal/*.css | head
frontend/src/features/panels/ui/detailModal/PanelDetailModal.sections.css:1:/* Collection layout segmented control (HEL-247). A two-option grid/list toggle;
frontend/src/features/panels/ui/detailModal/PanelDetailModal.mobile.css:193:  /* HEL-247: Collection editor — the grid/list layout segmented buttons must
frontend/src/features/panels/ui/editors/TableDisplayFields.tsx:11:// dynamic, variable-length collection reads as nested rather than as more
frontend/src/features/panels/ui/editors/TableDisplayFields.css:8:   collection rather than more inline form fields. */
frontend/src/features/panels/ui/editors/TableDisplayFields.css:32:   dynamic, variable-length collection from the inline fields around it. */
frontend/src/features/panels/ui/editors/BoundOrLiteralField.tsx:8:// (Collections) copy directly for their own field-or-literal slots — see the
frontend/src/features/panels/ui/detailModal/PanelDetailModal.mobile.css:193:  /* HEL-247: Collection editor — the grid/list layout segmented buttons must
frontend/src/features/panels/ui/detailModal/PanelDetailModal.sections.css:1:/* Collection layout segmented control (HEL-247). A two-option grid/list toggle;
```

**Output editor save: configPatch & PATCH call**
```
$ sed -n 1,40p frontend/src/features/pipelines/ui/outputEditor/configPatch.ts; grep -n -E 'updateOutput|patch' frontend/src/features/pipelines/ui/outputEditor/OutputEditorSheet.tsx | head
// Edit-mode Save as a config PATCH (HEL-1389). `PATCH /api/outputs/:id` shallow-merges `config`
// (an omitted top-level key is kept, a present key replaces wholesale, an explicit `null` is
// stored as `null`), so the sheet must send only the keys the user changed, with `null` for a
// clear -- never a rebuild of the whole kind config from editor state.
//
// "Changed" means: the builder's output for the current state differs from the builder's output
// for the state the sheet OPENED with (`openingParams`, seeded exactly as the sheet seeds its
// state). Diffing against the opening state, not the raw stored config, keeps read defaults
// (`chartType: "line"` for an absent key, a normalized `{agg}` aggregation) from being written
// on an untouched save.

import { defaultBoundOrLiteralMode } from "../../../panels/ui/editors/BoundOrLiteralField";
import {
  buildOutputConfig,
  type BoundOrLiteralValue,
  type BuildOutputConfigParams,
} from "./buildOutputConfig";
import {
  readChartConfig,
  readCollectionConfig,
  readMarkdownConfig,
  readMetricConfig,
  readTableConfig,
  readTimelineConfig,
} from "./outputConfigTypes";
import { buildOutputColumns, deriveColumnOrder } from "./useOutputTableColumns";
import type { OutputKind } from "../../types/output";

function staticBound(
  literalIsSet: boolean,
  fieldValue: string,
  literalValue: string,
): BoundOrLiteralValue {
  const mode = defaultBoundOrLiteralMode(literalIsSet);
  return {
    mode,
    fieldValue,
    literalValue,
    fieldMappingValue: mode === "field" && fieldValue ? fieldValue : undefined,
  };
17:import { useAppDispatch, useAppSelector } from "../../../../hooks/reduxHooks";
25:  updateOutput,
93:  const dispatch = useAppDispatch();
127:    void dispatch(fetchNodeCapabilities({ pipelineId, stepId: nodeStepId }));
128:  }, [open, dispatch, pipelineId, nodeStepId]);
200:        const created = await dispatch(
216:        void dispatch(previewOutput({ pipelineId, outputId: created.id }));
218:        const patch = withHistoryPayloads(buildEditConfig());
219:        await dispatch(
220:          updateOutput({
```

**Output editor mobile touch-target 44px rules**
```
$ grep -n -B3 -A10 'max-width: 768px' frontend/src/features/pipelines/ui/outputEditor/OutputEditorSheet.css | head -50; grep -rn -E 'min-height: *44px|--touch' frontend/src/features/pipelines/ui/outputEditor/OutputEditorSheet.css | head
178-
179-/* Mobile: the shared Select trigger lifts to the 44px touch floor (inputs.css, same gate); lift the row's
180-   text inputs to that same floor so every control in the row stays the same height on touch. */
181:@media (max-width: 768px), (pointer: coarse) {
182-  .conditional-formats__controls .ui-input {
183-    min-height: 44px;
184-  }
185-}
186-
187-.conditional-formats__actions {
188-  display: flex;
189-  gap: var(--space-1);
190-  align-self: flex-end;
191-}
--
198-/* HEL-1311: the histogram bin-count input meets the 44px tap floor on touch, as the shared Select
199-   triggers beside it do (`shared/ui/inputs.css`). Touch gate, not a width gate -- see
200-   `shared/ui/tapTarget.css`. */
201:@media (max-width: 768px), (pointer: coarse) {
202-  .output-editor-sheet__bin-count {
203-    min-height: 44px;
204-  }
205-}
206-
207-/* HEL-1306: reference-line / band rows. Inputs and Selects share a wrapping row so four controls fit
208-   a narrow sheet; text inputs meet the 44px tap floor on touch, as the bin-count input does. */
209-.output-editor-sheet__mark-block {
210-  display: grid;
211-  gap: var(--space-1);
--
229-  justify-self: start;
230-}
231-
232:@media (max-width: 768px), (pointer: coarse) {
233-  .output-editor-sheet__mark-input {
234-    min-height: 44px;
235-  }
236-}
183:    min-height: 44px;
203:    min-height: 44px;
234:    min-height: 44px;
```

**configPatch.ts diff logic & collection handling**
```
$ sed -n 40,140p frontend/src/features/pipelines/ui/outputEditor/configPatch.ts
  };
}

/** NOTE: `useOutputKindState` calls this with a fixed kind and reads only kind-independent fields,
 *  so this must not branch on `kind`.
 *  The builder inputs for an Output exactly as the sheet seeds its editor state from `config`
 *  (and, for a table, from the capabilities-dependent column hook), i.e. the untouched state. */
export function openingParams(
  kind: OutputKind,
  config: Record<string, unknown>,
  fieldKeys: string[],
): BuildOutputConfigParams {
  const chart = readChartConfig(config);
  const table = readTableConfig(config);
  const metric = readMetricConfig(config);
  const markdown = readMarkdownConfig(config);
  const collection = readCollectionConfig(config);
  const timeline = readTimelineConfig(config);
  return {
    kind,
    chartType: chart.chartType,
    chartFieldMapping: chart.fieldMapping,
    groupBy: chart.aggregation?.groupBy ?? "",
    chartAggFn: chart.aggregation?.agg ?? "",
    yField: chart.aggregation?.yField ?? "",
    chartOptionsState: chart.chartOptions ?? {},
    annotationState: staticBound(
      chart.annotation !== undefined && chart.annotation !== null,
      chart.fieldMapping.annotation ?? "",
      chart.annotation ?? "",
    ),
    referenceLines: chart.referenceLines,
    referenceBands: chart.referenceBands,
    tableFieldMapping: table.fieldMapping,
    tableColumnOrder: deriveColumnOrder(
      buildOutputColumns(fieldKeys, table.columnOrder),
      fieldKeys,
      table.columnOrder,
    ),
    tableColumnFormats: { ...(table.columnFormats ?? {}) },
    metricField: metric.fieldMapping.value ?? metric.aggregation?.value ?? "",
    metricAggFn: metric.aggregation?.agg ?? "",
    metricLabelState: staticBound(
      metric.label !== undefined,
      metric.fieldMapping.label ?? "",
      metric.label ?? "",
    ),
    metricUnitState: staticBound(
      metric.unit !== undefined,
      metric.fieldMapping.unit ?? "",
      metric.unit ?? "",
    ),
    metricFormat: metric.format ?? "number",
    compare: metric.compare ?? "none",
    markdownContent: markdown.content ?? "",
    collectionFieldMapping: collection.fieldMapping,
    collectionFormat: collection.format ?? "number",
    timelineFieldMapping: timeline.fieldMapping,
    // HEL-1307 -- the three kinds read the same flat key, so the per-kind reader is immaterial.
    conditionalFormats:
      kind === "table"
        ? table.conditionalFormats
        : kind === "collection"
          ? collection.conditionalFormats
          : metric.conditionalFormats,
    conditionalFormatsStored:
      (kind === "table"
        ? table.conditionalFormats
        : kind === "collection"
          ? collection.conditionalFormats
          : metric.conditionalFormats) !== undefined,
  };
}

/** `undefined` and `null` both mean "no value" on the wire; otherwise structural JSON equality. */
function sameValue(a: unknown, b: unknown): boolean {
  const left = a === undefined ? null : a;
  const right = b === undefined ? null : b;
  if (left === right) return true;
  if (typeof left !== "object" || typeof right !== "object" || left === null || right === null) {
    return false;
  }
  if (Array.isArray(left) !== Array.isArray(right)) return false;
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  if (leftKeys.length !== rightKeys.length) return false;
  return leftKeys.every(
    (k) =>
      Object.prototype.hasOwnProperty.call(right, k) &&
      sameValue((left as Record<string, unknown>)[k], (right as Record<string, unknown>)[k]),
  );
}

/** The `fieldMapping` slots the editor owns per kind (a bound-or-literal slot). */
const OWNED_SLOTS: Partial<Record<OutputKind, string[]>> = {
  chart: ["annotation"],
  metric: ["label", "unit"],
};

/** D4 -- an Output this bug already damaged: the STORED mapping carries an owned slot (non-empty
 *  string) that the editor state does not bind to that same field. Stale-slot detection only,
```

**updateOutput thunk -> PATCH /api/outputs/:id**
```
$ grep -n -B2 -A8 'export async function updateOutput' frontend/src/features/pipelines/services/outputService.ts | head -20
50-}
51-
52:export async function updateOutput(
53-  outputId: string,
54-  payload: UpdateOutputPayload,
55-): Promise<Output> {
56-  const response = await httpClient.patch<Output>(`/api/outputs/${outputId}`, payload);
57-  invalidateOutput(outputId);
58-  return normalizeOutput(response.data);
59-}
60-
```

**Tests exercising collection in OutputEditorSheet/configPatch**
```
$ grep -rln -i 'collection' frontend/src/features/pipelines/ui/outputEditor/*.test.* | head; grep -n -i 'collection' frontend/src/features/pipelines/ui/outputEditor/OutputEditorSheet.configPatch.test.tsx | head
frontend/src/features/pipelines/ui/outputEditor/buildOutputConfig.test.ts
frontend/src/features/pipelines/ui/outputEditor/ConditionalFormatsField.test.tsx
frontend/src/features/pipelines/ui/outputEditor/durationFormat.seam.test.ts
frontend/src/features/pipelines/ui/outputEditor/outputConfigTypes.conditionalFormats.test.ts
frontend/src/features/pipelines/ui/outputEditor/outputConfigTypes.hel1410.test.ts
frontend/src/features/pipelines/ui/outputEditor/OutputEditorSheet.configPatch.test.tsx
frontend/src/features/pipelines/ui/outputEditor/OutputEditorSheet.duration.test.tsx
frontend/src/features/pipelines/ui/outputEditor/OutputEditorSheet.labels.test.tsx
frontend/src/features/pipelines/ui/outputEditor/OutputEditorSheet.openingState.test.tsx
129:  it("keeps a stored collection layout: 'list' when only the format changes", async () => {
131:    await openAndWaitForColumns(outputOf("collection", stored));
272:      ["collection", "collection", { fieldMapping: { value: "a" }, layout: "list" }],
305:  it("collection create writes layout: 'grid'", async () => {
307:    await choose("Output kind", "Collection");
```

**Unknown-key rejection code**
```
$ sed -n 56,100p backend/src/main/scala/com/helio/services/pipelines/OutputConfigValidation.scala
  /** `written` = what the caller sent (create body / PATCH patch); `stored` = the pre-write config
   *  (empty on create). */
  def validate(kind: OutputKind, written: JsObject, stored: JsObject): Either[String, Unit] = {
    val known = KnownKeys.getOrElse(kind, Shared)
    val kindName = OutputKind.asString(kind)
    val offending = written.fields.toVector.collect {
      case (key, value) if !known.contains(key) && !tolerated(stored, key, value) => key
    }.sorted
    if (offending.nonEmpty) {
      val described = offending.map(k => describe(kind, kindName, known, k)).mkString("; ")
      Left(s"Unknown config key${if (offending.size > 1) "s" else ""} for a $kindName Output: $described. Valid keys: ${known.toVector.sorted.mkString(", ")}")
    } else
      validateChartType(written, stored).flatMap(_ => validateBinCount(written, stored)).flatMap(_ => ChartReferenceMarks.validate(written, stored)).flatMap(_ => validateAggregation(kind, written, stored))
  }

  private def tolerated(stored: JsObject, key: String, value: JsValue): Boolean =
    stored.fields.get(key) match {
      case Some(existing) => value == JsNull || existing == value
      case None           => false
    }

  private def changed(written: JsObject, stored: JsObject, key: String): Option[JsValue] =
    written.fields.get(key).filter(v => !stored.fields.get(key).contains(v))

  private def describe(kind: OutputKind, kindName: String, known: Set[String], key: String): String =
    Renames.get(key).filter(known.contains).map(r => s"`$key` (renamed: use `$r`)")
      .orElse(Option.when(DeadStyling.contains(key))(s"`$key` (no renderer reads it; chart styling lives on the panel's appearance.chart)"))
      .orElse(Option.when(KnownKeys.exists { case (k, keys) => k != kind && keys.contains(key) && !Shared.contains(key) })(s"`$key` (not a $kindName config key)"))
      .orElse(nearest(known, key).map(n => s"`$key` (did you mean `$n`?)"))
      .getOrElse(s"`$key`")

  private def nearest(known: Set[String], key: String): Option[String] =
    known.toVector.sorted.map(k => k -> distance(k.toLowerCase, key.toLowerCase)).filter(_._2 <= 2).sortBy(_._2).headOption.map(_._1)

  private def distance(a: String, b: String): Int = {
    val prev = Array.tabulate(b.length + 1)(identity)
    for (i <- 1 to a.length) {
      var diag = prev(0)
      prev(0) = i
      for (j <- 1 to b.length) {
        val up = prev(j)
        prev(j) = math.min(math.min(prev(j) + 1, prev(j - 1) + 1), diag + (if (a(i - 1) == b(j - 1)) 0 else 1))
        diag = up
      }
    }
```

**Backend tests on collection config keys / unknown key**
```
$ grep -rln -E 'OutputConfigValidation' backend/src/test | head; grep -rn -E 'baseType|itemOptions|collectionOptions' backend/src/test | head -8
backend/src/test/scala/com/helio/api/protocols/assistant/AssistantProposalToolSchemasSpec.scala
backend/src/test/scala/com/helio/api/routes/pipelines/DurationFormatSeamSpec.scala
backend/src/test/scala/com/helio/api/routes/pipelines/OutputRoutesSpec.scala
backend/src/test/scala/com/helio/infrastructure/persistence/V117DeadOutputConfigKeysMigrationSpec.scala
backend/src/test/scala/com/helio/infrastructure/persistence/V118LegacyMetricFormatMigrationSpec.scala
backend/src/test/scala/com/helio/services/pipelines/ConditionalFormatsWriteSpec.scala
backend/src/test/scala/com/helio/services/pipelines/OutputConfigValidationSpec.scala
backend/src/test/scala/com/helio/services/patchsets/RefinementEditShapeSpec.scala
backend/src/test/scala/com/helio/api/protocols/proposals/DashboardProposalProtocolSpec.scala:194:      val config = JsObject("baseType" -> JsString("metric"), "layout" -> JsString("list"))
backend/src/test/scala/com/helio/api/ApiRoutesSpec.scala:353:    // no Panel-level equivalent (timeline sort/collection baseType are now
backend/src/test/scala/com/helio/api/routes/proposals/DashboardApplyProposalConfigSpec.scala:9: *  path as any other panel create (design.md D1-D3) — collection baseType/layout,
backend/src/test/scala/com/helio/infrastructure/persistence/V117DeadOutputConfigKeysMigrationSpec.scala:29:    """(jsonb_typeof(config) = 'object' AND (jsonb_exists_any(config, ARRAY['metricLabel', 'metricUnit', 'chartAnnotation', 'collectionOptions', 'timelineOptions',
backend/src/test/scala/com/helio/infrastructure/persistence/V117DeadOutputConfigKeysMigrationSpec.scala:56:    "chartAnnotation" -> ("chart", "annotation"), "collectionOptions" -> ("collection", "layout"), "timelineOptions" -> ("timeline", "sort"))
backend/src/test/scala/com/helio/infrastructure/persistence/V117DeadOutputConfigKeysMigrationSpec.scala:110:              |  collection_options = '{"baseType": "metric", "layout": "list", "itemOptions": {"x": 1}}', timeline_options = '{"sort": "desc"}'""".stripMargin)
backend/src/test/scala/com/helio/infrastructure/persistence/V117DeadOutputConfigKeysMigrationSpec.scala:132:          ins("e-live-wins", "collection", """{"layout": "grid", "collectionOptions": {"layout": "list", "baseType": "metric"}}""")
backend/src/test/scala/com/helio/infrastructure/persistence/V117DeadOutputConfigKeysMigrationSpec.scala:133:          ins("e-bad-layout", "collection", """{"collectionOptions": {"layout": "tile"}}""")
```

**OutputConfigValidationSpec unknown-key tests**
```
$ grep -n -E '" in |should|Unknown config key' backend/src/test/scala/com/helio/services/pipelines/OutputConfigValidationSpec.scala | head -20
4:import org.scalatest.matchers.should.Matchers
20:    OutputConfigValidation.validate(kind, written, stored) shouldBe Right(())
24:  "known keys" should {
25:    "accept every kind's full known set (string-valued placeholders where no shape is checked)" in {
33:    "accept referenceLines and referenceBands on a chart only, and list them in KeysDoc" in {
36:      rejected(OutputKind.Metric, marks) should include("`referenceBands` (not a metric config key)")
37:      OutputConfigValidation.KeysDoc should (include("referenceLines") and include("referenceBands") and include("at most 5") and include("at most 3"))
40:    "name referenceLines when its shape is invalid" in {
41:      rejected(OutputKind.Chart, obj("referenceLines" -> JsArray(obj("value" -> s("95"))))) should include("referenceLines[0].value")
44:    "reject a typo'd key per kind, naming it with a did-you-mean hint" in {
50:        msg should include(s"`$typo`")
51:        msg should include(s"did you mean `$intended`?")
55:    "say a key valid for another kind is not a config key of this one" in {
56:      rejected(OutputKind.Table, obj("chartType" -> s("bar"))) should include("`chartType` (not a table config key)")
59:    "suggest the rename for known legacy keys, and the panel appearance for dead styling keys" in {
60:      rejected(OutputKind.Metric, obj("metricLabel" -> s("x"))) should include("use `label`")
61:      rejected(OutputKind.Metric, obj("metricUnit" -> s("x"))) should include("use `unit`")
62:      rejected(OutputKind.Chart, obj("chartAnnotation" -> s("x"))) should include("use `annotation`")
64:        rejected(OutputKind.Chart, obj(k -> obj())) should include("appearance.chart")
68:    "list every offending key, sorted, and the valid keys" in {
```

**OutputRoutesSpec: 400 on unknown key & collection config**
```
$ grep -n -i -E 'collection|Unknown config key' backend/src/test/scala/com/helio/api/routes/pipelines/OutputRoutesSpec.scala | head
49:import scala.collection.concurrent.TrieMap
412:    // no renderer reads them, so they are unknown config keys (contract change, not a fixture edit).
```

**noData computation**
```
$ grep -rn 'noData' frontend/src --include=*.tsx --include=*.ts | grep -v -E '\.test\.' | head
frontend/src/features/panels/ui/detailModal/usePanelDetailData.ts:63:    noData,
frontend/src/features/panels/ui/detailModal/usePanelDetailData.ts:88:    noData,
frontend/src/features/panels/ui/detailModal/PanelDetailModal.tsx:61:    noData,
frontend/src/features/panels/ui/detailModal/PanelDetailModal.tsx:240:              noData={noData}
frontend/src/features/panels/ui/grid/MobilePanelStack.tsx:80:      noData={panelData.noData}
frontend/src/features/panels/ui/PanelFullscreenOverlay.tsx:110:  noData,
frontend/src/features/panels/ui/PanelFullscreenOverlay.tsx:227:            noData={noData}
frontend/src/features/panels/ui/PanelCard.tsx:234:        noData={panelData.noData}
frontend/src/features/panels/ui/PanelCard.tsx:309:          noData={panelData.noData}
frontend/src/features/panels/ui/PanelCardBody.tsx:72:  noData,
```

**usePanelData noData**
```
$ grep -n -B2 -A4 'noData' frontend/src/features/panels/hooks/usePanelData.ts | head -50
30-  /** Classification of `error` — `null` when there is no error. */
31-  errorKind: RequestErrorKind | null;
32:  noData: boolean;
33:  /** HEL-946 Bug C(2): true when `noData` is caused by the bound Output's
34-   *  node never having been materialized by a successful pipeline run, as
35-   *  opposed to a node that ran and legitimately returned zero rows.
36:   *  Always `false` while `noData` is `false`. */
37-  neverMaterialized: boolean;
38-  /** HEL-451 design D4: whether MORE rows exist upstream than are currently
39-   *  loaded (`paginationEntry?.hasMore`) — branch-independent, unlike
40-   *  `usingPagination && paginationHasMore` (HEL-448's original predicate),
--
342-      error: null,
343-      errorKind: null,
344:      noData: false,
345-      neverMaterialized: false,
346-      paginationRows: null,
347-      rowsTruncated: false,
348-      refresh,
--
355-  const isLoading =
356-    paginationEntry == null || (paginationEntry.isLoadingMore === true && rows.length === 0);
357:  const noData =
358-    paginationEntry != null && !paginationEntry.isLoadingMore && rows.length === 0 && !error;
359-  // HEL-946 Bug C(2) -- defaults to `true` (materialized) before the fetch
360-  // resolves, so `neverMaterialized` never fires spuriously while loading;
361:  // `paginationEntry.materialized` only becomes meaningful once `noData` is
362-  // also true.
363:  const neverMaterialized = noData && paginationEntry?.materialized === false;
364-  const isRefreshing = paginationEntry?.isLoadingMore ?? false;
365-
366-  return {
367-    data: null,
--
371-    error,
372-    errorKind,
373:    noData,
374-    neverMaterialized,
375-    paginationRows: rows.length > 0 ? rows : null,
376-    rowsTruncated: paginationEntry?.hasMore ?? false,
377-    refresh,
```

**configPatch test: collection format-only edit & create**
```
$ sed -n 120,150p frontend/src/features/pipelines/ui/outputEditor/OutputEditorSheet.configPatch.test.tsx; sed -n 300,325p frontend/src/features/pipelines/ui/outputEditor/OutputEditorSheet.configPatch.test.tsx

async function openAndWaitForColumns(output: Output) {
  renderSheet(output);
  await waitFor(() =>
    expect(http.get.mock.calls.some(([u]) => String(u).includes("/capabilities"))).toBe(true),
  );
}

describe("OutputEditorSheet edit Save -- config patch (HEL-1389)", () => {
  it("keeps a stored collection layout: 'list' when only the format changes", async () => {
    const stored = { fieldMapping: { value: "a" }, layout: "list", format: "number" };
    await openAndWaitForColumns(outputOf("collection", stored));
    await choose("Format", "Percent (%)");
    const body = await saveEdit();
    expect(body.config).toEqual({ format: "percent" });
    expect(merged(stored, body).layout).toBe("list");
  });

  it("keeps a stored timeline sort: 'desc' when only the field mapping changes", async () => {
    const stored = { fieldMapping: { time: "a", event: "b" }, sort: "desc" };
    await openAndWaitForColumns(outputOf("timeline", stored));
    await choose("Event field", "c");
    const body = await saveEdit();
    expect(body.config).toEqual({ fieldMapping: { time: "a", event: "c" } });
    expect(merged(stored, body).sort).toBe("desc");
  });

  it("clears a stored metric literal label/unit when both are switched to field bindings", async () => {
    const stored = { fieldMapping: { value: "a" }, label: "Revenue", unit: "$" };
    await openAndWaitForColumns(outputOf("metric", stored));
    const labelMode = screen.getByRole("group", { name: "Label mode" });
    });
    await waitFor(() => expect(http.post).toHaveBeenCalled());
    return (http.post.mock.calls[0][1] as { config: Record<string, unknown> }).config;
  }

  it("collection create writes layout: 'grid'", async () => {
    renderSheet(null);
    await choose("Output kind", "Collection");
    expect((await saveCreate()).layout).toBe("grid");
  });

  it("timeline create writes sort: 'asc'", async () => {
    renderSheet(null);
    await choose("Output kind", "Timeline");
    expect((await saveCreate()).sort).toBe("asc");
  });

  it("table create with a hidden column and no reorder writes the visible array", async () => {
    renderSheet(null);
    await choose("Output kind", "Table");
    await screen.findByText("c");
    fireEvent.click(screen.getByRole("checkbox", { name: "c" }));
    expect((await saveCreate()).columnOrder).toEqual(["a", "b"]);
  });
});
```

**METRIC_FORMAT_OPTIONS**
```
$ grep -n -B1 -A10 'METRIC_FORMAT_OPTIONS' frontend/src/features/pipelines/ui/outputEditor/OutputKindFields.tsx | sed -n 1,16p
252-
253:export const METRIC_FORMAT_OPTIONS: SelectOption[] = [
254-  { value: "number", label: "Number" },
255-  { value: "integer", label: "Integer" },
256-  { value: "currency", label: "Currency ($)" },
257-  { value: "percent", label: "Percent (%)" },
258-  { value: "duration", label: "Duration" },
259-  { value: "durationMs", label: "Duration (ms)" },
260-];
261-
262-interface MetricKindFieldsProps {
263-  fieldOptions: SelectOption[];
--
309-          onChange={onFormatChange}
310:          options={METRIC_FORMAT_OPTIONS}
311-        />
```

**MetricRenderer return JSX (element order)**
```
$ sed -n 146,200p frontend/src/features/panels/ui/renderers/MetricRenderer.tsx
  // unmapped slot. The literal-text override path (typed directly in panel config, rather
  // than resolved from a bound column) is out of scope for this ticket; see the sibling
  // config-depth ticket under HEL-291.
  const hasValue = !!data?.value;
  const matched = resolveRule(conditionalFormats, data?.value);
  const valueText = formatMetricValue(data?.value, format) || "--";

  return (
    <div className="panel-content panel-content--metric">
      <span className="panel-content__metric-value">
        {matched ? (
          // The tone class wraps ONLY the glyph, the value text and the sr text. The unit stays a sibling
          // outside it so it keeps inheriting the panel colour (`--panel-text-override`) exactly as today.
          <span
            className={`panel-content__metric-figure panel-content__metric-figure--tone-${matched.tone}`}
            title={ruleName(matched)}
          >
            <ToneGlyph tone={matched.tone} size="lg" />
            {valueText}
            <ToneSrText rule={matched} />
          </span>
        ) : (
          valueText
        )}
        {data?.unit && !isDurationFormat(format) && (
          <span className="panel-content__metric-unit">{data.unit}</span>
        )}
      </span>
      {/* The "No data" fallback is keyed on value presence, not label presence — a missing
          label alone should not present as a data-availability problem. */}
      {hasValue ? (
        data?.label && <span className="panel-content__metric-label">{data.label}</span>
      ) : (
        <span className="panel-content__metric-label">No data</span>
      )}
      {trend && (
        <span className={`panel-content__metric-trend ${trendDirectionClass}`}>{trend}</span>
      )}
      {((!trend && comparison) || (sparkline && sparkline.length >= 2)) && (
        // Column when spacious; one inline row in the compact container (default 3x2 card).
        <div className="panel-content__metric-meta">
          {!trend && comparison && <ComparisonLine comparison={comparison} format={format} />}
          {sparkline && sparkline.length >= 2 && <MetricSparkline values={sparkline} />}
        </div>
      )}
    </div>
  );
}
```

**OutputKind has Timeline & Collection (backend)**
```
$ grep -rn -E 'case object (Timeline|Collection)' backend/src/main/scala | head -3
backend/src/main/scala/com/helio/domain/model/model.scala:611:  case object Collection extends OutputKind
backend/src/main/scala/com/helio/domain/model/model.scala:612:  case object Timeline   extends OutputKind
```

**update-output schema / MCP kind enum**
```
$ sed -n 53,56p helio-mcp/src/tools/outputs.ts; grep -n -E 'outputKindSchema' helio-mcp/src/tools/outputs.ts | head -4
// Mirrors CreatePipelineTransactionalOutputRequest's kind enum
// (schemas/pipelines/create-pipeline-transactional-output-request.schema.json).
const outputKindSchema = z.enum(["table", "metric", "chart", "collection", "timeline", "markdown"]);

55:const outputKindSchema = z.enum(["table", "metric", "chart", "collection", "timeline", "markdown"]);
154:        kind: outputKindSchema,
```

**Panel.scala lists typeId among removed flat fields**
```
$ grep -rn 'typeId' backend/src/main/scala/com/helio/domain/model/Panel.scala backend/src/main/scala/com/helio/domain/panels/*.scala | head -5
backend/src/main/scala/com/helio/domain/model/Panel.scala:17: *  nullable per-subtype fields (`typeId`, `fieldMapping`, `content`,
```

**No typeId binding on the Panel types in frontend**
```
$ grep -rn 'typeId' frontend/src/features/panels --include=*.ts --include=*.tsx | grep -v -E '\.test\.' | head
frontend/src/features/panels/hooks/usePanelPolling.ts:4: * Polls `refresh` every `refreshInterval` seconds as long as `typeId` is set.
frontend/src/features/panels/hooks/usePanelPolling.ts:7: * - No-ops when `refreshInterval` is null/undefined or `typeId` is null/undefined.
frontend/src/features/panels/hooks/usePanelPolling.ts:10: * - Clears the interval on unmount or whenever `refreshInterval`/`typeId` changes.
frontend/src/features/panels/hooks/usePanelPolling.ts:15:  typeId: string | null | undefined,
frontend/src/features/panels/hooks/usePanelPolling.ts:25:    if (!refreshInterval || !typeId) return;
frontend/src/features/panels/hooks/usePanelPolling.ts:63:  }, [refreshInterval, typeId]);
```

**PanelDetailModal collection CSS rules and their class names**
```
$ sed -n 1,30p frontend/src/features/panels/ui/detailModal/PanelDetailModal.sections.css; sed -n 190,210p frontend/src/features/panels/ui/detailModal/PanelDetailModal.mobile.css
/* Collection layout segmented control (HEL-247). A two-option grid/list toggle;
   shares the mode-toggle recipe (accent selection wash, neutral hairline) so it
   reads as the same control family. */

.panel-detail-modal__segmented {
  display: flex;
  gap: var(--space-1);
}

.panel-detail-modal__segmented-btn {
  flex: 1;
  height: var(--control-md);
  padding: 0 var(--space-3);
  border: 1px solid var(--app-border-subtle);
  border-radius: var(--app-radius-sm);
  background: transparent;
  color: var(--app-text-muted);
  font-size: var(--text-sm);
  font-weight: var(--weight-medium);
  transition:
    border-color var(--app-transition),
    background-color var(--app-transition),
    color var(--app-transition);
}

.panel-detail-modal__segmented-btn:hover {
  border-color: var(--app-border-strong);
  background: var(--app-surface-soft);
  color: var(--app-text);
}
    min-height: 44px;
  }

  /* HEL-247: Collection editor — the grid/list layout segmented buttons must
     also meet the 44px tap minimum. The base-type Select and the value-field /
     label / unit Selects are already covered by the `.ui-select__trigger` rule
     above, and the label/unit mode toggles by `.panel-detail-modal__mode-toggle-btn`. */
  /* Hit expander, not an inflated box — see `shared/ui/tapTarget.css`. */
  .panel-detail-modal__segmented-btn {
    position: relative;
  }

  .panel-detail-modal__segmented-btn::after {
    content: "";
    position: absolute;
    top: 50%;
    left: 0;
    right: 0;
    height: 44px;
    transform: translateY(-50%);
  }
```

**Are those collection-layout classes used in any tsx?**
```
$ grep -rn -E 'collection-layout|panel-detail-modal__layout|layout-toggle|layout-option' frontend/src --include=*.tsx --include=*.ts | head -5; echo rc-grep-done
rc-grep-done
```

**outputId required at panel create**
```
$ sed -n 55,72p backend/src/main/scala/com/helio/services/panels/PanelCreateBuilder.scala
              id           = PanelId(UUID.randomUUID().toString),
              dashboardId  = dashboardId,
              title        = RequestValidation.normalizePanelTitle(request.title),
              meta         = ResourceMeta(createdBy = user.id.value, createdAt = now, lastUpdated = now),
              appearance   = appearance,
              ownerId      = user.id,
              createConfig = createConfig
            )
            panel.validateConfig match {
              case Left(msg) => Future.successful(Left(ServiceError.BadRequest(msg)))
              case Right(_)  =>
                // HEL-1189 design.md D4: create has no pre-existing persisted controls, so every
                // entry in a new panel's `controls` is "new" and gets validated.
                outputControlsValidator.reject(outputIdOf(panel), controlsOf(panel), Vector.empty, user).flatMap {
                  case Left(err) => Future.successful(Left(err))
                  case Right(_)  =>
                    rejectInconsistentForm(formConfigOf(panel), user).map {
                      case Left(err) => Left(err)
```

**panel-detail-modal__segmented used anywhere in source?**
```
$ grep -rn 'segmented' frontend/src --include=*.tsx --include=*.ts | head -5; echo '(end of grep; no lines above = unused in ts/tsx)'
frontend/src/features/panels/ui/detailModal/PanelDetailModal.css.test.ts:193:// HEL-247: the Collection editor's grid/list layout segmented buttons are
frontend/src/features/panels/ui/detailModal/PanelDetailModal.css.test.ts:201:  it("the layout segmented buttons clear the 44px floor", () => {
frontend/src/features/panels/ui/detailModal/PanelDetailModal.css.test.ts:202:    expectTapExpander(mobileBlock, ".panel-detail-modal__segmented-btn");
(end of grep; no lines above = unused in ts/tsx)
```

**outputKindSchema users and add_output kind**
```
$ grep -n 'outputKindSchema\|registerTool(\|"add_output"\|"update_output"' helio-mcp/src/tools/outputs.ts | head -20; sed -n 140,158p helio-mcp/src/tools/outputs.ts
55:const outputKindSchema = z.enum(["table", "metric", "chart", "collection", "timeline", "markdown"]);
127:  server.registerTool(
128:    "add_output",
154:        kind: outputKindSchema,
164:  server.registerTool(
165:    "update_output",
191:  server.registerTool(
204:  server.registerTool(
224:  server.registerTool(
235:  server.registerTool(
253:  server.registerTool(
266:  server.registerTool(
278:  server.registerTool(
299:  server.registerTool(
335:  server.registerTool(
354:  server.registerTool(
        "fieldMapping (a markdown Output's text is the literal `config.content`; sending a " +
        "fieldMapping key for either kind is a 400). `rootId` (HEL-913, multi-root only) " +
        "names WHICH root a root-bound Output attaches to — mutually exclusive with " +
        "`nodeStepId`; omit it on a single-root pipeline (the backend auto-resolves the one " +
        "root). Requires editor or owner access on the pipeline. " +
        COMPARE_CONFIG_DOC +
        " " +
        OUTPUT_CONFIG_KEYS_DOC +
        " " +
        CONDITIONAL_FORMATS_CONFIG_DOC +
        " Returns the created Output.",
      inputSchema: {
        pipelineId: z.string().min(1),
        nodeStepId: z.string().min(1).optional(),
        kind: outputKindSchema,
        name: z.string().min(1),
        config: z.record(z.string(), z.unknown()).optional(),
        rootId: z.string().min(1).optional(),
      },
```

**MetricOutputConfig has no trend**
```
$ grep -n -B2 -A14 'export interface MetricOutputConfig' frontend/src/features/pipelines/ui/outputEditor/outputConfigTypes.ts | grep -n -i -E 'trend|interface|compare' 
3:155:export interface MetricOutputConfig {
9:161-  /** HEL-1275 — `config.compare` (`previous_run | 1d | 7d | 30d | custom:<ISO-8601 duration>`);
11:163-  compare?: string | null;
17:169-export interface MarkdownOutputConfig {
```

**Timeline Time/Event field select labels**
```
$ grep -n -A25 'function SimpleMappingFields' frontend/src/features/pipelines/ui/outputEditor/OutputKindFields.tsx | grep -E 'aria|label|Select' | head
399-      <span className="output-editor-sheet__data-label">{title}</span>
402-          <label className="output-editor-sheet__mapping-label" htmlFor={`output-slot-${slot.key}`}>
403-            {slot.label}
404-          </label>
405-          <Select
407-            ariaLabel={`${slot.label} field`}
```

**fetchPanels endpoint**
```
$ grep -n -B2 -A6 'export async function fetchPanels' frontend/src/features/panels/services/panelService.ts; grep -rn 'httpClient.get' frontend/src/features/panels/services/panelService.ts | head
28-}
29-
30:export async function fetchPanels(dashboardId: string): Promise<Panel[]> {
31-  const response = await httpClient.get<PagedResult<Panel>>(
32-    `/api/dashboards/${dashboardId}/panels`,
33-  );
34-  return response.data.items;
35-}
36-
31:  const response = await httpClient.get<PagedResult<Panel>>(
```

**Swap output reachable from detail modal OutputPanelSection**
```
$ sed -n 70,86p frontend/src/features/panels/ui/detailModal/OutputPanelSection.tsx
        {placementCount === null
          ? "Used on — dashboards"
          : `Used on ${placementCount} dashboard${placementCount === 1 ? "" : "s"}`}
      </p>
      {swapPickerOpen ? (
        <OutputPicker
          dashboardId={panel.dashboardId}
          currentDashboardPanels={[]}
          mode="swap"
          swapPanelId={panel.id}
          onClose={() => setSwapPickerOpen(false)}
        />
      ) : null}
    </div>
  );
}
```

**typeId across living specs (post-edit working tree), counts**
```
$ grep -rc typeId openspec/specs | grep -v ':0' | sort -t: -k2 -nr | head -20
openspec/specs/panel-polling/spec.md:7
openspec/specs/panel-type-rendering/spec.md:1
openspec/specs/echarts-chart-panel/spec.md:1
openspec/specs/dashboard-export-import/spec.md:1
```

**echarts-chart-panel typeId mention (deferred, C3)**
```
$ grep -n typeId openspec/specs/echarts-chart-panel/spec.md; git diff --stat origin/main...HEAD -- openspec/specs/echarts-chart-panel | cat; git status --short openspec/specs/echarts-chart-panel | cat; echo '(no output above = unedited)'
20:- **WHEN** a panel with `type: "chart"` has no data bound (`typeId` is absent)
(no output above = unedited)
```

**write-path-audit remaining typeId in living spec (task 4.1)**
```
$ grep -n typeId openspec/specs/write-path-audit/spec.md; echo rc=$?
rc=1
```

**dashboard-export-import / panel-polling typeId remaining in LIVING specs (changed only at archive via deltas)**
```
$ grep -n typeId openspec/specs/dashboard-export-import/spec.md openspec/specs/panel-polling/spec.md | cut -c1-120
openspec/specs/dashboard-export-import/spec.md:11:The system SHALL expose `GET /api/dashboards/:id/export` that returns 
openspec/specs/panel-polling/spec.md:7:When a panel has a numeric `refreshInterval` and a bound `typeId`, the frontend S
openspec/specs/panel-polling/spec.md:10:- **WHEN** a panel with `refreshInterval=30` and a bound `typeId` is mounted
openspec/specs/panel-polling/spec.md:17:#### Scenario: No polling when typeId is unset
openspec/specs/panel-polling/spec.md:18:- **WHEN** a panel has no `typeId` binding
openspec/specs/panel-polling/spec.md:29:If a panel's `typeId` is set to null (binding removed), any active polling inter
openspec/specs/panel-polling/spec.md:31:#### Scenario: Removing typeId stops polling
openspec/specs/panel-polling/spec.md:32:- **WHEN** a panel's `typeId` is patched to null while polling is active
```

**typeId in the change's delta files (should be only Reason/Migration history)**
```
$ grep -rn typeId openspec/changes/restate-remaining-stale-panel-specs/specs | cut -c1-200
openspec/changes/restate-remaining-stale-panel-specs/specs/panel-polling/spec.md:4:**Reason**: Gates polling on a bound `typeId`, a binding panels no longer have (removed by the pipelines-and-outputs 
openspec/changes/restate-remaining-stale-panel-specs/specs/panel-polling/spec.md:8:**Reason**: Same stale `typeId` binding as above.
```

**Probes in a throwaway copy of HEAD's openspec/specs (Purpose delta; zero-requirement spec)**
```
$ bash /tmp/claude-1000/-home-matt-Development-helio/9b21e65f-3fe7-47b2-9c41-c08a39656cd5/scratchpad/probe_grammar.sh
### Probe A: a '## MODIFIED Purpose' delta on panel-type-rendering
Change 'pa' has issues
✗ [ERROR] panel-type-rendering/spec.md: No delta sections found. Add headers such as "## ADDED Requirements" or move non-delta notes outside specs/.
✗ [ERROR] file: Change must have at least one delta. No deltas found. Ensure your change has a specs/ directory with capability folders (e.g. specs/http-server/spec.md) containing .md files that use delta headers (## ADDED/MODIFIED/REMOVED/RENAMED Requirements) and that each requirement includes at least one "#### Scenario:" block. If this change intentionally modifies no specs (pure refactor, tooling, docs), set "skip_specs: true" in the change's .openspec.yaml instead. Tip: run "openspec change show <change-id> --json --deltas-only" to inspect parsed deltas.
Next steps:
rc=1

### Probe B: a delta that REMOVES the only requirement of collection-panel-type (zero requirements left)
Change 'pb' is valid
validate rc=0
  collection-panel-type: update

Validation errors in rebuilt spec for collection-panel-type (will not write changes):
  ✗ Spec must have at least one requirement
  → This change removes the last requirement 'collection-panel-type' has. To retire the capability and delete its spec, add `retire_capabilities: true` to the change's .openspec.yaml (alongside its `schema:`, which that file requires), then rerun.
Aborted. No files were changed.
archive rc=1
```

**Simulated archive in a throwaway copy of the working tree (not archived in the worktree)**
```
$ bash /tmp/claude-1000/-home-matt-Development-helio/9b21e65f-3fe7-47b2-9c41-c08a39656cd5/scratchpad/sim_archive.sh
Applying changes to openspec/specs/collection-panel-type/spec.md:
  + 1 added
  - 1 removed
Applying changes to openspec/specs/dashboard-export-import/spec.md:
  ~ 1 modified
Applying changes to openspec/specs/mcp-panel-composition-tools/spec.md:
  + 3 added
  - 3 removed
Applying changes to openspec/specs/metric-panel-trend-indicator/spec.md:
  ~ 2 modified
Applying changes to openspec/specs/panel-polling/spec.md:
  + 2 added
  - 2 removed
Applying changes to openspec/specs/panel-type-rendering/spec.md:
  ~ 2 modified
Applying changes to openspec/specs/timeline-panel-rendering/spec.md:
  + 1 added
  ~ 2 modified
  - 1 removed
Applying changes to openspec/specs/timeline-panel-type/spec.md:
  + 1 added
  - 1 removed
Totals: + 12, ~ 7, - 14, → 0
Specs updated successfully.
Change 'restate-remaining-stale-panel-specs' archived as '2026-10-15-restate-remaining-stale-panel-specs'.
archive rc=0
--- openspec validate --specs --strict (summary)
✓ spec/workspace-resource-search
✓ spec/workspace-tag-teardown
✓ spec/write-path-audit
Totals: 494 passed, 0 failed (494 items)
--- typeId after archive, in the specs this change touches
openspec/specs/panel-type-rendering/spec.md:49:`metric`, `markdown`, `collection`, `timeline`). No panel kind has a `typeId` binding, and a `text` pan
--- requirement headers after archive
[collection-panel-type]
8:### Requirement: A collection Output's config is fieldMapping, layout, format and conditionalFormats
[collection-panel-rendering]
8:### Requirement: Grid and list layouts
22:### Requirement: Desktop overflow scrolls inside the panel
31:### Requirement: A collection Output renders one metric item per loaded row
49:### Requirement: A collection with no rows shows a no-data state
[collection-config-editor]
8:### Requirement: The Output editor sheet presents collection fields
22:### Requirement: Editing a collection Output sends only the changed config keys
[timeline-panel-type]
8:### Requirement: Timeline is an Output kind in every Output-kind contract surface
[timeline-panel-rendering]
8:### Requirement: Timeline renders bound rows as a vertical chronological event list
28:### Requirement: Timeline rendering scales with panel size and degrades gracefully
56:### Requirement: The Output editor sheet maps the timeline time and event fields
[metric-panel-trend-indicator]
8:### Requirement: Metric panel renders trend indicator when trend data is present
37:### Requirement: Trend indicator font-size scales with container query breakpoints
[panel-polling]
6:### Requirement: Polling stops cleanly when the panel unmounts
13:### Requirement: Polling pauses when the browser tab is hidden
24:### Requirement: Panel rows are re-fetched on the configured refresh interval
43:### Requirement: Polling stops when the polling hook's binding becomes empty
```

**Pinning frontend tests, run fresh with nice -n 19 and 2 workers**
```
$ bash /tmp/claude-1000/-home-matt-Development-helio/9b21e65f-3fe7-47b2-9c41-c08a39656cd5/scratchpad/run_jest.sh
# files run (absolute paths, own worktree):
/home/matt/Development/helio/.claude/worktrees/task/restate-remaining-stale-panel-specs/HEL-1598/frontend/src/features/pipelines/ui/outputEditor/OutputEditorSheet.configPatch.test.tsx
/home/matt/Development/helio/.claude/worktrees/task/restate-remaining-stale-panel-specs/HEL-1598/frontend/src/features/panels/ui/renderers/MetricRenderer.test.tsx
/home/matt/Development/helio/.claude/worktrees/task/restate-remaining-stale-panel-specs/HEL-1598/frontend/src/features/panels/ui/renderers/TimelineRenderer.test.tsx
/home/matt/Development/helio/.claude/worktrees/task/restate-remaining-stale-panel-specs/HEL-1598/frontend/src/features/panels/ui/renderers/CollectionRenderer.test.tsx
/home/matt/Development/helio/.claude/worktrees/task/restate-remaining-stale-panel-specs/HEL-1598/frontend/src/features/panels/hooks/usePanelPolling.test.ts
# run (HELIO_JEST_MAX_WORKERS=2):
Test Suites: 5 passed, 5 total
Tests:       72 passed, 72 total
exit=0
```

**(corrected paths) OutputPanel validateConfig / Patch / applyPatch; rejectMissingOutput**
```
$ grep -n -E 'def validateConfig|outputId is required|case class Patch|def applyPatch' backend/src/main/scala/com/helio/domain/panels/OutputPanel.scala; grep -n -A12 'def rejectMissingOutput' backend/src/main/scala/com/helio/services/panels/PanelUpdateValidation.scala | head -16
181:  final case class Patch(outputId: Option[OutputId], controls: Option[Vector[OutputControlSpec]]) {
223:  def validateConfig: Either[String, Unit] =
224:    if (config.outputId.value.isEmpty) Left("outputId is required")
227:  def applyPatch(patch: OutputPanelConfig.Patch): OutputPanel =
```

**ProposalPanelSupport imports/uses: buildDataConfig derives {outputId} for output; divider path in test**
```
$ sed -n 62,100p backend/src/test/scala/com/helio/api/routes/proposals/DashboardApplyProposalSpec.scala
    // used to guard (HEL-292's "preserve the aggregation spec" and "apply a
    // proposal without an aggregation field unchanged") are deleted, not
    // rewritten: there is no Output-panel-config equivalent to preserve.

    // HEL-293 — content/url/orientation flow through the create-side config
    // for non-data panels, applied via the existing PanelConfigCodec decoders.
    "apply markdown content, image url, and divider orientation from a proposal (HEL-293)" in {
      val before = dashboardCount()
      val body =
        s"""{
           |  "dashboardName": "Content Depth",
           |  "panels": [
           |    {"title":"Roadmap","type":"markdown","content":"# Q3 goals\\n\\nShip it"},
           |    {"title":"Logo","type":"image","url":"https://example.com/logo.png"},
           |    {"title":"Sep","type":"divider","orientation":"vertical"}
           |  ]
           |}""".stripMargin
      apply(body) ~> routes ~> check {
        status shouldBe StatusCodes.Created
        val obj    = responseAs[String].parseJson.asJsObject
        val panels = obj.fields("panels").convertTo[Vector[JsValue]].map(_.asJsObject)

        val markdown = panels.find(_.fields("title").convertTo[String] == "Roadmap").get
        markdown.fields("config").asJsObject.fields("content").convertTo[String] shouldBe "# Q3 goals\n\nShip it"

        val image = panels.find(_.fields("title").convertTo[String] == "Logo").get
        image.fields("config").asJsObject.fields("imageUrl").convertTo[String] shouldBe "https://example.com/logo.png"
        image.fields("config").asJsObject.fields("imageFit").convertTo[String] shouldBe "contain"

        val divider = panels.find(_.fields("title").convertTo[String] == "Sep").get
        divider.fields("config").asJsObject.fields("orientation").convertTo[String] shouldBe "vertical"
      }
      dashboardCount() shouldBe (before + 1)
    }

    // HEL-904 task 3.10a: `"chart"` is a fully retired panel type — appearance
    // (chartType/axis labels/seriesColors), metric literal label/unit
    // overrides, and chartType-validity rejection are all now Output-owned
    // concepts with no Panel-level equivalent to test here (design.md:
```

**V117 audit table keeps baseType/itemOptions**
```
$ grep -n -E 'hel1387_dropped_output_config_keys|baseType' backend/src/main/resources/db/migration/V117__migrate_v94_dead_output_config_keys.sql | head -6
15:--   collectionOptions (whole object)  -                    none       -                                  drop (baseType/itemOptions kept in audit)
40:CREATE TABLE IF NOT EXISTS hel1387_dropped_output_config_keys (
52:ALTER TABLE hel1387_dropped_output_config_keys NO FORCE ROW LEVEL SECURITY;
136:      INSERT INTO hel1387_dropped_output_config_keys (output_id, output_kind, config_key, config_value, action, live_key)
172:ALTER TABLE hel1387_dropped_output_config_keys ENABLE ROW LEVEL SECURITY;
173:ALTER TABLE hel1387_dropped_output_config_keys FORCE ROW LEVEL SECURITY;
```

**Legacy chart flat-field config: unit test pins output panel config**
```
$ grep -rn -E 'chartType|xAxisLabel' backend/src/test/scala/com/helio/api/routes/proposals/*.scala | head -6
backend/src/test/scala/com/helio/api/routes/proposals/CombinedApplyProposalRollbackSpec.scala:18:    // an invalid `chartType` -- ChartPanel-specific validation, task 3.10a)
backend/src/test/scala/com/helio/api/routes/proposals/DashboardApplyProposalSpec.scala:98:    // (chartType/axis labels/seriesColors), metric literal label/unit
backend/src/test/scala/com/helio/api/routes/proposals/DashboardApplyProposalSpec.scala:99:    // overrides, and chartType-validity rejection are all now Output-owned
backend/src/test/scala/com/helio/api/routes/proposals/DashboardApplyProposalSpec.scala:104:    // chartType") are deleted outright, not rewritten.
```

**Legacy flat fields are never read by the apply path (no .chartType/.xAxisLabel/... reads outside the case class)**
```
$ grep -rn -E '\.(chartType|xAxisLabel|yAxisLabel|seriesColors|aggregation|label|unit|sort)\b' backend/src/main/scala/com/helio/services/proposals/ProposalPanelSupport.scala backend/src/main/scala/com/helio/services/proposals/DashboardProposalService.scala | grep -E 'panel\.|p\.' | head; echo '--- reads of fieldMapping:'; grep -rn 'panel.fieldMapping\|p.fieldMapping' backend/src/main/scala | head
--- reads of fieldMapping:
backend/src/main/scala/com/helio/api/protocols/proposals/DashboardProposalProtocol.scala:116:      p.fieldMapping.foreach(v => fields("fieldMapping") = v)
backend/src/main/scala/com/helio/services/proposals/ProposalPanelSupport.scala:321:        "fieldMapping" -> panel.fieldMapping.getOrElse(JsObject.empty)
```

**Gate: openspec validate (change, strict)**
```
$ openspec validate restate-remaining-stale-panel-specs --type change --strict; echo exit=$?
Change 'restate-remaining-stale-panel-specs' is valid
exit=0
```

**Gate: openspec validate --specs --strict (working tree, includes the direct edits)**
```
$ openspec validate --specs --strict 2>&1 | tail -3; echo exit=${PIPESTATUS[0]}
✓ spec/workspace-tag-teardown
✓ spec/write-path-audit
Totals: 494 passed, 0 failed (494 items)
exit=0
```

**Cycle 2 CR1: hook starts the interval at mount, no initial-load wait**
```
$ sed -n 24,56p frontend/src/features/panels/hooks/usePanelPolling.ts
  useEffect(() => {
    if (!refreshInterval || !typeId) return;

    const ms = refreshInterval * 1000;
    let intervalId: ReturnType<typeof setInterval> | null = null;

    function startInterval() {
      if (intervalId !== null) return; // already running — don't stack
      intervalId = setInterval(() => {
        refreshRef.current();
      }, ms);
    }

    function stopInterval() {
      if (intervalId !== null) {
        clearInterval(intervalId);
        intervalId = null;
      }
    }

    function handleVisibilityChange() {
      if (document.visibilityState === "hidden") {
        stopInterval();
      } else {
        startInterval();
      }
    }

    // Only start immediately if the tab is already visible.
    if (document.visibilityState !== "hidden") {
      startInterval();
    }
```

**Cycle 2 CR2: Format option values and labels**
```
$ sed -n 253,260p frontend/src/features/pipelines/ui/outputEditor/OutputKindFields.tsx
export const METRIC_FORMAT_OPTIONS: SelectOption[] = [
  { value: "number", label: "Number" },
  { value: "integer", label: "Integer" },
  { value: "currency", label: "Currency ($)" },
  { value: "percent", label: "Percent (%)" },
  { value: "duration", label: "Duration" },
  { value: "durationMs", label: "Duration (ms)" },
];
```

**Cycle 2 CR3: which proposal-schema descriptions say what**
```
$ grep -n -o -E '"(fieldMapping|aggregation|chartType|xAxisLabel|label|unit|sort)": \{|Deprecated and ignored: this panel-level field has no effect on the applied panel|Legacy field, decoded but never applied' schemas/dashboards/dashboard-proposal.schema.json | head -40
45:"fieldMapping": {
48:Deprecated and ignored: this panel-level field has no effect on the applied panel
48:Legacy field, decoded but never applied
50:"aggregation": {
53:Deprecated and ignored: this panel-level field has no effect on the applied panel
53:Legacy field, decoded but never applied
68:"chartType": {
71:Legacy field, decoded but never applied
73:"xAxisLabel": {
75:Legacy field, decoded but never applied
79:Legacy field, decoded but never applied
86:Legacy field, decoded but never applied
88:"label": {
91:Deprecated and ignored: this panel-level field has no effect on the applied panel
91:Legacy field, decoded but never applied
93:"unit": {
96:Deprecated and ignored: this panel-level field has no effect on the applied panel
96:Legacy field, decoded but never applied
98:"sort": {
101:Legacy field, decoded but never applied
129:"label": {
```

**Cycle 2: workflow-state.md not tracked**
```
$ git ls-files openspec/changes/restate-remaining-stale-panel-specs/workflow-state.md | wc -l; grep -n workflow-state .git/info/exclude $(git rev-parse --git-common-dir)/info/exclude 2>/dev/null | head -3; git check-ignore -v openspec/changes/restate-remaining-stale-panel-specs/workflow-state.md
0
/home/matt/Development/helio/.git/info/exclude:21:workflow-state.md
/home/matt/Development/helio/.git/info/exclude:21:workflow-state.md	openspec/changes/restate-remaining-stale-panel-specs/workflow-state.md
```

**Cycle 2 gate: change validate**
```
$ openspec validate restate-remaining-stale-panel-specs --type change --strict; echo exit=$?
Change 'restate-remaining-stale-panel-specs' is valid
exit=0
```

**Cycle 2 gate: simulated archive + specs validate (throwaway copy)**
```
$ bash /tmp/claude-1000/-home-matt-Development-helio/9b21e65f-3fe7-47b2-9c41-c08a39656cd5/scratchpad/sim_archive.sh | grep -E 'archive rc|Totals|typeId' 
Totals: + 12, ~ 7, - 14, → 0
archive rc=0
Totals: 494 passed, 0 failed (494 items)
--- typeId after archive, in the specs this change touches
openspec/specs/panel-type-rendering/spec.md:49:`metric`, `markdown`, `collection`, `timeline`). No panel kind has a `typeId` binding, and a `text` pan
```

**Cycle 2 CR3 (final wording): evaluator's split is only partly right; every listed field carries 'decoded but never applied' (grep above, lines 48,53,71,75,79,86,91,96,101); four also open with 'Deprecated and ignored'**
```
$ openspec validate restate-remaining-stale-panel-specs --type change --strict
Change 'restate-remaining-stale-panel-specs' is valid
```
