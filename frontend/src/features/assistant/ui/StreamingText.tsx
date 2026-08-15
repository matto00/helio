import { useEffect, useState } from "react";

import "./StreamingText.css";

interface StreamingTextProps {
  /** Scripted chunk sequence — this ticket's own tests drive it with mock data only; no live SSE
   *  source exists yet to wire it to (design.md D3). Pass a fresh `key` prop from the caller
   *  (React's own documented "reset state with a key" pattern) when rendering a genuinely NEW
   *  sequence on what would otherwise be the same component position — this component does not
   *  itself detect a `chunks` identity change mid-life as "start over" (no synchronous reset in an
   *  effect or a render-time ref read, both disallowed by this repo's stricter react-hooks rules). */
  chunks: string[];
  /** Per-chunk reveal delay in ms. Defaults to a small, visibly-incremental value; tests pass `0`
   *  for fast, deterministic assertions. */
  intervalMs?: number;
}

/** The first incremental-reveal pattern in this codebase (design.md D3, confirmed no precedent
 *  exists) — reveals `chunks` one at a time with a blinking-cursor affordance, visible until the
 *  full sequence has revealed. Built and tested against mock chunk arrays only; wiring it to a real
 *  live stream is a later, route-wiring ticket's job (no live route exists for the new assistant
 *  yet). */
export function StreamingText({ chunks, intervalMs = 40 }: StreamingTextProps) {
  const [revealedCount, setRevealedCount] = useState(0);

  useEffect(() => {
    if (chunks.length === 0) return;

    let cancelled = false;
    let timeoutId: ReturnType<typeof setTimeout>;

    function revealNext(nextIndex: number) {
      if (cancelled) return;
      setRevealedCount(nextIndex);
      if (nextIndex < chunks.length) {
        timeoutId = setTimeout(() => revealNext(nextIndex + 1), intervalMs);
      }
    }

    timeoutId = setTimeout(() => revealNext(1), intervalMs);

    return () => {
      cancelled = true;
      clearTimeout(timeoutId);
    };
  }, [chunks, intervalMs]);

  const done = revealedCount >= chunks.length;
  const text = chunks.slice(0, revealedCount).join("");

  return (
    <span className="streaming-text" aria-live="polite">
      {text}
      {!done && (
        <span
          className="streaming-text__cursor"
          aria-hidden="true"
          data-testid="streaming-text-cursor"
        />
      )}
    </span>
  );
}
