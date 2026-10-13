import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  allMidnightUtc,
  formatChartInstant,
  isTimeXField,
  parseChartInstant,
  toChartFieldTypes,
} from "./chartTimeAxis";

interface FixtureCase {
  input: string;
  epochMillis: number | null;
}

const cases = JSON.parse(
  readFileSync(
    resolve(__dirname, "../../../shared-test-fixtures/chart-timestamp-parsing.json"),
    "utf8",
  ),
) as FixtureCase[];

describe("parseChartInstant against the shared backend-parity fixture", () => {
  it.each(cases.map((c) => [c.input, c.epochMillis] as const))(
    "reads %j as %p",
    (input, expected) => {
      expect(parseChartInstant(input)).toBe(expected);
    },
  );

  it("covers every shape the design lists", () => {
    expect(cases.length).toBeGreaterThanOrEqual(125);
  });

  it("reads a time-zone-less date-time as UTC whatever the process time zone is", () => {
    const original = process.env.TZ;
    try {
      for (const tz of ["America/Los_Angeles", "Asia/Kolkata", "UTC"]) {
        process.env.TZ = tz;
        expect(parseChartInstant("2026-10-01T12:00")).toBe(Date.UTC(2026, 9, 1, 12));
        expect(parseChartInstant("2026-10-01")).toBe(Date.UTC(2026, 9, 1));
      }
    } finally {
      if (original === undefined) delete process.env.TZ;
      else process.env.TZ = original;
    }
  });

  it("returns null for null and undefined", () => {
    expect(parseChartInstant(null)).toBeNull();
    expect(parseChartInstant(undefined)).toBeNull();
  });
});

describe("isTimeXField / toChartFieldTypes", () => {
  it("is true only for a field declared timestamp", () => {
    const types = toChartFieldTypes([
      { name: "day", type: "timestamp" },
      { name: "label", type: "string" },
    ]);
    expect(isTimeXField(types, "day")).toBe(true);
    expect(isTimeXField(types, "label")).toBe(false);
    expect(isTimeXField(types, "missing")).toBe(false);
    expect(isTimeXField(null, "day")).toBe(false);
    expect(isTimeXField(types, undefined)).toBe(false);
  });

  it("yields null for an empty or absent schema", () => {
    expect(toChartFieldTypes([])).toBeNull();
    expect(toChartFieldTypes(undefined)).toBeNull();
  });
});

describe("formatChartInstant / allMidnightUtc", () => {
  it("formats in UTC as a date or a date-time", () => {
    const t = Date.UTC(2026, 9, 1, 7, 5);
    expect(formatChartInstant(t, false)).toBe("2026-10-01");
    expect(formatChartInstant(t, true)).toBe("2026-10-01 07:05");
  });

  it("detects midnight-UTC-only instants, including pre-epoch ones", () => {
    expect(allMidnightUtc([Date.UTC(2026, 9, 1), Date.UTC(1969, 11, 31)])).toBe(true);
    expect(allMidnightUtc([Date.UTC(2026, 9, 1), Date.UTC(2026, 9, 1, 0, 1)])).toBe(false);
  });
});
