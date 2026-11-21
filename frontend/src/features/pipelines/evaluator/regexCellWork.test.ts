// HEL-1697 -- the per-cell predicted work, exact values (design D1 addenda 3 and 4):
// cost = f x (A x len + sum over maximal U-runs (R x A x min(R, W) + m x R^2)).

import { compileJavaRegex } from "./javaRegex";
import { cellWork, cellWorkBound } from "./regexInputCost";

const workOf = (pattern: string) => {
  const compiled = compileJavaRegex(pattern);
  if (!compiled.ok) throw new Error(`${pattern} declined`);
  return compiled.work;
};

describe("cellWork", () => {
  it("charges one run as its own cell, plus the scan", () => {
    // (a*)b: A = 1, W = 2, m = 1; "aaab" is one U-run of 4: 4 + 4 x 1 x min(4, 2) + 1 x 16.
    expect(cellWork("aaab", workOf("(a*)b"))).toBe(4 + 8 + 16);
  });

  it("splits runs at characters no atom consumes", () => {
    // "aa-aa": two runs of 2: 5 + 2 x (2 x 1 x 2 + 4).
    expect(cellWork("aa-aa", workOf("(a*)b"))).toBe(5 + 2 * (4 + 4));
  });

  it("charges the scan only on a cell outside the pattern's characters", () => {
    expect(cellWork("zzzz", workOf("(a*)b"))).toBe(4);
  });

  it("multiplies the alternatives outside the per-run clip", () => {
    // A = 3, W = 17: one run of 1 costs 3 x 1 x min(1, 17) and the scan 3 per character.
    expect(cellWork("b", workOf("(.{16})x|(.{16})y|(.{16})z"))).toBe(3 + 3);
  });

  it("applies the class-width factor to the whole cell", () => {
    const small = cellWork("a", workOf("(a)b"));
    const classes = Array.from({ length: 63 }, (_, k) => String.fromCharCode(0x100 + 2 * k)).join(
      "",
    );
    const wide = cellWork("ж", workOf(`([^${classes}]{16})x`));
    // r = 64: factor 2 over (1 + 1 x 1 x 1).
    expect(small).toBe(1 + 1);
    expect(wide).toBe(2 * (1 + 1));
  });

  it("counts an unpaired surrogate as two units and a pair as two", () => {
    const work = workOf("(.{12})x");
    // len 2, one run of 2: A=1,W=13: 2 + 2 x 1 x min(2, 13) = 6, for both.
    expect(cellWork("\ud800", work)).toBe(6);
    expect(cellWork("😀", work)).toBe(6);
  });
});

describe("cellWorkBound", () => {
  const cells = [
    "",
    "aaab",
    "aa-aa b",
    "zzzz",
    "b\nb\nb\n",
    "\ud800\ud800a",
    "a\ude00",
    "\ud83d\ude00a\ud83d\ude00",
    "ab".repeat(300),
    "1234.5-67 ABC-77 x".repeat(20),
  ];
  const patterns = [
    "(a*)b",
    "(\\d+\\.\\d+)",
    "([A-Z]+)-(\\d+)",
    "(.{12})x",
    "(.{16})x|(.{16})y|(.{16})z",
    "(a+)",
  ];
  it.each(patterns)("is an upper bound of cellWork for %s on every sample cell", (pattern) => {
    const work = workOf(pattern);
    for (const cell of cells)
      expect(cellWorkBound(cell, work)).toBeGreaterThanOrEqual(cellWork(cell, work));
  });

  it("doubles the length only for a cell with an unpaired surrogate", () => {
    const work = workOf("(a+)");
    expect(cellWorkBound("aa", work)).toBe(2 + 2 * 1);
    expect(cellWorkBound("\ud83d\ude00", work)).toBe(2 + 2 * 1);
    expect(cellWorkBound("a\ud800", work)).toBe(4 + 4 * 1);
  });
});
