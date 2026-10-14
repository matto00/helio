# Evidence (HEL-1592, constraint C1)

Every claim below is followed by the command that verifies it and its captured output. Wording follows ground truth.
Run in this worktree (paths shown are this worktree's). Verdicts: all design.md "Code facts" and every delta sentence
verified TRUE; no delta wording needed amending.

## Verdict table

| Claim | Verdict | Section |
|---|---|---|
| canonical kinds = text/markdown/image/divider/output/form | true | A |
| PanelContent branches (text literal, markdown, image, divider, form, MetricRenderer fallback) | true | A |
| OutputPanelContent kinds chart/table/metric/markdown/collection/timeline | true | A |
| MetricOutputPanel `{value,label:cfg.label??"",unit:cfg.unit??""}`, no trend/fieldMapping | true | A |
| MetricRenderer: No data keyed on value; label omitted when empty; unit hidden for duration | true | A |
| Badge renders `panel.type` | true | A |
| Image: sanitizeImageUrl rules (bare relative, data:, //evil.com) | true | B |
| selector / unknown-type requirements | true-enough, left unchanged (see Out of scope) | C |
| mcp REMOVED Reasons (enum, HEL-907, sort, metricId, preValidateBindings, /api/metrics 404) | true | D |
| create_content_panel offers divider | true | D |

## A. Frontend code facts (tasks 1.1, 1.2)
```
$ grep consumers of changed strings
helio-mcp/src/tools/proposal.ts:38:// No `divider`: excluded for a stated product-scope reason (purely presentational layout chrome),
schemas/dashboards/dashboard-proposal.schema.json:35:          "description": "No `divider`: excluded from the agent-facing set by an explicit, stated product-scope reason (purely presentational layout chrome, nothing an
frontend/src/features/sources/ui/forms/TemplateParametersField.tsx:5:// purely presentational over the detected name list + value map.
scripts/check-schema-drift.mjs:11:  AGENT_SURFACE_EXCLUSIONS,
scripts/check-schema-drift.mjs:291:  AGENT_SURFACE_EXCLUSIONS,
scripts/check-schema-drift.mjs:427:    exclusions: AGENT_SURFACE_EXCLUSIONS,
scripts/check-schema-drift.selftest.mjs:13:  AGENT_SURFACE_EXCLUSIONS,
scripts/check-schema-drift.selftest.mjs:57:    typeof AGENT_SURFACE_EXCLUSIONS.divider === "string" &&
scripts/check-schema-drift.selftest.mjs:58:      AGENT_SURFACE_EXCLUSIONS.divider.length > 20,
scripts/check-schema-drift.selftest.mjs:63:    exclusions: AGENT_SURFACE_EXCLUSIONS,
scripts/lib/agentFacingPanelTypes.mjs:4:// A canonical kind is agent-facing unless it is in AGENT_SURFACE_EXCLUSIONS (a `{ kind: reason }`
scripts/lib/agentFacingPanelTypes.mjs:14: *  it is excluded because it is purely presentational. */
scripts/lib/agentFacingPanelTypes.mjs:15:export const AGENT_SURFACE_EXCLUSIONS = {
scripts/lib/agentFacingPanelTypes.mjs:17:    "purely presentational layout chrome: no content, binding or data an agent can author; " +
scripts/lib/agentFacingPanelTypes.mjs:18:    "create_panel's enum excludes it, and the proposal surfaces mirror that parity",
openspec/specs/mcp-panel-composition-tools/spec.md:342:for a stated product-scope reason (purely presentational layout chrome with no content, binding or data an agent can

$ description text consumers
schemas/dashboards/dashboard-proposal.schema.json

$ canonical enum
19:      "enum": ["text", "markdown", "image", "divider", "output", "form"]
20-    },
21-    "config": {
22-      "type": "object"
23-    },
24-    "appearance": {
25-      "$ref": "panel-appearance.schema.json"
26-    }
27-  },

$ PanelContent dispatcher
21:import { DividerRenderer } from "./renderers/DividerRenderer";
22:import { FormRenderer } from "./renderers/FormRenderer";
23:import { ImageRenderer } from "./renderers/ImageRenderer";
24:import { MarkdownRenderer } from "./renderers/MarkdownRenderer";
25:import { MetricRenderer } from "./renderers/MetricRenderer";
27:import { TextRenderer } from "./renderers/TextRenderer";
63:   *  `usePanelData` — table panels only (`TableRenderer`'s disclosure).
67:  /** HEL-301: forwarded to `ChartRenderer` only — see `ChartPanel`'s
70:  /** HEL-572: forwarded to `ChartRenderer` (chart-kind output panels only)
73:  /** HEL-1027 design.md D4 — forwarded to `TableRenderer` (table-kind output panels only), fired
76:   *  `PanelFullscreenOverlay`) — `TableRenderer` optional-chains both, so a missing callback is a
81:   *  (`PanelPaginationState.total`), forwarded to `TableRenderer`'s loaded-scope disclosure. */
97:   *  always the literal `null` that type declares, which is what makes `TableRenderer`'s
237:  if (isTextPanel(panel)) return <TextRenderer content={panel.config.content} />;
238:  if (isMarkdownPanel(panel)) return <MarkdownRenderer content={panel.config.content} />;
239:  if (isImagePanel(panel)) return <ImageRenderer panel={panel} />;
240:  if (isDividerPanel(panel)) return <DividerRenderer panel={panel} />;
242:    // HEL-1085 design.md D1: dispatches to `FormRenderer`, which renders the
246:    return <FormRenderer panel={panel} />;
253:  return <MetricRenderer data={data} />;
  dashboard

### Requirement: propose_dashboard exposes the current agent-facing panel type set

The MCP `propose_dashboard` and `apply_proposal` tools SHALL accept the panel `type` set
`text/markdown/image/output/form` and SHALL NOT offer `divider`, which is excluded from the agent-facing proposal set
for a stated product-scope reason (purely presentational layout chrome with no content, binding or data an agent can
author) recorded in the repository's agent-surface exclusion table. The panel kinds
`metric`, `chart`, `table`, `collection` and `timeline` no longer exist and SHALL NOT be offered. No stale type list
SHALL remain in the proposal flow's tool schemas or descriptions. The `dashboard-proposal.schema.json`
`ProposalPanel.type` enum SHALL be exactly the same set.

#### Scenario: Divider is not offered in the proposal flow
- **WHEN** an agent inspects the `propose_dashboard`/`apply_proposal` panel `type` enum
- **THEN** `divider` is absent from the accepted values and only the five proposable types remain
$ PanelContent 225-255
        compact={compact}
        outputId={panel.config.outputId}
        onDataPointSelect={onDataPointSelect}
        onSortChange={onSortChange}
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
$ OutputPanelContent kinds
34:/** Dispatches on an output-kind panel's fetched Output `kind`/`config`
36: *  enough info to render). Non-output panel kinds (text/markdown/image/
85:  // renderer for `output.kind` — no NEW fetch, and therefore no fetch-timing
93:  // live, reproducible transient window where a Table-kind sibling panel's
106:  // drives this component's kind-dispatch/cross-filter render — the two can no longer disagree,
132:      output.kind,
161:  const kind = output.kind;
164:  if (kind === "chart") {
190:  } else if (kind === "table") {
218:  } else if (kind === "metric") {
239:  } else if (kind === "markdown") {
242:  } else if (kind === "collection") {
254:  } else if (kind === "timeline") {
267:        <span className="panel-content__state-label">Unsupported output kind</span>
283:          output kind) rather than inside `TableRenderer` alone, so a table
$ MetricOutputPanel
35:   *  `undefined` = none provided, so the loaded-rows value stands. */
40:/** HEL-1275 — the metric branch of `OutputPanelContent`: today's loaded-rows value, replaced by the
73:  // The server's own selection rule (also reads `aggregation.value`, where the editor stores an
76:  const valueColumn = resolvedMetric?.field;
83:    valueColumn && cfg.aggregation?.agg
84:      ? String(computeAggregate(rowsAsRecords, valueColumn, cfg.aggregation.agg) ?? "")
85:      : valueColumn && firstRow
86:        ? String(firstRow[valueColumn] ?? "")
88:  // HEL-1326 design D6 — under a server-applied filter the headline is the full-filtered-set value,
100:          ? filteredMetric.value === null
102:            : String(filteredMetric.value)
105:  const value =
111:  const data: MappedPanelData = { value, label: cfg.label ?? "", unit: cfg.unit ?? "" };
117:    baselineValue === null ? null : metricBaselineText(baselineValue, cfg.format, cfg.unit);
$ PanelCard badge
319-      <div className="panel-grid-card__footer">
320:        <span className="panel-grid-card__type-badge">{panel.type}</span>
321-        {outputId && (
322-          <ProvenanceTrigger
```

### TextRenderer / MetricRenderer / ImagePanel
```
$ TextRenderer
interface TextRendererProps {
  /** The panel's literal `config.content`; a text panel has no data binding. */
  content?: string | null;
}

export function TextRenderer({ content }: TextRendererProps) {
  const live = content ?? null;
  if (live && live.length > 0) {
    return (
      <div className="panel-content panel-content--text">
        <span className="panel-content__text-live">{live}</span>
      </div>
    );
  }
  return (
    <div className="panel-content panel-content--text" aria-hidden="true">
      <span className="panel-content__text-line panel-content__text-line--long" />
      <span className="panel-content__text-line panel-content__text-line--short" />
    </div>
  );
}
$ ImageRenderer
import type { ImagePanel } from "../../types/panel";
import { ImagePanel as ImagePanelView } from "../ImagePanel";

interface ImageRendererProps {
  panel: ImagePanel;
}

export function ImageRenderer({ panel }: ImageRendererProps) {
  return (
    <ImagePanelView
      imageUrl={panel.config.imageUrl || null}
      imageFit={panel.config.imageFit || null}
      caption={panel.config.caption ?? null}
    />
  );
}
$ sanitizeImageUrl
$ MetricRenderer
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
 *  a genuinely numeric value; `"number"`/absent keeps the original HEL-297 formatter exactly. */
export function formatMetricValue(
  value: string | undefined,
  format?: MetricFormat | null,
): string | undefined {
  if (value === undefined || value.trim() === "") return value;
  const n = Number(value);
  if (!Number.isFinite(n)) return value;
  switch (format) {
    case "integer":
      return new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(n);
    case "currency":
      return new Intl.NumberFormat(undefined, { style: "currency", currency: "USD" }).format(n);
    case "duration":
      return formatDuration(n);
    case "durationMs":
      return formatDuration(n / 1000);
    case "percent":
      return new Intl.NumberFormat(undefined, {
        style: "percent",
        maximumFractionDigits: 2,
      }).format(n);
    case "number":
    default:
      return new Intl.NumberFormat(undefined, {
        maximumFractionDigits: 2,
        useGrouping: false,
      }).format(n);
  }
}

/** A duration-formatted value already carries its unit words (`5m 30s`), so the metric `unit` suffix is hidden
 *  for it (HEL-1308, owner ruling on P6). A display rule only: the stored `unit` config is never rewritten. */
export function isDurationFormat(format: MetricFormat | null | undefined): boolean {
  return format === "duration" || format === "durationMs";
}

/** The history baseline as shown beside the headline: formatted value plus the unit, if any. */
export function metricBaselineText(
  baselineValue: number,
  format: MetricFormat | null | undefined,
  unit: string | undefined,
): string {
  const shownUnit = isDurationFormat(format) ? undefined : unit;
  return `${formatMetricValue(String(baselineValue), format) ?? ""}${shownUnit ? ` ${shownUnit}` : ""}`;
}

const GLYPHS = { up: "\u25B2", down: "\u25BC", flat: "\u25AC" } as const;

function ComparisonLine({
27:        {comparison.label} comparison available from{" "}
41:      aria-label={`${spokenDirection} ${magnitude} ${comparison.words}`}
43:      {GLYPHS[comparison.direction]} {magnitude} vs {comparison.label}
64:  // `value`, `label`, and `unit` are all column references resolved via usePanelData
65:  // (`firstRow[field]`), not literal text — a metric with, say, `label` mapped to a column
78:          // The tone class wraps ONLY the glyph, the value text and the sr text. The unit stays a sibling
91:        {data?.unit && !isDurationFormat(format) && (
92:          <span className="panel-content__metric-unit">{data.unit}</span>
95:      {/* The "No data" fallback is keyed on value presence, not label presence — a missing
96:          label alone should not present as a data-availability problem. */}
98:        data?.label && <span className="panel-content__metric-label">{data.label}</span>
100:        <span className="panel-content__metric-label">No data</span>
$ ImagePanel + sanitize
import { useState, type CSSProperties } from "react";

import "./ImagePanel.css";
import { Image } from "lucide-react";
import { ICON_SIZE } from "../../../shared/ui/iconSize";

interface ImagePanelProps {
  imageUrl: string | null;
  imageFit: string | null;
  caption?: string | null;
}

// HEL-246: a root-relative internal upload path (`/api/uploads/image/<id>`,
// as returned by the upload endpoint) has no scheme of its own, so it must
// be resolved against a base URL to parse at all — `new URL(url)` (no base)
// throws for any relative input. Resolving against `window.location.origin`
// lets both an absolute `http(s)://` URL and a root-relative upload path
// parse through the same call; the protocol allow-list check below still
// runs against the resolved URL.
function sanitizeImageUrl(url: string): string | null {
  try {
    const parsed = new URL(url, window.location.origin);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      return null;
    }
    // Render a genuine root-relative path (`/api/uploads/image/<id>`) with
    // the original literal string, not `parsed.href` — a bare path needs no
    // browser-support work as an <img src>. Guarded to single-slash-prefixed
    // inputs that still resolve to *this page's own origin*: a
    // protocol-relative/backslash-smuggled value like "//evil.com/x" also
    // starts with "/" but resolves (via the base URL's protocol) to a
    // different origin — that falls through to the plain `parsed.href`
    // branch below instead, which is exactly the same "any absolute
    // http(s) URL is accepted" behavior already in place for a typed
    // external URL, so no new host is trusted here.
    if (url.startsWith("/") && !url.startsWith("//") && parsed.origin === window.location.origin) {
      return url;
    }
    return parsed.href;
  } catch {
    return null;
  }
}

export function ImagePanel({ imageUrl, imageFit, caption }: ImagePanelProps) {
  const safeUrl = imageUrl ? sanitizeImageUrl(imageUrl) : null;
  const trimmedCaption = caption?.trim();
  const objectFit = (imageFit ?? "contain") as CSSProperties["objectFit"];

  // F-112: a broken/unreachable image URL used to leave the browser's native broken-image glyph
  // on screen indefinitely. Swap to the same placeholder markup the "no URL set" case already
  // uses, with copy specific to a load failure. Resets whenever the URL itself changes, so a
  // previously-broken image gets a fresh chance once the user points it somewhere new — adjusted
  // during render (React's documented pattern for "reset state when a prop changes"), not in an
  // effect, since this repo's eslint config flags synchronous setState-in-effect as an error.
  const [hasLoadError, setHasLoadError] = useState(false);
  const [lastSeenUrl, setLastSeenUrl] = useState(safeUrl);
  if (safeUrl !== lastSeenUrl) {
    setLastSeenUrl(safeUrl);
    setHasLoadError(false);
  }

  const visual =
    safeUrl && !hasLoadError ? (
      <div className="image-panel">
        <img
          className="image-panel__img"
          src={safeUrl}
          alt=""
          style={{ objectFit }}
          onError={() => setHasLoadError(true)}
        />
      </div>
    ) : (
      <div className="image-panel image-panel--empty">
        <span className="image-panel__placeholder-icon" aria-hidden="true">
          <Image size={ICON_SIZE.lg} />
        </span>
        <span className="image-panel__placeholder-text">
          {safeUrl
frontend/src/features/panels/ui/ImagePanel.tsx
```

## B. sanitizeImageUrl probe and placeholders (task 1.2)
```
          {safeUrl
            ? "Image failed to load. Check the URL in panel settings."
            : "No image URL set. Open panel settings to configure."}
        </span>
      </div>
    );

  return (
    <div className="image-panel-frame">
      {visual}
      {trimmedCaption ? (
        <p className="image-panel__caption" title={trimmedCaption}>
          {trimmedCaption}
        </p>
      ) : null}
    </div>
  );
}
$ sanitizeImageUrl probe (verbatim function body, origin http://localhost:5173)
"photo.png" -> "http://localhost:5173/photo.png"
"/api/uploads/image/abc" -> "/api/uploads/image/abc"
"data:image/png;base64,AAA" -> null
"javascript:alert(1)" -> null
"//evil.com/x" -> "http://evil.com/x"
"https://example.com/a.png" -> "https://example.com/a.png"
"http://[bad" -> null
$ divider/markdown/form
11:      orientation={panel.config.orientation}
frontend/src/features/panels/ui/PanelContent.tsx:243:    // "Form not configured" placeholder itself for an empty field list. The
frontend/src/features/panels/ui/renderers/FormRenderer.tsx:15:        <span className="panel-content__state-label">Form not configured</span>
16:  /** Literal markdown content — a `markdown`-kind panel's own `content`, or
17:   *  an output-kind panel's Output-fetched `MarkdownOutputConfig.content`.
20:  content: string | null;
23:export function MarkdownRenderer({ content }: MarkdownRendererProps) {
26:      <MarkdownPanelView content={content} />
```

## C. Selector / unknown-type / existing spec (task 1.3)
```
$ markdown placeholder
frontend/src/features/panels/ui/renderers/MarkdownRenderer.tsx
11:  if (!content) {
13:      <div className="markdown-panel markdown-panel--empty">
14:        <span className="markdown-panel__placeholder">
$ selector reqs
79:### Requirement: Unknown panel types degrade gracefully
80-If a panel has an unrecognised or missing type value, the grid MUST render a fallback body rather than crashing or leaving the body blank.
81-
82-#### Scenario: Panel with unknown type falls back to metric rendering
83-- **WHEN** a panel with an unrecognised type is displayed
84-- **THEN** the metric placeholder is shown as a safe fallback
85-
86-### Requirement: Type badge is visible on each panel card
87-Each panel card in the grid MUST display the panel's type as a small visible label so users can identify the type at a glance without relying solely on the placeholder content.
88-
89-#### Scenario: Type badge shown on panel card
90-- **WHEN** any panel is displayed in the grid
91-- **THEN** a small type badge (e.g. "metric", "chart") is visible on the card
--
101:### Requirement: Panel type selector includes markdown option
102-The panel type selector (used when creating or changing a panel's type) SHALL include `markdown`
103-as a selectable option alongside the existing types.
104-
105-#### Scenario: Markdown appears in type selector
106-- **WHEN** the panel type selector is opened
107-- **THEN** `markdown` is listed as a valid selectable type
108-
109:### Requirement: Panel type selector includes image option
110-The panel type selector (used when creating or changing a panel's type) SHALL include `image`
111-as a selectable option alongside the existing types.
112-
113-#### Scenario: Image appears in type selector
114-- **WHEN** the panel type selector is opened
115-- **THEN** `image` is listed as a valid selectable type
116-
117-### Requirement: Metric panel literal label/unit takes precedence over field-mapped values
118-The rendered label/unit text SHALL use a metric panel config's literal `label`/`unit` (see
119-`panel-datatype-binding`) instead of the value resolved from `fieldMapping`, when the literal value is
120-present. When the literal value is absent, rendering SHALL fall back to the existing
121-`fieldMapping`-resolved value unchanged. The literal label/unit SHALL NOT affect the "No data"
$ rest of spec requirements
4:### Requirement: Each panel type renders a visually distinct body
16:- **WHEN** a panel with `type: "metric"` and no `typeId` is displayed in the grid
20:- **WHEN** a panel with `type: "metric"` has a `typeId` and data has been fetched and `trend` is not in the data map
24:- **WHEN** a panel with `type: "metric"` has a `typeId` and the mapped data includes a non-empty `unit` slot
36:- **WHEN** a panel with `type: "metric"` has a `typeId` and bound data contains a `trend` field
40:- **WHEN** a panel with `type: "chart"` and no `typeId` is displayed in the grid
44:- **WHEN** a panel with `type: "chart"` has a `typeId` and data has been fetched
48:- **WHEN** a panel with `type: "text"` and no `typeId` is displayed in the grid
52:- **WHEN** a panel with `type: "text"` has a `typeId` and data has been fetched
56:- **WHEN** a panel with `type: "table"` and no `typeId` is displayed in the grid
60:- **WHEN** a panel with `type: "table"` has a `typeId` and data has been fetched
79:### Requirement: Unknown panel types degrade gracefully
86:### Requirement: Type badge is visible on each panel card
93:### Requirement: Markdown panel type badge is displayed correctly
101:### Requirement: Panel type selector includes markdown option
109:### Requirement: Panel type selector includes image option
117:### Requirement: Metric panel literal label/unit takes precedence over field-mapped values
$ type selector
frontend/src/features/panels/ui/OutputPicker.tsx:32:  { kind: "markdown", label: "Markdown", icon: <AlignLeft size={ICON_SIZE.md} /> },
frontend/src/features/pipelines/ui/outputEditor/OutputEditorSheet.tsx:53:  { value: "markdown", label: "Markdown" },
$ Markdown badge req
### Requirement: Markdown panel type badge is displayed correctly
The type badge on a markdown panel card SHALL display the label "markdown" (consistent with other
panel type badges).

#### Scenario: Markdown panel shows markdown type badge
- **WHEN** a markdown panel is displayed in the grid
- **THEN** a small type badge reading "markdown" is visible on the card

## Purpose
Defines how each panel type renders its body content area inside the dashboard grid, including placeholder states when no data is bound and live states when data is present.
## Requirements
$ unknown fallback test
$ panel creation UI kinds
frontend/src/features/panels/types/panel.ts:65:export type PanelKind = "output" | "text" | "markdown" | "image" | "divider" | "form";
frontend/src/features/panels/types/panel.ts:323:  type: "divider";
frontend/src/features/panels/types/panel.ts:394:    case "divider":
frontend/src/features/panels/ui/OutputPicker.tsx:30:const CONTENT_PANEL_KINDS: { kind: PanelKind; label: string; icon: ReactElement }[] = [
frontend/src/features/panels/ui/OutputPicker.tsx:34:  { kind: "divider", label: "Divider", icon: <Minus size={ICON_SIZE.md} /> },
frontend/src/features/panels/ui/OutputPicker.tsx:117:      for (const { kind, label } of CONTENT_PANEL_KINDS) {
frontend/src/features/panels/ui/OutputPicker.tsx:357:              {CONTENT_PANEL_KINDS.map(({ kind, label, icon }) => {
frontend/src/features/panels/ui/grid/mobilePanelHeights.ts:88:    case "divider":
frontend/src/features/panels/ui/grid/MobilePanelStack.tsx:132:        if (panel.type === "divider") {
frontend/src/features/panels/state/panelNarrowing.ts:28:export const isDividerPanel = (p: Panel): p is DividerPanel => p.type === "divider";
$ unknown test
frontend/src/features/panels/ui/renderers/TableRenderer.test.tsx
frontend/src/features/pipelines/utils/triggerSourceLabel.ts
frontend/src/features/pipelines/ui/outputEditor/outputConfigTypes.test.ts
```
Verdict: markdown/image are listed in OutputPicker.tsx CONTENT_PANEL_KINDS (the only panel-kind picker); unknown kind falls to MetricRenderer (PanelContent.tsx:253). Requirements left unchanged.

## D. MCP / backend facts (task 1.4)
```
$ write.ts HEL-907
  );

  // HEL-907 task 3.6: create_panel/create_panels/bind_panel/create_bound_panel REMOVED from
  // here (no alias) -- replaced by place_outputs/create_content_panel in tools/placements.ts
  // (registerPlacementTools). create_bound_panel's own backend route (POST /api/panels/bound)
  // no longer exists (retired during the Outputs remodel) -- every call has 404'd since then,
  // undetected because no test covered it; bind_panel's PATCH body (config: {dataTypeId,
$ create_content_panel divider
76:      title: "Create a content panel (text/markdown/image/divider)",
78:        "Create ONE panel with no data binding — text/markdown/image/divider only (use " +
85:        "• divider — optional `orientation` (horizontal|vertical, default horizontal), `weight`, " +
94:        type: z.enum(["text", "markdown", "image", "divider"]),
$ metricId in wire surfaces (expect none)
grep exit=1
$ metricId anywhere in proposal services
backend/src/main/scala/com/helio/services/proposals/DashboardProposalService.scala:203:  // and the bound panel kinds that could carry a `metricId`, no longer exist.
exit=0
$ preValidateBindings
155:  def preValidateBindings(
156-      panels: Vector[ProposalPanel],
157-      user: AuthenticatedUser,
158-      outputRepo: OutputRepository,
159-      dataSourceRepo: DataSourceRepository = null
160-  )(implicit ec: ExecutionContext): Future[Either[ServiceError, Unit]] = {
161-    require(outputRepo != null, "ProposalPanelSupport.preValidateBindings requires an OutputRepository")
162-    panels.foldLeft[Future[Either[ServiceError, Unit]]](Future.successful(Right(()))) {
163-      (accF, panel) =>
164-        accF.flatMap {
165-          case Left(err) => Future.successful(Left(err))
166-          case Right(_)  =>
167-            validateDataTypeBinding(panel, user, outputRepo).flatMap {
168-              case Left(err) => Future.successful(Left(err))
169-              case Right(_)  => validateSourceBinding(panel, user, dataSourceRepo)
170-            }
171-        }
172-    }
173-  }
174-
175-  /** HEL-1148: only the source-bound panels' `dataSourceId` check, over every panel — read-only,
176-   *  run before any write (the combined-proposal path calls it before the pipeline phase). */
177-  def preValidateSourceBindings(
178-      panels: Vector[ProposalPanel],
179-      user: AuthenticatedUser,
180-      dataSourceRepo: DataSourceRepository
$ DashboardProposalService deleted note
198-  // (round-4 finding — this is a live validation predicate, not a passive
199-  // list; retargeting it to the wrong set would silently re-require
200-  // `outputId` (formerly `dataTypeId`) on every proposal panel or silently stop requiring it on
201:  // any). `MetricKind`/`TimelineKind`/`MetricIdSupportedKinds` (task 3.10a)
202-  // were deleted outright along with the code paths they guarded — metrics,
203-  // and the bound panel kinds that could carry a `metricId`, no longer exist.
204-  private[services] val DataPanelKinds: Set[String] = Set("output")
$ propose handler catalog
$ sort
schemas/dashboards/dashboard-proposal.schema.json:98:        "sort": {
helio-mcp/src/tools/proposal.ts:58:// `chartType`/`xAxisLabel`/`yAxisLabel`/`seriesColors`/`label`/`unit`/`sort`
helio-mcp/src/tools/proposal.ts:93:  sort: z.enum(["asc", "desc"]).optional(),
$ schema sort
          "description": "Deprecated and ignored: this panel-level field has no effect on the applied panel; set it on the Output's `config` instead. Still accepted so existing callers keep working. Previously: Legacy field, decoded but never applied: the metric panel kind was deleted by the pipelines-and-outputs remodel (HEL-903/904). Retained on the wire for schema stability only."
        },
        "sort": {
          "type": "string",
          "enum": ["asc", "desc"],
          "description": "Legacy field, decoded but never applied: the timeline panel kind was deleted by the pipelines-and-outputs remodel (HEL-903/904). Retained on the wire for schema stability only."
        },
        "layout": {
          "$ref": "#/$defs/ProposalPanelLayout"
        },
        "config": {
$ sort uses in backend main
backend/src/main/scala/com/helio/api/protocols/proposals/DashboardProposalProtocol.scala:43:    // panel's `config.timelineOptions.sort` by `DashboardProposalService`, at
backend/src/main/scala/com/helio/api/protocols/proposals/DashboardProposalProtocol.scala:128:      p.sort.foreach(v => fields("sort") = JsString(v))
backend/src/main/scala/com/helio/services/proposals/ProposalPanelSupport.scala:298:  // (label/unit/aggregation/timelineOptions) were removed along with the
$ validatePanel body sort
35:   *  divider panel's `orientation`, or a timeline panel's `sort` — value
50:      // that used to gate chartType/aggregation/timeline-sort validation here
68:      Left(s"$where: dataSourceId is only supported on a ${DashboardProposalService.SourceBoundKinds.toSeq.sorted.mkString("/")} panel")
$ sort decode test
backend/src/test/scala/com/helio/api/protocols/proposals/DashboardProposalProtocolSpec.scala:26:      sort: Option[String] = None,
backend/src/test/scala/com/helio/api/protocols/proposals/DashboardProposalProtocolSpec.scala:43:    sort         = sort,
backend/src/test/scala/com/helio/api/protocols/proposals/DashboardProposalProtocolSpec.scala:144:  "ProposalPanel.write/read — sort" should {
backend/src/test/scala/com/helio/api/protocols/proposals/DashboardProposalProtocolSpec.scala:145:    "omit the sort key when absent" in {
backend/src/test/scala/com/helio/api/protocols/proposals/DashboardProposalProtocolSpec.scala:147:      json.fields.keySet should not contain "sort"
$ /api/metrics
backend/src/main/scala/com/helio/api/routes/ServiceResponse.scala:51:   *  `204` (HEL-560: `DELETE /api/metrics/:id` returns the unbound panel
backend/src/main/scala/com/helio/app/Main.scala:167:      // HEL-904 task 4.1: `MetricRepository`/`/api/metrics` deleted outright —
backend/src/test/scala/com/helio/api/ApiRoutesSpec.scala
$ read side of sort
42:    // HEL-321: flat timeline `sort` (`asc`/`desc`) derived into the created
43:    // panel's `config.timelineOptions.sort` by `DashboardProposalService`, at
45:    sort: Option[String],
91:          deserializationError(s"Unrecognized control attribute(s): ${unknown.toSeq.sorted.mkString(", ")}")
128:      p.sort.foreach(v => fields("sort") = JsString(v))
153:        sort         = obj.fields.get("sort").map(_.convertTo[String]),
$ any sort validation
backend/src/main/scala/com/helio/services/proposals/ProposalPanelSupport.scala:35:   *  divider panel's `orientation`, or a timeline panel's `sort` — value
backend/src/main/scala/com/helio/services/proposals/ProposalPanelSupport.scala:50:      // that used to gate chartType/aggregation/timeline-sort validation here
$ /api/metrics 404 test
3642-    }
3643-  }
3644-
3645:  // HEL-906 task 4.1 / ticket AC 5: `/api/types`, `/api/metrics`, and `/api/panels/bound` were
3646-  // already deleted outright by HEL-904 -- this asserts the absence directly (404, route not
3647-  // found) rather than relying on the grep-based confirmation in execution-progress.md alone,
3648-  // so a future accidental re-mount fails a test instead of going unnoticed.
3649-  "retired DataType/Metric/bound-panel routes (HEL-904)" should {
3650-    "404 for every GET/PATCH/DELETE /api/types/* route" in {
3651-      Get("/api/types") ~> routes() ~> check { status shouldBe StatusCodes.NotFound }
--
3655-      Get("/api/types/some-id/panel-capabilities") ~> routes() ~> check { status shouldBe StatusCodes.NotFound }
3656-    }
3657-
3658:    "404 for every GET/POST/DELETE /api/metrics/* route" in {
3659:      Get("/api/metrics") ~> routes() ~> check { status shouldBe StatusCodes.NotFound }
3660:      Get("/api/metrics/some-id") ~> routes() ~> check { status shouldBe StatusCodes.NotFound }
3661-    }
3662-
3663-    // `PanelIdSegment` is an unconstrained `Segment` matcher (design.md D5) -- "bound" matches it
3664-    // as a bogus panel id, so this 405s (path matched, method didn't; only GET/PATCH/DELETE are
3665-    // registered under `path(PanelIdSegment)`) rather than 404ing. Either status proves the same
3666-    // thing AC 5 cares about: no `POST /api/panels/bound` route (`BoundPanelRoutes`) exists.
$ Main.scala 165-170
      val alertEventRepo     = new AlertEventRepository(ctx)
      val pipelineScheduleRepo = new PipelineScheduleRepository(ctx)
      // HEL-904 task 4.1: `MetricRepository`/`/api/metrics` deleted outright —
      // metrics no longer exist.
      // HEL-472 (420-A): /api/preferences persistence for the in-app agent's authoring defaults.
      val agentPreferencesRepo = new AgentPreferencesRepository(ctx)
$ HEL-904 timeline deleted
```

## E. Consumers of the changed strings (task 2.1) and baseline checks (task 2.2)
(consumer grep is the first block of section A output: only agentFacingPanelTypes.mjs, proposal.ts, dashboard-proposal.schema.json embed the text; check-schema-drift selftest only asserts the divider reason is a string > 20 chars; no generated artifact or backend resource embeds the description.)
```

> helio@0.7.4 check:schemas
> node scripts/check-schema-drift.mjs

check-schema-drift: raw recursive walk found 152 entries under /home/matt/Development/helio/.claude/worktrees/task/stale-panel-spec-wording/HEL-1592/schemas
schemas in sync with JsonProtocols (124 checked across 54 protocol files)
panel-type enums in sync with backend canonical sets (11 surfaces checked)
panel-kind enum coverage: 7 schema enums/const groups detected, each checked or exempted
AssistantProposalToolSchemas.scala in sync with schemas/ (14 surfaces checked)
exit=0
ok   the real panel.schema.json and create-panel-request.schema.json each yield a const group
ok   consts outside a combinator, and a one-kind combinator const group, are ignored
ok   a nested combinator const group is reported once, by its innermost combinator
ok   a Windows-style key (panels\x.json) matches the same surface written panels/x.json
ok   the real exemption table gives every entry a reason
ok   the real script passes against the repository with form on the agent surfaces

check-schema-drift selftest: all cases passed
exit=0
```

## F. Edits (tasks 2.3-2.5)
```
diff --git a/backend/src/main/scala/com/helio/api/protocols/assistant/AssistantProposalToolSchemas.scala b/backend/src/main/scala/com/helio/api/protocols/assistant/AssistantProposalToolSchemas.scala
index d6876e87b..5a99842b5 100644
--- a/backend/src/main/scala/com/helio/api/protocols/assistant/AssistantProposalToolSchemas.scala
+++ b/backend/src/main/scala/com/helio/api/protocols/assistant/AssistantProposalToolSchemas.scala
@@ -61,2 +61,3 @@ private[protocols] trait AssistantProposalToolSchemas {
-      // here either -- dropped from the proposal flow's agent-facing type set for parity with
-      // create_panel, per that schema file's own description). `form` joins
+      // here either -- excluded from the proposal flow's agent-facing type set as purely
+      // presentational chrome, per the AGENT_SURFACE_EXCLUSIONS table in
+      // scripts/lib/agentFacingPanelTypes.mjs). `form` joins
diff --git a/backend/src/main/scala/com/helio/api/protocols/proposals/DashboardProposalProtocol.scala b/backend/src/main/scala/com/helio/api/protocols/proposals/DashboardProposalProtocol.scala
index 42855718d..e48e8110e 100644
--- a/backend/src/main/scala/com/helio/api/protocols/proposals/DashboardProposalProtocol.scala
+++ b/backend/src/main/scala/com/helio/api/protocols/proposals/DashboardProposalProtocol.scala
@@ -42,3 +42,2 @@ final case class ProposalPanel(
-    // HEL-321: flat timeline `sort` (`asc`/`desc`) derived into the created
-    // panel's `config.timelineOptions.sort` by `DashboardProposalService`, at
-    // flat-binding parity with metric's `label`/`unit`.
+    // HEL-321: legacy flat `sort` field -- decoded and round-tripped, never applied (the
+    // timeline panel kind was deleted by HEL-903/904); retained on the wire for schema stability.
@@ -48,2 +47,2 @@ final case class ProposalPanel(
-    // by `DashboardProposalService.buildCreateRequest`, mirroring the MCP
-    // `create_panel` `config` passthrough. Makes every v1.5 panel-config
+    // by `ProposalPanelSupport.buildCreateRequest`, decoded by `PanelConfigCodec` like
+    // `POST /api/panels`'s `config`. Makes every v1.5 panel-config
diff --git a/backend/src/main/scala/com/helio/services/proposals/ProposalPanelSupport.scala b/backend/src/main/scala/com/helio/services/proposals/ProposalPanelSupport.scala
index 42f61c926..928bc9131 100644
--- a/backend/src/main/scala/com/helio/services/proposals/ProposalPanelSupport.scala
+++ b/backend/src/main/scala/com/helio/services/proposals/ProposalPanelSupport.scala
@@ -34,3 +34,2 @@ object ProposalPanelSupport {
-   *  data-panel binding presence, and — for a chart panel's `chartType`, a
-   *  divider panel's `orientation`, or a timeline panel's `sort` — value
-   *  validity. */
+   *  data-panel binding presence, and a divider panel's `orientation` value
+   *  (the chartType/aggregation/timeline-sort checks were removed with those panel kinds). */
diff --git a/backend/src/test/scala/com/helio/services/proposals/DashboardAuthoringPromptSpec.scala b/backend/src/test/scala/com/helio/services/proposals/DashboardAuthoringPromptSpec.scala
index b42e78633..23cea3ab1 100644
--- a/backend/src/test/scala/com/helio/services/proposals/DashboardAuthoringPromptSpec.scala
+++ b/backend/src/test/scala/com/helio/services/proposals/DashboardAuthoringPromptSpec.scala
@@ -113 +113 @@ class DashboardAuthoringPromptSpec extends AnyWordSpec with Matchers {
-    "instructs the model to emit exactly the panel kinds PanelType.fromString accepts (minus divider, which the proposal flow deliberately excludes for create_panel parity)" in {
+    "instructs the model to emit exactly the panel kinds PanelType.fromString accepts (minus divider, which the proposal flow deliberately excludes as purely presentational chrome)" in {
diff --git a/helio-mcp/src/tools/proposal.ts b/helio-mcp/src/tools/proposal.ts
index c24f63de7..8a9009463 100644
--- a/helio-mcp/src/tools/proposal.ts
+++ b/helio-mcp/src/tools/proposal.ts
@@ -38,3 +38,3 @@ import { CHART_TYPES } from "./chartTypes.js";
-// No `divider`: excluded for a stated product-scope reason (purely presentational layout chrome),
-// mirroring create_panel (scripts/lib/agentFacingPanelTypes.mjs holds the reasoned exclusion table
-// check:schemas enforces). No `metric`/`chart`/`table`/`collection`/`timeline` either — those panel
+// No `divider`: excluded for a stated product-scope reason (purely presentational layout chrome);
+// scripts/lib/agentFacingPanelTypes.mjs holds the reasoned exclusion table (AGENT_SURFACE_EXCLUSIONS)
+// that check:schemas enforces. No `metric`/`chart`/`table`/`collection`/`timeline` either — those panel
@@ -96,2 +96,2 @@ export const panelSchema = z.object({
-  // above, then decoded by the same panel-create path as create_panel's
-  // `config`.
+  // above, then decoded by the same panel-create path (`PanelConfigCodec`) as
+  // `POST /api/panels`'s `config`.
@@ -142,3 +142,3 @@ export function registerProposalTools(server: McpServer, api: HelioApi): void {
-        "`type` ∈ text/markdown/image/output/form (there is no `divider`: dropped for agent/UI parity, " +
-        "mirroring create_content_panel/place_outputs — the backend wire still accepts it on other " +
-        "paths; there is no " +
+        "`type` ∈ text/markdown/image/output/form (there is no `divider`: excluded from the proposal " +
+        "flow as purely presentational chrome — create one with create_content_panel; the backend " +
+        "wire still accepts it on other paths; there is no " +
diff --git a/schemas/dashboards/dashboard-proposal.schema.json b/schemas/dashboards/dashboard-proposal.schema.json
index 21564dd00..a8eb9ffcf 100644
--- a/schemas/dashboards/dashboard-proposal.schema.json
+++ b/schemas/dashboards/dashboard-proposal.schema.json
@@ -35 +35 @@
-          "description": "No `divider`: excluded from the agent-facing set by an explicit, stated product-scope reason (purely presentational layout chrome, nothing an agent can author), mirrored by create_panel's enum (see scripts/lib/agentFacingPanelTypes.mjs). Every other canonical kind is on this wire because the wire can express its required binding: `output` binds `outputId`, `form` binds `dataSourceId` (HEL-1148)."
+          "description": "No `divider`: excluded from the agent-facing set by an explicit, stated product-scope reason (purely presentational layout chrome, nothing an agent can author), recorded in the AGENT_SURFACE_EXCLUSIONS table in scripts/lib/agentFacingPanelTypes.mjs; dividers remain creatable through the MCP create_content_panel tool. Every other canonical kind is on this wire because the wire can express its required binding: `output` binds `outputId`, `form` binds `dataSourceId` (HEL-1148)."
diff --git a/scripts/lib/agentFacingPanelTypes.mjs b/scripts/lib/agentFacingPanelTypes.mjs
index f5d0bb0e3..350854533 100644
--- a/scripts/lib/agentFacingPanelTypes.mjs
+++ b/scripts/lib/agentFacingPanelTypes.mjs
@@ -18 +18 @@ export const AGENT_SURFACE_EXCLUSIONS = {
-    "create_panel's enum excludes it, and the proposal surfaces mirror that parity",
+    "excluded from the proposal surfaces only (the MCP create_content_panel tool still creates dividers)",
```

## G. Residual create_panel probe (task 2.6) and validation
```
$ grep create_panel\b (post-edit)
helio-mcp/src/tools/placementsHandlers.ts:7: * Replaces `create_panel`/`create_panels`/`bind_panel`/`create_bound_panel`
helio-mcp/src/tools/placementsHandlers.ts:37: *  calling `create_panel` alone always was. */
helio-mcp/src/tools/placements.ts:3: * `create_panel`/`create_panels`/`bind_panel`/`create_bound_panel`. This
helio-mcp/src/tools/placements.ts:43:        "all-or-nothing call (POST /api/panels/batch) — replaces create_panel/create_panels/" +
helio-mcp/src/server.test.ts:4: * bind_panel/create_bound_panel/get_panel_capabilities/create_panel/
helio-mcp/src/server.test.ts:46:  "create_panel",
helio-mcp/src/helioApi.ts:895:  // (create_panel/create_panels) are retired; replaced by placeOutputs/createContentPanel below.
helio-mcp/src/helioApi.ts:948:   *  (`POST /api/panels/batch`, HEL-370) — replaces `create_panel`/`create_panels`/`bind_panel`/
helio-mcp/src/tools/write.ts:728:  // HEL-907 task 3.6: create_panel/create_panels/bind_panel/create_bound_panel REMOVED from
$ parity
backend/src/main/scala/com/helio/api/protocols/proposals/DashboardProposalProtocol.scala:51:    // field per surface. See openspec/changes/mcp-proposal-panel-parity.
$ the three phrases
exit=1
$ observed: other stale in mcp spec
34:- **WHEN** a `create_panel` request with `type: "collection"` and a valid `CollectionConfig` is
54:### Requirement: Panel composition tools accept image caption and chart annotation
57:an optional `annotation` on chart-panel `config`, passing each straight through to the panel API so
58:agent-built dashboards can attach static caption/annotation text. The tool descriptions SHALL document
60:behavior (no caption/annotation).
68:#### Scenario: Agent sets a chart annotation
69:- **WHEN** an agent creates or updates a chart panel with `config.annotation: "Source: BLS"`
70:- **THEN** the panel persists with that `annotation` and renders it as a subtitle/footnote
72:#### Scenario: Omitting caption/annotation preserves current behavior
73:- **WHEN** an agent creates an image or chart panel without a `caption`/`annotation`
74:- **THEN** the panel is created with no caption/annotation, exactly as before this change
144:### Requirement: Proposal panels accept an optional metricId bound via the existing HEL-500 config path
146:Proposal panels SHALL accept an optional `metricId` (string) on the `propose_dashboard`/
150:exactly as today — `metricId` does not relax that requirement. When present and valid,
151:`ProposalPanelSupport.buildCreateRequest`/`buildDataConfig` SHALL include `metricId` in the created
152:panel's config, reusing the same `MetricPanelConfig`/`ChartPanelConfig`/`TablePanelConfig` `metricId`
154:SHALL document the field. The `propose_dashboard` tool's `description` string SHALL document `metricId`
157:proposal supplying only the pre-existing flat fields (no `metricId`) SHALL behave byte-for-byte as
160:#### Scenario: Proposal panel with a valid metricId is created bound to that metric
163:  `fieldMapping`, and a `metricId` resolving to a metric the caller owns
$ other specs typeId
openspec/specs/dashboard-export-import/spec.md
openspec/specs/echarts-chart-panel/spec.md
openspec/specs/panel-polling/spec.md
openspec/specs/panel-type-rendering/spec.md
openspec/specs/write-path-audit/spec.md
$ validate
Change 'restate-stale-panel-spec-wording' is valid
```
Classification: every remaining create_panel hit is accurate history ("replaces/retired/REMOVED", or the server.test.ts removed-tool list). Zero false parity claims; zero hits for the three phrases.

## H. Gates after editing (tasks 3.1, 3.2, 3.2a)
```
> helio@0.7.4 check:schemas
> node scripts/check-schema-drift.mjs

check-schema-drift: raw recursive walk found 152 entries under /home/matt/Development/helio/.claude/worktrees/task/stale-panel-spec-wording/HEL-1592/schemas
schemas in sync with JsonProtocols (124 checked across 54 protocol files)
panel-type enums in sync with backend canonical sets (11 surfaces checked)
panel-kind enum coverage: 7 schema enums/const groups detected, each checked or exempted
AssistantProposalToolSchemas.scala in sync with schemas/ (14 surfaces checked)
exit=0
ok   the real script passes against the repository with form on the agent surfaces

check-schema-drift selftest: all cases passed
--- helio-mcp typecheck

> helio-mcp@0.1.0 typecheck
> tsc --noEmit -p tsconfig.typecheck.json

exit=0
--- jest (rootDir = this worktree; helio-mcp + scripts)
PASS helio-mcp/src/tools/durationFormatSeam.test.ts
PASS helio-mcp/src/tools/read.buildListConnectorsResult.test.ts
Test Suites: 51 passed, 51 total
Tests:       469 passed, 469 total
Snapshots:   0 total
Time:        7.444 s
Ran all test suites matching helio-mcp|scripts.
exit=0
--- sbt
[info] - should include a memory bullet list when memory is non-empty, and no preferences section
[info] - should include both a preferences summary and a memory bullet list when both are present
[info] userMessage
[info] - should not include an agentContext section when agentContext is empty
[info] - should include the rendered agentContext section after the grounding section when non-empty
[info] - should instructs the model to emit exactly the panel kinds PanelType.fromString accepts (minus divider, which the proposal flow deliberately excludes as purely presentational chrome)
[info] [hel1468-guard] ScalaTest summary: failed=0 aborted=0 unreadable=0
[info] Run completed in 927 milliseconds.
[info] Total number of tests run: 32
[info] Suites: completed 2, aborted 0
[info] Tests: succeeded 32, failed 0, canceled 0, ignored 0, pending 0
[info] All tests passed.
[success] elapsed time: 2 s, cache 87%, 27 disk cache hits, 4 onsite tasks
exit=0
```

## Out of scope, observed (task 3.3; for Delivery triage)
- `openspec/specs/panel-type-rendering/spec.md` Purpose line ("how each panel type renders ... placeholder states when no data is bound and live states when data is present") is loosely worded; it predates the `typeId` removal. Not edited.
- `openspec/specs/mcp-panel-composition-tools/spec.md` line ~34: a scenario still calls `create_panel` with `type: "collection"` (inside a requirement not named by the ticket's five); other requirements there (chart `annotation`, flat-field back-compat) may also be stale. Re-check at triage.
- `panel-type-rendering` "Panel type selector includes markdown/image option" speaks of selecting "or changing a panel's type"; the only picker found is `OutputPicker.tsx` (creation). Left unchanged.
- "Unknown panel types degrade gracefully": behaviour holds in code (MetricRenderer fallback), but no `PanelContent` test greps for an unrecognised type (searched `unrecogni|unknown` in PanelContent.test.tsx: none).
- Other specs still containing `typeId`: dashboard-export-import, echarts-chart-panel, panel-polling, write-path-audit (command: `grep -ln typeId openspec/specs/*/spec.md`). `metric-panel-trend-indicator`, `collection-panel-type`, `timeline-panel-type` specs not examined (design D2).
- `backend .../ProposalPanelSupport.scala:35` comment was stale (timeline sort check does not exist) - fixed here; `bindingKey = if (...) "outputId" else "outputId"` at ProposalPanelSupport.scala (buildCreateRequest) is a redundant conditional - not touched.
- helio-mcp source comments changed: a local `helio-mcp/dist` rebuild is needed for the running MCP to pick up the new `propose_dashboard` description (no behaviour change).
