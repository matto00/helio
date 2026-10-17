import { NOW, iso } from "../test/homeFixtures";
import { summary } from "../test/homeFixtures";
import { formatClock, hourTicks, timeToPercent, timelineRange } from "./timelineScale";

describe("timelineScale", () => {
  const range = timelineRange(summary());

  it("maps the window start to 0, the horizon end to 100 and now to 24/30", () => {
    expect(timeToPercent(range.start, range)).toBe(0);
    expect(timeToPercent(range.end, range)).toBe(100);
    expect(timeToPercent(NOW, range)).toBeCloseTo(80, 5);
  });

  it("clamps times outside the range", () => {
    expect(timeToPercent(range.start - 1e9, range)).toBe(0);
    expect(timeToPercent(range.end + 1e9, range)).toBe(100);
  });

  it("labels hourly ticks on multiples of six local hours, in order, inside the range", () => {
    const ticks = hourTicks(range);
    expect(ticks.length).toBeGreaterThanOrEqual(5);
    for (const tick of ticks) {
      expect(new Date(tick.time).getHours() % 6).toBe(0);
      expect(tick.time).toBeGreaterThanOrEqual(range.start);
      expect(tick.time).toBeLessThanOrEqual(range.end);
      expect(tick.label).toBe(formatClock(tick.time));
    }
    expect(ticks.map((t) => t.time)).toEqual([...ticks.map((t) => t.time)].sort((a, b) => a - b));
  });

  it("formats a clock as zero-padded 24-hour local time", () => {
    const date = new Date(2026, 9, 13, 3, 5);
    expect(formatClock(date.getTime())).toBe("03:05");
    expect(iso(0)).toBe(new Date(NOW).toISOString());
  });
});
