import { relativeShelfTime } from "./relativeShelfTime";

const NOW = Date.parse("2026-10-13T09:12:00Z");
const at = (ms: number) => new Date(NOW - ms).toISOString();

describe("relativeShelfTime", () => {
  it.each([
    [10_000, "now"],
    [12 * 60_000, "12m"],
    [9 * 3_600_000, "9h"],
    [3 * 86_400_000, "3d"],
  ])("renders %i ms ago as %s", (ms, expected) => {
    expect(relativeShelfTime(at(ms), NOW)).toBe(expected);
  });

  it("falls back to a calendar date after a week", () => {
    expect(relativeShelfTime(new Date(2026, 8, 18, 12).toISOString(), NOW)).toBe("Sep 18");
  });

  it("returns an empty string for an unparseable time", () => {
    expect(relativeShelfTime("nope", NOW)).toBe("");
  });
});
