// HEL-1581 — the Decision 1a regex allowlist: what it translates and what it refuses. Match behaviour
// against Java is held by the corpus (stringops vectors); these pin the allowlist's boundary.

import { compileJavaRegex } from "./javaRegex";

const accepted = (p: string): boolean => compileJavaRegex(p).ok;

describe("allowlisted patterns", () => {
  it.each([
    "(\\d+)",
    "(a|b)c",
    "^(\\w+)",
    "(abc)$",
    "([a-c]+)",
    "([^0-9]+)",
    "([-a]+)",
    "([a-]+)",
    "(a\\-b)",
    "(a{2,3})",
    "(a{0,2147483647})",
    "(a+?)",
    "a()b",
    "(\\s)",
    "(.)",
  ])("accepts %s", (p) => {
    expect(accepted(p)).toBe(true);
  });

  it("counts capturing groups", () => {
    expect(compileJavaRegex("(a)(b)")).toMatchObject({ ok: true, groupCount: 2 });
    expect(compileJavaRegex("abc")).toMatchObject({ ok: true, groupCount: 0 });
  });

  it("translates \\s to the ASCII set and . to a class without line terminators", () => {
    const s = compileJavaRegex("(\\s)");
    expect(s.ok && s.regex.test(" ")).toBe(false);
    expect(s.ok && s.regex.test("\t")).toBe(true);
    const dot = compileJavaRegex("(.)");
    expect(dot.ok && dot.regex.test("\u0085")).toBe(false);
    expect(dot.ok && dot.regex.exec("😀")?.[1]).toBe("😀");
  });
});

describe("declined patterns", () => {
  it.each([
    ["a quantified group", "(a?)*"],
    ["a quantified group with +", "(ab)+"],
    ["a quantified anchor", "(^*a)"],
    ["a word boundary", "(\\w+)\\b"],
    ["a class escape as a range end", "([\\d-z])"],
    ["a leading ] in a class", "([]a])"],
    ["\\S in a class", "([\\S])"],
    ["a bound above Integer.MAX_VALUE", "(a{0,99999999999})"],
    ["a leading-zero bound above Integer.MAX_VALUE", "a{0000000000002147483648}"],
    ["a dangling brace", "a{"],
    ["an empty class", "([])"],
    ["an inline flag", "(?i)(a)"],
    ["a back-reference", "(a)\\1"],
    ["a possessive quantifier", "(a*+)"],
    ["a property escape", "(\\p{L})"],
    ["an unbalanced parenthesis", "(a"],
    ["a reversed range", "([z-a])"],
    ["a dangling quantifier", "(*a)"],
    ["a class intersection", "([a-z&&[^b]])"],
    ["a quantifier bound out of order", "a{3,2}"],
    ["a stray close brace", "a}"],
  ])("declines %s", (_name, p) => {
    expect(accepted(p)).toBe(false);
  });
});
