// HEL-1581 — the value model's rendering and numeric parse primitives. The corpus pins their agreement
// with the JVM; these keep the acceptance sets readable.

import {
  doubleToInt,
  parseJavaBoolean,
  parseJavaDouble,
  parseJavaInt,
  parseJavaLong,
} from "./javaNumbers";
import { javaDoubleToString, toJsonValue, int, long } from "./value";

describe("javaDoubleToString", () => {
  it.each([
    [3, "3.0"],
    [0.001, "0.001"],
    [1e-4, "1.0E-4"],
    [1e7, "1.0E7"],
    [9999999, "9999999.0"],
    [123456789, "1.23456789E8"],
    [-0, "-0.0"],
    [NaN, "NaN"],
    [Infinity, "Infinity"],
    [-Infinity, "-Infinity"],
    [1.5e-7, "1.5E-7"],
    [5e-324, "4.9E-324"],
    [100, "100.0"],
    [0.1, "0.1"],
  ])("%s -> %s", (d, text) => {
    expect(javaDoubleToString(d)).toBe(text);
  });
});

describe("numeric parse primitives", () => {
  it.each([
    ["1d", 1],
    ["1f", 1],
    [" 1 ", 1],
    ["0x1p3", 8],
    ["+1", 1],
    [".5", 0.5],
    ["5.", 5],
    ["NaN", NaN],
    ["-Infinity", -Infinity],
    ["1e3", 1000],
  ])("parses %j as a Java double", (s, n) => {
    expect(parseJavaDouble(s)).toBe(n);
  });

  it.each(["0x10", "", " ", "1_000", "abc", "1e", "0x", "NaNf", " 1"])(
    "rejects %j as a Java double",
    (s) => {
      expect(parseJavaDouble(s)).toBeUndefined();
    },
  );

  it("parses Java ints and longs strictly", () => {
    expect(parseJavaInt("+5")).toBe(5);
    expect(parseJavaInt("-0")).toBe(0);
    expect(parseJavaInt("2147483648")).toBeUndefined();
    expect(parseJavaInt("1.0")).toBeUndefined();
    expect(parseJavaInt(" 1")).toBeUndefined();
    expect(parseJavaInt("٣")).toBe(3);
    expect(parseJavaLong("2147483648")).toBe(2147483648);
    expect(parseJavaLong("")).toBeUndefined();
  });

  it("converts doubles to ints the Scala way", () => {
    expect(doubleToInt(NaN)).toBe(0);
    expect(doubleToInt(Infinity)).toBe(2147483647);
    expect(doubleToInt(-3.9)).toBe(-3);
  });

  it("parses booleans with equalsIgnoreCase", () => {
    expect(parseJavaBoolean("TrUe")).toBe(true);
    expect(parseJavaBoolean("false")).toBe(false);
    expect(parseJavaBoolean("yes")).toBeUndefined();
  });
});

describe("JSON output (anyToJsValue)", () => {
  it("renders integrals and doubles as numbers, a non-finite double as null, and negative zero as zero", () => {
    expect(toJsonValue(int(3))).toBe(3);
    expect(toJsonValue(long(4))).toBe(4);
    expect(toJsonValue(2.5)).toBe(2.5);
    expect(toJsonValue(NaN)).toBeNull();
    expect(toJsonValue(Infinity)).toBeNull();
    expect(Object.is(toJsonValue(-0), 0)).toBe(true);
    expect(toJsonValue("s")).toBe("s");
    expect(toJsonValue(null)).toBeNull();
  });
});
