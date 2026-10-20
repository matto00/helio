import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

/**
 * HEL-1631 (design.md D13): leaving the page with a draft asks first. A reload or tab close gets the browser's own prompt
 * (`beforeunload`); a click on an in-app link is held and answered by the "Discard your draft?" dialog. Only link clicks are
 * intercepted: the app's router is not a data router, so a programmatic navigation (the command palette, back/forward) cannot
 * be held and drops the draft.
 */
export function useDraftLeaveGuard(hasDraft: boolean, discard: () => void) {
  const navigate = useNavigate();
  const [pendingHref, setPendingHref] = useState<string | null>(null);

  useEffect(() => {
    if (!hasDraft) return undefined;
    function onBeforeUnload(e: BeforeUnloadEvent) {
      e.preventDefault();
      e.returnValue = "";
    }
    function onClick(e: MouseEvent) {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey)
        return;
      const anchor = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!anchor || (anchor.target !== "" && anchor.target !== "_self")) return;
      if (anchor.hasAttribute("download")) return;
      const url = new URL(anchor.href, window.location.href);
      if (url.origin !== window.location.origin || url.pathname === window.location.pathname)
        return;
      e.preventDefault();
      e.stopPropagation();
      setPendingHref(`${url.pathname}${url.search}${url.hash}`);
    }
    window.addEventListener("beforeunload", onBeforeUnload);
    document.addEventListener("click", onClick, true);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      document.removeEventListener("click", onClick, true);
    };
  }, [hasDraft]);

  const confirmLeave = useCallback(() => {
    const href = pendingHref;
    setPendingHref(null);
    discard();
    if (href !== null) void navigate(href);
  }, [pendingHref, discard, navigate]);
  const stay = useCallback(() => setPendingHref(null), []);

  return { leaveRequested: pendingHref !== null && hasDraft, confirmLeave, stay };
}
