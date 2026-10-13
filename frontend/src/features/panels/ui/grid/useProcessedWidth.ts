// HEL-1413 processed-width report for `DesktopPanelGrid` (HEL-1418 split; behaviour unchanged).

import { useCallback, useMemo, useState, type CSSProperties } from "react";

// HEL-1413 — the container width RGL has actually PROCESSED, as opposed to the `width` prop this
// component was just handed. RGL derives the active breakpoint and cols from a new width in an
// effect and calls `onWidthChange` from it, so this state commits together with the new
// breakpoint/cols render. It is NOT the point at which every item is laid out: RGL's inner
// GridLayout syncs its own layout state from props one effect flush later, so a consumer must
// still let item transitions finish and positions stabilise after seeing this value.
// Exposed as a CSS custom property on the grid root (it carries no styling; `style` is used
// because RGL does not forward `data-*` to its root) so a live browser check can wait on RGL
// itself instead of racing the ResizeObserver -> rAF -> setWidth chain that sits between a
// viewport resize and this component receiving the new width.
export function useProcessedWidth(width: number) {
  const [processedWidth, setProcessedWidth] = useState(width);
  const handleWidthChange = useCallback((nextWidth: number) => setProcessedWidth(nextWidth), []);
  const gridStyle = useMemo(
    () => ({ "--panel-grid-processed-width": `${processedWidth}px` }) as CSSProperties,
    [processedWidth],
  );
  return { gridStyle, handleWidthChange };
}
