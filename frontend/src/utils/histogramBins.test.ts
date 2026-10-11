import { automaticBinCount, binHistogram } from "./histogramBins";

const range = (n: number): string[] => Array.from({ length: n }, (_, i) => String(i));

describe("binHistogram", () => {
  it("uses Sturges' rule when no bin count is given (100 values -> 8 bins, counts sum to 100)", () => {
    const { bins, skipped } = binHistogram(range(100));
    expect(bins).toHaveLength(8);
    expect(bins.reduce((n, b) => n + b.count, 0)).toBe(100);
    expect(skipped).toBe(0);
  });

  it("clamps the automatic bin count to 1-50", () => {
    expect(binHistogram(["1", "2"]).bins).toHaveLength(2);
    expect(automaticBinCount(1)).toBe(1);
    expect(automaticBinCount(100)).toBe(8);
    expect(automaticBinCount(2 ** 60)).toBe(50);
  });

  it("honours a configured bin count and counts the maximum in the last bin", () => {
    const { bins } = binHistogram(["0", "2.5", "5", "7.5", "10"], 5);
    expect(bins.map((b) => [b.start, b.end])).toEqual([
      [0, 2],
      [2, 4],
      [4, 6],
      [6, 8],
      [8, 10],
    ]);
    expect(bins.map((b) => b.count)).toEqual([1, 1, 1, 1, 1]);
    expect(bins[4].count).toBe(1); // 10 is inside the last bin
  });

  it("makes a single bin when every value is equal, even with a configured bin count", () => {
    const { bins } = binHistogram(["4", "4", "4"], 10);
    expect(bins).toEqual([{ start: 4, end: 4, count: 3 }]);
  });

  it("skips blank and non-numeric cells and reports how many", () => {
    const cells = [...range(10), "", "", "n/a"];
    const { bins, skipped } = binHistogram(cells);
    expect(bins.reduce((n, b) => n + b.count, 0)).toBe(10);
    expect(skipped).toBe(3);
  });

  it("returns no bins when nothing is numeric", () => {
    expect(binHistogram(["", "n/a"])).toEqual({ bins: [], skipped: 2 });
    expect(binHistogram([])).toEqual({ bins: [], skipped: 0 });
  });

  it("treats a non-finite parse as skipped", () => {
    expect(binHistogram(["Infinity", "1", "2"]).skipped).toBe(1);
  });
});
