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
  DividerOrientation,
  DividerPanelConfig,
  ImageFit,
  ImagePanelConfig,
  MarkdownPanelConfig,
  Panel,
  PanelConfig,
  PanelKind,
  TextPanelConfig,
  TypeConfig,
} from "../types/panel";
import { emptyConfigForKind } from "../types/panel";

// ── Create payload ──────────────────────────────────────────────────────────

export interface CreatePanelBody {
  dashboardId: string;
  title: string;
  type: PanelKind;
  config: PanelConfig;
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
  return {
    dashboardId: args.dashboardId,
    title: args.title,
    type: args.type,
    config,
  };
}

function seedCreateConfig(
  type: PanelKind,
  typeConfig: TypeConfig | null | undefined,
  dataTypeId: string | undefined,
): PanelConfig {
  const base = emptyConfigForKind(type);
  switch (type) {
    case "metric":
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
      if (typeConfig?.type === "divider" && typeConfig.dividerOrientation) {
        return {
          ...(base as DividerPanelConfig),
          orientation: typeConfig.dividerOrientation,
        };
      }
      return base;
    case "text":
    case "markdown":
      return base;
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

/** Build the typed `config` PATCH for a metric/chart/table binding edit. */
export function buildBindingPatch(args: {
  typeId: string | null;
  fieldMapping: Record<string, string> | null;
}): Record<string, unknown> {
  return {
    dataTypeId: args.typeId,
    fieldMapping: args.fieldMapping,
  };
}

/** Build the typed `config` PATCH for a text/markdown content edit. */
export function buildContentPatch(content: string): Pick<TextPanelConfig, "content"> {
  return { content };
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

/** Build the typed `config` PATCH for an arbitrary markdown edit. */
export function buildMarkdownPatch(content: string): Pick<MarkdownPanelConfig, "content"> {
  return { content };
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
