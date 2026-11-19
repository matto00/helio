import { useCallback, type KeyboardEvent } from "react";

import {
  fetchOutputProvenance,
  fetchPublicProvenance,
  type Provenance,
} from "../provenance/provenanceService";
import { outputProvenanceKey, publicProvenanceKey } from "../provenance/provenanceCache";
import { useProvenancePopoverHost } from "../provenance/useProvenancePopoverHost";
import type { InsightCitation } from "./insightService";
import "./InsightPanel.css";

export type CitationSource =
  | { variant: "authenticated" }
  | { variant: "public"; dashboardId: string; token?: string };

interface CitationChipProps {
  citation: InsightCitation;
  /** 1-based position among the render's citations (the chip's visible text). */
  ordinal: number;
  /** The insight panel the chip lives in: its telemetry id, and the public fallback when the cited Output is not placed. */
  insightPanelId: string;
  source: CitationSource;
}

/** The cited value as the model stated it, for the chip's accessible name. */
function formatCitedValue(c: InsightCitation): string {
  if (c.number !== undefined) {
    const text = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(c.number);
    return c.isPct ? `${text}%` : text;
  }
  if (c.date !== undefined) return new Date(c.date).toLocaleDateString();
  return "";
}

/** HEL-1744 D6 -- a citation marker as a small neutral button. Activating it opens the provenance popover of the cited
 *  data, anchored at the chip (the same popover as the panel's own provenance control: HEL-1756 placement, focus moved in,
 *  Escape returning focus here). Authenticated: the cited Output's provenance. Public: the provenance of the panel on
 *  this dashboard bound to the cited Output, else the insight panel's own. */
export function CitationChip({ citation, ordinal, insightPanelId, source }: CitationChipProps) {
  const isPublic = source.variant === "public";
  const publicPanelId = citation.panelId ?? insightPanelId;
  const outputId = citation.outputId ?? "";
  const dashboardId = source.variant === "public" ? source.dashboardId : "";
  const token = source.variant === "public" ? source.token : undefined;

  const cacheKey = isPublic
    ? publicProvenanceKey(dashboardId, publicPanelId)
    : outputProvenanceKey(outputId);
  const fetcher = useCallback(
    (): Promise<Provenance> =>
      isPublic
        ? fetchPublicProvenance(dashboardId, publicPanelId, token)
        : fetchOutputProvenance(outputId),
    [isPublic, dashboardId, publicPanelId, token, outputId],
  );
  const { triggerRef, isOpen, toggle, popover } = useProvenancePopoverHost({
    variant: source.variant,
    panelId: insightPanelId,
    cacheKey,
    fetcher,
    label: `Source: ${citation.field}`,
    outputId,
    comparisonKey: null,
  });

  const value = formatCitedValue(citation);
  const name = `Source: ${citation.field}${value ? ` ${value}` : ""}, open provenance`;
  return (
    <span
      className="insight-chip-wrap"
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e: KeyboardEvent<HTMLElement>) => e.stopPropagation()}
    >
      <button
        ref={triggerRef}
        type="button"
        className="insight-chip tap-expand-44"
        aria-label={name}
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        onClick={(e) => toggle(e, false)}
      >
        {ordinal}
      </button>
      {popover}
    </span>
  );
}
