import { Check, RotateCw } from "lucide-react";

import { ICON_SIZE } from "../../../../shared/ui/iconSize";
import { Spinner } from "../../../../shared/ui/Spinner";
import type { PullPhase } from "../../../../shared/motion/usePullToRefresh";

interface PullRefreshIndicatorProps {
  phase: PullPhase;
  busy: boolean;
  /** Full motion: the indicator rides above the stack and is revealed by the stack's own translate. Otherwise it is an
   *  overlay pinned to the stack's top edge that snaps between states. */
  follows: boolean;
}

const LABELS = {
  pulling: "Pull to refresh",
  ready: "Release to refresh",
  busy: "Refreshing",
  // HEL-1681: while the stack settles back after a pull-started round the indicator is still visible; it must not
  // invite another pull.
  done: "Refreshed",
} as const;

/** The visual half of the phone pull-to-refresh (HEL-1656). Purely decorative (`aria-hidden`): the announcement lives
 *  in the stack's always-mounted status region, so unmounting this at rest never drops "Refreshed". The caller renders
 *  it only while a pull is engaged or a refresh is running. */
export function PullRefreshIndicator({ phase, busy, follows }: PullRefreshIndicatorProps) {
  const state = busy ? "busy" : phase === "done" ? "done" : phase === "ready" ? "ready" : "pulling";
  return (
    <div
      className={`pull-refresh-indicator pull-refresh-indicator--${follows ? "follow" : "snap"}`}
      data-state={state}
      aria-hidden="true"
    >
      {state === "busy" ? (
        <Spinner size="md" />
      ) : state === "done" ? (
        <Check className="pull-refresh-indicator__check" size={ICON_SIZE.md} />
      ) : (
        <RotateCw className="pull-refresh-indicator__arrow" size={ICON_SIZE.md} />
      )}
      <span className="pull-refresh-indicator__label">{LABELS[state]}</span>
    </div>
  );
}
