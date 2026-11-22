// HEL-1697 -- the per-pattern constants of the predicted-work model (design D1 addenda 3 and 4): A (alternative paths),
// W (per-start work, at least 1), m (quadratic multiplier) and f (class-width factor, 1 for up to 8 ranges).

import { compileJavaRegex } from "./javaRegex";

describe("regexWorkModel", () => {
  it.each([
    ["(a*)b", 1, 2, 1],
    ["(a+)", 1, 1, 0],
    ["(a{1000})b", 1, 1001, 0],
    ["(a{1000,})", 1, 1000, 0],
    ["(.{16})x|(.{16})y|(.{16})z", 3, 17, 0],
  ])("%s has A=%i W=%i m=%i", (pattern, A, W, m) => {
    const compiled = compileJavaRegex(pattern);
    expect(compiled.ok && { A: compiled.work.A, W: compiled.work.W, m: compiled.work.m }).toEqual({
      A,
      W,
      m,
    });
  });

  it("derives the factor from the widest class and consumes the union of the atoms", () => {
    const compiled = compileJavaRegex("(a*)b");
    expect(compiled.ok && compiled.work.f).toBe(1);
    expect(compiled.ok && compiled.work.chars).toEqual([[0x61, 0x62]]);
  });

  // HEL-1807 -- `anchored` is true when every top-level alternative of the flattened tree starts with `^`.
  it.each([
    ["^(.*)$", true],
    ["(^a*)b", true],
    ["^a*b|^c", true],
    ["()^a", true],
    ["(^(a*)|^(c))b", true],
    ["^a*b|c", false],
    ["^(a*)b|(c)", false],
    ["(a)^b", false],
    ["(.*)^(x)", false],
    ["(a*)b", false],
    ["(a*)$", false],
  ])("%s has anchored=%s", (pattern, anchored) => {
    const compiled = compileJavaRegex(pattern);
    expect(compiled.ok && compiled.work.anchored).toBe(anchored);
  });
});
