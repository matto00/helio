// HEL-1517 item 1 -- the finest tick a time axis may use is the granularity of its own data.
import { timeAxisMinInterval } from "./chartTimeAxis";

const DAY = 86_400_000;
const HOUR = 3_600_000;
const MINUTE = 60_000;
const SECOND = 1_000;
const utc = (iso: string): number => Date.parse(`${iso}Z`);

describe("timeAxisMinInterval", () => {
  it("is one day when every instant is a whole UTC day", () => {
    expect(timeAxisMinInterval([utc("2026-10-01T00:00:00"), utc("2026-10-09T00:00:00")])).toBe(DAY);
  });

  it("is one day for a single midnight and for instants before 1970", () => {
    expect(timeAxisMinInterval([utc("2026-10-01T00:00:00")])).toBe(DAY);
    expect(timeAxisMinInterval([utc("1960-01-01T00:00:00")])).toBe(DAY);
  });

  it("is one hour when every instant is on a whole hour and one is not midnight", () => {
    expect(timeAxisMinInterval([utc("2026-10-01T00:00:00"), utc("2026-10-01T05:00:00")])).toBe(
      HOUR,
    );
  });

  it("is one minute, then one second, for finer whole-unit data", () => {
    expect(timeAxisMinInterval([utc("2026-10-01T05:07:00"), utc("2026-10-01T05:08:00")])).toBe(
      MINUTE,
    );
    expect(timeAxisMinInterval([utc("2026-10-01T05:07:09"), utc("2026-10-01T05:07:10")])).toBe(
      SECOND,
    );
  });

  it("is undefined when any instant has a millisecond part, or there are no instants", () => {
    expect(timeAxisMinInterval([utc("2026-10-01T00:00:00"), utc("2026-10-01T00:00:00.250")])).toBe(
      undefined,
    );
    expect(timeAxisMinInterval([])).toBeUndefined();
  });
});
