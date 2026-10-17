// GUARD (HEL-1305 task 3.9 / design D11d, labelled as such): green on a correct tree, red only by
// mutation. Whole built options are deep-compared with what main (3eb0cc893) built for the same
// inputs, so any drift in the legend, tooltip, axes or series of a chart that is not a timestamp-x
// line/scatter/vertical bar fails. The one allowed difference is owner ruling 2: a multi-series gap
// cell main plotted as 0 is now null (listed per case in `gaps`). Formatter functions compare as
// `expect.any(Function)` (the tooltip wrapper is a new function).
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { build } from "./timeAxisTestSupport";
import { SNAPSHOT_FILE, UNCHANGED_CASES } from "./unchangedPathCases";

const frozen = JSON.parse(readFileSync(resolve(__dirname, SNAPSHOT_FILE), "utf8")) as Record<
  string,
  unknown
>;

/** The frozen JSON with its "__fn__" markers turned back into function matchers. */
function revive(value: unknown): unknown {
  if (value === "__fn__") return expect.any(Function);
  if (Array.isArray(value)) return value.map(revive);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, revive(v)]));
  }
  return value;
}

/** HEL-1584 D10: the built option's series now carry a stable `id` (`chartDataOptions.withSeriesIds`), which main's frozen
 *  option does not. That added field is the ONLY accepted difference: it is removed from the series before comparing, and
 *  `chartDataOptions.seriesIds.test.ts` pins the ids themselves. Every other field still has to match main's. */
function withoutSeriesIds(option: unknown): unknown {
  const bag = option as { series?: unknown };
  if (!Array.isArray(bag.series)) return option;
  return {
    ...bag,
    series: bag.series.map((entry: Record<string, unknown>) => {
      // The reference-marks carrier already had its id on main; only the ids added by `withSeriesIds` come off.
      if (entry.id === "__helio_reference_marks__") return entry;
      const { id: _id, ...rest } = entry;
      return rest;
    }),
  };
}

function expectedFor(name: string, gaps: Array<[number, number]> = []): unknown {
  const expected = JSON.parse(JSON.stringify(frozen[name])) as {
    series: Array<{ data: unknown[] }>;
  };
  for (const [s, i] of gaps) {
    expect(expected.series[s].data[i]).toBe(0);
    expected.series[s].data[i] = null;
  }
  return revive(expected);
}

describe("GUARD: charts that are not timestamp-x line/scatter/vertical bar build main's option", () => {
  it("covers every case in the frozen snapshot", () => {
    expect(Object.keys(frozen).sort()).toEqual(UNCHANGED_CASES.map((c) => c.name).sort());
  });

  describe.each(UNCHANGED_CASES.map((c) => [c.name, c] as const))("%s", (name, kase) => {
    it.each(
      kase.fieldTypes.map(
        (f) => [JSON.stringify(f ?? null) + (f === undefined ? " (absent)" : ""), f] as const,
      ),
    )("fieldTypes %s", (_label, fieldTypes) => {
      const option = build(kase.chartType, { ...kase.args, fieldTypes });
      expect(withoutSeriesIds(option)).toEqual(expectedFor(name, kase.gaps));
    });
  });
});
