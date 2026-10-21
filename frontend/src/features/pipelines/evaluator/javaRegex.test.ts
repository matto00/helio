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

// HEL-1683 — backtracking-prone patterns are declined so they run on the server under its 2 s regex budget.
describe("backtracking-prone patterns (HEL-1683)", () => {
  it.each([
    ["stacked unbounded quantifiers", "^(a*a*a*a*a*a*a*a*a*a*)$"],
    ["stacked wide quantifiers on a class", "(\\w*\\w*\\w*\\w*\\w*\\w*\\w*\\w*\\w*\\w*)!x"],
    ["stacked dots", "^(.*.*.*.*.*.*.*.*x)"],
    ["25 stacked optional atoms", `^${"a?".repeat(25)}$`],
    ["30 stacked two-branch groups", `^${"(a|a)".repeat(30)}$`],
    ["a wide quantifier multiplied by narrow choices", "a*a?a?a?a?a?a?b"],
    ["narrow choices multiplying a trailing wide quantifier", "a?a?a?a?a?a?a*b"],
    ["a wide quantifier with a counted tail it can re-match", "a*a{20}b"],
    ["a dot quantifier with a counted dot tail", ".*.{60}z"],
    ["narrow choices before a long counted tail", "a?a?a?a?a?a?a{50}b"],
    ["an unfenced wide quantifier after two optionals before $", "\\d?\\d?(\\d+)$"],
    ["optionals before a wide quantifier with a $ tail", ".?.?.*$x"],
    ["optionals before a long counted tail", ".?.?.{100}.*z"],
    ["many $ anchors in the tail", `.*${"$".repeat(50)}x`],
    ["a wide quantifier next to a nullable separator", "(\\d+)\\s*items"],
    ["two wide quantifiers with alternation", "(a+|b)c+d"],
  ])("declines %s", (_name, p) => {
    expect(accepted(p)).toBe(false);
  });

  it.each([
    ["a fenced pair", "([a-z]+)-([a-z]+)"],
    ["a fenced decimal", "(\\d+\\.\\d+)"],
    ["a fenced wide quantifier before a literal", "(\\d+) items"],
    ["an IPv4 shape", "(\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}\\.\\d{1,3})"],
    ["a lazy fenced wide quantifier", "<(.+?)>"],
    ["an alternation with an optional tail", "(cat|dog)s?"],
  ])("accepts %s", (_name, p) => {
    expect(accepted(p)).toBe(true);
  });
});

// HEL-1683 -- one boundary pair per guard of the backtracking check, so a changed constant or a dropped guard turns one red.
describe("backtracking check boundaries (HEL-1683)", () => {
  it("treats a quantifier as wide above 16 extents: {0,16} (17) is wide, {0,15} (16) is narrow", () => {
    // wide: one unfenced wide quantifier, tail 2, no narrow choice
    expect(accepted("a{0,16}a{2}")).toBe(true);
    // narrow: sixteen paths x weight 17 exceeds the whole-pattern cost cap
    expect(accepted("a{0,15}a{2}")).toBe(false);
  });

  it("caps the whole-pattern cost at 64: 64 accepted, 65 declined", () => {
    expect(accepted("b{31}a?")).toBe(true); // P 2 x weight 32 = 64
    expect(accepted("b{9}a{0,4}")).toBe(false); // P 5 x weight 13 = 65
    expect(accepted("b{8}a{0,4}")).toBe(true); // P 5 x weight 12 = 60
  });

  it("does not bound the length of a pattern with no choice point", () => {
    expect(accepted("sha256:([0-9a-f]{64})")).toBe(true);
    expect(accepted(`(${"a".repeat(200)})`)).toBe(true);
  });

  it("caps the tail after an unfenced wide quantifier at 4: 4 accepted, 5 declined", () => {
    expect(accepted("a*a{4}")).toBe(true);
    expect(accepted("a*a{5}")).toBe(false);
    expect(accepted("(.*)\\.csv")).toBe(true); // tail 4
    expect(accepted("(.*)\\.json")).toBe(false); // tail 5
  });

  it("caps a run of dot atoms after an unfenced dot quantifier at 4", () => {
    expect(accepted(".*.....")).toBe(false); // five dots
    expect(accepted(".*....")).toBe(true); // four dots
    expect(accepted(".*.{4}")).toBe(true);
    expect(accepted(".*.{5}")).toBe(false);
  });

  it("weighs $ as 2 in the tail", () => {
    expect(accepted("\\d?(\\d+)$")).toBe(true); // P 2 x tail 2 = 4
    expect(accepted("\\d?\\d?(\\d+)$")).toBe(false); // P 4 x tail 2 = 8
    expect(accepted("a*$$")).toBe(true); // tail 4
    expect(accepted("a*$$$")).toBe(false); // tail 6 (would be 3 if $ weighed 1)
  });

  it("fences a narrow choice with multiplicity 1", () => {
    // Each ? is followed by a disjoint mandatory atom: 25 of them have one extent each.
    expect(accepted(`^${"a?b".repeat(25)}$`)).toBe(true);
    expect(accepted(`^${"a?".repeat(25)}b$`)).toBe(false);
  });

  it("treats the last item of an alternation branch as unfenced", () => {
    expect(accepted("(a?|b)c")).toBe(true); // P 3 x weight 2: fine, but a? is unfenced (branch end)
    expect(accepted("(b{29}a?|z)c")).toBe(false); // a? ends its branch: unfenced, P 3 x weight 31 = 93
    expect(accepted("(b{29}a?c|z)c")).toBe(true); // fenced inside the branch by c: P 2 x weight 32 = 64
  });

  it("fences a wide quantifier only by a disjoint, mandatory next atom", () => {
    expect(accepted("(\\d+)-(\\d+)")).toBe(true); // disjoint fence
    expect(accepted("(\\d+)x?(\\d+)")).toBe(false); // optional separator is not a fence
    expect(accepted("([a-c]+)b(\\d+)")).toBe(false); // overlapping class: b is in [a-c]
    expect(accepted("([a-c]+)d(\\d+)")).toBe(true); // disjoint class
    expect(accepted("(\\w+)\\W(\\d+)")).toBe(true); // \W is disjoint from \w
    expect(accepted("(\\w+)\\d(\\w+)")).toBe(false); // \d lies inside \w
  });

  it("computes class sets: negation, \\s \\W \\D inside a bracket class", () => {
    expect(accepted("([^0-9]+)5(\\w+)")).toBe(true); // negated class disjoint from the digit
    expect(accepted("([^0-9]+)a(\\w+)")).toBe(false); // negated class contains a
    expect(accepted("([\\s]+)x(\\w+)")).toBe(true); // \s inside a class, disjoint from x
    expect(accepted("([\\s\\D]+)5(\\w+)")).toBe(true); // \D inside a class excludes 5
    expect(accepted("([\\s\\W]+)5(\\w+)")).toBe(true); // \W inside a class excludes the word character 5
    expect(accepted("([\\s\\W]+)-(\\w+)")).toBe(false); // but includes -
  });

  it("declines two wide quantifiers whenever the pattern has an alternation", () => {
    expect(accepted("(a+x|b)c+")).toBe(false); // a+ is fenced by x, so only the alternation rule declines it
    expect(accepted("(a+|b)-c+")).toBe(false);
    expect(accepted("a+-(b|c)")).toBe(true);
  });
});
