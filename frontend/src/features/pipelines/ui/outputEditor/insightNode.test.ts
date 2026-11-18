// HEL-1744 D2/D3 -- the insight "same node" rule and the config the editor writes for an insight.
import { defaultInsightReads, sameInsightNode } from "./insightNode";
import { buildOutputConfig } from "./buildOutputConfig";
import { buildBaselineConfig, buildConfigPatch, openingParams } from "./configPatch";
import { readInsightConfig } from "./outputConfigTypes";
import type { Output } from "../../types/output";

function out(id: string, extra: Partial<Output> = {}): Output {
  return {
    id,
    pipelineId: "p-1",
    ownerId: "u-1",
    name: id,
    kind: "table",
    config: {},
    schema: [],
    createdAt: "",
    updatedAt: "",
    ...extra,
  };
}

describe("sameInsightNode", () => {
  it("matches a step-bound insight to Outputs on the same step only", () => {
    expect(sameInsightNode({ nodeStepId: "s1" }, { nodeStepId: "s1" })).toBe(true);
    expect(sameInsightNode({ nodeStepId: "s1" }, { nodeStepId: "s2" })).toBe(false);
    expect(sameInsightNode({ nodeStepId: "s1" }, { rootId: "r1" })).toBe(false);
  });

  it("matches a root-bound insight to Outputs on the same root with no step", () => {
    expect(sameInsightNode({ rootId: "r1" }, { rootId: "r1" })).toBe(true);
    expect(sameInsightNode({ rootId: "r1" }, { rootId: "r2" })).toBe(false);
    expect(sameInsightNode({ rootId: "r1" }, { rootId: "r1", nodeStepId: "s1" })).toBe(false);
  });

  it("never matches on two undefined ids", () => {
    expect(sameInsightNode({}, {})).toBe(false);
    expect(sameInsightNode({ rootId: "r1" }, {})).toBe(false);
  });
});

describe("defaultInsightReads", () => {
  it("two roots: only the Output on the insight's own root is pre-ticked", () => {
    const candidates = [out("a", { rootId: "r1" }), out("b", { rootId: "r2" })];
    expect(defaultInsightReads({ rootId: "r1" }, candidates)).toEqual(["a"]);
  });
});

describe("readInsightConfig", () => {
  it("reads stored values and reports absent ones as absent", () => {
    expect(readInsightConfig({})).toEqual({
      preset: undefined,
      refresh: undefined,
      prompt: undefined,
      readsOutputs: null,
      readsWindows: [],
    });
    expect(
      readInsightConfig({
        preset: "trend",
        refresh: "daily",
        prompt: "Be brief",
        reads: { outputs: ["x"], windows: ["7d"] },
      }),
    ).toEqual({
      preset: "trend",
      refresh: "daily",
      prompt: "Be brief",
      readsOutputs: ["x"],
      readsWindows: ["7d"],
    });
  });
});

const DEFAULT = ["a", "b"];

function params(config: Record<string, unknown>, over: Record<string, unknown> = {}) {
  return { ...openingParams("insight", config, [], DEFAULT), ...over };
}

describe("buildOutputConfig (insight, create)", () => {
  it("writes nothing for an untouched card", () => {
    expect(buildOutputConfig(params({}))).toEqual({});
  });

  it("writes preset and refresh only when they differ from the defaults", () => {
    expect(buildOutputConfig(params({}, { insightPreset: "trend" }))).toEqual({ preset: "trend" });
    expect(buildOutputConfig(params({}, { insightRefresh: "manual" }))).toEqual({
      refresh: "manual",
    });
  });

  it("writes a non-blank prompt and never a blank one", () => {
    expect(buildOutputConfig(params({}, { insightPrompt: "Focus on churn" }))).toEqual({
      prompt: "Focus on churn",
    });
    expect(buildOutputConfig(params({}, { insightPrompt: "   " }))).toEqual({});
  });

  it("writes reads.outputs only when the ticked set differs from the default (as a set)", () => {
    expect(buildOutputConfig(params({}, { insightReads: ["b", "a"] }))).toEqual({});
    expect(buildOutputConfig(params({}, { insightReads: ["a"] }))).toEqual({
      reads: { outputs: ["a"] },
    });
    expect(buildOutputConfig(params({}, { insightReads: [] }))).toEqual({ reads: { outputs: [] } });
  });
});

describe("buildConfigPatch (insight, edit)", () => {
  function patch(stored: Record<string, unknown>, over: Record<string, unknown>) {
    const baseline = buildBaselineConfig("insight", stored, [], DEFAULT);
    const built = buildOutputConfig({ ...openingParams("insight", stored, [], DEFAULT), ...over });
    return buildConfigPatch("insight", built, baseline, stored);
  }

  it("untouched edit sends nothing", () => {
    expect(patch({ preset: "delta", prompt: "p", reads: { outputs: ["x"] } }, {})).toBeNull();
  });

  it("sends only changed keys", () => {
    expect(patch({ preset: "delta", refresh: "daily" }, { insightRefresh: "manual" })).toEqual({
      refresh: "manual",
    });
  });

  it("a cleared prompt is an explicit null", () => {
    expect(patch({ prompt: "p" }, { insightPrompt: "" })).toEqual({ prompt: null });
  });

  it("a preset returned to auto clears the stored key", () => {
    expect(patch({ preset: "trend" }, { insightPreset: "auto" })).toEqual({ preset: null });
  });

  it("reads: changed away from the default, no stored windows", () => {
    expect(patch({}, { insightReads: ["a"] })).toEqual({ reads: { outputs: ["a"] } });
  });

  it("reads: changed away from the default keeps stored windows", () => {
    expect(patch({ reads: { windows: ["7d"] } }, { insightReads: ["a"] })).toEqual({
      reads: { outputs: ["a"], windows: ["7d"] },
    });
  });

  it("reads: returned to the default with no stored windows clears reads", () => {
    expect(patch({ reads: { outputs: ["a"] } }, { insightReads: null })).toEqual({ reads: null });
  });

  it("reads: returned to the default with stored windows keeps only the windows", () => {
    expect(patch({ reads: { outputs: ["a"], windows: ["7d"] } }, { insightReads: null })).toEqual({
      reads: { windows: ["7d"] },
    });
  });
});
