// HEL-1331 D6 -- scroll a Settings section into view when the URL hash names it (e.g. the Output
// editor's "Request Beta access" link to `/settings#beta-access`). The sections above render
// loading placeholders and then content, which shifts layout, so the scroll re-fires each time a
// page-level loading flag settles. Once the user has scrolled or pressed a key themselves, auto
// scrolling stops so it never fights them.

import { useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";

export function useScrollToHashSection(id: string, settledFlags: readonly boolean[]) {
  const { hash } = useLocation();
  const active = hash === `#${id}`;
  const userInteracted = useRef(false);

  useEffect(() => {
    if (!active) return;
    userInteracted.current = false;
    const mark = () => {
      userInteracted.current = true;
    };
    const events = ["wheel", "touchmove", "keydown"] as const;
    events.forEach((e) => window.addEventListener(e, mark, { passive: true }));
    return () => events.forEach((e) => window.removeEventListener(e, mark));
  }, [active]);

  const settledKey = settledFlags.join(",");
  useEffect(() => {
    if (!active || userInteracted.current) return;
    document.getElementById(id)?.scrollIntoView?.({ block: "start" });
  }, [active, id, settledKey]);
}
