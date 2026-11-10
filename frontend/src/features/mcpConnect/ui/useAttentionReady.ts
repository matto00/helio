import { useEffect, useState } from "react";

/**
 * True once the document has been visible AND focused for `holdMs` continuously; any blur or
 * hiding resets it. Gates one-click consequential actions against clickjacking and
 * double-click/new-window tricks (HEL-1709 design D4a).
 */
export function useAttentionReady(holdMs: number): boolean {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;

    const attentive = () => document.visibilityState === "visible" && document.hasFocus();

    const reset = () => {
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
      setReady(false);
    };

    const evaluate = () => {
      reset();
      if (attentive()) timer = setTimeout(() => setReady(true), holdMs);
    };

    evaluate();
    window.addEventListener("focus", evaluate);
    window.addEventListener("blur", reset);
    document.addEventListener("visibilitychange", evaluate);
    return () => {
      if (timer !== undefined) clearTimeout(timer);
      window.removeEventListener("focus", evaluate);
      window.removeEventListener("blur", reset);
      document.removeEventListener("visibilitychange", evaluate);
    };
  }, [holdMs]);

  return ready;
}
