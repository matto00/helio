import { buildSummarySentence, numberWord, sentenceText } from "./buildSummarySentence";

const quiet = { changedDashboards: 0, failedRuns: 0, stuckRuns: 0, missedRuns: 0 };

describe("buildSummarySentence", () => {
  it("names changed dashboards and a failure, ending quiet (the spec example)", () => {
    expect(
      sentenceText(buildSummarySentence({ ...quiet, changedDashboards: 2, failedRuns: 1 })),
    ).toBe(
      "Two dashboards changed since your last visit. One run failed, everything else is quiet.",
    );
  });

  it("says one dashboard changed, then that everything else is quiet", () => {
    expect(sentenceText(buildSummarySentence({ ...quiet, changedDashboards: 1 }))).toBe(
      "One dashboard changed since your last visit. Everything else is quiet.",
    );
  });

  it("names only run problems when nothing changed", () => {
    expect(sentenceText(buildSummarySentence({ ...quiet, failedRuns: 3 }))).toBe(
      "Three runs failed, everything else is quiet.",
    );
  });

  it("joins failed, stuck and missed clauses", () => {
    expect(
      sentenceText(buildSummarySentence({ ...quiet, failedRuns: 1, stuckRuns: 1, missedRuns: 2 })),
    ).toBe(
      "One run failed, one run looks stuck and two scheduled runs were missed, everything else is quiet.",
    );
  });

  it("states plainly that all is quiet when nothing happened", () => {
    expect(sentenceText(buildSummarySentence(quiet))).toBe(
      "All quiet: nothing has changed, failed or been missed.",
    );
  });

  it("marks run problems as the danger tone and nothing else", () => {
    const segments = buildSummarySentence({ ...quiet, changedDashboards: 1, failedRuns: 1 });
    expect(segments.filter((s) => s.tone === "danger").map((s) => s.text)).toEqual([
      "One run failed",
    ]);
  });

  it("uses number words to nine and digits beyond", () => {
    expect(numberWord(9)).toBe("nine");
    expect(numberWord(10)).toBe("10");
  });
});
