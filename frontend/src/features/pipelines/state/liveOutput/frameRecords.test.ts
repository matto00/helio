import { int, long, type Frame } from "../../evaluator";
import { frameToRecords, orderLiveColumns, orderRecords } from "./frameRecords";

const SCHEMA = [
  { name: "date", type: "string" },
  { name: "amount", type: "integer" },
];

describe("orderLiveColumns", () => {
  it("is the schema's order for columns the frame has, then extras in code-point order", () => {
    expect(orderLiveColumns(["other", "amount", "extra", "date"], SCHEMA)).toEqual([
      "date",
      "amount",
      "extra",
      "other",
    ]);
  });

  it("drops a schema field the frame lacks and sorts everything by code point without a schema", () => {
    expect(orderLiveColumns(["b", "a"], [{ name: "z", type: "string" }])).toEqual(["a", "b"]);
    expect(orderLiveColumns(["b", "a"], null)).toEqual(["a", "b"]);
    expect(orderLiveColumns(["a", "B", "10", "2"], null)).toEqual(["10", "2", "B", "a"]);
  });

  it("keeps an integer-like schema name where the schema puts it (HEL-1705)", () => {
    const schema = ["zeta", "10", "alpha"].map((name) => ({ name, type: "string" }));
    expect(orderLiveColumns(["alpha", "10", "extra", "zeta"], schema)).toEqual([
      "zeta",
      "10",
      "alpha",
      "extra",
    ]);
  });
});

describe("frameToRecords", () => {
  it("unwraps Integral cells and orders keys by the schema", () => {
    const frame: Frame = [
      { amount: int(5), date: "2026-01-01", ratio: 0.5, big: long(7), flag: true, none: null },
    ];
    const [record] = frameToRecords(frame, SCHEMA);
    expect(Object.keys(record)).toEqual(["date", "amount", "big", "flag", "none", "ratio"]);
    expect(record).toMatchObject({ amount: 5, big: 7, ratio: 0.5, flag: true, none: null });
  });

  it("gives a row that lacks a column null for it, so every record has the same keys", () => {
    const records = frameToRecords([{ date: "a" }, { date: "b", amount: int(1) }], SCHEMA);
    expect(Object.keys(records[0])).toEqual(["date", "amount"]);
    expect(records[0].amount).toBeNull();
  });

  it("keeps a column named __proto__ as an own key", () => {
    const row = Object.defineProperty({}, "__proto__", {
      value: "x",
      enumerable: true,
      configurable: true,
      writable: true,
    });
    const [record] = frameToRecords([row as never], null);
    expect(Object.keys(record)).toEqual(["__proto__"]);
  });
});

describe("orderRecords", () => {
  it("reorders saved records into the same schema order", () => {
    const [record] = orderRecords([{ amount: 1, date: "d" }], SCHEMA);
    expect(Object.keys(record)).toEqual(["date", "amount"]);
  });
});
