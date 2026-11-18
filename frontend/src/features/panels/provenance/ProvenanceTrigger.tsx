import { useCallback, type KeyboardEvent } from "react";
import { Info } from "lucide-react";

import { IconButton } from "../../../shared/ui/IconButton";
import { ICON_SIZE } from "../../../shared/ui/iconSize";
import "./ProvenanceTrigger.css";
import { fetchOutputProvenance, fetchPublicProvenance, type Provenance } from "./provenanceService";
import { outputProvenanceKey, publicProvenanceKey } from "./provenanceCache";
import type { ProvenanceVariant } from "./provenanceTelemetry";
import { useProvenancePopoverHost } from "./useProvenancePopoverHost";
import { comparisonStoreKey } from "../history/metricComparisonStore";

export interface ProvenanceTriggerProps {
  panelId: string;
  panelTitle?: string;
  outputId: string;
  variant: ProvenanceVariant;
  /** Public variant only. */
  dashboardId?: string;
  /** Public variant only — the share token the public endpoint authorizes with. */
  token?: string;
  /** When set, renders the "Invalid data" badge as a second opener of the SAME popover, landing
   *  on its Checks section (HEL-1207 A4). */
  invalidBadge?: boolean;
  className?: string;
}

/** HEL-1207 — the shared provenance trigger: one component per render path (desktop card footer,
 *  mobile stack header, public viewer row, fullscreen/detail modal), owning open state, the lazy
 *  cached read and the popover. Event isolation (A2): its own click/keydown never bubble to the
 *  host card / mobile item / modal. */
export function ProvenanceTrigger({
  panelId,
  panelTitle,
  outputId,
  variant,
  dashboardId,
  token,
  invalidBadge = false,
  className,
}: ProvenanceTriggerProps) {
  const isPublic = variant === "public";
  const key =
    isPublic && dashboardId
      ? publicProvenanceKey(dashboardId, panelId)
      : outputProvenanceKey(outputId);
  const fetcher = useCallback(
    (): Promise<Provenance> =>
      isPublic && dashboardId
        ? fetchPublicProvenance(dashboardId, panelId, token ?? "")
        : fetchOutputProvenance(outputId),
    [isPublic, dashboardId, panelId, token, outputId],
  );
  const { triggerRef, isOpen, toggle, popover } = useProvenancePopoverHost({
    variant,
    panelId,
    cacheKey: key,
    fetcher,
    label: panelTitle ? `Data provenance for ${panelTitle}` : "Data provenance",
    outputId,
    comparisonKey: comparisonStoreKey(variant, panelId),
  });
  const stopKey = (event: KeyboardEvent<HTMLElement>) => event.stopPropagation();

  return (
    <span
      className={["provenance-trigger", className].filter(Boolean).join(" ")}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={stopKey}
    >
      <IconButton
        ref={triggerRef}
        icon={<Info aria-hidden="true" size={ICON_SIZE.sm} />}
        variant="ghost"
        size="xs"
        className="provenance-trigger__btn"
        aria-label="Data provenance"
        title="Data provenance"
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        onClick={(e) => toggle(e, false)}
      />
      {invalidBadge && (
        <button
          type="button"
          className="panel-grid-card__type-badge panel-grid-card__type-badge--invalid provenance-trigger__badge"
          title="The latest pipeline run for this panel's data failed an assertion rule"
          aria-label="Data checks failed - view provenance"
          aria-haspopup="dialog"
          aria-expanded={isOpen}
          onClick={(e) => toggle(e, true)}
        >
          Invalid data
        </button>
      )}
      {popover}
    </span>
  );
}
