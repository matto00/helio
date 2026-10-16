// HEL-1581 — clientEvaluable's decline reasons (design Decision 2) and agreement check 5.

import { clientEvaluable, evaluateStep, type RunContext } from "./evaluateStep";
import { SUPPORTED_FUNCTIONS } from "./expression/compile";
import { readCorpusFile } from "./testing/corpus";

const none: RunContext = { lane: () => undefined, source: () => undefined };
const compute = (expression: string) => ({
  id: "c",
  kind: "compute",
  config: { column: "o", expression },
});

describe("clientEvaluable reasons", () => {
  it.each([
    ["chunkbytokencount", "serverKind"],
    ["convertformat", "serverKind"],
    ["analyzewithai", "aiStep"],
    ["generatetext", "aiStep"],
    ["frobnicate", "unknownKind"],
  ])("%s declines as %s", (kind, reason) => {
    expect(clientEvaluable({ id: "s", kind, config: {} }, none)).toEqual({ ok: false, reason });
  });

  it("an AI step is notPreviewed and a server step needsServer; neither returns rows", () => {
    expect(evaluateStep({ id: "s", kind: "analyzewithai", config: {} }, [{ a: 1 }], none)).toEqual({
      status: "notPreviewed",
    });
    expect(evaluateStep({ id: "s", kind: "convertformat", config: {} }, [{ a: 1 }], none)).toEqual({
      status: "needsServer",
      reason: "serverKind",
    });
  });

  it("declines a legacy bare-identifier expression", () => {
    expect(clientEvaluable(compute("price * qty"), none)).toEqual({
      ok: false,
      reason: "legacyExpression",
    });
  });

  it("declines a regex outside the allowlist, and accepts one inside it", () => {
    const step = (pattern: string) => ({
      id: "s",
      kind: "stringops",
      config: { operation: "extractRegex", field: "a", outputColumn: "o", pattern },
    });
    expect(clientEvaluable(step("(\\w+)\\b"), none)).toEqual({ ok: false, reason: "unsafeRegex" });
    expect(clientEvaluable(step("(\\d+)"), none)).toEqual({ ok: true });
  });

  it("declines a configured source secondary that is missing or truncated, but not an empty one", () => {
    const join = (dataSourceId: string) => ({
      id: "j",
      kind: "join",
      config: { secondaryInput: { kind: "source", dataSourceId }, joinKey: "id" },
    });
    const withSource = (complete: boolean): RunContext => ({
      lane: () => undefined,
      source: () => ({ rows: [], complete }),
    });
    expect(clientEvaluable(join("ds"), none)).toEqual({ ok: false, reason: "secondaryNotCached" });
    expect(clientEvaluable(join("ds"), withSource(false))).toEqual({
      ok: false,
      reason: "secondaryNotCached",
    });
    expect(clientEvaluable(join("ds"), withSource(true))).toEqual({ ok: true });
    expect(clientEvaluable(join(""), none)).toEqual({ ok: true });
  });
});

describe("check 5: an unknown function declines instead of guessing", () => {
  it("declines a call to a function absent from the TypeScript table", () => {
    expect(clientEvaluable(compute("foo($a)"), none)).toEqual({
      ok: false,
      reason: "unknownFunction",
    });
    expect(evaluateStep(compute("foo($a)"), [{ a: 1 }], none)).toEqual({
      status: "needsServer",
      reason: "unknownFunction",
    });
  });

  it("accepts a call to every function in the shared seam file (so dropping one from the table turns this red)", () => {
    const seam = readCorpusFile<{ functions: string[] }>("../compute-expression-functions.json");
    const call: Record<string, string> = {
      abs: "abs(1)",
      add_days: 'add_days("2026-01-01", 1)',
      ceil: "ceil(1)",
      coalesce: "coalesce(1, 2)",
      concat: "concat(1)",
      date_trunc: 'date_trunc("day", "2026-01-01")',
      floor: "floor(1)",
      if: "if(true, 1, 2)",
      length: 'length("a")',
      lower: 'lower("A")',
      mod: "mod(5, 3)",
      round: "round(1)",
      seconds_between: 'seconds_between("2026-01-02", "2026-01-01")',
      substring: 'substring("abc", 0, 1)',
      upper: 'upper("a")',
    };
    expect(Object.keys(call).sort()).toEqual([...seam.functions].sort());
    for (const name of seam.functions) {
      expect({ name, result: clientEvaluable(compute(call[name]), none) }).toEqual({
        name,
        result: { ok: true },
      });
    }
    expect([...SUPPORTED_FUNCTIONS]).toEqual([...seam.functions].sort());
  });
});

describe("evaluateStep keeps errors apart from declines", () => {
  it("a configuration problem is an error, never rows", () => {
    expect(evaluateStep(compute(""), [{ a: 1 }], none)).toMatchObject({ status: "error" });
  });

  it("a wrong-typed config key is an error", () => {
    expect(
      evaluateStep({ id: "s", kind: "rename", config: { renames: { a: 1 } } }, [{ a: 1 }], none),
    ).toMatchObject({ status: "error" });
  });
});
