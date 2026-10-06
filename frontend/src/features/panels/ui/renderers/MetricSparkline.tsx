const WIDTH = 100;
const HEIGHT = 24;
const PAD = 2;

interface MetricSparklineProps {
  /** Oldest to newest; the caller guarantees at least two. */
  values: number[];
}

/** HEL-1275 design.md D6 — an inline-SVG polyline, not an ECharts instance per metric panel.
 *  Stroke is `--app-accent` (the decoration token; `--app-accent-text` is text-only, HEL-1048). */
export function MetricSparkline({ values }: MetricSparklineProps) {
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min;
  const step = (WIDTH - PAD * 2) / (values.length - 1);
  const points = values
    .map((v, i) => {
      const y = span === 0 ? HEIGHT / 2 : HEIGHT - PAD - ((v - min) / span) * (HEIGHT - PAD * 2);
      return `${(PAD + i * step).toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");
  const first = values[0];
  const last = values[values.length - 1];
  const trend = last > first ? "rising" : last < first ? "falling" : "flat";
  return (
    <svg
      className="panel-content__metric-sparkline"
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={`Trend over ${values.length} data points, ${trend}`}
    >
      <polyline points={points} fill="none" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
