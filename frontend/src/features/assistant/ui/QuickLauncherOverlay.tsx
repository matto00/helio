import { useEffect, useRef } from "react";
import { Link } from "react-router-dom";

import "./QuickLauncherOverlay.css";
import { Modal } from "../../../shared/ui/Modal";
import { useOverlay } from "../../../shared/chrome/OverlayProvider";
import { fetchConversations } from "../state/assistantConversationsSlice";
import { useAppDispatch, useAppSelector } from "../../../hooks/reduxHooks";
import { ActiveConversationPanel } from "./ActiveConversationPanel";

interface QuickLauncherOverlayProps {
  open: boolean;
  onClose: () => void;
}

/** Command-bar quick-launcher (design.md D5-D7) — a DESIGN.md-canonical `Modal` (size `lg`)
 *  rendering the SAME `ActiveConversationPanel` `/chat` renders, reading the identical
 *  `state.assistantConversations` Redux slice (no second fetch/copy). Registers with the shared
 *  `useOverlay()` single-active-overlay primitive, mirroring `AuthoringChatDrawer`/
 *  `RefinementChatDrawer`'s exact wiring, so opening the quick-launcher closes any other open
 *  overlay (and vice versa) and Escape closes it via `OverlayProvider`'s global handler. Deliberately
 *  does NOT attempt to render `SidebarBody.tsx`'s route-gated conversation list — a "Browse all
 *  conversations →" link reaches the full list at `/chat` instead (design.md D5). Mounted
 *  unconditionally in `App.tsx` (unlike the dashboard-scoped `RefinementChatDrawer`): the
 *  quick-launcher has no per-route dependency, matching its trigger's own unconditional visibility. */
export function QuickLauncherOverlay({ open, onClose }: QuickLauncherOverlayProps) {
  const dispatch = useAppDispatch();
  const overlay = useOverlay();
  const wasActiveRef = useRef(false);
  const currentUser = useAppSelector((state) => state.auth.currentUser);
  // HEL-703 design.md D9 — mirrors ChatPage's own guard: a `free`-tier user never attempts the
  // list fetch (which would otherwise 403); `ActiveConversationPanel` renders its request-access
  // state regardless of whether this fetch ran.
  const isFreeTier = currentUser?.tier === "free";

  // Register with the shared single-active-overlay + global Escape handler, and (re)fetch the
  // conversation list on every open -- mirrors ChatPage's own fetch-on-mount, since the
  // quick-launcher can be opened before the user ever visits /chat.
  useEffect(() => {
    if (open) {
      overlay.open();
      if (!isFreeTier) {
        void dispatch(fetchConversations());
      }
    } else {
      overlay.close();
      wasActiveRef.current = false;
    }
    // overlay.open/close are stable (useCallback); dispatch is stable. Only re-run on `open`/tier.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, isFreeTier]);

  useEffect(() => {
    if (overlay.isActive) {
      wasActiveRef.current = true;
      return;
    }
    if (open && wasActiveRef.current) {
      onClose();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [overlay.isActive]);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Assistant"
      size="lg"
      ariaLabel="Assistant conversation"
      className="quick-launcher-overlay"
    >
      {/* `Modal` doesn't conditionally render `children` on `open` (the native <dialog> alone
          governs visibility), so gate this ourselves: mounting `ActiveConversationPanel`
          unconditionally would render a second, always-live copy of the active conversation on
          every route, wasting a fetch/render pass and duplicating content in the accessibility
          tree even while the overlay is visually closed. */}
      {open && (
        <>
          <ActiveConversationPanel />
          <Link to="/chat" className="quick-launcher-overlay__browse-link" onClick={onClose}>
            Browse all conversations →
          </Link>
        </>
      )}
    </Modal>
  );
}
