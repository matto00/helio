import { diffRows } from "./diffRows";

describe("diffRows", () => {
  it("flags new and changed rows and counts comparison rows no longer present", () => {
    const a1 = { a: 1 };
    const a3 = { a: 3 };
    const d = diffRows([a1, a3], [{ a: 1 }, { a: 2 }]);
    expect([...d.changed]).toEqual([a3]);
    expect(d.noLongerPresent).toBe(1);
  });

  it("treats duplicates as a multiset", () => {
    const first = { a: 1 };
    const second = { a: 1 };
    const d = diffRows([first, second], [{ a: 1 }]);
    expect(d.changed.size).toBe(1);
    expect(d.changed.has(second)).toBe(true);
    expect(d.noLongerPresent).toBe(0);
  });

  it("ignores key order, including in nested objects", () => {
    const d = diffRows([{ a: 1, b: { x: 1, y: 2 } }], [{ b: { y: 2, x: 1 }, a: 1 }]);
    expect(d.changed.size).toBe(0);
    expect(d.noLongerPresent).toBe(0);
  });

  it("is type-sensitive: 1 and '1' differ, null and missing differ", () => {
    expect(diffRows([{ a: 1 }], [{ a: "1" }]).changed.size).toBe(1);
    expect(diffRows([{ a: null }], [{}]).changed.size).toBe(1);
  });

  it("handles empty sides", () => {
    const r = { a: 1 };
    const onlySelected = diffRows([r], []);
    expect(onlySelected.changed.has(r)).toBe(true);
    expect(onlySelected.noLongerPresent).toBe(0);
    const onlyComparison = diffRows([], [{ a: 1 }, { a: 2 }]);
    expect(onlyComparison.changed.size).toBe(0);
    expect(onlyComparison.noLongerPresent).toBe(2);
    expect(diffRows([], [])).toEqual({ changed: new Set(), noLongerPresent: 0 });
  });
});
