// Thunk payload builders for the HEL-909 `{ type, config }` wire shape.
//
// A panel is one of 5 kinds: output, text, markdown, image, divider. An
// output-kind panel carries only `outputId` — everything the old bound
// configs carried (fieldMapping/aggregation/chartOptions/columnWidths/
// timelineOptions/metricId/label/unit) now lives on the fetched Output
// itself, not the placement. Content-kind panels (text/markdown/image/
// divider) are dashboard-native and literal-only.
//
// Every builder returns a value safe to pass directly as the request body
// to the corresponding `panelService` axios call.

import type {
  DividerOrientation,
  DividerPanelConfig,
  ImageFit,
  ImagePanelConfig,
  Panel,
  PanelAppearance,
  PanelConfig,
  PanelKind,
} from "../types/panel";
import { emptyConfigForKind } from "../types/panel";

export interface CreatePanelBody {
  dashboardId: string;
  title?: string;
  type: PanelKind;
  config: PanelConfig;
  appearance?: PanelAppearance;
}

/** Build a `POST /api/panels` body. `outputId` is required for an
 *  output-kind panel and ignored otherwise. Content-kind panels are
 *  created with an empty default literal config. */
export function buildCreatePanelBody(args: {
  dashboardId: string;
  title?: string;
  type: PanelKind;
  outputId?: string;
}): CreatePanelBody {
  const config = seedCreateConfig(args.type, args.outputId);
  const body: CreatePanelBody = {
    dashboardId: args.dashboardId,
    type: args.type,
    config,
  };
  if (args.title !== undefined) {
    body.title = args.title;
  }
  return body;
}

function seedCreateConfig(type: PanelKind, outputId: string | undefined): PanelConfig {
  const base = emptyConfigForKind(type);
  if (type === "output") {
    return { outputId: outputId ?? "" };
  }
  return base;
}

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
