import { useCallback, useEffect, useRef } from "react";

/** The slice of an ECharts instance this hook touches (its zrender handle). */
interface CursorChart {
  getZr: () => {
    on: (event: string, handler: () => void) => void;
    setCursorStyle: (cursor: string) => void;
  };
}

/** HEL-1311 design D6 -- ECharts 6.1 draws every element with a pointer cursor and its HeatmapView
 *  never reads a series `cursor` (verified in `HeatmapView.js`), while `silent: true` would also kill
 *  the item tooltip. A heatmap cell is not clickable (cell selection is a follow-up), so while the
 *  resolved type is `heatmap` the canvas cursor is forced back to default on every mouse move.
 *
 *  Returns an `onChartReady` callback: `echarts-for-react` re-creates the chart instance on a
 *  remount, and a handler registered once from an effect would be left on the disposed instance, so
 *  the handler is attached to each instance as it becomes ready and reads the CURRENT type from a
 *  ref (a type change then needs no re-registration). A disposed instance takes its handlers with it. */
export function useHeatmapDefaultCursor(isHeatmap: boolean): (chart: CursorChart) => void {
  const isHeatmapRef = useRef(isHeatmap);
  useEffect(() => {
    isHeatmapRef.current = isHeatmap;
  }, [isHeatmap]);
  return useCallback((chart: CursorChart) => {
    const zr = chart.getZr();
    zr.on("mousemove", () => {
      if (isHeatmapRef.current) zr.setCursorStyle("default");
    });
  }, []);
}
