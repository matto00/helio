import { useEffect, useLayoutEffect, useRef } from "react";
import { createPortal } from "react-dom";

import "../../../shared/chrome/Popover.css";
import "./ProvenancePopover.css";
import { ProvenanceContent } from "./ProvenanceContent";
import type { PublishedComparison } from "../history/metricComparisonStore";
import type { ProvenanceState } from "./useProvenance";
import type { ProvenanceVariant } from "./provenanceTelemetry";
import type { PortalPopoverPos } from "../../../hooks/usePortalPopover";

const FOCUSABLE =
  'button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"]), input:not([disabled])';

interface ProvenancePopoverProps {
  label: string;
  variant: ProvenanceVariant;
  pos: PortalPopoverPos;
  state: ProvenanceState;
  /** HEL-1275 — the metric panel's resolved comparison, when it shows a delta. */
  comparison: PublishedComparison | null;
  /** `true` when opened from the Invalid data badge: focus lands on the Checks section. */
  focusChecks: boolean;
  pipelineHref: string | null;
  /** Element to portal into: the enclosing native `<dialog>` when the trigger sits inside one
   *  (so the popover is in the dialog's top layer and focus scope), else `document.body`. */
  container: HTMLElement;
  onClose: () => void;
}

/** HEL-1207 — the provenance popover panel. Hosted by `usePortalPopover` via `ProvenanceTrigger`
 *  (which owns position + open state); this component owns the a11y contract (A2/A3): labelled
 *  dialog, focus moved in on open, its own Tab wrap, Escape closed at document CAPTURE phase with
 *  `stopPropagation` so an enclosing native-dialog Modal does not also close. No `panelRef` is
 *  attached to the hook, so it does not close on focus-out. */
export function ProvenancePopover({
  label,
  variant,
  pos,
  state,
  comparison,
  focusChecks,
  pipelineHref,
  container,
  onClose,
}: ProvenancePopoverProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const checksRef = useRef<HTMLHeadingElement>(null);
  const ready = state.status === "ready";

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      event.preventDefault();
      onClose();
    }
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [onClose]);

  // Move focus in on open; once content lands, honour a checks-section request.
  useLayoutEffect(() => {
    const target = focusChecks && ready ? checksRef.current : null;
    if (target) {
      target.focus();
      target.scrollIntoView?.({ block: "nearest" });
    } else if (!panelRef.current?.contains(document.activeElement)) {
      panelRef.current?.focus();
    }
  }, [focusChecks, ready]);

  // Native (not React) keydown on the panel itself: it is deeper than any enclosing native
  // `<dialog>` Modal, so its own Tab trap never sees these events (it would otherwise wrap focus
  // out of the popover), and stopping propagation here also keeps every key away from the host
  // card / mobile item handlers (A2).
  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    function onPanelKeyDown(event: KeyboardEvent) {
      event.stopPropagation();
      if (event.key !== "Tab") return;
      const focusable = Array.from(panel!.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (focusable.length === 0) {
        event.preventDefault();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === first || active === panel)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || active === panel)) {
        event.preventDefault();
        first.focus();
      }
    }
    panel.addEventListener("keydown", onPanelKeyDown);
    return () => panel.removeEventListener("keydown", onPanelKeyDown);
  }, []);

  return createPortal(
    <>
      <button
        type="button"
        className="popover__scrim"
        tabIndex={-1}
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-label={label}
        tabIndex={-1}
        className="popover__panel provenance-popover"
        style={{
          position: "fixed",
          top: pos.top,
          bottom: pos.bottom,
          left: pos.left,
          right: "auto",
          width: pos.width,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="provenance-popover__header">
          <h2 className="provenance-popover__title">Data provenance</h2>
          <button
            type="button"
            className="provenance-popover__close"
            aria-label="Close provenance"
            onClick={onClose}
          >
            Close
          </button>
        </div>
        {state.status === "ready" ? (
          <ProvenanceContent
            data={state.data}
            variant={variant}
            comparison={comparison}
            checksRef={checksRef}
            pipelineHref={pipelineHref}
            onNavigate={onClose}
          />
        ) : state.status === "error" ? (
          <div role="alert" className="provenance-popover__status">
            <p>Provenance could not be loaded.</p>
            <button type="button" className="provenance-popover__link" onClick={state.retry}>
              Retry
            </button>
          </div>
        ) : (
          <p role="status" className="provenance-popover__status">
            Loading provenance…
          </p>
        )}
      </div>
    </>,
    container,
  );
}
