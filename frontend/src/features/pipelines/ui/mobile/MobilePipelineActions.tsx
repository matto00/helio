// MobilePipelineActions -- HEL-1582 (design.md D7): the floating Dry run / Run pipeline pills that replace the sticky
// footer. Absolute inside the page, above the glass nav (the page already ends above it). Dry run is a secondary
// pill with an OPAQUE surface (DESIGN.md §3 keeps the glass carve-out narrow); Run pipeline is the page's only
// accent fill. The bar is a column: an empty, zero-height `draft-status` slot above the pill row is reserved for
// HEL-1631's draft status (and the pills' Discard / Save & run); its measured height drives the scroller's bottom
// clearance through `--pipeline-mobile-actions-h` on the page element.

import { FlaskConical, Play } from "lucide-react";
import { useLayoutEffect, useRef } from "react";

import { ICON_SIZE } from "../../../../shared/ui/iconSize";
import "./PipelineMobile.css";

/** The page-element custom property holding the action bar's measured height. */
export const ACTIONS_HEIGHT_PROPERTY = "--pipeline-mobile-actions-h";

export function MobilePipelineActions({
  busy,
  onDryRun,
  onRun,
}: {
  /** A run is queued or running: both pills are disabled. */
  busy: boolean;
  onDryRun: () => void;
  onRun: () => void;
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
      {/* HEL-1631: draft status ("Draft · unsaved changes") renders here; empty and zero-height until then. */}
      <div className="mobile-actions__slot" data-slot="draft-status" />
      <div className="mobile-actions__pills">
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
      </div>
    </div>
  );
}
