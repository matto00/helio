// HEL-1732 (design.md D2): the client step handlers place columns where the server's analyze (`StepSchemaInference`) does, so a
// draft frame's key order is the order the server would project. One case per client kind; the comment on each names the server rule.

import { evaluatePipeline, type StepDefinition } from "../evaluatePipeline";
import type { Frame, Row } from "../value";
import { scalaMapKeyOrder } from "../scalaGroup";

const def = (
  kind: string,
  config: unknown,
  over: Partial<StepDefinition> = {},
): StepDefinition => ({
  id: "s",
  kind,
  parentStepId: null,
  rootId: "r",
  position: 0,
  enabled: true,
  config,
  ...over,
});

function keysAfter(
  kind: string,
  config: unknown,
  rows: Frame,
  options: Parameters<typeof evaluatePipeline>[2] = {},
): string[][] {
  const walk = evaluatePipeline([def(kind, config)], [{ rootId: "r", rows }], options);
  const node = walk.nodes.get("s");
  if (node?.status !== "ok") throw new Error(`step did not evaluate: ${JSON.stringify(node)}`);
  return node.rows.map((row) => Object.keys(row));
}

const row = (o: Record<string, string | number>): Row => o;

describe("client step handlers keep the server's column order (HEL-1732 D2)", () => {
  const BASE = [
    row({ id: 1, region: "east", status: "ok", amount: 4, total: 5, created: "2026-09-01" }),
  ];

  it("rename puts the renamed column where the original was (server: in-place mapping)", () => {
    expect(keysAfter("rename", { renames: { region: "area" } }, BASE)[0]).toEqual([
      "id",
      "area",
      "status",
      "amount",
      "total",
      "created",
    ]);
  });

  it("rename of several columns keeps every position", () => {
    expect(
      keysAfter("rename", { renames: { id: "key", created: "made_at", status: "state" } }, BASE)[0],
    ).toEqual(["key", "region", "state", "amount", "total", "made_at"]);
  });

  it("rename onto an existing column keeps the earlier position (server: the first occurrence)", () => {
    expect(keysAfter("rename", { renames: { created: "id" } }, BASE)[0]).toEqual([
      "id",
      "region",
      "status",
      "amount",
      "total",
    ]);
    expect(keysAfter("rename", { renames: { id: "total" } }, BASE)[0]).toEqual([
      "total",
      "region",
      "status",
      "amount",
      "created",
    ]);
  });

  it("rename chains follow the client fold's final names, in the input row's positions (D2 table: differs from the server's single lookup)", () => {
    // Folded in Scala sorted-key order: amount -> cost, then cost -> price.
    expect(scalaMapKeyOrder(["amount", "cost"])).toEqual(["amount", "cost"]);
    expect(keysAfter("rename", { renames: { amount: "cost", cost: "price" } }, BASE)[0]).toEqual([
      "id",
      "region",
      "status",
      "price",
      "total",
      "created",
    ]);
  });

  it("rename leaves a row that lacks the column alone and keeps sparse rows' own order", () => {
    const rows = [row({ id: 1, region: "e" }), row({ id: 2 })];
    expect(keysAfter("rename", { renames: { region: "area" } }, rows)).toEqual([
      ["id", "area"],
      ["id"],
    ]);
  });

  it("select keeps the input's order, not the config's (server: input schema filtered)", () => {
    expect(keysAfter("select", { fields: ["total", "id", "status"] }, BASE)[0]).toEqual([
      "id",
      "status",
      "total",
    ]);
  });

  it("filter, sort, limit, dedupe, assert and fillnull pass the order through", () => {
    for (const [kind, config] of [
      ["filter", { combinator: "and", conditions: [] }],
      ["sort", { sortBy: [{ field: "id", direction: "asc" }] }],
      ["limit", { count: 5 }],
      ["dedupe", { keys: ["id"], keep: "first" }],
      ["assert", { rules: [] }],
      ["fillnull", { columns: ["total"], strategy: "constant", value: "0" }],
    ] as const) {
      expect(keysAfter(kind, config, BASE)[0]).toEqual(Object.keys(BASE[0]));
    }
  });

  it("cast keeps the order (server: same schema, new types)", () => {
    expect(keysAfter("cast", { casts: { amount: "string" } }, BASE)[0]).toEqual(
      Object.keys(BASE[0]),
    );
  });

  it("compute adds a new column last and keeps an existing column's position (server: appended, first occurrence shown)", () => {
    expect(
      keysAfter(
        "compute",
        { column: "margin", expression: "$amount - $total", type: "float" },
        BASE,
      )[0],
    ).toEqual([...Object.keys(BASE[0]), "margin"]);
    expect(
      keysAfter("compute", { column: "region", expression: "$amount", type: "float" }, BASE)[0],
    ).toEqual(Object.keys(BASE[0]));
  });

  it("datebucket moves an existing output column to the end (server: filterNot then append)", () => {
    const rows = [row({ id: 1, created: "2026-09-12", region: "e" })];
    expect(keysAfter("datebucket", { field: "created", granularity: "month" }, rows)[0]).toEqual([
      "id",
      "region",
      "created",
    ]);
    expect(
      keysAfter(
        "datebucket",
        { field: "created", granularity: "month", outputColumn: "bucket" },
        rows,
      )[0],
    ).toEqual(["id", "created", "region", "bucket"]);
  });

  it("window moves an existing output column to the end, else appends it", () => {
    const rows = [row({ id: 1, rn: 0, region: "e" })];
    const cfg = {
      function: "row_number",
      partitionBy: [],
      orderBy: [{ field: "id", direction: "asc" }],
    };
    expect(keysAfter("window", { ...cfg, outputColumn: "rn" }, rows)[0]).toEqual([
      "id",
      "region",
      "rn",
    ]);
    expect(keysAfter("window", { ...cfg, outputColumn: "n2" }, rows)[0]).toEqual([
      "id",
      "rn",
      "region",
      "n2",
    ]);
  });

  it("stringops moves an existing output column to the end, else appends it", () => {
    const rows = [row({ id: 1, name: "a", region: "e" })];
    expect(
      keysAfter("stringops", { operation: "upper", field: "name", outputColumn: "name" }, rows)[0],
    ).toEqual(["id", "region", "name"]);
    expect(
      keysAfter("stringops", { operation: "upper", field: "name", outputColumn: "loud" }, rows)[0],
    ).toEqual(["id", "name", "region", "loud"]);
  });

  it("splittext keeps the split field in place and moves an existing index field to the end", () => {
    const rows = [row({ id: 1, seg: 9, body: "a\n\nb", tail: "t" })];
    expect(
      keysAfter("splittext", { field: "body", mode: "paragraph", indexField: "seg" }, rows)[0],
    ).toEqual(["id", "body", "tail", "seg"]);
    expect(
      keysAfter("splittext", { field: "body", mode: "paragraph", indexField: "n" }, rows)[0],
    ).toEqual(["id", "seg", "body", "tail", "n"]);
  });

  it("extractheadings moves existing index and level fields to the end, in that order", () => {
    const rows = [row({ lvl: 0, doc: "# A\ntext", idx: 7, other: 1 })];
    expect(
      keysAfter("extractheadings", { field: "doc", indexField: "idx", levelField: "lvl" }, rows)[0],
    ).toEqual(["doc", "other", "idx", "lvl"]);
  });

  it("unpivot lists the id columns, then the variable and value names (a name that collides moves to the end)", () => {
    const rows = [row({ id: 1, region: "e", a: 1, b: 2 })];
    expect(
      keysAfter(
        "unpivot",
        { idVars: ["id", "region"], valueVars: ["a", "b"], varName: "k", valueName: "v" },
        rows,
      )[0],
    ).toEqual(["id", "region", "k", "v"]);
    expect(
      keysAfter(
        "unpivot",
        { idVars: ["id", "region"], valueVars: ["a"], varName: "id", valueName: "v" },
        rows,
      )[0],
    ).toEqual(["region", "id", "v"]);
  });

  it("groupby, aggregate and pivot list the group/index columns first, then their computed columns", () => {
    const rows = [
      row({ region: "e", status: "ok", amount: 4 }),
      row({ region: "w", status: "ok", amount: 5 }),
    ];
    expect(
      keysAfter(
        "groupby",
        { groupBy: ["status", "region"], aggColumn: "amount", aggFunction: "sum" },
        rows,
      )[0],
    ).toEqual(["status", "region", "sum_amount"]);
    expect(
      keysAfter(
        "aggregate",
        {
          groupBy: [{ name: "region", type: "string" }],
          aggregations: [
            { alias: "n", fn: "count", field: "amount" },
            { alias: "t", fn: "sum", field: "amount" },
          ],
        },
        rows,
      )[0],
    ).toEqual(["region", "n", "t"]);
    expect(
      keysAfter(
        "pivot",
        { index: ["status"], column: "region", values: "amount", agg: "sum" },
        rows,
      )[0][0],
    ).toBe("status");
  });

  it("join appends the secondary's columns in the secondary's key order", () => {
    const secondaryRows = [row({ code: "e", label: "East", size: 3 })];
    const options2 = { sources: { src: { rows: secondaryRows, complete: true } } };
    expect(
      keysAfter(
        "join",
        {
          joinKey: "code",
          joinType: "inner",
          secondaryInput: { kind: "source", dataSourceId: "src" },
        },
        [row({ id: 1, code: "e" })],
        options2,
      ),
    ).toEqual([["id", "code", "label", "size"]]);
  });

  it("lookup appends the looked-up columns in the config's order", () => {
    const ref = [row({ code: "e", label: "East", size: 3 })];
    const options = { sources: { src: { rows: ref, complete: true } } };
    expect(
      keysAfter(
        "lookup",
        {
          sourceKey: "region",
          lookupKey: "code",
          columns: ["size", "label"],
          secondaryInput: { kind: "source", dataSourceId: "src" },
        },
        [row({ id: 1, region: "e" })],
        options,
      ),
    ).toEqual([["id", "region", "size", "label"]]);
  });

  it("union by name appends the secondary's new columns after this lane's", () => {
    const other = [row({ b: 1, c: 2 })];
    const options = { sources: { src: { rows: other, complete: true } } };
    expect(
      keysAfter(
        "union",
        { mode: "byName", secondaryInput: { kind: "source", dataSourceId: "src" } },
        [row({ a: 1, b: 2 })],
        options,
      )[0],
    ).toEqual(["a", "b", "c"]);
  });
});
