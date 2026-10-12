import type { Output } from "../../types/output";
import { collectionRulesAsCellRules, historyRowRules } from "./historyRowRules";

const rule = { op: "lt", value: 50, tone: "error" } as const;

function out(kind: string, config: Record<string, unknown>): Output {
  return { id: "o", kind, config } as unknown as Output;
}

describe("collectionRulesAsCellRules", () => {
  it("targets the value column as cell rules, keeping order and other fields", () => {
    const rules = [{ ...rule, label: "Low" }, { op: "gte", value: 90, tone: "success" } as const];
    expect(collectionRulesAsCellRules(rules, "score")).toEqual([
      { ...rules[0], column: "score", target: "cell" },
      { ...rules[1], column: "score", target: "cell" },
    ]);
  });

  it("applies nothing without a mapped value column", () => {
    expect(collectionRulesAsCellRules([rule], undefined)).toEqual([]);
  });
});

describe("historyRowRules", () => {
  it("passes table rules through", () => {
    const r = { ...rule, column: "x", target: "row" };
    expect(historyRowRules(out("table", { conditionalFormats: [r] }))).toEqual([r]);
  });

  it("maps collection rules, and gives none for a collection without a value mapping", () => {
    const config = { conditionalFormats: [rule] };
    expect(historyRowRules(out("collection", { ...config, fieldMapping: { value: "s" } }))).toEqual(
      [{ ...rule, column: "s", target: "cell" }],
    );
    expect(historyRowRules(out("collection", config))).toBeUndefined();
  });

  it("gives none for metric, other kinds and empty rules", () => {
    expect(historyRowRules(out("metric", { conditionalFormats: [rule] }))).toBeUndefined();
    expect(historyRowRules(out("chart", { conditionalFormats: [rule] }))).toBeUndefined();
    expect(historyRowRules(out("table", { conditionalFormats: [] }))).toBeUndefined();
  });
});
