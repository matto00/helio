// HEL-590 (evaluation-1.md CR4) -- owns the share-dialog's open target at the APP SHELL level
// (mirrors `OverlayProvider`'s shape), NOT inside `DashboardList`/`.app-sidebar`. The sidebar is
// `display: none` below the desktop breakpoint (`Sidebar.css`), which hides its entire subtree --
// a component mounted inside it, even a native `<dialog>` promoted via `showModal()`, is hidden
// along with it and measures 0x0 (verified live in evaluation-1.md). Mounting `DashboardShareDialog`
// as a sibling of `Sidebar`/`MobileShell` in `AppShell` (see `App.tsx`) keeps it reachable
// regardless of viewport width; `DashboardList` (desktop) and `MobileShell` (phone) both just call
// `useShareDialog().open(...)`.

import { createContext, useContext, useRef, useState, type ReactNode } from "react";

interface ShareDialogTarget {
  dashboardId: string;
  dashboardName: string;
  /** HEL-590 (evaluation-2.md CR-E): a CSS selector for the control that should regain focus on
   *  close, e.g. the desktop `ActionsMenu` trigger's `[aria-label]`. Needed because `Modal.tsx`'s
   *  own "capture whatever was focused when we opened" heuristic (`Modal.tsx`'s `[open]` effect)
   *  fails for THIS invoker specifically: the `ActionsMenu` item that was clicked and the dialog's
   *  own open both land in the same React commit, so the item is already removed from the DOM
   *  (and the browser has already collapsed focus to `<body>`) by the time Modal's effect reads
   *  `document.activeElement` -- there is nothing correct left to capture at that point. Passing
   *  the trigger's own selector sidesteps the timing problem entirely by not depending on
   *  `document.activeElement` at all. Optional: `undefined` falls back to Modal's own capture,
   *  which is correct for an always-mounted trigger (e.g. the mobile nav sheet's own button, which
   *  survives the sheet closing). */
  restoreFocusSelector?: string;
}

interface ShareDialogContextValue {
  target: ShareDialogTarget | null;
  open: (target: ShareDialogTarget) => void;
  close: () => void;
}

const ShareDialogContext = createContext<ShareDialogContextValue | null>(null);

export function ShareDialogProvider({ children }: { children: ReactNode }) {
  const [target, setTarget] = useState<ShareDialogTarget | null>(null);
  const lastTargetRef = useRef<ShareDialogTarget | null>(null);

  function open(next: ShareDialogTarget) {
    lastTargetRef.current = next;
    setTarget(next);
  }

  function close() {
    setTarget(null);
    const selector = lastTargetRef.current?.restoreFocusSelector;
    if (selector !== undefined) {
      // Deferred one tick so this runs after the closing commit (dialog removed, menu item
      // already gone) rather than racing it.
      window.setTimeout(() => {
        document.querySelector<HTMLElement>(selector)?.focus();
      }, 0);
    }
  }

  return (
    <ShareDialogContext.Provider value={{ target, open, close }}>
      {children}
    </ShareDialogContext.Provider>
  );
}

/** Throws outside a `ShareDialogProvider` -- every route that can reach a "Share" action (desktop
 *  sidebar, mobile nav sheet) is rendered under `AppShell`, which always provides one. */
export function useShareDialog(): ShareDialogContextValue {
  const ctx = useContext(ShareDialogContext);
  if (ctx === null) {
    throw new Error("useShareDialog must be used within a ShareDialogProvider");
  }
  return ctx;
}
