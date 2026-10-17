import type { EChartsOption } from "echarts";

/** Replaces a data payload while keeping the fact that one was present. */
const DATA = "~data";

type Bag = Record<string, unknown>;

const asBag = (value: unknown): Bag | null =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Bag) : null;

/** Applies `strip` to a value that is either one component object or an array of them. */
function eachComponent(value: unknown, strip: (component: Bag) => Bag): unknown {
  if (Array.isArray(value)) return value.map((item) => (asBag(item) ? strip(asBag(item)!) : item));
  const bag = asBag(value);
  return bag ? strip(bag) : value;
}

/** The option with only its data payloads replaced: `series[].data`, a category axis' `data`, `dataset.source`, and the
 *  data-derived `min` / `max` of a `visualMap` (a heatmap's colour scale). Everything else — types, formatters, axis names and
 *  bounds, legends, stacking, colours — stays, so a change to any of it changes the signature. */
function stripDataPayloads(option: Bag): Bag {
  const out: Bag = { ...option };
  if (out.series !== undefined) {
    out.series = eachComponent(out.series, (s) =>
      s.data === undefined ? s : { ...s, data: DATA },
    );
  }
  for (const axis of ["xAxis", "yAxis"]) {
    if (out[axis] !== undefined) {
      out[axis] = eachComponent(out[axis], (a) =>
        a.data === undefined ? a : { ...a, data: DATA },
      );
    }
  }
  if (out.dataset !== undefined) {
    out.dataset = eachComponent(out.dataset, (d) =>
      d.source === undefined ? d : { ...d, source: DATA },
    );
  }
  if (out.visualMap !== undefined) {
    out.visualMap = eachComponent(out.visualMap, (v) => {
      const { min: _min, max: _max, ...rest } = v;
      return {
        ...rest,
        ...(v.min !== undefined ? { min: DATA } : {}),
        ...(v.max !== undefined ? { max: DATA } : {}),
      };
    });
  }
  return out;
}

/** Deterministic text for any option value: keys sorted, `undefined` dropped, a function by its source text (so a formatter
 *  rebuilt with identical source matches and a different one does not). */
function stable(value: unknown): string {
  if (typeof value === "function") return `fn(${value.toString()})`;
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "undefined";
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  const bag = value as Bag;
  const keys = Object.keys(bag)
    .filter((key) => bag[key] !== undefined)
    .sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stable(bag[key])}`).join(",")}}`;
}

/** Shape signature of a chart option (HEL-1584 D10): the whole option, deterministically serialised, with the data payloads
 *  stripped. Two options with the same signature differ only in their data, which ECharts can update in place and animate;
 *  anything else (a chart type, an axis name or bound, a formatter, a legend setting) changes the signature, and the caller
 *  then replaces the chart outright so no stale nested option survives. */
export function chartShapeSignature(option: EChartsOption): string {
  return stable(stripDataPayloads(option as Bag));
}

/** What the chart last committed to ECharts. Held in state as one mutable object (the `EntranceWindow` pattern in
 *  `useChartEntranceMotion`): the render reads it, only an effect writes it, so a StrictMode double render can never make a
 *  first mount look unchanged. */
export class ShapeMemory {
  private committed: string | null = null;

  matches(signature: string): boolean {
    return this.committed === signature;
  }

  commit(signature: string): void {
    this.committed = signature;
  }
}
