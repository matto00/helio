import { CHART_COMPACT_HEIGHT_PX } from "./useChartCompact";
import { valueAxisSplitCap } from "./valueAxisLabels";

// HEL-1444 -- the value axis keeps ECharts' default ~5 splits however short the canvas, so on a
// 33-45px compact canvas (a 10px label needs ~12px) the labels overprint. The cap is the number of
// splits whose labels fit the plot area left after the compact grid insets and the x-axis label band.
describe("valueAxisSplitCap (HEL-1444)", () => {
  it.each([
    [45, 1],
    [48, 1],
    [60, 2],
    [72, 3],
    [81, 4],
  ])("a %ipx canvas caps the value axis at %i split(s)", (height, cap) => {
    expect(valueAxisSplitCap(height)).toBe(cap);
  });

  it("never returns less than one split (the min and max labels) however short the canvas", () => {
    expect(valueAxisSplitCap(1)).toBe(1);
    expect(valueAxisSplitCap(16.2)).toBe(1);
    expect(valueAxisSplitCap(33)).toBe(1);
  });

  it("leaves the default alone once five splits fit", () => {
    expect(valueAxisSplitCap(94)).toBeUndefined();
    expect(valueAxisSplitCap(CHART_COMPACT_HEIGHT_PX)).toBeUndefined();
  });

  it("leaves a canvas of 180px or more, and an unmeasured one, alone", () => {
    expect(valueAxisSplitCap(CHART_COMPACT_HEIGHT_PX + 1)).toBeUndefined();
    expect(valueAxisSplitCap(400)).toBeUndefined();
    expect(valueAxisSplitCap(0)).toBeUndefined();
    expect(valueAxisSplitCap(Number.NaN)).toBeUndefined();
  });
});
