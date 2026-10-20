// MobilePipelineActions -- HEL-1582 (design.md D7): the floating Dry run / Run pipeline pills that replace the sticky
// footer. Absolute inside the page, above the glass nav (the page already ends above it). Dry run is a secondary
// pill with an OPAQUE surface (DESIGN.md §3 keeps the glass carve-out narrow); Run pipeline is the page's only
// accent fill. The bar is a column: a `draft-status` slot above the pill row (empty and zero-height until a draft
// exists, then "Draft · unsaved changes"; with a draft the pills are Discard and Save & run, HEL-1631); its measured
// height drives the scroller's bottom clearance through `--pipeline-mobile-actions-h` on the page element.

import { FlaskConical, Play, Trash2 } from "lucide-react";
import { useLayoutEffect, useRef } from "react";

import { ICON_SIZE } from "../../../../shared/ui/iconSize";
import { StatusChip } from "../../../../shared/ui/StatusChip";
import "./PipelineMobile.css";

/** The page-element custom property holding the action bar's measured height. */
export const ACTIONS_HEIGHT_PROPERTY = "--pipeline-mobile-actions-h";

export function MobilePipelineActions({
  busy,
  onDryRun,
  onRun,
  draft,
}: {
  /** A run is queued or running: both pills are disabled. */
  busy: boolean;
  onDryRun: () => void;
  onRun: () => void;
  /** HEL-1631: the client-only draft. While `hasDraft` the pills are Discard and Save & run. */
  draft: { hasDraft: boolean; saving: boolean; onDiscard: () => void; onSaveAndRun: () => void };
}) {
  const barRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const bar = barRef.current;
    const page = bar?.parentElement;
    if (!bar || !page) return undefined;
    const publish = () => page.style.setProperty(ACTIONS_HEIGHT_PROPERTY, `${bar.offsetHeight}px`);
    publish();
    if (typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(publish);
    observer.observe(bar);
    return () => {
      observer.disconnect();
      page.style.removeProperty(ACTIONS_HEIGHT_PROPERTY);
    };
  }, []);

  return (
    <div className="mobile-actions" ref={barRef}>
      <div className="mobile-actions__slot" data-slot="draft-status">
        {draft.hasDraft && (
          <StatusChip intent="neutral" dot>
            Draft · unsaved changes
          </StatusChip>
        )}
      </div>
      <div className="mobile-actions__pills">
        {draft.hasDraft ? (
          <>
            <button
              type="button"
              className="mobile-pill"
              onClick={draft.onDiscard}
              disabled={draft.saving}
              aria-label="Discard draft"
            >
              <Trash2 aria-hidden="true" size={ICON_SIZE.sm} />
              Discard
            </button>
            <button
              type="button"
              className="mobile-pill mobile-pill--primary"
              onClick={draft.onSaveAndRun}
              disabled={draft.saving || busy}
              aria-label="Save and run"
            >
              <Play aria-hidden="true" size={ICON_SIZE.sm} />
              {draft.saving ? "Saving…" : "Save & run"}
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              className="mobile-pill"
              onClick={onDryRun}
              disabled={busy}
              aria-label="Dry run"
            >
              <FlaskConical aria-hidden="true" size={ICON_SIZE.sm} />
              Dry run
            </button>
            <button
              type="button"
              className="mobile-pill mobile-pill--primary"
              onClick={onRun}
              disabled={busy}
              aria-label="Run pipeline"
            >
              <Play aria-hidden="true" size={ICON_SIZE.sm} />
              Run pipeline
            </button>
          </>
        )}
      </div>
    </div>
  );
}
