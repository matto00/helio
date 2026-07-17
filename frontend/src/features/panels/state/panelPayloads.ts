// Thunk payload builders for the CS2c-3c `{ type, config }` wire shape.
//
// The backend `CreatePanelRequest` and `UpdatePanelRequest` carry a typed
// `config` payload whose shape depends on the `type` discriminator. These
// builders construct the JSON body for each thunk so call sites (modal
// editors, slice thunks) never assemble raw config objects ad-hoc.
//
// Every builder returns a value safe to pass directly as the request body
// to the corresponding `panelService` axios call.

import type {
  ChartAggregation,
  ChartTypeOptionsMap,
  CollectionItemOptions,
  CollectionLayout,
  CollectionPanelConfig,
  DividerOrientation,
  DividerPanelConfig,
  ImageFit,
  ImagePanelConfig,
  MarkdownPanelConfig,
  MetricAggregation,
  MetricPanelConfig,
  Panel,
  PanelAppearance,
  PanelConfig,
  PanelKind,
  TableDensity,
  TextPanelConfig,
  TypeConfig,
} from "../types/panel";
import { emptyConfigForKind } from "../types/panel";
import { defaultChartAppearance, defaultPanelAppearance } from "../../../theme/appearance";

// ── Create payload ──────────────────────────────────────────────────────────

export interface CreatePanelBody {
  dashboardId: string;
  title: string;
  type: PanelKind;
  config: PanelConfig;
  /** Optional creation-time appearance. Emitted only for chart panels whose
   *  creation-modal chart-type selector is set, so the selected chart type
   *  takes effect on the created panel's first render (HEL-305). Composed over
   *  the shared default panel/chart appearance. Omitted otherwise, so the
   *  backend applies its default appearance exactly as before. */
  appearance?: PanelAppearance;
}

/** Build a `POST /api/panels` body from the high-level form values collected
 *  by the panel-creation modal.  `typeConfig` (optional, from the modal's
 *  step-3 form) supplies subtype-specific seed fields; `dataTypeId` (if
 *  present) seeds the bound-trio binding. */
export function buildCreatePanelBody(args: {
  dashboardId: string;
  title: string;
  type: PanelKind;
  typeConfig?: TypeConfig | null;
  dataTypeId?: string;
}): CreatePanelBody {
  const config = seedCreateConfig(args.type, args.typeConfig, args.dataTypeId);
  const body: CreatePanelBody = {
    dashboardId: args.dashboardId,
    title: args.title,
    type: args.type,
    config,
  };
  const appearance = seedCreateAppearance(args.type, args.typeConfig);
  if (appearance) {
    body.appearance = appearance;
  }
  return body;
}

/** Carry the creation-modal chart-type selection into the create payload as
 *  `appearance.chart.chartType`, composed over the shared default panel/chart
 *  appearance (HEL-305). Returns `undefined` for non-chart types and for charts
 *  with no chart-type selection, so the `appearance` key is omitted entirely
 *  and the backend applies its default appearance unchanged. */
function seedCreateAppearance(
  type: PanelKind,
  typeConfig: TypeConfig | null | undefined,
): PanelAppearance | undefined {
  if (type !== "chart" || typeConfig?.type !== "chart" || !typeConfig.chartType) {
    return undefined;
  }
  return {
    ...defaultPanelAppearance,
    chart: { ...defaultChartAppearance, chartType: typeConfig.chartType },
  };
}

function seedCreateConfig(
  type: PanelKind,
  typeConfig: TypeConfig | null | undefined,
  dataTypeId: string | undefined,
): PanelConfig {
  const base = emptyConfigForKind(type);
  switch (type) {
    case "metric": {
      // Seed the literal display label/unit (HEL-293 `config.label`/`config.unit`)
      // from the creation modal's "Value label"/"Unit" inputs so they take
      // effect on first render (HEL-305). Empty values are omitted so the
      // absent-vs-null convention leaves them unset.
      const metric: MetricPanelConfig = {
        ...(base as MetricPanelConfig),
        dataTypeId: dataTypeId ?? "",
      };
      if (typeConfig?.type === "metric") {
        if (typeConfig.valueLabel) {
          metric.label = typeConfig.valueLabel;
        }
        if (typeConfig.unit) {
          metric.unit = typeConfig.unit;
        }
      }
      return metric;
    }
    case "chart":
    case "table":
      return {
        ...(base as { dataTypeId: string; fieldMapping: Record<string, string> }),
        dataTypeId: dataTypeId ?? "",
      };
    case "image":
      if (typeConfig?.type === "image" && typeConfig.imageUrl) {
        return { ...(base as ImagePanelConfig), imageUrl: typeConfig.imageUrl };
      }
      return base;
    case "divider":
      // `typeConfig` can never carry a "divider" variant (removed from the
      // creation-time `TypeConfig` union — HEL-249); divider is no longer
      // selectable in the type-select step, so this arm only exists for
      // exhaustiveness over `PanelKind`. Return the unmodified default config.
      return base;
    case "text":
      return {
        ...(base as TextPanelConfig),
        dataTypeId: dataTypeId ?? "",
      };
    case "markdown":
      return {
        ...(base as MarkdownPanelConfig),
        dataTypeId: dataTypeId ?? "",
      };
    case "collection":
      // HEL-305 lesson — carry the creation-time discriminators explicitly
      // rather than relying on a `typeConfig` passthrough that silently drops
      // them. `baseType`/`layout` come from `emptyCollectionConfig` (metric /
      // grid) and the binding is seeded from the DataType step.
      return {
        ...(base as CollectionPanelConfig),
        dataTypeId: dataTypeId ?? "",
      };
  }
}

// ── Update payload ──────────────────────────────────────────────────────────
//
// PATCH `config` objects are partial — only the fields the user is changing
// appear, so the per-subtype `Patch.decode` on the backend preserves
// absent-vs-null semantics. `null` on a field means "clear to default".

export interface UpdatePanelBody {
  title?: string;
  appearance?: unknown;
  type?: PanelKind;
  config?: Record<string, unknown>;
}

/** Build the typed `config` PATCH for a metric/chart/table binding edit.
 *  `aggregation`/`label`/`unit` follow the same absent-vs-null convention
 *  (HEL-292, extended to `label`/`unit` by HEL-243): `undefined` omits the
 *  key entirely (leave unchanged — matches "leaving aggregation controls
 *  unset persists no aggregation"); `null` explicitly clears a previously-
 *  configured value; a value sets/replaces it. */
export function buildBindingPatch(args: {
  typeId: string | null;
  fieldMapping: Record<string, string> | null;
  aggregation?: MetricAggregation | ChartAggregation | null;
  label?: string | null;
  unit?: string | null;
  /** HEL-255 Table display config, folded into the same single Save PATCH.
   *  Each follows the absent-vs-null convention: `undefined` omits the key
   *  (leave unchanged); `null` clears it; a value sets it. */
  density?: TableDensity;
  columnOrder?: string[] | null;
  columnWidths?: null;
  /** HEL-248 Chart per-type display options, folded into the same single Save
   *  PATCH. `undefined` omits the key (untouched → persist nothing); `null`
   *  clears all stored options; an object replaces the keyed map. */
  chartOptions?: ChartTypeOptionsMap | null;
}): Record<string, unknown> {
  const patch: Record<string, unknown> = {
    dataTypeId: args.typeId,
    fieldMapping: args.fieldMapping,
  };
  if (args.aggregation !== undefined) {
    patch.aggregation = args.aggregation;
  }
  if (args.label !== undefined) {
    patch.label = args.label;
  }
  if (args.unit !== undefined) {
    patch.unit = args.unit;
  }
  if (args.density !== undefined) {
    patch.density = args.density;
  }
  if (args.columnOrder !== undefined) {
    patch.columnOrder = args.columnOrder;
  }
  if (args.columnWidths !== undefined) {
    patch.columnWidths = args.columnWidths;
  }
  if (args.chartOptions !== undefined) {
    patch.chartOptions = args.chartOptions;
  }
  return patch;
}

/** Build the typed `config` PATCH for a Collection panel's editor save
 *  (HEL-247). Follows the same absent-vs-null convention as `buildBindingPatch`:
 *  `undefined` omits the key (leave unchanged); `null` clears to default; a
 *  value sets it. The editor always resends `dataTypeId`/`fieldMapping` (the
 *  backend patch replaces `fieldMapping` wholesale), while `baseType`/`layout`/
 *  `itemOptions` ride the same single PATCH so the whole editor persists
 *  atomically. */
export function buildCollectionPatch(args: {
  typeId: string | null;
  fieldMapping: Record<string, string> | null;
  baseType?: string;
  layout?: CollectionLayout;
  itemOptions?: CollectionItemOptions | null;
}): Record<string, unknown> {
  const patch: Record<string, unknown> = {
    dataTypeId: args.typeId,
    fieldMapping: args.fieldMapping,
  };
  if (args.baseType !== undefined) {
    patch.baseType = args.baseType;
  }
  if (args.layout !== undefined) {
    patch.layout = args.layout;
  }
  if (args.itemOptions !== undefined) {
    patch.itemOptions = args.itemOptions;
  }
  return patch;
}

/** Build the typed `config` PATCH for a Table panel's column-width resize
 *  (HEL-253). Kept as its own patch object — separate from
 *  `buildBindingPatch` — since width edits are driven by drag gestures
 *  (frequent, debounced) on a different cadence than binding edits
 *  (deliberate, modal-driven); a fast drag PATCH must never clobber an
 *  in-flight binding edit's `dataTypeId`/`fieldMapping` keys. */
export function buildTableWidthsPatch(
  columnWidths: Record<string, number>,
): Record<string, unknown> {
  return { columnWidths };
}

/** Build the typed `config` PATCH for a Text or Markdown panel's Content
 *  editor save (HEL-244 design.md Decision 1's bind-direction corollary;
 *  shared by Markdown per HEL-245). Source mode (`mode === "field"`) sets
 *  `dataTypeId`/`fieldMapping.content` and deliberately OMITS `content` from
 *  the patch entirely — unlike `buildBindingPatch`'s `label`/`unit` handling
 *  for Metric — so `TextPanelConfig.Patch.decode` /
 *  `MarkdownPanelConfig.Patch.decode`'s "absent = unchanged" convention
 *  preserves the prior literal text untouched. Static mode (`mode ===
 *  "literal"`) clears the binding back to unbound and sets `content` to the
 *  current literal value. */
export function buildContentBindingPatch(args: {
  mode: "field" | "literal";
  typeId: string | null;
  fieldValue: string;
  literalValue: string;
}): Record<string, unknown> {
  if (args.mode === "field") {
    return {
      dataTypeId: args.typeId,
      fieldMapping: args.fieldValue ? { content: args.fieldValue } : null,
    };
  }
  return {
    dataTypeId: null,
    fieldMapping: null,
    content: args.literalValue,
  };
}

/** Build the typed `config` PATCH for an image edit. */
export function buildImagePatch(args: { imageUrl: string; imageFit: ImageFit }): ImagePanelConfig {
  return { imageUrl: args.imageUrl, imageFit: args.imageFit };
}

/** Build the typed `config` PATCH for a divider edit. */
export function buildDividerPatch(args: {
  orientation: DividerOrientation;
  weight: number;
  color: string | null;
}): DividerPanelConfig {
  return {
    orientation: args.orientation,
    weight: args.weight,
    color: args.color,
  };
}

// ── Batch payload ───────────────────────────────────────────────────────────

export interface BatchPanelItem {
  id: string;
  title?: string;
  appearance?: unknown;
  type?: PanelKind;
  config?: Record<string, unknown>;
}

/** Given a stored panel plus an accumulated set of pending fields, produce
 *  the wire-shape entry for `POST /api/panels/updateBatch`. Today the
 *  accumulator only collects title / appearance / type — config-affecting
 *  edits flow through their own typed thunks. */
export function buildBatchItem(panel: Panel, fields: BatchEntryFields): BatchPanelItem {
  const item: BatchPanelItem = { id: panel.id };
  if (fields.title !== undefined) item.title = fields.title;
  if (fields.appearance !== undefined) item.appearance = fields.appearance;
  if (fields.type !== undefined) item.type = fields.type;
  return item;
}

export interface BatchEntryFields {
  title?: string;
  appearance?: unknown;
  type?: PanelKind;
}
