import { evaluatePipeline, type Frame, type StepDefinition } from "../evaluator";
import { decodeRow } from "../evaluator/wire";
import type { Step } from "../types/step";
import {
  createIncrementalWalker,
  rootCauseOf,
  schemaFromFrame,
  secondarySourceIds,
  serverResolvedStepIds,
  singleEditedStep,
  toStepDefinitions,
} from "./draftEvaluation";
import { OP_TYPES } from "./stepNarrowing";

const frame = (...rows: Array<Record<string, unknown>>): Frame => rows.map(decodeRow);
const ROOTS = [{ rootId: "r1", rows: frame({ n: 1 }, { n: 2 }, { n: 3 }, { n: 4 }) }];
const NO_SOURCES = {};
const def = (id: string, kind: string, parent: string | null, config: unknown): StepDefinition => ({
  id,
  kind,
  parentStepId: parent,
  rootId: parent === null ? "r1" : null,
  position: 0,
  enabled: true,
  config,
});

describe("singleEditedStep", () => {
  const a = def("a", "limit", null, { count: 2 });
  const b = def("b", "limit", "a", { count: 1 });

  it("names the one step whose config object changed", () => {
    expect(singleEditedStep([a, b], [a, { ...b, config: { count: 3 } }])).toBe("b");
  });

  it("is undefined for no change, two changed configs, a flag change, a different step set or order", () => {
    expect(singleEditedStep([a, b], [a, b])).toBeUndefined();
    expect(
      singleEditedStep(
        [a, b],
        [
          { ...a, config: {} },
          { ...b, config: {} },
        ],
      ),
    ).toBeUndefined();
    expect(singleEditedStep([a, b], [a, { ...b, enabled: false }])).toBeUndefined();
    expect(singleEditedStep([a, b], [a])).toBeUndefined();
    expect(singleEditedStep([a, b], [b, a])).toBeUndefined();
  });
});

describe("createIncrementalWalker", () => {
  it("gives the same result as a full walk after a single-config edit, reusing the untouched upstream nodes", () => {
    const a = def("a", "limit", null, { count: 3 });
    const b = def("b", "limit", "a", { count: 2 });
    const c = def("c", "limit", "b", { count: 1 });
    const walker = createIncrementalWalker();
    const first = walker.walk([a, b, c], ROOTS, NO_SOURCES);
    const edited = { ...b, config: { count: 1 } };
    const second = walker.walk([a, edited, c], ROOTS, NO_SOURCES);
    const full = evaluatePipeline([a, edited, c], ROOTS);
    expect(second.nodes.get("a")).toBe(first.nodes.get("a"));
    for (const id of ["a", "b", "c"]) {
      const s = second.nodes.get(id);
      const f = full.nodes.get(id);
      expect(s?.status).toBe(f?.status);
      if (s?.status === "ok" && f?.status === "ok") expect(s.count).toBe(f.count);
    }
  });

  it("does a full walk when the samples change, even if only one config changed", () => {
    const a = def("a", "limit", null, { count: 3 });
    const walker = createIncrementalWalker();
    const first = walker.walk([a], ROOTS, NO_SOURCES);
    const moreRows = [
      { rootId: "r1", rows: frame({ n: 1 }, { n: 2 }, { n: 3 }, { n: 4 }, { n: 5 }) },
    ];
    const second = walker.walk([{ ...a, config: { count: 4 } }], moreRows, NO_SOURCES);
    expect(second.nodes.get("a")).not.toBe(first.nodes.get("a"));
    expect(second.nodes.get("a")).toMatchObject({ status: "ok", count: 4 });
  });
});

describe("serverResolvedStepIds and rootCauseOf", () => {
  it("collects needsServer steps and everything blocked behind them, and not what an error blocks", () => {
    const defs = [
      def("a", "convertformat", null, { field: "n", from: "csv", to: "json" }),
      def("b", "limit", "a", { count: 1 }),
      def("c", "limit", null, { count: "x" }),
      def("d", "limit", "c", { count: 1 }),
    ].map((d, i) => (i >= 2 ? { ...d, rootId: d.parentStepId === null ? "r1" : null } : d));
    const walk = evaluatePipeline(defs, ROOTS);
    expect([...serverResolvedStepIds(walk)].sort()).toEqual(["a", "b"]);
    expect(rootCauseOf(walk.nodes, "d").stepId).toBe("c");
    expect(rootCauseOf(walk.nodes, "b").node?.status).toBe("needsServer");
  });
});

describe("toStepDefinitions", () => {
  const op = (id: string) => OP_TYPES.find((o) => o.id === id)!;
  it("maps a Step to the evaluator's definition and leaves a not-yet-created AI draft out", () => {
    const steps: Step[] = [
      {
        id: "s1",
        opType: op("limit"),
        label: "L",
        config: { count: 1 },
        enabled: true,
        rootId: "r1",
        position: 2,
      },
      { id: "step-4", opType: op("limit"), label: "L", config: { count: 1 }, enabled: true },
    ];
    expect(toStepDefinitions(steps)).toEqual([
      {
        id: "s1",
        kind: "limit",
        parentStepId: null,
        rootId: "r1",
        position: 2,
        enabled: true,
        config: { count: 1 },
      },
    ]);
  });
});

describe("secondarySourceIds and schemaFromFrame", () => {
  const op = (id: string) => OP_TYPES.find((o) => o.id === id)!;
  it("lists the source ids join/union/lookup take, sorted and without lane references", () => {
    const steps = [
      {
        id: "j",
        opType: op("join"),
        label: "",
        enabled: true,
        config: {
          secondaryInput: { kind: "source", dataSourceId: "z" },
          joinKey: "k",
          joinType: "inner",
        },
      },
      {
        id: "u",
        opType: op("union"),
        label: "",
        enabled: true,
        config: { secondaryInput: { kind: "source", dataSourceId: "a" }, mode: "byPosition" },
      },
      {
        id: "l",
        opType: op("lookup"),
        label: "",
        enabled: true,
        config: { secondaryInput: { kind: "lane", stepId: "x" } },
      },
    ] as unknown as Step[];
    expect(secondarySourceIds(steps)).toEqual(["a", "z"]);
  });

  it("types a column by its first non-null value and lets a known type win", () => {
    const rows = frame({ a: null, b: "x", c: true, d: 1.5 }, { a: 1, b: "y", c: false, d: 2 });
    const typed = Object.fromEntries(schemaFromFrame(rows).map((f) => [f.name, f.type]));
    expect(typed).toEqual({ a: "float", b: "string", c: "boolean", d: "float" });
    expect(
      schemaFromFrame(rows, [{ name: "a", type: "integer" }]).find((f) => f.name === "a")?.type,
    ).toBe("integer");
  });
});
