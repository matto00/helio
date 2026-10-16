import { useLayoutEffect, useState, type RefObject } from "react";

/** How much of the dashboard meta row's content fits (HEL-1576 design D3). 0: everything with labels.
 *  1: edit tools, Edit layout/Done and Share are icon-only. 2: Share and the assistant move into the
 *  overflow kebab. 3: the facts collapse to the panel count. The facts' own ellipsis shrinks first, at
 *  every tier. */
export type MetaRowTier = 0 | 1 | 2 | 3;

/** Row widths (px) below which each tier applies, measured live and recorded in this change's
 *  `measurements.md`. Edit mode adds three more controls to the row, so it shifts every threshold up. */
export const META_ROW_TIER_WIDTHS = { iconOnly: 820, kebab: 640, countOnly: 520 } as const;
export const META_ROW_EDIT_EXTRA_PX = 150;

export function tierForWidth(width: number, isEditing: boolean): MetaRowTier {
  // Width 0 means "not measured" (no layout yet, or no ResizeObserver): show everything.
  if (width <= 0) return 0;
  const extra = isEditing ? META_ROW_EDIT_EXTRA_PX : 0;
  if (width < META_ROW_TIER_WIDTHS.countOnly + extra) return 3;
  if (width < META_ROW_TIER_WIDTHS.kebab + extra) return 2;
  if (width < META_ROW_TIER_WIDTHS.iconOnly + extra) return 1;
  return 0;
}

/** Measures `ref`'s inline size and returns the tier for it. Conditional rendering by tier (rather than
 *  CSS-only hiding) keeps exactly one accessible instance of every control at every width. */
export function useMetaRowTier(
  ref: RefObject<HTMLElement | null>,
  isEditing: boolean,
): MetaRowTier {
  const [width, setWidth] = useState(0);

  useLayoutEffect(() => {
    const element = ref.current;
    if (element === null) return;
    setWidth(element.getBoundingClientRect().width);
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      const next = entries[entries.length - 1]?.contentRect.width;
      if (next !== undefined) setWidth(next);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);

  return tierForWidth(width, isEditing);
}
