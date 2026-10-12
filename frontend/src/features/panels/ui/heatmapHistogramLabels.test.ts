import { binHistogram } from "../../../utils/histogramBins";
import { histogramBinLabels } from "./heatmapHistogramOptions";

function labelsFor(min: number, max: number, binCount: number): string[] {
  return histogramBinLabels(binHistogram([String(min), String(max)], binCount).bins);
}

function expectDistinctAdjacent(labels: string[]) {
  labels.forEach((l, i) => {
    if (i > 0) expect(l).not.toBe(labels[i - 1]);
  });
}

describe("histogramBinLabels (HEL-1487)", () => {
  it("shows one decimal place for a 2.5 bin width", () => {
    expect(labelsFor(0, 10, 4)).toEqual(["0.0 to 2.5", "2.5 to 5.0", "5.0 to 7.5", "7.5 to 10.0"]);
  });

  it("shows no decimals for integer edges", () => {
    expect(labelsFor(0, 10, 5)).toEqual(["0 to 2", "2 to 4", "4 to 6", "6 to 8", "8 to 10"]);
  });

  it("caps repeating edges one place past the width's first significant decimal", () => {
    expect(labelsFor(0, 10, 3)).toEqual(["0.0 to 3.3", "3.3 to 6.7", "6.7 to 10.0"]);
  });

  it("keeps 0 to 0.01 in 3 bins distinguishable", () => {
    const labels = labelsFor(0, 0.01, 3);
    expectDistinctAdjacent(labels);
    expect(new Set(labels.map((l) => l.split(" to ")[0].split(".")[1]?.length)).size).toBe(1);
  });

  it("never renders a negative zero", () => {
    const labels = labelsFor(-0.1, 0.5, 6);
    labels.forEach((l) => expect(l).not.toContain("-0.0 "));
    labels.forEach((l) => expect(l).not.toMatch(/(^|to )-0(\.0+)?( |$)/));
    expect(labels.join("|")).toContain("0.0");
  });

  it("keeps 0 to 0.000001 in 4 bins distinguishable", () => {
    expectDistinctAdjacent(labelsFor(0, 0.000001, 4));
  });

  it("uses 2 places for epoch seconds 1700000000..1700000002 in 8 bins", () => {
    const labels = labelsFor(1700000000, 1700000002, 8);
    expect(labels[0]).toBe("1700000000.00 to 1700000000.25");
    expectDistinctAdjacent(labels);
  });

  it("keeps 1234567890.12..1234567890.15 in 3 bins distinguishable", () => {
    expectDistinctAdjacent(labelsFor(1234567890.12, 1234567890.15, 3));
  });

  it("keeps 0..1e-12 in 4 bins distinguishable", () => {
    expectDistinctAdjacent(labelsFor(0, 1e-12, 4));
  });

  it("keeps a single bin's shared number format", () => {
    expect(histogramBinLabels(binHistogram(["1700000000.5"]).bins)).toEqual(["1700000000.5"]);
  });

  it("labels a stored binCount of 1 as a range in the shared format", () => {
    expect(labelsFor(0, 10, 1)).toEqual(["0 to 10"]);
  });

  it("takes the width from the full span, not the first bin", () => {
    const labels = histogramBinLabels([
      { start: 1, end: 1, count: 1 },
      { start: 1, end: 3, count: 1 },
      { start: 3, end: 5, count: 1 },
    ]);
    expect(labels).toEqual(["1", "1 to 3", "3 to 5"]);
  });
});
