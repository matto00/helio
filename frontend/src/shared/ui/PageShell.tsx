import type { ReactNode } from "react";

import "./PageShell.css";

interface PageShellProps {
  children: ReactNode;
  /** Route-specific class, applied alongside `page-shell` (e.g. for a layout
   *  override like `SettingsPage`'s `max-width`, or a route whose CSS keeps
   *  its own container rules such as `PipelineDetailPage`'s full-height
   *  scroll layout). */
  className?: string;
}

/** Canonical top-level page container (DESIGN.md §6 "Section overview
 *  pages"): `padding: var(--space-5) var(--space-6)`, `gap: var(--space-7)`.
 *  Every listed route composes this instead of hand-rolling the same
 *  padding/gap so the geometry can't drift per-route again (HEL-725). */
export function PageShell({ children, className }: PageShellProps) {
  const classes = ["page-shell", className ?? null].filter(Boolean).join(" ");
  return <div className={classes}>{children}</div>;
}
