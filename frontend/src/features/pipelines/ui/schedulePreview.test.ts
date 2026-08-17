import {
  validateCronExpression,
  computeCronNextRun,
  computeIntervalNextRun,
  isValidTimezone,
} from "./schedulePreview";

describe("validateCronExpression", () => {
  it("accepts a standard 5-field expression", () => {
    expect(validateCronExpression("0 * * * *")).toBeNull();
  });

  it("accepts lists, ranges and steps", () => {
    expect(validateCronExpression("0,30 9-17 * * 1-5")).toBeNull();
    expect(validateCronExpression("*/15 * * * *")).toBeNull();
  });

  it("rejects an empty expression", () => {
    expect(validateCronExpression("")).toMatch(/required/i);
  });

  it("rejects the wrong field count", () => {
    expect(validateCronExpression("0 * * *")).toMatch(/5 fields/i);
    expect(validateCronExpression("0 * * * * *")).toMatch(/5 fields/i);
  });

  it("rejects an out-of-range field", () => {
    expect(validateCronExpression("99 * * * *")).toMatch(/field 1/i);
    expect(validateCronExpression("0 25 * * *")).toMatch(/field 2/i);
  });

  it("rejects a malformed field", () => {
    expect(validateCronExpression("abc * * * *")).toMatch(/field 1/i);
  });
});

describe("computeCronNextRun", () => {
  it("finds the next top-of-hour for an hourly preset", () => {
    const from = new Date(2026, 0, 1, 9, 30, 0);
    const next = computeCronNextRun("0 * * * *", from);
    expect(next).not.toBeNull();
    expect(next?.getHours()).toBe(10);
    expect(next?.getMinutes()).toBe(0);
    expect(next?.getDate()).toBe(1);
  });

  it("rolls over to the next day for a daily-midnight preset run late in the day", () => {
    const from = new Date(2026, 0, 1, 23, 0, 0);
    const next = computeCronNextRun("0 0 * * *", from);
    expect(next?.getDate()).toBe(2);
    expect(next?.getHours()).toBe(0);
    expect(next?.getMinutes()).toBe(0);
  });

  it("finds the next matching weekday for a weekly preset", () => {
    // 2026-01-01 is a Thursday (day 4); "Sunday" preset is day 0.
    const from = new Date(2026, 0, 1, 12, 0, 0);
    const next = computeCronNextRun("0 0 * * 0", from);
    expect(next?.getDay()).toBe(0);
    expect(next).not.toBeNull();
    expect(next!.getTime()).toBeGreaterThan(from.getTime());
  });

  it("applies OR semantics when both day-of-month and day-of-week are restricted", () => {
    // The 15th OR a Monday — whichever comes first after `from`.
    const from = new Date(2026, 0, 1, 0, 0, 0); // Thursday Jan 1 2026
    const next = computeCronNextRun("0 0 15 * 1", from);
    expect(next).not.toBeNull();
    expect(next!.getDate() === 15 || next!.getDay() === 1).toBe(true);
  });

  it("returns null for an invalid expression", () => {
    expect(computeCronNextRun("not a cron")).toBeNull();
  });
});

describe("computeIntervalNextRun", () => {
  it("adds n * unit to `from` for each unit", () => {
    const from = new Date(2026, 0, 1, 0, 0, 0);
    expect(computeIntervalNextRun(30, "m", from)?.getTime()).toBe(from.getTime() + 30 * 60_000);
    expect(computeIntervalNextRun(2, "h", from)?.getTime()).toBe(from.getTime() + 2 * 3_600_000);
    expect(computeIntervalNextRun(1, "d", from)?.getTime()).toBe(from.getTime() + 86_400_000);
    expect(computeIntervalNextRun(45, "s", from)?.getTime()).toBe(from.getTime() + 45_000);
  });

  it("returns null for a non-positive or unrecognized input", () => {
    expect(computeIntervalNextRun(0, "m")).toBeNull();
    expect(computeIntervalNextRun(-1, "m")).toBeNull();
    expect(computeIntervalNextRun(5, "weeks")).toBeNull();
  });
});

describe("isValidTimezone", () => {
  it("accepts well-known IANA zones", () => {
    expect(isValidTimezone("America/Los_Angeles")).toBe(true);
    expect(isValidTimezone("UTC")).toBe(true);
  });

  it("rejects garbage input", () => {
    expect(isValidTimezone("Not/A_Zone")).toBe(false);
    expect(isValidTimezone("")).toBe(false);
  });
});
