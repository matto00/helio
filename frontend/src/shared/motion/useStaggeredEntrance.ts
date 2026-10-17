import { useState, type CSSProperties } from "react";

import "./motion.css";

export interface StaggeredItemProps {
  className: string;
  style: CSSProperties;
}

/** Staggered entrance (HEL-1573, DESIGN.md §10): a fade plus a rise, one `--motion-stagger` step per item.
 *
 *  `count` is how many items the surface shows. The items present the first time it is non-zero stagger in order
 *  (`itemProps(index)` for their position); an item that mounts later gets index 0, a single rise with no queue behind
 *  the earlier ones. Re-renders never replay an entrance: a CSS animation runs once when its element mounts. The
 *  delay cap, the rise distance and every duration are tokens in `motion.css`. */
export function useStaggeredEntrance(count: number): {
  itemProps: (index: number) => StaggeredItemProps;
} {
  // React's "adjust state while rendering": remember the population the surface first showed.
  const [initialCount, setInitialCount] = useState(0);
  if (initialCount === 0 && count > 0) setInitialCount(count);

  return {
    itemProps(index: number): StaggeredItemProps {
      const staggered = index < initialCount;
      return {
        className: "motion-enter",
        style: { "--motion-index": staggered ? index : 0 } as CSSProperties,
      };
    },
  };
}
