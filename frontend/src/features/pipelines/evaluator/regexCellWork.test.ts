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

// HEL-1807 -- start-anchored patterns: one attempt per cell, the smaller of the anchored and the per-position charge.
describe("cellWork of a start-anchored pattern", () => {
  it("charges f x (A x (1 + W) + R0 x (A + m)) for the first U-run R0", () => {
    // ^(a*)b: A = 1, W = 2, m = 1. "aaab" is one run of 4: 3 + 4 x 2 = 11 (28 per position).
    expect(cellWork("aaab", workOf("^(a*)b"))).toBe(11);
    // "aa-aa": R0 = 2 (the second run is never tried): 3 + 2 x 2 = 7 (21 per position).
    expect(cellWork("aa-aa", workOf("^(a*)b"))).toBe(7);
  });

  it("charges the constant for a cell whose first character is outside U", () => {
    expect(cellWork("zzzz", workOf("^(a*)b"))).toBe(3);
    expect(cellWork("zaaa", workOf("^(a*)b"))).toBe(3);
  });

  it("never exceeds the per-position charge of the same pattern", () => {
    // ^(a{1000})b over `aaaa`: anchored 1,002 + 4, per position 4 + 4 x 4 = 20.
    expect(cellWork("aaaa", workOf("^(a{1000})b"))).toBe(20);
    expect(cellWork("", workOf("^(a{1000})b"))).toBe(0);
  });

  it("charges a partly anchored pattern per position, as without the anchor", () => {
    expect(cellWork("aaab", workOf("^(a*)b|c"))).toBe(cellWork("aaab", workOf("(a*)b|c")));
  });

  it("counts an unpaired surrogate of the first run as two units", () => {
    // ^(.*)x: A = 1, W = 2, m = 1. Three unpaired surrogates are one run of 6 units: 3 + 6 x 2 = 15 (9 at one unit each).
    expect(cellWork("\ud800\ud800\ud800", workOf("^(.*)x"))).toBe(15);
  });
});

describe("cellWorkBound of a start-anchored pattern", () => {
  const cells = [
    "",
    "aaab",
    "zzzz",
    "aa-aa b",
    "\ud800\ud800a",
    "a\ude00",
    "\ud83d\ude00a\ud83d\ude00",
    "c" + "a".repeat(300),
    "ab".repeat(300),
    "1234.5-67 ABC-77 x".repeat(20),
  ];
  const patterns = [
    "^(a*)b",
    "^(.*)$",
    "(^a*)b",
    "^(\\d+\\.\\d+)",
    "^(.{12})x",
    "^(a+)",
    "^(a{1000})b",
    "^a*b|^c",
  ];
  it.each(patterns)("is an upper bound of cellWork for %s on every sample cell", (pattern) => {
    const work = workOf(pattern);
    for (const cell of cells)
      expect(cellWorkBound(cell, work)).toBeGreaterThanOrEqual(cellWork(cell, work));
  });

  it("uses the surrogate-free length 2 x text.length, never testing the cell", () => {
    // ^(a+): A = 1, W = 1, m = 0: L = 4 for two characters, min(4 + 4 x 1, 2 + 4) = 6, lone surrogate or not.
    const work = workOf("^(a+)");
    expect(cellWorkBound("aa", work)).toBe(6);
    expect(cellWorkBound("a\ud800", work)).toBe(6);
    expect(cellWorkBound("\ud83d\ude00", work)).toBe(6);
  });
});
