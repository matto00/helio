import "./Skeleton.css";

import type { CSSProperties } from "react";

interface SkeletonProps {
  /** Placeholder shape. `block` — a rectangular area (cards, panel bodies, table
   *  cells); `line` — a single text-line bar (list rows, labels); `circle` — an
   *  avatar/icon-sized dot. Defaults to `line`. */
  variant?: "block" | "line" | "circle";
  /** Optional explicit width/height override (e.g. `"60%"`, `24`). When omitted,
   *  the variant's default sizing from `Skeleton.css` applies — callers shape-match
   *  by sizing the placeholder to the real content's own dimensions (DESIGN.md §7). */
  width?: number | string;
  height?: number | string;
  className?: string;
}

/**
 * Shared shimmer-placeholder primitive (DESIGN.md §7 / §6).
 *
 * Skeleton = initial structural load, where a region has no prior content and its
 * resolved size is predictable — shown until the first real content arrives.
 * `Spinner` (`frontend/src/shared/ui/Spinner.tsx`) remains the indicator for short
 * in-place work over structure that already exists (pagination "load more", a
 * button's busy label, a route-level `Suspense` fallback) — never replace one of
 * those with a `Skeleton`.
 *
 * Always `aria-hidden` — mirrors `Spinner`'s contract that the loading state's
 * accessible name lives on a sibling/ancestor wrapper, not on the placeholder
 * itself. Callers rendering a group of skeletons must expose exactly one
 * accessible loading name on that wrapper (e.g. `role="status"` + `aria-label`).
 */
export function Skeleton({ variant = "line", width, height, className }: SkeletonProps) {
  const classes = ["ui-skeleton", `ui-skeleton--${variant}`, className ?? null]
    .filter(Boolean)
    .join(" ");
  const style: CSSProperties | undefined =
    width !== undefined || height !== undefined
      ? {
          ...(width !== undefined ? { width } : null),
          ...(height !== undefined ? { height } : null),
        }
      : undefined;
  return <span className={classes} style={style} aria-hidden="true" />;
}
