import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { EChartsOption } from "echarts";

import { readMotionDuration } from "../../../shared/motion/motionTokens";
import { useMotion } from "../../../theme/ThemeProvider";
import { applyChartMotion } from "../../../utils/chartAppearance";

/** Whether the entrance is still open. A plain object the callbacks close and the option memo reads. */
class EntranceWindow {
  open = true;
  close() {
    this.open = false;
  }
}

/** The slice of an ECharts instance this hook touches. */
interface EntranceChart {
  on: (event: string, handler: () => void) => void;
}

/** True when `option` carries something to draw: a series with data, or a dataset. */
function optionHasData(option: EChartsOption): boolean {
  if (option.dataset !== undefined) return true;
  const series = option.series;
  if (series === undefined) return false;
  return (Array.isArray(series) ? series : [series]).some((s) => {
    const data = (s as { data?: unknown }).data;
    return Array.isArray(data) ? data.length > 0 : data != null;
  });
}

/** Chart entrance motion (HEL-1034, HEL-1573): gives `option` its token-timed animation settings (see
 *  `applyChartMotion`) and owns the entrance window that keeps the entrance from replaying.
 *
 *  The window is a ref, not state, so closing it never rebuilds or re-sets the option by itself; the `animationDuration: 0`
 *  takes effect on the next naturally occurring option rebuild (theme tick, resize, data refresh, config edit). It
 *  closes on the chart's `finished` event once an option with data has rendered, or when the standard duration has
 *  elapsed since the chart became ready with data, whichever is first. Rebuilds inside the window keep the entrance
 *  duration, so an identical option is not re-applied and the entrance is not cut. Returns the option to render and an
 *  `onChartReady` to hand the chart. */
export function useChartEntranceMotion(option: EChartsOption): {
  option: EChartsOption;
  onChartReady: (chart: EntranceChart) => void;
} {
  const motion = useMotion();
  // A mutable object held in state, not a ref: the option memo reads it during render, and closing it must not re-render.
  const [entrance] = useState(() => new EntranceWindow());
  const chartReadyRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hasData = optionHasData(option);
  const hasDataRef = useRef(hasData);

  const closeEntrance = useCallback(() => {
    entrance.close();
    if (timerRef.current !== null) clearTimeout(timerRef.current);
    timerRef.current = null;
  }, [entrance]);

  const armTimer = useCallback(() => {
    if (!entrance.open || timerRef.current !== null) return;
    if (!chartReadyRef.current || !hasDataRef.current) return;
    timerRef.current = setTimeout(closeEntrance, readMotionDuration("--motion-duration-standard"));
  }, [closeEntrance, entrance]);

  useEffect(() => {
    hasDataRef.current = hasData;
    armTimer();
  }, [hasData, armTimer]);

  useEffect(
    () => () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
    },
    [],
  );

  const onChartReady = useCallback(
    (chart: EntranceChart) => {
      chartReadyRef.current = true;
      chart.on("finished", () => {
        if (hasDataRef.current) closeEntrance();
      });
      armTimer();
    },
    [armTimer, closeEntrance],
  );

  // The standard duration is read while the option is built (the option is a render product, so it cannot wait for an
  // effect: echarts-for-react applies it in its own mount). The cascade can lag one render behind a Motion change; the
  // `effectiveMotion` rebuild that `useChartOption` schedules after paint re-reads the settled value.
  const motionOption = useMemo(
    () =>
      applyChartMotion(option, {
        motion,
        entrance: entrance.open,
        durationMs: readMotionDuration("--motion-duration-standard"),
      }),
    [option, motion, entrance],
  );

  return { option: motionOption, onChartReady };
}
