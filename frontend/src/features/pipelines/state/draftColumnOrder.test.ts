// HEL-1732 (design.md D3a/D3b/D6): the column order the draft grid shows for a step.

import { evaluatePipeline, type Frame, type Row } from "../evaluator";
import { serverResolvedStepIds, toStepDefinitions } from "./draftEvaluation";
import { createColumnOrderResolver, draftColumnOrder } from "./draftColumnOrder";
import { OP_TYPES } from "./stepNarrowing";
import type { PipelineRoot } from "../types/pipelineStep";
import type { Step } from "../types/step";

const row = (o: Record<string, string | number>): Row => o;

describe("draftColumnOrder (D3a)", () => {
  it("a dense frame (the first row has every key) shows the first row's own order and never asks for the parent", () => {
    const parent = jest.fn(() => ["z"]);
    expect(draftColumnOrder([row({ b: 1, a: 2 }), row({ a: 3 })], parent)).toEqual(["b", "a"]);
    expect(parent).not.toHaveBeenCalled();
  });

  it("a sparse frame takes the parent's order, then the new columns in first-seen order", () => {
    // Row 1 has a,c; row 2 has b: first-seen is a,c,b, the parent's order is a,b,c.
    expect(draftColumnOrder([row({ a: 1, c: 2 }), row({ b: 3 })], () => ["a", "b", "c"])).toEqual([
      "a",
      "b",
      "c",
    ]);
    expect(draftColumnOrder([row({ a: 1, z: 2 }), row({ b: 3 })], () => ["a", "b"])).toEqual([
      "a",
      "b",
      "z",
    ]);
  });

  it("a parent column the frame lacks is not added", () => {
    expect(
      draftColumnOrder([row({ a: 1, c: 2 }), row({ b: 3 })], () => ["x", "a", "b", "c"]),
    ).toEqual(["a", "b", "c"]);
  });

  it("an empty frame has no columns", () => {
    expect(draftColumnOrder([], () => ["a"])).toEqual([]);
  });
});

// --- the resolver --------------------------------------------------------------------------------------------------

const opOf = (id: string) => OP_TYPES.find((o) => o.id === id)!;
const step = (id: string, kind: string, config: unknown, over: Partial<Step> = {}): Step => ({
  id,
  opType: opOf(kind),
  label: kind,
  config: config as Step["config"],
  enabled: true,
  parentStepId: null,
  position: 0,
  rootId: "r1",
  ...over,
});

const ROOTS: PipelineRoot[] = [{ id: "r1", dataSourceId: "src1", dataSourceName: "Sales" }];
const DECLARED = ["id", "region", "status", "amount", "total", "created"];
const SAMPLE: Frame = [
  row({ id: 1, region: "e", status: "ok", amount: 4, total: 5, created: "2026-09-01" }),
];

interface Setup {
  steps: Step[];
  savedSteps?: Step[];
  roots?: PipelineRoot[];
  savedRoots?: PipelineRoot[];
  /** Server rows by step id (hash order), for the steps the client cannot evaluate. */
  serverRows?: Record<string, Frame>;
  saved?: Record<string, string[]>;
  /** Steps to treat as server-resolved regardless of the walk (a join whose source secondary is not cached). */
  forceServer?: string[];
}

function resolve({
  steps,
  savedSteps = steps,
  roots = ROOTS,
  savedRoots = ROOTS,
  serverRows = {},
  saved = {},
  forceServer = [],
}: Setup) {
  const walk = evaluatePipeline(toStepDefinitions(steps), [{ rootId: "r1", rows: SAMPLE }]);
  const serverResolved = new Set([...serverResolvedStepIds(walk), ...forceServer]);
  const rowsOf = (id: string): Frame | undefined => {
    if (serverRows[id] !== undefined) return serverRows[id];
    const node = walk.nodes.get(id);
    return node?.status === "ok" || node?.status === "disabled" ? node.rows : undefined;
  };
  return createColumnOrderResolver({
    steps,
    savedSteps,
    roots,
    savedRoots,
    rowsOf,
    rootRowsOf: () => SAMPLE,
    serverResolved,
    savedOutputNames: (id) => saved[id],
  });
}

describe("createColumnOrderResolver, client-evaluated steps (D3a)", () => {
  it("a rename keeps the column in place and every step below it inherits that order", () => {
    const steps = [
      step("a", "rename", { renames: { region: "area" } }),
      step("b", "filter", { combinator: "and", conditions: [] }, { parentStepId: "a" }),
    ];
    const orderOf = resolve({ steps });
    expect(orderOf("a")).toEqual(["id", "area", "status", "amount", "total", "created"]);
    expect(orderOf("b")).toEqual(["id", "area", "status", "amount", "total", "created"]);
  });

  it("a draft-inserted compute step shows its parent's columns, then the new one (derived by the real walk)", () => {
    const steps = [
      step("c", "compute", { column: "margin", expression: "$amount - $total", type: "float" }),
    ];
    expect(resolve({ steps })("c")).toEqual([...DECLARED, "margin"]);
  });

  it("a sparse frame after a rename uses the parent's order with the rename substituted", () => {
    // A left join leaves unmatched rows without the right column, so row 1 lacks `label`; here emulated by a root with sparse rows.
    const walkRows: Frame = [row({ id: 1, region: "e" }), row({ id: 2, status: "ok" })];
    const steps = [step("a", "rename", { renames: { region: "area" } })];
    const orderOf = createColumnOrderResolver({
      steps,
      savedSteps: steps,
      roots: ROOTS,
      savedRoots: ROOTS,
      rowsOf: () => [row({ id: 1, area: "e" }), row({ id: 2, status: "ok" })],
      rootRowsOf: () => walkRows,
      serverResolved: new Set(),
      savedOutputNames: () => undefined,
    });
    expect(orderOf("a")).toEqual(["id", "area", "status"]);
  });
});

describe("createColumnOrderResolver, server-resolved steps (D3b)", () => {
  const SERVER_ROWS: Frame = [
    row({ total: 5, margin: 9, id: 1, created: "d", status: "ok", amount: 4, region: "e" }),
  ];
  const SAVED = ["id", "region", "status", "amount", "total", "created", "margin"];
  const lineage = (over: Partial<Step> = {}): Step[] => [
    step("a", "rename", { renames: { region: "area" } }),
    step(
      "b",
      "convertformat",
      { field: "note", from: "text", to: "markdown" },
      { parentStepId: "a", ...over },
    ),
  ];

  it("an unchanged lineage uses the step's saved analyzed order", () => {
    const steps = lineage();
    const orderOf = resolve({ steps, serverRows: { b: SERVER_ROWS }, saved: { b: SAVED } });
    expect(orderOf("b")).toEqual([
      "id",
      "region",
      "status",
      "amount",
      "total",
      "created",
      "margin",
    ]);
  });

  it("an edited ancestor falls back to the nearest client-evaluated ancestor's order, new columns after in code-unit order", () => {
    const steps = lineage();
    const savedSteps = [step("a", "rename", { renames: { region: "zone" } }), steps[1]];
    const orderOf = resolve({
      steps,
      savedSteps,
      serverRows: { b: SERVER_ROWS },
      saved: { b: SAVED },
    });
    // a's order is id, area, status, amount, total, created; the server's `margin` is not in it.
    expect(orderOf("b")).toEqual([
      "id",
      "status",
      "amount",
      "total",
      "created",
      "margin",
      "region",
    ]);
  });

  it("a changed config on the step itself uses rule 2", () => {
    const steps = lineage();
    const savedSteps = [
      steps[0],
      { ...steps[1], config: { field: "other", from: "text", to: "markdown" } as Step["config"] },
    ];
    const orderOf = resolve({
      steps,
      savedSteps,
      serverRows: { b: SERVER_ROWS },
      saved: { b: SAVED },
    });
    expect(orderOf("b")?.[0]).toBe("id");
    expect(orderOf("b")).not.toEqual(SAVED);
  });

  it("a step the saved pipeline lacks has no saved order (rule 2)", () => {
    const steps = lineage();
    const orderOf = resolve({
      steps,
      savedSteps: [steps[0]],
      serverRows: { b: SERVER_ROWS },
      saved: { b: SAVED },
    });
    expect(orderOf("b")).not.toEqual(SAVED);
  });

  it("a changed root binding (HEL-1734) uses rule 2", () => {
    const steps = lineage();
    const savedRoots: PipelineRoot[] = [
      { id: "r1", dataSourceId: "other-src", dataSourceName: "Other" },
    ];
    const orderOf = resolve({
      steps,
      savedRoots,
      serverRows: { b: SERVER_ROWS },
      saved: { b: SAVED },
    });
    expect(orderOf("b")).not.toEqual(SAVED);
  });

  it("an edit in a lane the step reads uses rule 2", () => {
    // A saved order that differs from the root order, so rule 1 and rule 2 are told apart.
    const LANE_SAVED = ["margin", ...SAVED.slice(0, 6)];
    const lane = step("lane", "rename", { renames: { id: "key" } }, { rootId: "r1" });
    const edited = { ...lane, config: { renames: { id: "other" } } as Step["config"] };
    const reader = step(
      "b",
      "join",
      { joinKey: "id", joinType: "inner", secondaryInput: { kind: "lane", stepId: "lane" } },
      { parentStepId: null, position: 1 },
    );
    const orderOf = resolve({
      steps: [edited, reader],
      savedSteps: [lane, reader],
      serverRows: { b: SERVER_ROWS },
      saved: { b: LANE_SAVED },
      forceServer: ["b"],
    });
    expect(orderOf("b")).not.toEqual(LANE_SAVED);
    const unchanged = resolve({
      steps: [lane, reader],
      savedSteps: [lane, reader],
      serverRows: { b: SERVER_ROWS },
      saved: { b: LANE_SAVED },
      forceServer: ["b"],
    });
    expect(unchanged("b")).toEqual(LANE_SAVED);
  });

  it("with no saved order and no client ancestor, the step is in code-unit order", () => {
    const steps = [step("b", "convertformat", { field: "note", from: "text", to: "markdown" })];
    const orderOf = resolve({ steps, serverRows: { b: SERVER_ROWS } });
    // The root's displayed order is the sample's own, so the first-rule ancestor is the root: its columns first, the new one after.
    expect(orderOf("b")).toEqual([...DECLARED, "margin"]);
  });
});
