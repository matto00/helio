import { useEffect, useRef } from "react";

/**
 * Polls `refresh` every `refreshInterval` seconds as long as `typeId` is set.
 *
 * Behaviour:
 * - No-ops when `refreshInterval` is null/undefined or `typeId` is null/undefined.
 * - Pauses (clears the interval) while the browser tab is hidden; resumes
 *   without stacking a duplicate interval when the tab becomes visible again.
 * - Clears the interval on unmount or whenever `refreshInterval`/`typeId` changes.
 */
export function usePanelPolling(
  refresh: () => void,
  refreshInterval: number | null | undefined,
  typeId: string | null | undefined,
): void {
  // Keep a stable ref so the interval callback always calls the latest `refresh`
  // without needing to recreate the interval when the function identity changes.
  const refreshRef = useRef(refresh);
  useEffect(() => {
    refreshRef.current = refresh;
  }, [refresh]);

  useEffect(() => {
    if (!refreshInterval || !typeId) return;

    const ms = refreshInterval * 1000;
    let intervalId: ReturnType<typeof setInterval> | null = null;

    function startInterval() {
      if (intervalId !== null) return; // already running — don't stack
      intervalId = setInterval(() => {
        refreshRef.current();
      }, ms);
    }

    function stopInterval() {
      if (intervalId !== null) {
        clearInterval(intervalId);
        intervalId = null;
      }
    }

    function handleVisibilityChange() {
      if (document.visibilityState === "hidden") {
        stopInterval();
      } else {
        startInterval();
      }
    }

    // Only start immediately if the tab is already visible.
    if (document.visibilityState !== "hidden") {
      startInterval();
    }

    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      stopInterval();
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [refreshInterval, typeId]);
}
