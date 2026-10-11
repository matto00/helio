import { formatDuration } from "./formatDuration";

// HEL-1308 task 4.1 -- every spec scenario of "Compact duration text", incl. the single-rounding cases.
describe("formatDuration", () => {
  it.each([
    [330, "5m 30s"],
    [0, "0s"],
    [45, "45s"],
    [45.6, "46s"],
    [0.25, "250ms"],
    [3600, "1h"],
    [3725, "1h 2m"],
    [3755, "1h 3m"],
    [90061, "1d 1h"],
    [59.6, "1m"],
    [3599.7, "1h"],
    [-330, "-5m 30s"],
    [400 * 86400, "400d"],
  ])("%p seconds -> %p", (seconds, text) => {
    expect(formatDuration(seconds)).toBe(text);
  });

  // Single-rounding red cases: a double round (round to s, then round to the minor unit) gets these wrong.
  it.each([
    [3629.5, "1h"],
    [88199.5, "1d"],
    [86399, "1d"],
  ])("rounds once from the original value: %p -> %p", (seconds, text) => {
    expect(formatDuration(seconds)).toBe(text);
  });

  it("a milliseconds caller converts first: 3629500 ms -> 1h, 330000 ms -> 5m 30s", () => {
    expect(formatDuration(3629500 / 1000)).toBe("1h");
    expect(formatDuration(330000 / 1000)).toBe("5m 30s");
  });

  it("never prints -0s: a negative value that rounds to zero is 0s", () => {
    expect(formatDuration(-0.0001)).toBe("0s");
    expect(formatDuration(-0)).toBe("0s");
  });

  it("rounds a negative half away from zero", () => {
    expect(formatDuration(-45.5)).toBe("-46s");
    expect(formatDuration(-0.9996)).toBe("-1s");
  });

  it("a sub-second value that rounds up to 1000 ms is 1s", () => {
    expect(formatDuration(0.9996)).toBe("1s");
  });

  it("prints huge inputs with plain digits (no exponent)", () => {
    expect(formatDuration(1e21)).not.toMatch(/e/i);
  });
});
