// useShapeOffering — HEL-399's lazy shape-catalog fetch for panel creation's
// datatype-select step. Extracted out of `PanelCreationModal.tsx` to keep
// that shell file within the codebase's file-size soft budget.
//
// Fetches the live `GET /api/pipeline-shapes` catalog only once `active` is
// true (the modal is actually on `datatype-select`) and only when the
// current panel type maps to at least one shape (`PANEL_TYPE_SHAPES`) — never
// on every modal open, and never more than once per modal lifetime.

import { useEffect, useState } from "react";
import { isAxiosError } from "axios";

import { getPipelineShapeCatalog } from "../../pipelines/services/pipelineService";
import type { PipelineShapeCatalogEntry } from "../../pipelines/types/pipelineShape";
import type { PanelType } from "../types/panel";
import { shapesForPanelType } from "./panelShapes";

function extractErrorMessage(err: unknown, fallback: string): string {
  if (isAxiosError(err) && typeof err.response?.data?.message === "string") {
    return err.response.data.message;
  }
  if (err instanceof Error && err.message) return err.message;
  return fallback;
}

interface ShapeOffering {
  /** Shape catalog entries matching `panelType`'s `PANEL_TYPE_SHAPES`
   *  mapping. Empty until the fetch resolves, or for unmapped panel types. */
  offeredShapes: PipelineShapeCatalogEntry[];
  /** Set only when this panel type maps to at least one shape but the
   *  catalog fetch itself failed. */
  shapeCatalogError: string | null;
}

export function useShapeOffering(active: boolean, panelType: PanelType | null): ShapeOffering {
  const [catalog, setCatalog] = useState<PipelineShapeCatalogEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!active) return;
    if (catalog !== null || error !== null) return;
    if (shapesForPanelType(panelType).length === 0) return;

    let cancelled = false;
    getPipelineShapeCatalog()
      .then((entries) => {
        if (!cancelled) setCatalog(entries);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(extractErrorMessage(err, "Failed to load shape catalog."));
      });
    return () => {
      cancelled = true;
    };
  }, [active, panelType, catalog, error]);

  const offeredShapeIds = shapesForPanelType(panelType);
  const offeredShapes = catalog?.filter((s) => offeredShapeIds.includes(s.id)) ?? [];
  return { offeredShapes, shapeCatalogError: error };
}
