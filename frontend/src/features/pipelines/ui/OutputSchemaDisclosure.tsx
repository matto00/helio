// OutputSchemaDisclosure — HEL-1022. The footer's "OUTPUT" field row used to
// render EVERY analyze output-schema field as a chip directly into the
// footer (`.pipeline-detail-page__footer-schema`, an unbounded
// `flex-wrap` row with no max-height). A ~200-field REST source wrapped the
// footer to ~15 rows, ballooning it upward, eating the pipeline canvas, and
// shoving the "N step / Dry run / Run pipeline" cluster around — not a
// z-index bug, just unbounded growth of an ordinary flex sibling.
//
// This component is that fix for the LARGE case only: `PipelineDetailFooter`
// renders it instead of the chip row once `outputSchema.length` exceeds
// `SCHEMA_FIELD_VIEWER_SMALL_THRESHOLD` (the same constant `SchemaFieldViewer`
// itself uses, so the two never disagree about what counts as "large"). A
// compact "N fields" trigger replaces the chip flood; the footer's own
// height stops depending on field count entirely. Below the threshold,
// `PipelineDetailFooter` keeps rendering the chips inline exactly as before
// — a 4-field schema must never look more complicated than it is, so this
// component is never invoked for that case at all.
//
// Reuses `usePortalPopover` (the same primitive `PipelineDetailHeader`'s
// multi-source overflow popover uses) for Escape-to-close, outside-click
// (scrim) to close, and focus-out-to-close — never hand-rolled here, the
// bug class this fixes was already found and fixed once this ticket.
// `SchemaFieldViewer` (shared/ui) owns the filter/group/cap chrome inside
// the popover; this component only supplies the chip `renderField`/
// `fieldsContainer` and the trigger/popover shell around it.

import { useState } from "react";
import { createPortal } from "react-dom";

import { usePortalPopover } from "../../../hooks/usePortalPopover";
import { SchemaFieldViewer } from "../../../shared/ui/SchemaFieldViewer";
import type { SchemaField } from "../types/pipelineStep";

import "../../../shared/chrome/Popover.css";
import "./OutputSchemaDisclosure.css";

interface OutputSchemaDisclosureProps {
  /** Non-empty by contract -- `PipelineDetailFooter` only mounts this once
   *  `outputSchema.length` clears the small-schema threshold; the 0-field
   *  "no output yet" state and the small inline-chip case both stay in the
   *  caller. */
  fields: SchemaField[];
}

/** `28rem` and the gap kept to the viewport edge, as the panel's CSS width is expressed. */
const PANEL_MAX_WIDTH_PX = 448;
const PANEL_EDGE_MARGIN_PX = 8;
/** `24rem`, the panel's CSS height cap. */
const PANEL_MAX_HEIGHT_PX = 384;

export function OutputSchemaDisclosure({ fields }: OutputSchemaDisclosureProps) {
  const { triggerRef, panelRef, isOpen, panelPos, handleOpen, close } =
    usePortalPopover<HTMLButtonElement>();
  const [portalTarget, setPortalTarget] = useState<Element | null>(null);

  function handleToggle() {
    if (isOpen) {
      close();
      return;
    }
    // Opens ABOVE the trigger (mirrors `ActionsMenu`'s `align="above"` and
    // this same page's `.pipeline-detail-page__cancel-confirm` "dropup"
    // idiom) -- the trigger lives in the page's bottom footer, so opening
    // downward would push the panel toward (or under) the phone BottomNav
    // capsule / viewport edge instead of into the canvas above it.
    // Inside an open <dialog> (the phone step sheet) the panel portals into that dialog, or it would render behind the
    // modal's top layer (the ActionsMenu / Select pattern, HEL-1582).
    setPortalTarget(triggerRef.current?.closest("dialog[open]") ?? document.body);
    handleOpen((rect) => {
      // Kept inside the viewport (HEL-1582): a trigger far to the right of a narrow header would otherwise push the
      // panel, and its filter field, off the right edge. The panel is `min(28rem, 100vw - 40px)` wide (CSS).
      const left = Math.max(
        PANEL_EDGE_MARGIN_PX,
        Math.min(
          rect.left,
          window.innerWidth -
            Math.min(PANEL_MAX_WIDTH_PX, window.innerWidth - 40) -
            PANEL_EDGE_MARGIN_PX,
        ),
      );
      // Vertical: opens above when that side has room for the whole panel or more room than below; otherwise it opens
      // below. Either way its height is capped to the room on the chosen side, so it never leaves the viewport.
      const gap = 8;
      const roomAbove = rect.top - gap - PANEL_EDGE_MARGIN_PX;
      const roomBelow = window.innerHeight - rect.bottom - gap - PANEL_EDGE_MARGIN_PX;
      const fullHeight = Math.min(PANEL_MAX_HEIGHT_PX, window.innerHeight - 80);
      if (roomAbove >= fullHeight || roomAbove >= roomBelow) {
        return {
          bottom: window.innerHeight - rect.top + gap,
          left,
          maxHeight: Math.min(fullHeight, roomAbove),
        };
      }
      return { top: rect.bottom + gap, left, maxHeight: Math.min(fullHeight, roomBelow) };
    });
  }

  const panel =
    isOpen && panelPos
      ? createPortal(
          <>
            <button type="button" className="popover__scrim" tabIndex={-1} onClick={close} />
            <div
              ref={(el) => {
                panelRef.current = el;
              }}
              className="popover__panel output-schema-disclosure__panel"
              role="dialog"
              aria-label="Output schema"
              style={{
                position: "fixed",
                top: panelPos.top,
                bottom: panelPos.bottom,
                left: panelPos.left,
                maxHeight: panelPos.maxHeight,
              }}
            >
              {/* Bounded by CSS (`max-height` + `overflow-y: auto` on
               *  `.output-schema-disclosure__panel`) -- unlike the footer
               *  row this replaces, a 200-field panel scrolls internally
               *  instead of growing the page. */}
              <SchemaFieldViewer
                title="Output schema"
                fields={fields}
                getName={(field) => field.name}
                renderField={(field) => (
                  <span className="pipeline-detail-page__footer-schema-chip">{field.name}</span>
                )}
                fieldsContainer={(children) => (
                  <div className="pipeline-detail-page__footer-schema output-schema-disclosure__chips">
                    {children}
                  </div>
                )}
              />
            </div>
          </>,
          portalTarget ?? document.body,
        )
      : null;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="output-schema-disclosure__trigger"
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        onClick={handleToggle}
      >
        {fields.length} field{fields.length === 1 ? "" : "s"}
        <span className="output-schema-disclosure__chevron" aria-hidden="true">
          ▾
        </span>
      </button>
      {panel}
    </>
  );
}
