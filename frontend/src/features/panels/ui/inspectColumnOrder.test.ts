import { inspectColumnKeys, inspectColumns } from "./inspectColumnOrder";

const SERVER_KEYS = ["amount_usd", "category", "date", "merchant"];
const SCHEMA = ["date", "category", "merchant", "amount_usd"];

describe("inspectColumnKeys (HEL-1394)", () => {
  it("follows the declared schema order, not the alphabetical row key order", () => {
    expect(inspectColumnKeys(SERVER_KEYS, SCHEMA)).toEqual(SCHEMA);
  });

  it("lets columnOrder take precedence over the schema, then falls back to schema order", () => {
    expect(inspectColumnKeys(SERVER_KEYS, SCHEMA, ["merchant", "date"])).toEqual([
      "merchant",
      "date",
      "category",
      "amount_usd",
    ]);
  });

  it("skips stale columnOrder and schema keys absent from the rows", () => {
    expect(inspectColumnKeys(["b", "a"], ["gone", "a", "b"], ["ghost", "b"])).toEqual(["b", "a"]);
  });

  it("appends undeclared row keys after the ordered ones, natural-sorted", () => {
    expect(inspectColumnKeys(["col_10", "z", "col_2", "a"], ["z"])).toEqual([
      "z",
      "a",
      "col_2",
      "col_10",
    ]);
  });

  it("ignores duplicate and non-string columnOrder entries", () => {
    expect(inspectColumnKeys(["a", "b"], [], ["b", "b", 3, null, "a"])).toEqual(["b", "a"]);
  });

  it("never drops a row key", () => {
    expect(inspectColumnKeys(["x", "y", "z"], ["y"], ["z"]).sort()).toEqual(["x", "y", "z"]);
  });
});

describe("inspectColumns", () => {
  it("is undefined without a hint or rows (DataGrid keeps its own behavior)", () => {
    expect(inspectColumns([{ a: 1 }], undefined)).toBeUndefined();
    expect(inspectColumns([], { schema: ["a"] })).toBeUndefined();
  });

  it("unions keys across rows and orders them", () => {
    expect(inspectColumns([{ b: 1 }, { a: 2, b: 3 }], { schema: ["b", "a"] })).toEqual([
      { key: "b" },
      { key: "a" },
    ]);
  });
});
