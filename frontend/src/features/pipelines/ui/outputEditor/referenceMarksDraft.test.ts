import type { ReferenceTone } from "../../../../utils/referenceMarks";
import {
  bandDraftProblem,
  draftsToMarks,
  lineDraftProblem,
  marksOrNull,
  parseDraftNumber,
} from "./referenceMarksDraft";

const line = (value: string, label = "", tone: ReferenceTone = "neutral") => ({
  value,
  label,
  tone,
});

describe("parseDraftNumber", () => {
  it.each([
    ["95", 95],
    [" -1.5 ", -1.5],
    [".5", 0.5],
    ["1e3", 1000],
    ["+7", 7],
  ])("accepts %j", (text, expected) => {
    expect(parseDraftNumber(text)).toBe(expected);
  });

  it.each(["", "  ", "abc", "1,5", "0x10", "NaN", "Infinity", "1e400", "-1e400", "1 2", "--1"])(
    "rejects %j",
    (text) => {
      expect(parseDraftNumber(text)).toBeUndefined();
    },
  );
});

describe("draft problems", () => {
  it("flags a missing value and an over-long or blank-trimmed label correctly", () => {
    expect(lineDraftProblem(line(""))).toBe("number");
    expect(lineDraftProblem(line("1", "a".repeat(61)))).toBe("label");
    expect(lineDraftProblem(line("1", "   "))).toBeNull();
    expect(lineDraftProblem(line("1", `  ${"a".repeat(60)}  `))).toBeNull();
  });

  it("flags a band whose from is not less than to", () => {
    const band = (from: string, to: string) => ({ from, to, label: "", tone: "neutral" as const });
    expect(bandDraftProblem(band("5", "5"))).toBe("order");
    expect(bandDraftProblem(band("9", "5"))).toBe("order");
    expect(bandDraftProblem(band("", "5"))).toBe("number");
    expect(bandDraftProblem(band("1", "1e400"))).toBe("number");
    expect(bandDraftProblem(band("-3", "5"))).toBeNull();
  });
});

describe("draftsToMarks", () => {
  it("trims labels, omits an empty label and the default tone", () => {
    expect(
      draftsToMarks(
        [line("95", "  SLO  ", "warning"), line("10")],
        [{ from: "0", to: "50", label: "", tone: "success" }],
      ),
    ).toEqual({
      lines: [{ value: 95, label: "SLO", tone: "warning" }, { value: 10 }],
      bands: [{ from: 0, to: 50, tone: "success" }],
    });
  });

  it("returns null when any row is invalid", () => {
    expect(draftsToMarks([line("1"), line("x")], [])).toBeNull();
    expect(draftsToMarks([], [{ from: "2", to: "1", label: "", tone: "neutral" }])).toBeNull();
  });
});

describe("marksOrNull", () => {
  it("is null for none, and drops an explicit neutral tone", () => {
    expect(marksOrNull([])).toBeNull();
    expect(marksOrNull([{ value: 1, tone: "neutral" as const }])).toEqual([{ value: 1 }]);
    expect(marksOrNull([{ value: 1, tone: "error" as const }])).toEqual([
      { value: 1, tone: "error" },
    ]);
  });
});
