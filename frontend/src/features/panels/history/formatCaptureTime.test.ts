import {
  distinctCapturePrecision,
  formatCaptureTime,
  formatCapturePair,
} from "./formatCaptureTime";

describe("formatCaptureTime (HEL-1277)", () => {
  it("renders seconds only on request", () => {
    const a = formatCaptureTime("2026-10-05T14:02:05Z", true);
    const b = formatCaptureTime("2026-10-05T14:02:55Z", true);
    expect(a).not.toBe(b);
    expect(formatCaptureTime("2026-10-05T14:02:05Z")).toBe(
      formatCaptureTime("2026-10-05T14:02:55Z"),
    );
  });
});

describe("formatCapturePair (HEL-1352)", () => {
  it("keeps minute precision for different minutes", () => {
    const p = formatCapturePair("2026-10-05T14:03:05Z", "2026-10-05T14:02:55Z");
    expect(p.selected).toBe(formatCaptureTime("2026-10-05T14:03:05Z"));
    expect(p.comparison).toBe(formatCaptureTime("2026-10-05T14:02:55Z"));
  });

  it("escalates to seconds within the same minute", () => {
    const p = formatCapturePair("2026-10-05T14:02:55Z", "2026-10-05T14:02:05Z");
    expect(p.selected).not.toBe(p.comparison);
    expect(p.selected).toBe(formatCaptureTime("2026-10-05T14:02:55Z", "second"));
  });

  it("escalates to milliseconds within the same second", () => {
    const p = formatCapturePair("2026-10-05T14:02:05.742Z", "2026-10-05T14:02:05.318Z");
    expect(p.selected).not.toBe(p.comparison);
    expect(p.selected).toContain("742");
    expect(p.comparison).toContain("318");
  });

  it("suffixes the comparison for an identical instant", () => {
    const p = formatCapturePair("2026-10-05T14:02:05.742Z", "2026-10-05T14:02:05.742Z");
    expect(p.comparison).toMatch(/ \(older capture\)$/);
    expect(p.selected).not.toBe(p.comparison);
  });

  it("returns a null comparison for the oldest point", () => {
    expect(formatCapturePair("2026-10-05T14:02:05Z", null)).toEqual({
      selected: formatCaptureTime("2026-10-05T14:02:05Z"),
      comparison: null,
    });
  });
});

describe("distinctCapturePrecision (HEL-1359)", () => {
  const T = "2026-10-05T14:02:05.742Z";

  it("stays at minute precision with no neighbours", () => {
    expect(distinctCapturePrecision(T, [])).toEqual({ precision: "minute", identical: false });
  });

  it("stays at minute precision when every neighbour is in another minute", () => {
    expect(distinctCapturePrecision(T, ["2026-10-05T14:03:05Z", "2026-10-05T14:01:05Z"])).toEqual({
      precision: "minute",
      identical: false,
    });
  });

  it("escalates to seconds for a same-minute neighbour", () => {
    expect(distinctCapturePrecision(T, ["2026-10-05T14:02:45Z"])).toEqual({
      precision: "second",
      identical: false,
    });
  });

  it("escalates to milliseconds for a same-second neighbour", () => {
    expect(distinctCapturePrecision(T, ["2026-10-05T14:02:05.318Z"])).toEqual({
      precision: "millisecond",
      identical: false,
    });
  });

  it("uses the highest precision any one of two neighbours demands", () => {
    expect(
      distinctCapturePrecision(T, ["2026-10-05T14:09:00Z", "2026-10-05T14:02:05.100Z"]),
    ).toEqual({ precision: "millisecond", identical: false });
  });

  it("flags an identical instant", () => {
    expect(distinctCapturePrecision(T, [T])).toEqual({ precision: "millisecond", identical: true });
  });
});
