import {
  conditionalFormatsFixture as fixture,
  type FixtureInvalidCase,
  type FixtureValidCase,
} from "../../../../test/conditionalFormatsFixture";
import {
  TONE_WORD,
  matchRule,
  parseNumeric,
  readConditionalFormats,
  resolveCellRule,
  resolveRowRule,
  resolveRule,
  validateConditionalFormatRule,
  type ConditionalFormatRule,
} from "./conditionalFormatting";

const rule = (r: Partial<ConditionalFormatRule> & Pick<ConditionalFormatRule, "op" | "value">) =>
  ({ tone: "error", ...r }) as ConditionalFormatRule;

describe("parseNumeric", () => {
  it("is numeric only when trimmed non-empty and a finite number", () => {
    expect(parseNumeric(" 4.5 ")).toBe(4.5);
    expect(parseNumeric(7)).toBe(7);
    expect(parseNumeric("")).toBeNull();
    expect(parseNumeric("  ")).toBeNull();
    expect(parseNumeric("abc")).toBeNull();
    expect(parseNumeric("Infinity")).toBeNull();
    expect(parseNumeric(null)).toBeNull();
    expect(parseNumeric(undefined)).toBeNull();
  });
});

describe("matchRule", () => {
  it("compares numerically for gt/gte/lt/lte and never matches a non-numeric value", () => {
    expect(matchRule(rule({ op: "gt", value: 5 }), "6")).toBe(true);
    expect(matchRule(rule({ op: "gt", value: 5 }), "5")).toBe(false);
    expect(matchRule(rule({ op: "gte", value: 5 }), "5")).toBe(true);
    expect(matchRule(rule({ op: "lt", value: 5 }), "4.9")).toBe(true);
    expect(matchRule(rule({ op: "lte", value: 5 }), 5)).toBe(true);
    expect(matchRule(rule({ op: "gt", value: 5 }), "abc")).toBe(false);
    expect(matchRule(rule({ op: "lt", value: 5 }), "")).toBe(false);
  });

  it("treats between as inclusive at both ends", () => {
    const r = rule({ op: "between", value: 1, value2: 3 });
    expect([0.99, 1, 2, 3, 3.01].map((v) => matchRule(r, String(v)))).toEqual([
      false,
      true,
      true,
      true,
      false,
    ]);
  });

  it("compares eq/neq numerically when both sides are numeric (incl. a numeric string rule value)", () => {
    expect(matchRule(rule({ op: "eq", value: 3 }), "3.0")).toBe(true);
    expect(matchRule(rule({ op: "eq", value: "3" }), "3.00")).toBe(true);
    expect(matchRule(rule({ op: "neq", value: 3 }), "3.0")).toBe(false);
    expect(matchRule(rule({ op: "neq", value: 3 }), "4")).toBe(true);
  });

  it("compares eq/neq as trimmed case-insensitive text otherwise", () => {
    expect(matchRule(rule({ op: "eq", value: "failed" }), " Failed ")).toBe(true);
    expect(matchRule(rule({ op: "eq", value: " FAILED " }), "failed")).toBe(true);
    expect(matchRule(rule({ op: "neq", value: "ok" }), "OK")).toBe(false);
    expect(matchRule(rule({ op: "neq", value: "ok" }), "failed")).toBe(true);
    // a numeric rule value against a text raw value falls back to text comparison
    expect(matchRule(rule({ op: "eq", value: 3 }), "three")).toBe(false);
  });

  it("never matches an empty or missing raw value, including neq", () => {
    for (const raw of ["", "   ", null, undefined]) {
      expect(matchRule(rule({ op: "neq", value: "x" }), raw)).toBe(false);
      expect(matchRule(rule({ op: "eq", value: "" as unknown as string }), raw)).toBe(false);
      expect(matchRule(rule({ op: "lt", value: 100 }), raw)).toBe(false);
    }
  });

  it("compares the RAW value, not display formatting", () => {
    // 0.75 renders "75%" under format=percent; the rule still sees 0.75
    expect(matchRule(rule({ op: "lt", value: 0.8 }), "0.75")).toBe(true);
    expect(matchRule(rule({ op: "lt", value: 0.8 }), "75%")).toBe(false);
  });
});

describe("resolveRule (first match wins)", () => {
  const rules = [
    rule({ op: "lt", value: 50, tone: "error" }),
    rule({ op: "lt", value: 80, tone: "warning" }),
    rule({ op: "gte", value: 80, tone: "success" }),
  ];
  it("returns the first matching rule, not the best", () => {
    expect(resolveRule(rules, "42")?.tone).toBe("error");
    expect(resolveRule(rules, "60")?.tone).toBe("warning");
    expect(resolveRule(rules, "95")?.tone).toBe("success");
  });
  it("returns null with no rules or no match", () => {
    expect(resolveRule(undefined, "1")).toBeNull();
    expect(resolveRule([], "1")).toBeNull();
    expect(resolveRule([rule({ op: "gt", value: 10 })], "1")).toBeNull();
  });
});

describe("table resolvers", () => {
  const row = { status: "failed", pass_rate: "0.5", duration_s: "700" };
  const rules: ConditionalFormatRule[] = [
    rule({ op: "eq", value: "failed", tone: "error", column: "status", target: "row" }),
    rule({ op: "lt", value: 0.8, tone: "error", column: "pass_rate" }),
    rule({ op: "gt", value: 600, tone: "warning", column: "duration_s", target: "cell" }),
    rule({ op: "gt", value: 0, tone: "success", column: "missing_col" }),
  ];
  it("resolves cell rules per column (target defaults to cell), ignoring row rules", () => {
    expect(resolveCellRule(rules, row, "pass_rate")?.tone).toBe("error");
    expect(resolveCellRule(rules, row, "duration_s")?.tone).toBe("warning");
    expect(resolveCellRule(rules, row, "status")).toBeNull();
    expect(resolveCellRule(rules, row, "missing_col")).toBeNull();
  });
  it("resolves the row rule from the rule's own column, independently of cell rules", () => {
    expect(resolveRowRule(rules, row)?.tone).toBe("error");
    expect(resolveRowRule(rules, { ...row, status: "passed" })).toBeNull();
  });
  it("takes the first matching row rule and the first matching cell rule independently", () => {
    const two: ConditionalFormatRule[] = [
      rule({ op: "gt", value: 1, tone: "warning", column: "a" }),
      rule({ op: "gt", value: 1, tone: "error", column: "a", target: "row" }),
      rule({ op: "gt", value: 1, tone: "success", column: "a" }),
      rule({ op: "gt", value: 1, tone: "success", column: "a", target: "row" }),
    ];
    expect(resolveCellRule(two, { a: "5" }, "a")?.tone).toBe("warning");
    expect(resolveRowRule(two, { a: "5" })?.tone).toBe("error");
  });
});

describe("TONE_WORD", () => {
  it("names the three tones", () => {
    expect(TONE_WORD).toEqual({ success: "Good", warning: "Warning", error: "Critical" });
  });
});

describe("shared fixture (seam with the backend validator)", () => {
  const valid = fixture.valid as FixtureValidCase[];
  const invalid = fixture.invalid as FixtureInvalidCase[];

  it.each(valid.filter((c) => Array.isArray(c.config.conditionalFormats)))(
    "reads valid case $name losslessly (nulls dropped, order kept)",
    ({ kind, config }) => {
      const read = readConditionalFormats(config.conditionalFormats, kind) ?? [];
      const wire = (config.conditionalFormats as Record<string, unknown>[]).map((r) =>
        Object.fromEntries(Object.entries(r).filter(([, v]) => v !== null)),
      );
      expect(read).toEqual(wire);
    },
  );

  it.each(valid)("flags no rule of valid case $name", ({ kind, config }) => {
    const rules = Array.isArray(config.conditionalFormats) ? config.conditionalFormats : [];
    for (const r of rules) expect(validateConditionalFormatRule(r, kind)).toBeNull();
  });

  it.each(invalid.filter((c) => c.ruleIndex !== null))(
    "flags the offending rule of invalid case $name and the reader drops it",
    ({ kind, ruleIndex, config }) => {
      const rules = config.conditionalFormats as unknown[];
      expect(validateConditionalFormatRule(rules[ruleIndex as number], kind)).not.toBeNull();
      const read = readConditionalFormats(config.conditionalFormats, kind) ?? [];
      expect(read.length).toBe(rules.length - 1);
    },
  );

  it("reads a non-array value and an over-long list tolerantly (never throws)", () => {
    expect(readConditionalFormats({ op: "lt" }, "metric")).toBeUndefined();
    expect(readConditionalFormats(null, "metric")).toBeUndefined();
    expect(readConditionalFormats("x", "table")).toBeUndefined();
    const many = invalid.find((c) => c.name === "too-many-rules");
    expect(
      (readConditionalFormats(many?.config.conditionalFormats, "metric") ?? []).length,
    ).toBeLessThanOrEqual(20);
  });
});
