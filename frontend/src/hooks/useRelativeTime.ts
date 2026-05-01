import { useEffect, useState } from "react";

function formatRelativeTime(timestamp: number | null, now: number): string {
  if (timestamp === null) return "";
  const elapsed = Math.floor((now - timestamp) / 1000);
  if (elapsed < 10) return "just now";
  if (elapsed < 60) return `${elapsed}s ago`;
  const minutes = Math.floor(elapsed / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}

/**
 * Returns a live-updating relative time string for the given Unix-ms timestamp.
 * Ticks every 10 seconds. Returns "" when timestamp is null.
 */
export function useRelativeTime(timestamp: number | null): string {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 10_000);
    return () => clearInterval(id);
  }, []);

  return formatRelativeTime(timestamp, now);
}
