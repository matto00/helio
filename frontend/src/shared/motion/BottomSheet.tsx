import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

import { Modal } from "../ui/Modal";
import { useMotion } from "../../theme/ThemeProvider";
import { clearSheetMotion, fadeSheet, settleSheet } from "./sheetMotion";
import { useSheetSwipe } from "./useSheetSwipe";
import "./BottomSheet.css";

export interface BottomSheetProps {
  /** Whether the sheet is open. Set it `false` in `onClosed`; setting it `false` elsewhere closes it at once. */
  open: boolean;
  title: ReactNode;
  ariaLabel?: string;
  /** Asked first on every close request (swipe, close button, Escape, backdrop). Return `false` to veto: a
   *  vetoed swipe springs back and the sheet stays open. */
  onRequestClose?: () => boolean | void;
  /** Called once the exit animation has finished: the consumer then flips `open` to `false`. */
  onClosed: () => void;
  /** Header slot before the close button (e.g. an actions menu). */
  headerActions?: ReactNode;
  className?: string;
  children: ReactNode;
}

/** Swipe-dismissable bottom sheet (HEL-1582, DESIGN.md §10). Composes `Modal` (focus trap, focus restore, one vetoable
 *  close request for Escape, backdrop and the close button) and adds the phone presentation: full height from the
 *  bottom edge with a grab handle, a downward drag on the header following the finger, and an exit that keeps the
 *  dialog open until it has finished. At rest the sheet carries no transform, so popovers portalled from inside it
 *  anchor to their triggers. Timing comes only from motion tokens; Subtle fades, Off does not animate. */
export function BottomSheet({
  open,
  title,
  ariaLabel,
  onRequestClose,
  onClosed,
  headerActions,
  className,
  children,
}: BottomSheetProps) {
  const [sheet, setSheet] = useState<HTMLDialogElement | null>(null);
  const motion = useMotion();
  const exitingRef = useRef(false);
  // A stable callback ref: an inline one would be re-called (null, then the element) on every render.
  const locateSheet = useCallback((marker: HTMLSpanElement | null) => {
    setSheet(marker?.closest("dialog") ?? null);
  }, []);
  const latest = useRef({ onRequestClose, onClosed, motion });
  useEffect(() => {
    latest.current = { onRequestClose, onClosed, motion };
  });

  // The motion traces of a drag or exit are cleared only once the dialog is closed: clearing them earlier flashes
  // the closed sheet back on screen. A passive effect, so it runs after `Modal`'s own (child effects run first)
  // `dialog.close()` for the same `open` change, never between the commit and the close.
  useEffect(() => {
    if (sheet !== null) clearSheetMotion(sheet);
  }, [open, sheet]);

  const exit = useCallback(
    (offsetPx: number) => {
      const element = sheet;
      const { onClosed: closed, motion: level } = latest.current;
      exitingRef.current = true;
      const finish = () => {
        exitingRef.current = false;
        // The exit transform/opacity stay on the dialog until `open` turns false (see the effect above `exit`):
        // clearing them here would paint the sheet back at rest for a frame before React commits the close.
        closed();
      };
      if (element === null || level === "off") finish();
      else if (level === "subtle") fadeSheet(element, finish);
      else settleSheet(element, Math.max(offsetPx, element.offsetHeight), false, finish);
    },
    [sheet],
  );

  /** The one close path: veto first, then exit. Returns whether the close was accepted. */
  const requestClose = useCallback(
    (offsetPx = 0): boolean => {
      if (exitingRef.current) return true;
      if (latest.current.onRequestClose?.() === false) return false;
      exit(offsetPx);
      return true;
    },
    [exit],
  );

  useSheetSwipe({ sheet, onDismiss: requestClose });

  return (
    <Modal
      open={open}
      title={title}
      ariaLabel={ariaLabel}
      size="full"
      className={["bottom-sheet", className].filter(Boolean).join(" ")}
      headerActions={headerActions}
      onClose={() => void requestClose()}
    >
      {/* Locates the dialog element for the gesture hook; Modal exposes no ref of its own. */}
      <span hidden ref={locateSheet} data-bottom-sheet-marker="" />
      {children}
    </Modal>
  );
}
