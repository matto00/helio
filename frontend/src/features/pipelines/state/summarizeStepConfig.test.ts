import { OP_TYPES, unsupportedOpType } from "./stepNarrowing";
import { summarizeStepConfig } from "./summarizeStepConfig";
import { stepRowCount, stepRowCountSource } from "./stepRowCount";
import type { PipelineStepConfig } from "../types/pipelineStep";
import type { Step } from "../types/step";

function stepOf(kind: string, config: unknown): Step {
  const opType = OP_TYPES.find((op) => op.id === kind)!;
  return {
    id: `s-${kind}`,
    opType,
    label: opType.label,
    config: config as PipelineStepConfig,
    enabled: true,
  };
}

describe("summarizeStepConfig", () => {
  it("summarises a filter with a glyph operator and joins two conditions", () => {
    const s = stepOf("filter", {
      combinator: "and",
      conditions: [
        { field: "duration_s", operator: ">=", value: "180" },
        { field: "status", operator: "=", value: "ok" },
      ],
    });
    expect(summarizeStepConfig(s)).toBe("duration_s ≥ 180 and status = ok");
  });

  it("caps a filter at two conditions and counts the rest", () => {
    const cond = (f: string) => ({ field: f, operator: "=", value: "1" });
    const s = stepOf("filter", { combinator: "OR", conditions: [cond("a"), cond("b"), cond("c")] });
    expect(summarizeStepConfig(s)).toBe("a = 1 or b = 1 +1");
  });

  it("shows sort keys with direction arrows", () => {
    const s = stepOf("sort", {
      sortBy: [
        { field: "date", direction: "asc" },
        { field: "score", direction: "desc" },
      ],
    });
    expect(summarizeStepConfig(s)).toBe("date ↑, score ↓");
  });

  it("shows a compute column as an assignment", () => {
    const s = stepOf("compute", { column: "duration_min", expression: "duration_s / 60" });
    expect(summarizeStepConfig(s)).toBe("duration_min = duration_s / 60");
  });

  it("lists selected fields and truncates past three", () => {
    expect(summarizeStepConfig(stepOf("select", { fields: ["a", "b", "c", "d", "e"] }))).toBe(
      "a, b, c +2",
    );
  });

  it("summarises rename, cast, limit, aggregate, datebucket, dedupe and fillnull", () => {
    expect(summarizeStepConfig(stepOf("rename", { renames: { a: "b" } }))).toBe("a → b");
    expect(summarizeStepConfig(stepOf("cast", { casts: { a: "integer" } }))).toBe("a as integer");
    expect(summarizeStepConfig(stepOf("limit", { count: 10 }))).toBe("first 10");
    expect(
      summarizeStepConfig(
        stepOf("aggregate", {
          groupBy: [{ name: "region", type: "string" }],
          aggregations: [{ alias: "t", fn: "sum", field: "sales" }],
        }),
      ),
    ).toBe("sum(sales) by region");
    expect(summarizeStepConfig(stepOf("datebucket", { field: "d", granularity: "month" }))).toBe(
      "d by month",
    );
    expect(summarizeStepConfig(stepOf("dedupe", { keys: ["id"], keep: "first" }))).toBe("on id");
    expect(summarizeStepConfig(stepOf("fillnull", { columns: ["x"], strategy: "mean" }))).toBe(
      "x · mean",
    );
  });

  it("summarises the two-input kinds without naming ids", () => {
    const secondaryInput = { kind: "source", dataSourceId: "ds-1" };
    expect(
      summarizeStepConfig(stepOf("join", { secondaryInput, joinKey: "id", joinType: "left" })),
    ).toBe("left on id with another source");
    expect(summarizeStepConfig(stepOf("union", { secondaryInput, mode: "byName" }))).toBe(
      "append another source",
    );
  });

  it("falls back to the op label when the config has nothing to summarise", () => {
    expect(summarizeStepConfig(stepOf("filter", { combinator: "and", conditions: [] }))).toBe(
      "Filter rows",
    );
    expect(summarizeStepConfig(stepOf("sort", {}))).toBe("Sort rows");
  });

  it("falls back to the op label for an unknown or unsupported kind and never throws", () => {
    const unknown: Step = {
      id: "s-x",
      opType: unsupportedOpType("mystery"),
      label: "mystery",
      config: null as unknown as PipelineStepConfig,
      enabled: true,
    };
    expect(summarizeStepConfig(unknown)).toBe(unknown.opType.label);
    const broken = stepOf("filter", null);
    expect(summarizeStepConfig(broken)).toBe("Filter rows");
  });
});

describe("stepRowCount", () => {
  it("prefers the in-session run's count over the persisted one", () => {
    expect(stepRowCount("a", { a: 5 }, { a: 9 })).toBe(5);
  });
  it("falls back to the persisted latest run's count", () => {
    expect(stepRowCount("a", {}, { a: 9 })).toBe(9);
    expect(stepRowCount("a", null, { a: 9 })).toBe(9);
  });
  it("is null (not zero) for a step with no recorded count", () => {
    expect(stepRowCount("new", { a: 5 }, { a: 9 })).toBeNull();
    expect(stepRowCount("a", {}, null)).toBeNull();
    expect(stepRowCount("a", undefined, undefined)).toBeNull();
  });
  it("keeps a recorded zero as zero", () => {
    expect(stepRowCount("a", { a: 0 }, { a: 9 })).toBe(0);
  });
  it("names where the shown counts come from", () => {
    expect(stepRowCountSource({ a: 1 }, { a: 2 })).toBe("session");
    expect(stepRowCountSource({}, { a: 2 })).toBe("persisted");
    expect(stepRowCountSource({}, null)).toBe("none");
  });
});
