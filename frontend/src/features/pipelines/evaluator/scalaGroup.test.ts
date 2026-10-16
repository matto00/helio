// HEL-1581 — Scala hashing and HashMap iteration order. The corpus (rename / groupby / aggregate /
// pivot vectors with five or more keys) pins the order against the engine; these pin the hash functions.

import {
  KeyBuilder,
  javaStringHash,
  scalaGroupBy,
  scalaHash,
  scalaMapKeyOrder,
  seqHash,
} from "./scalaGroup";
import { int, long } from "./value";

describe("scalaHash (Statics.anyHash)", () => {
  it("hashes strings like Java and numbers across classes consistently", () => {
    expect(javaStringHash("hello")).toBe(99162322);
    expect(scalaHash("hello")).toBe(99162322);
    expect(scalaHash(null)).toBe(0);
    expect(scalaHash(true)).toBe(1231);
    expect(scalaHash(false)).toBe(1237);
    expect(scalaHash(1)).toBe(scalaHash(int(1)));
    expect(scalaHash(1)).toBe(scalaHash(long(1)));
    expect(scalaHash(0)).toBe(scalaHash(-0));
  });

  it("hashes a sequence by its element hashes, order sensitively", () => {
    expect(seqHash(["a", "b"])).not.toBe(seqHash(["b", "a"]));
    expect(seqHash([1])).toBe(seqHash([int(1)]));
  });
});

describe("Scala map key order", () => {
  it("sorts up to four keys by UTF-16 code unit and uses hash order from five", () => {
    expect(scalaMapKeyOrder(["z", "y", "x", "w"])).toEqual(["w", "x", "y", "z"]);
    expect(scalaMapKeyOrder(["9", "10"])).toEqual(["10", "9"]);
    expect(scalaMapKeyOrder(["a", "b", "c", "d", "e"])).not.toEqual(["a", "b", "c", "d", "e"]);
  });
});

describe("scalaGroupBy", () => {
  it("groups by Scala equality and keeps the first key spelling and input order within a group", () => {
    const rows = [
      { k: int(1), n: 1 },
      { k: 1, n: 2 },
      { k: "1", n: 3 },
      { k: null, n: 4 },
      { k: NaN, n: 5 },
      { k: NaN, n: 6 },
    ];
    const groups = scalaGroupBy(rows, (r) => [r.k]);
    expect(groups.map((g) => g.items.map((i) => i.n)).sort()).toEqual([[1, 2], [3], [4], [5], [6]]);
    expect(groups.find((g) => g.items.length === 2)!.keyValues[0]).toEqual(int(1));
  });

  it("builds equality keys that never match across strings and numbers", () => {
    const keys = new KeyBuilder();
    expect(keys.scalar(1)).toBe(keys.scalar(int(1)));
    expect(keys.scalar(1)).not.toBe(keys.scalar("1"));
    expect(keys.scalar(NaN)).not.toBe(keys.scalar(NaN));
  });
});
