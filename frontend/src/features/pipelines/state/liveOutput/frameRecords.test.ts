import { int, long, type Frame } from "../../evaluator";
import { frameToRecords, orderLiveColumns, orderRecords } from "./frameRecords";

const SCHEMA = [
  { name: "date", type: "string" },
  { name: "amount", type: "integer" },
];

describe("orderLiveColumns", () => {
  it("is the schema's order for columns the frame has, then extras in frame order", () => {
    expect(orderLiveColumns(["amount", "extra", "date", "other"], SCHEMA)).toEqual([
      "date",
      "amount",
      "extra",
      "other",
    ]);
  });

  it("drops a schema field the frame lacks and keeps frame order without a schema", () => {
    expect(orderLiveColumns(["b", "a"], [{ name: "z", type: "string" }])).toEqual(["b", "a"]);
    expect(orderLiveColumns(["b", "a"], null)).toEqual(["b", "a"]);
  });
});

describe("frameToRecords", () => {
  it("unwraps Integral cells and orders keys by the schema", () => {
    const frame: Frame = [
      { amount: int(5), date: "2026-01-01", ratio: 0.5, big: long(7), flag: true, none: null },
    ];
    const [record] = frameToRecords(frame, SCHEMA);
    expect(Object.keys(record)).toEqual(["date", "amount", "ratio", "big", "flag", "none"]);
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
