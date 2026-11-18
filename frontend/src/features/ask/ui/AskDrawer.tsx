import { useEffect, useRef } from "react";

import { BottomSheet } from "../../../shared/motion/BottomSheet";
import { AskPanel } from "./AskPanel";

interface AskDrawerProps {
  open: boolean;
  onClose: () => void;
  dashboardId: string;
  /** Where focus returns when the opener was a menu item that has unmounted (the kebab trigger): matched on close when focus
   *  landed on `body` or a disconnected node (the `restoreFocusSelector` precedent of the share dialog). */
  restoreFocusSelector?: string;
}

/** HEL-1746: "Ask about this dashboard", on the shared `BottomSheet` (a 540px dialog above 768px, the swipe sheet at and below it;
 *  no feature CSS sets its width). Focus moves to the question field on open; `Modal` returns it to the opener on close. */
export function AskDrawer({ open, onClose, dashboardId, restoreFocusSelector }: AskDrawerProps) {
  const fieldRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!open) return;
    // The dialog is shown by Modal's own effect, after this component's: focus the field once it can take it.
    const timer = window.setTimeout(() => fieldRef.current?.focus(), 0);
    return () => window.clearTimeout(timer);
  }, [open]);

  // After the drawer has closed (the dialog is shut and `Modal` has tried to restore focus), a menu-item opener has gone: focus is on
  // `body`, so the passed selector's match (the menu's trigger) takes it. Checked here, not in `onClosed`, which runs while the dialog
  // is still open.
  const wasOpen = useRef(false);
  useEffect(() => {
    if (open) {
      wasOpen.current = true;
      return;
    }
    if (!wasOpen.current) return;
    wasOpen.current = false;
    if (restoreFocusSelector === undefined) return;
    const timer = window.setTimeout(() => {
      const active = document.activeElement;
      if (active === null || active === document.body || !active.isConnected) {
        document.querySelector<HTMLElement>(restoreFocusSelector)?.focus();
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [open, restoreFocusSelector]);

  return (
    <BottomSheet
      open={open}
      title="Ask about this dashboard"
      size="md"
      onClosed={onClose}
      className="ask-drawer"
    >
      <AskPanel scope={{ kind: "dashboard", id: dashboardId }} fieldRef={fieldRef} />
    </BottomSheet>
  );
}
