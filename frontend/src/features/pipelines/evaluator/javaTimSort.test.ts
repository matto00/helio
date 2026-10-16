// HEL-1581 — javaTimSort agrees with a stable native sort for a consistent comparator at every size around
// TimSort's thresholds; its behaviour on a non-transitive comparator is held to Java by the window corpus vectors.

import { javaSort } from "./javaTimSort";

describe("javaSort", () => {
  it.each([0, 1, 2, 5, 31, 32, 33, 63, 64, 65, 100, 257, 1000])(
    "sorts %i random keys like a stable sort",
    (n) => {
      let seed = n + 1;
      const next = (): number => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) % 25;
      const items = Array.from({ length: n }, (_, i) => ({ k: next(), i }));
      const expected = [...items].sort((a, b) => a.k - b.k);
      expect(javaSort(items, (a, b) => a.k - b.k)).toEqual(expected);
    },
  );

  it("does not modify its input", () => {
    const input = [3, 1, 2];
    javaSort(input, (a, b) => a - b);
    expect(input).toEqual([3, 1, 2]);
  });

  it("reports an inconsistent comparator as Java does", () => {
    let seed = 7;
    const items = Array.from(
      { length: 300 },
      () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) % 1000,
    );
    // a deliberately broken order: random answers
    expect(() =>
      javaSort(items, () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) % 3) - 1),
    ).toThrow(/violates its general contract/);
  });
});
