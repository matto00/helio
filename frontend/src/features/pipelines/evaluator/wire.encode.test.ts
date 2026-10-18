import { int, long } from "./value";
import { decodeValue, encodeRow, encodeValue } from "./wire";

describe("encodeValue (HEL-1630)", () => {
  it("writes every value class in the lossless request encoding", () => {
    expect(encodeValue(int(7))).toEqual({ $int: 7 });
    expect(encodeValue(long(5))).toEqual({ $long: "5" });
    expect(encodeValue(1.5)).toBe(1.5);
    expect(encodeValue(NaN)).toEqual({ $double: "NaN" });
    expect(encodeValue(Infinity)).toEqual({ $double: "Infinity" });
    expect(encodeValue(-Infinity)).toEqual({ $double: "-Infinity" });
    expect(encodeValue(-0)).toEqual({ $double: "-0.0" });
    expect(encodeValue(0)).toBe(0);
    expect(encodeValue(null)).toBeNull();
    expect(encodeValue("s")).toBe("s");
    expect(encodeValue(true)).toBe(true);
  });

  it("is the inverse of decodeValue", () => {
    const row = { a: int(1), b: long(2), c: 0.5, d: NaN, e: -0, f: null, g: "x", h: false };
    const back = Object.fromEntries(
      Object.entries(encodeRow(row)).map(([k, v]) => [k, decodeValue(v)]),
    );
    expect(Object.is(back.e, -0)).toBe(true);
    expect(back).toEqual({ ...row, e: back.e });
  });
});
