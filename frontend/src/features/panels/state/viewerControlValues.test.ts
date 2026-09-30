// HEL-1190 design.md D2/D3 (task 6.2) — pure encode/decode/compose logic for a viewer's control
// selection.

import {
  buildViewerControlFilterOps,
  encodeDateRangeValue,
  encodeDefaultValue,
  encodeNumericRangeValue,
  isValidRawValue,
  parseDateRangeRaw,
  parseNumericRangeRaw,
  resolveDateRangePreset,
} from "./viewerControlValues";
import type { OutputControlSpec } from "../types/panel";

describe("date-range raw encoding (design.md D2)", () => {
  it("round-trips a custom from/to pair", () => {
    const raw = encodeDateRangeValue({
      from: "2026-01-01T00:00:00.000Z",
      to: "2026-01-08T00:00:00.000Z",
    });
    expect(raw).toBe("2026-01-01T00:00:00.000Z_2026-01-08T00:00:00.000Z");
    expect(parseDateRangeRaw(raw)).toEqual({
      from: "2026-01-01T00:00:00.000Z",
      to: "2026-01-08T00:00:00.000Z",
    });
  });

  it("round-trips an open-ended range (empty side)", () => {
    const raw = encodeDateRangeValue({ from: null, to: "2026-01-08T00:00:00.000Z" });
    expect(raw).toBe("_2026-01-08T00:00:00.000Z");
    expect(parseDateRangeRaw(raw)).toEqual({ from: null, to: "2026-01-08T00:00:00.000Z" });
  });

  it("round-trips a preset token", () => {
    const raw = encodeDateRangeValue({ preset: "last7d" });
    expect(raw).toBe("last7d");
    expect(parseDateRangeRaw(raw)).toEqual({ preset: "last7d" });
  });

  it("treats a malformed raw value as absent (undefined), never throwing", () => {
    expect(parseDateRangeRaw("not-a-date_also-not-a-date")).toBeUndefined();
    expect(parseDateRangeRaw("no-underscore-at-all")).toBeUndefined();
  });

  it("resolves last7d/last30d/thisQuarter against a fixed 'now'", () => {
    const now = new Date("2026-04-15T12:00:00.000Z");
    expect(resolveDateRangePreset("last7d", now)).toEqual({
      from: "2026-04-08T12:00:00.000Z",
      to: "2026-04-15T12:00:00.000Z",
    });
    expect(resolveDateRangePreset("last30d", now)).toEqual({
      from: "2026-03-16T12:00:00.000Z",
      to: "2026-04-15T12:00:00.000Z",
    });
    expect(resolveDateRangePreset("thisQuarter", now)).toEqual({
      from: "2026-04-01T00:00:00.000Z",
      to: "2026-04-15T12:00:00.000Z",
    });
  });
});

describe("numeric-range raw encoding", () => {
  it("round-trips a min/max pair", () => {
    const raw = encodeNumericRangeValue({ min: 10, max: 20 });
    expect(raw).toBe("10_20");
    expect(parseNumericRangeRaw(raw)).toEqual({ min: 10, max: 20 });
  });

  it("round-trips an open-ended side", () => {
    expect(parseNumericRangeRaw(encodeNumericRangeValue({ min: null, max: 5 }))).toEqual({
      min: null,
      max: 5,
    });
  });

  it("treats a malformed raw value as absent", () => {
    expect(parseNumericRangeRaw("abc_20")).toBeUndefined();
    expect(parseNumericRangeRaw("no-underscore")).toBeUndefined();
  });
});

describe("isValidRawValue (design.md D2)", () => {
  it("text/dropdown accept any string", () => {
    expect(isValidRawValue("text", "anything")).toBe(true);
    expect(isValidRawValue("dropdown", "")).toBe(true);
  });

  it("numeric-range/date-range require a parseable raw value", () => {
    expect(isValidRawValue("numeric-range", "10_20")).toBe(true);
    expect(isValidRawValue("numeric-range", "garbage")).toBe(false);
    expect(isValidRawValue("date-range", "last7d")).toBe(true);
    expect(isValidRawValue("date-range", "garbage")).toBe(false);
  });
});

describe("encodeDefaultValue (design.md D2)", () => {
  it("encodes each kind's defaultValue into the same raw shape a URL entry would carry", () => {
    expect(
      encodeDefaultValue({ id: "c1", kind: "text", column: "x", label: "X", defaultValue: "hi" }),
    ).toBe("hi");
    expect(
      encodeDefaultValue({
        id: "c2",
        kind: "numeric-range",
        column: "x",
        label: "X",
        defaultValue: { min: 1, max: null },
      }),
    ).toBe("1_");
  });

  it("returns undefined (no filter) when there is no default", () => {
    expect(encodeDefaultValue({ id: "c3", kind: "text", column: "x", label: "X" })).toBeUndefined();
  });
});

describe("buildViewerControlFilterOps (design.md D3)", () => {
  const now = new Date("2026-04-15T12:00:00.000Z");

  it("text/dropdown controls become eq ops on their bound column", () => {
    const controls: OutputControlSpec[] = [
      { id: "c1", kind: "dropdown", column: "region", label: "Region" },
    ];
    const ops = buildViewerControlFilterOps(controls, { c1: "east" }, now);
    expect(ops).toEqual([{ column: "region", op: "eq", value: "east" }]);
  });

  it("numeric-range controls become gte/lte ops", () => {
    const controls: OutputControlSpec[] = [
      { id: "c1", kind: "numeric-range", column: "amount", label: "Amount" },
    ];
    const ops = buildViewerControlFilterOps(
      controls,
      { c1: encodeNumericRangeValue({ min: 10, max: 20 }) },
      now,
    );
    expect(ops).toEqual([
      { column: "amount", op: "gte", value: "10" },
      { column: "amount", op: "lte", value: "20" },
    ]);
  });

  it("date-range controls resolve a preset against 'now' into gte/lte ops", () => {
    const controls: OutputControlSpec[] = [
      { id: "c1", kind: "date-range", column: "created_at", label: "Created" },
    ];
    const ops = buildViewerControlFilterOps(controls, { c1: "last7d" }, now);
    expect(ops).toEqual([
      { column: "created_at", op: "gte", value: "2026-04-08T12:00:00.000Z" },
      { column: "created_at", op: "lte", value: "2026-04-15T12:00:00.000Z" },
    ]);
  });

  it("a control with no effective value (undefined) contributes nothing", () => {
    const controls: OutputControlSpec[] = [
      { id: "c1", kind: "dropdown", column: "region", label: "Region" },
    ];
    expect(buildViewerControlFilterOps(controls, {}, now)).toEqual([]);
  });

  it("composes MULTIPLE controls' ops together, independent of each other", () => {
    const controls: OutputControlSpec[] = [
      { id: "c1", kind: "dropdown", column: "region", label: "Region" },
      { id: "c2", kind: "numeric-range", column: "amount", label: "Amount" },
    ];
    const ops = buildViewerControlFilterOps(
      controls,
      { c1: "east", c2: encodeNumericRangeValue({ min: 5, max: null }) },
      now,
    );
    expect(ops).toEqual([
      { column: "region", op: "eq", value: "east" },
      { column: "amount", op: "gte", value: "5" },
    ]);
  });
});
