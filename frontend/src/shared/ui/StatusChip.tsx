import type { ReactNode } from "react";

import "./StatusChip.css";

type StatusChipIntent = "success" | "warning" | "error" | "accent" | "neutral";

interface StatusChipProps {
  /** Intent-colored background/text pairing — reuses the shared intent tokens. */
  intent: StatusChipIntent;
  /** Renders a small leading dot in the intent color (e.g. a "running" pulse). */
  dot?: boolean;
  /** Dashed-border, transparent-background treatment for "no data yet" states. */
  dashed?: boolean;
  className?: string;
  children: ReactNode;
}

/** Rounded, intent-colored status pill (F-073). Consolidates the ~7 independent
 * pill recipes across pipelines/metrics/panels/sources (`.pipeline-status`,
 * `.metric-status`, `.run-history-modal__status`, etc.), all of which hardcode
 * `border-radius: 999px` instead of `var(--app-radius-pill)`. Not yet adopted
 * by any call site in this batch — new status pills should reach for this
 * instead of re-deriving the recipe; migrating existing call sites is a
 * separate follow-up. */
export function StatusChip({
  intent,
  dot = false,
  dashed = false,
  className,
  children,
}: StatusChipProps) {
  const classes = [
    "ui-status-chip",
    `ui-status-chip--${intent}`,
    dashed ? "ui-status-chip--dashed" : null,
    className ?? null,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <span className={classes}>
      {dot ? <span className="ui-status-chip__dot" aria-hidden="true" /> : null}
      {children}
    </span>
  );
}
