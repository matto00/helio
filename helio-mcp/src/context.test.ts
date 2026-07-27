/**
 * HEL-372 tasks.md 4.7 — MCP-side unit tests for `sampleRows`.
 *
 * `sanitizeSampleRows` is an INDEPENDENT TypeScript implementation of the
 * identical caps `WorkspaceContextService.sanitizeSampleRows` (Scala)
 * enforces (design.md D3/D6) — this codebase has no shared runtime between
 * the backend and helio-mcp, so parity is achieved by duplicating the rules
 * and testing each side separately (the existing pattern for
 * `panelCount`/`flattenRowCount`), not by sharing code.
 */

import {
  asNumeric,
  buildWorkspaceContext,
  computeColumnStats,
  sanitizeSampleRows,
} from "./context.js";
import type { HelioApi } from "./helioApi.js";
import type { DataTypeResponse } from "./types.js";

/** `noUncheckedIndexedAccess` (helio-mcp's tsconfig) types `arr[0]` as
 *  `T | undefined` — this narrows it once per test rather than repeating
 *  the guard at every call site. */
function firstRow(rows: Record<string, unknown>[]): Record<string, unknown> {
  const row = rows[0];
  if (!row) throw new Error("expected at least one sanitized row");
  return row;
}

describe("sanitizeSampleRows", () => {
  const structuredField = (name: string, dataType = "string") => ({ name, dataType });

  it("caps the number of rows at 5, even when given more", () => {
    const fields = [structuredField("id")];
    const rawRows = Array.from({ length: 7 }, (_, i) => ({ id: i }));

    const result = sanitizeSampleRows(fields, rawRows);

    expect(result).toHaveLength(5);
  });

  it("caps columns at the first 40 declared Structured fields, in field order", () => {
    const fields = Array.from({ length: 45 }, (_, i) => structuredField(`col${i}`));
    const rawRow = Object.fromEntries(fields.map((f) => [f.name, f.name]));

    const result = sanitizeSampleRows(fields, [rawRow]);

    expect(result).toHaveLength(1);
    const row = firstRow(result);
    expect(Object.keys(row)).toHaveLength(40);
    expect(row).toHaveProperty("col0");
    expect(row).toHaveProperty("col39");
    expect(row).not.toHaveProperty("col40");
    expect(row).not.toHaveProperty("col44");
  });

  it("excludes a Content-category field (string-body/binary-ref) from the projection entirely", () => {
    const fields = [structuredField("name"), structuredField("body", "string-body")];
    const rawRow = { name: "alice", body: "x".repeat(500) };

    const result = sanitizeSampleRows(fields, [rawRow]);

    expect(firstRow(result)).toEqual({ name: "alice" });
  });

  it("excludes a field whose dataType string is unrecognized (conservative default)", () => {
    const fields = [structuredField("name"), structuredField("mystery", "not-a-real-type")];
    const rawRow = { name: "alice", mystery: "?" };

    const result = sanitizeSampleRows(fields, [rawRow]);

    expect(firstRow(result)).toEqual({ name: "alice" });
  });

  it("truncates an oversized string cell to 200 chars of its JSON.stringify plus the exact marker", () => {
    const fields = [structuredField("note")];
    const original = "x".repeat(250);
    const rawRow = { note: original };

    const result = sanitizeSampleRows(fields, [rawRow]);

    const expected = JSON.stringify(original).slice(0, 200) + "…[truncated]";
    expect(firstRow(result).note).toBe(expected);
  });

  it("truncates an oversized non-string cell to a string with the same exact marker", () => {
    const fields = [structuredField("wide", "integer")];
    const original = Array.from({ length: 150 }, () => 7);
    expect(JSON.stringify(original).length).toBeGreaterThan(200);
    const rawRow = { wide: original };

    const result = sanitizeSampleRows(fields, [rawRow]);

    const expected = JSON.stringify(original).slice(0, 200) + "…[truncated]";
    const row = firstRow(result);
    expect(row.wide).toBe(expected);
    expect(typeof row.wide).toBe("string");
  });

  it("leaves a cell at or under the 200-char cap untouched", () => {
    const fields = [structuredField("note")];
    const rawRow = { note: "short" };

    const result = sanitizeSampleRows(fields, [rawRow]);

    expect(firstRow(result).note).toBe("short");
  });

  it("returns an empty array for an empty snapshot", () => {
    const result = sanitizeSampleRows([structuredField("id")], []);
    expect(result).toEqual([]);
  });
});

/**
 * HEL-373 tasks.md 5.5 — MCP-side unit tests for `computeColumnStats`/
 * `asNumeric`, mirroring `WorkspaceContextServiceComputeColumnStatsSpec`'s
 * Scala-side cases. An INDEPENDENT TypeScript implementation of the
 * identical caps `WorkspaceContextService.computeColumnStats` (Scala)
 * enforces (design.md D2/D3/D4/D5/D6/D10) — parity via duplicating the
 * rules and testing each side separately, not sharing code.
 */
describe("computeColumnStats", () => {
  const structuredField = (name: string, dataType = "string") => ({ name, dataType });

  it("reports min/max/mean for a numeric column", () => {
    const fields = [structuredField("amount", "float")];
    const rawRows = [{ amount: 10 }, { amount: 20 }, { amount: 30 }];

    const stats = computeColumnStats(fields, rawRows).amount;

    expect(stats?.min).toBe(10);
    expect(stats?.max).toBe(30);
    expect(stats?.mean).toBe(20);
  });

  it("omits min/max/mean for a non-numeric column", () => {
    const fields = [structuredField("status")];
    const rawRows = [{ status: "active" }, { status: "inactive" }];

    const stats = computeColumnStats(fields, rawRows).status;

    expect(stats?.min).toBeUndefined();
    expect(stats?.max).toBeUndefined();
    expect(stats?.mean).toBeUndefined();
  });

  it("reports nullRate, distinctCount, and exampleValues for a Structured column", () => {
    const fields = [structuredField("status")];
    const rawRows = [{ status: "active" }, { status: "inactive" }, { status: null }];

    const stats = computeColumnStats(fields, rawRows).status;

    expect(stats?.nullRate).toBeCloseTo(1 / 3);
    expect(stats?.distinctCount).toBe(2);
    expect(stats?.distinctCountCapped).toBe(false);
    expect(stats?.exampleValues).toEqual(expect.arrayContaining(["active", "inactive"]));
  });

  it("reports no min/max/mean and nullRate 0 for a numeric-declared column whose values are all unparseable strings", () => {
    const fields = [structuredField("amount", "float")];
    const rawRows = [{ amount: "n/a" }, { amount: "n/a" }];

    const stats = computeColumnStats(fields, rawRows).amount;

    expect(stats?.min).toBeUndefined();
    expect(stats?.max).toBeUndefined();
    expect(stats?.mean).toBeUndefined();
    expect(stats?.nullRate).toBe(0);
  });

  it("computes min/max/mean for a numeric-declared column whose values are string-encoded numbers (CSV case)", () => {
    const fields = [structuredField("amount", "integer")];
    const rawRows = [{ amount: "10" }, { amount: "20" }];

    const stats = computeColumnStats(fields, rawRows).amount;

    expect(stats?.min).toBe(10);
    expect(stats?.max).toBe(20);
    expect(stats?.mean).toBe(15);
  });

  // ── HEL-373 skeptic-final-1.md: "NaN"/"Infinity" string literals must be
  //    treated as unparseable garbage, not as successfully-parsed non-finite
  //    numbers (which would otherwise poison numericMax/mean to Infinity,
  //    then silently serialize to null via JSON.stringify) ─────────────────

  it('excludes a literal "NaN" string cell from min/max/mean like any other unparseable string', () => {
    const fields = [structuredField("amount", "float")];
    const rawRows = [{ amount: "10" }, { amount: "20" }, { amount: "NaN" }];

    const stats = computeColumnStats(fields, rawRows).amount;

    expect(stats?.min).toBe(10);
    expect(stats?.max).toBe(20);
    expect(stats?.mean).toBe(15);
  });

  it('excludes literal "Infinity"/"-Infinity" string cells from min/max/mean like any other unparseable string', () => {
    const fields = [structuredField("amount", "integer")];
    const rawRows = [
      ...Array.from({ length: 10 }, (_, i) => ({ amount: String(i + 1) })),
      { amount: "Infinity" },
      { amount: "-Infinity" },
    ];

    const stats = computeColumnStats(fields, rawRows).amount;

    expect(stats?.min).toBe(1);
    expect(stats?.max).toBe(10);
    expect(stats?.mean).toBe(5.5);
  });

  // ── HEL-373 skeptic-final-2.md: a genuine native-number Infinity (e.g. from
  //    JSON.parse("1e400"), exactly what the HTTP response layer produces for
  //    an overflowing numeric literal) must be excluded from min/max/mean
  //    exactly like an unparseable string — the round-1 fix only patched the
  //    typeof "string" branch; this is the sibling typeof "number" branch
  //    instance of the SAME bug class, now closed by asNumeric's single
  //    exit-point finiteness filter ─────────────────────────────────────────

  it('excludes a native-number Infinity cell (e.g. from JSON.parse("1e400")) from min/max/mean', () => {
    const fields = [structuredField("amount", "float")];
    const rawRows = [{ amount: 10 }, { amount: 20 }, { amount: JSON.parse("1e400") as number }];

    const stats = computeColumnStats(fields, rawRows).amount;

    expect(stats?.min).toBe(10);
    expect(stats?.max).toBe(20);
    expect(stats?.mean).toBe(15);
  });

  // ── HEL-373 skeptic-final-3.md: the ACCUMULATED numericSum can overflow to
  //    +-Infinity even though every individual value fed into it is
  //    legitimately finite (post-asNumeric, already airtight per rounds
  //    1-2) — a different location than asNumeric's own gap, closed by a
  //    finiteness guard at the ColumnStats construction site covering
  //    min/max/mean together ──────────────────────────────────────────────

  it(
    "excludes a fabricated mean when the accumulated sum overflows, while min/max stay correct " +
      "(two individually-finite 1e308 values)",
    () => {
      const fields = [structuredField("amount", "float")];
      const rawRows = [{ amount: 1e308 }, { amount: 1e308 }];

      const stats = computeColumnStats(fields, rawRows).amount;

      expect(stats?.min).toBe(1e308);
      expect(stats?.max).toBe(1e308);
      expect(stats?.mean).toBeUndefined();
    },
  );

  // Here the running SUM itself stays finite (499 small addends are
  // negligible next to a single ~1.7e308 outlier) — the true mean IS
  // computable and finite (~3.4e305). The naive Math.round(mean * 10000)
  // technique's OWN multiply step would overflow at this magnitude,
  // fabricating the same wrong ~922-trillion-style value the whole arc has
  // been about eliminating even though the true mean is legitimately huge
  // but finite. The fix must report the genuinely correct huge mean here,
  // not undefined — undefined would be swallowing valid information.
  it(
    "reports a genuinely correct (if very large) mean — not a fabricated value — when a single " +
      "near-Number.MAX_VALUE outlier is averaged with 499 otherwise-ordinary rows",
    () => {
      const fields = [structuredField("amount", "float")];
      const ordinaryRows = Array.from({ length: 499 }, (_, i) => ({ amount: i + 1 }));
      const rawRows = [...ordinaryRows, { amount: 1.7e308 }];

      const stats = computeColumnStats(fields, rawRows).amount;

      expect(stats?.min).toBe(1);
      expect(stats?.max).toBe(1.7e308);
      expect(stats?.mean).toBeDefined();
      expect(Number.isFinite(stats?.mean)).toBe(true);
      // Genuinely huge (the mathematically correct order of magnitude given
      // the outlier), NOT a fabricated small-ish value.
      expect(stats?.mean).toBeGreaterThan(1e300);
    },
  );

  it("reports nullRate 1, distinctCount 0, and no min/max for an all-null column", () => {
    const fields = [structuredField("notes")];
    const rawRows = [{ notes: null }, {}];

    const stats = computeColumnStats(fields, rawRows).notes;

    expect(stats?.nullRate).toBe(1);
    expect(stats?.distinctCount).toBe(0);
    expect(stats?.exampleValues).toEqual([]);
    expect(stats?.min).toBeUndefined();
  });

  it("produces a non-empty per-column entry with nullRate 0 / distinctCount 0 for an empty row array", () => {
    const fields = [structuredField("id"), structuredField("amount", "float")];

    const stats = computeColumnStats(fields, []);

    expect(Object.keys(stats)).toEqual(["id", "amount"]);
    expect(stats.id?.nullRate).toBe(0);
    expect(stats.id?.distinctCount).toBe(0);
    expect(stats.amount?.min).toBeUndefined();
  });

  it("caps columnStats columns at the first 40 declared Structured fields, in field order", () => {
    const fields = Array.from({ length: 45 }, (_, i) => structuredField(`col${i}`));
    const rawRow = Object.fromEntries(fields.map((f) => [f.name, f.name]));

    const stats = computeColumnStats(fields, [rawRow]);

    expect(Object.keys(stats)).toHaveLength(40);
    expect(stats).toHaveProperty("col0");
    expect(stats).toHaveProperty("col39");
    expect(stats).not.toHaveProperty("col40");
  });

  it("reports distinctCountCapped true and distinctCount equal to the cap for a high-cardinality column", () => {
    const fields = [structuredField("id")];
    const rawRows = Array.from({ length: 150 }, (_, i) => ({ id: `id-${i}` }));

    const stats = computeColumnStats(fields, rawRows).id;

    expect(stats?.distinctCountCapped).toBe(true);
    expect(stats?.distinctCount).toBe(100);
  });

  it("has no entry for a Content-category field", () => {
    const fields = [structuredField("title"), structuredField("body", "string-body")];
    const rawRow = { title: "doc", body: "x".repeat(500) };

    const stats = computeColumnStats(fields, [rawRow]);

    expect(Object.keys(stats)).toEqual(["title"]);
  });

  it("produces identical output across repeated calls over the same input (determinism)", () => {
    const fields = [structuredField("amount", "float"), structuredField("status")];
    const rawRows = [
      { amount: 3, status: "b" },
      { amount: 1, status: "a" },
      { amount: 2, status: "a" },
    ];

    const first = computeColumnStats(fields, rawRows);
    const second = computeColumnStats(fields, rawRows);

    expect(first).toEqual(second);
  });
});

/**
 * HEL-373 skeptic-final-2.md's binding requirement 3: "exhaustive
 * table-driven tests over `asNumeric`'s entire input space, both sides — not
 * one case bolted on." Every case below pins the exact expected
 * `number | undefined` for one representative of each input class
 * `asNumeric` can ever see — mirrors the Scala side's table exactly.
 */
describe("asNumeric", () => {
  const cases: Array<[string, unknown, number | undefined]> = [
    ["a finite number", 42, 42],
    [
      'a number that overflows to +Infinity (JSON.parse("1e400"))',
      JSON.parse("1e400") as number,
      undefined,
    ],
    [
      'a number that overflows to -Infinity (JSON.parse("-1e400"))',
      JSON.parse("-1e400") as number,
      undefined,
    ],
    ['the literal "NaN" string', "NaN", undefined],
    ['the literal "Infinity" string', "Infinity", undefined],
    ['the literal "-Infinity" string', "-Infinity", undefined],
    ["a valid numeric string", "42", 42],
    ["a valid numeric string with surrounding whitespace", "  10.5  ", 10.5],
    ["an empty string", "", undefined],
    ["a whitespace-only string", "   ", undefined],
    ["a non-numeric string", "n/a", undefined],
    ["a boolean", true, undefined],
    ["an object", { k: "v" }, undefined],
    ["an array", [1], undefined],
    ["null", null, undefined],
  ];

  it.each(cases)("returns the expected value for %s", (_description, input, expected) => {
    expect(asNumeric(input)).toBe(expected);
  });
});

describe("buildWorkspaceContext — sampleRows wiring", () => {
  const pipelineOutputType: DataTypeResponse = {
    id: "dt-output",
    name: "Output",
    // sourceId omitted — pipeline-output (panel-bindable) per the
    // spray-json-omits-None convention this file's own inline comment
    // documents.
    fields: [
      { name: "name", displayName: "Name", dataType: "string", nullable: false },
      { name: "wide", displayName: "Wide", dataType: "integer", nullable: false },
      { name: "body", displayName: "Body", dataType: "string-body", nullable: true },
    ],
    computedFields: [],
    version: 1,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  };

  const companionType: DataTypeResponse = {
    id: "dt-companion",
    name: "Companion",
    sourceId: "src-1",
    fields: [{ name: "value", displayName: "Value", dataType: "string", nullable: false }],
    computedFields: [],
    version: 1,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  };

  function makeFakeApi(): { api: HelioApi; getDataTypeRowsCalls: string[] } {
    const getDataTypeRowsCalls: string[] = [];
    const wideValue = Array.from({ length: 150 }, () => 7);
    const rawRows = [
      // A backend that (hypothetically) failed to strip the Content field
      // despite excludeContentFields=true — the TS sanitizer must still
      // exclude "body" itself, as defense-in-depth (mirrors design.md D3's
      // Scala-side defense-in-depth framing).
      { name: "row-0", wide: wideValue, body: "z".repeat(400) },
      { name: "row-1", wide: 1 },
      { name: "row-2", wide: 2 },
      { name: "row-3", wide: 3 },
      { name: "row-4", wide: 4 },
      { name: "row-5", wide: 5 },
      { name: "row-6", wide: 6 },
    ];

    const fake = {
      listDataSources: async () => ({ items: [], total: 0, offset: 0, limit: 200 }),
      listDataTypes: async () => ({
        items: [pipelineOutputType, companionType],
        total: 2,
        offset: 0,
        limit: 200,
      }),
      listDashboards: async () => ({ items: [], total: 0, offset: 0, limit: 200 }),
      listPipelines: async () => [],
      listPipelineShapes: async () => [],
      getDataTypeRows: async (
        dataTypeId: string,
        limit?: number,
        excludeContentFields?: boolean,
        maxStructuredColumns?: number,
      ) => {
        getDataTypeRowsCalls.push(dataTypeId);
        // HEL-373: ONE shared fetch, STATS_ROW_LIMIT (500) / maxStructuredColumns
        // (40) — not the old sample-only limit — feeds BOTH sanitizeSampleRows
        // and computeColumnStats.
        expect(limit).toBe(500);
        expect(excludeContentFields).toBe(true);
        expect(maxStructuredColumns).toBe(40);
        // The real endpoint would already respect `limit` — returning MORE
        // than 5 here deliberately exercises sanitizeSampleRows's own
        // defense-in-depth row cap through the full buildWorkspaceContext path.
        return { rows: rawRows, rowCount: rawRows.length };
      },
    };

    return { api: fake as unknown as HelioApi, getDataTypeRowsCalls };
  }

  it("populates sampleRows for a pipeline-output DataType, truncated per the row/column/cell caps", async () => {
    const { api } = makeFakeApi();

    const context = await buildWorkspaceContext(api);
    const entry = context.dataTypes.find((t) => t.id === "dt-output");
    if (!entry) throw new Error("dt-output entry missing");

    expect(entry.pipelineOutput).toBe(true);
    expect(entry.sampleRows).toHaveLength(5); // row cap, even though the fake returned 7
    const row = firstRow(entry.sampleRows);
    expect(row.name).toBe("row-0");
    expect(row).not.toHaveProperty("body"); // Content field excluded, defense-in-depth
    expect(typeof row.wide).toBe("string"); // oversized non-string cell truncated
    expect(row.wide).toContain("…[truncated]");
  });

  it("populates columnStats for a pipeline-output DataType from the SAME fetch as sampleRows, called exactly once", async () => {
    const { api, getDataTypeRowsCalls } = makeFakeApi();

    const context = await buildWorkspaceContext(api);
    const entry = context.dataTypes.find((t) => t.id === "dt-output");
    if (!entry) throw new Error("dt-output entry missing");

    expect(entry.columnStats.name).toBeDefined();
    expect(entry.columnStats.wide).toBeDefined();
    expect(entry.columnStats.body).toBeUndefined(); // Content field excluded
    // wide is declared "integer" and rows 1-6 hold plain numbers 1..6 (row-0's
    // oversized array is excluded from the numeric fold — not a number).
    expect(entry.columnStats.wide?.min).toBe(1);
    expect(entry.columnStats.wide?.max).toBe(6);
    expect(getDataTypeRowsCalls).toEqual(["dt-output"]); // exactly once, not twice
  });

  it("reports [] / {} for a source-companion DataType, and never calls getDataTypeRows for it", async () => {
    const { api, getDataTypeRowsCalls } = makeFakeApi();

    const context = await buildWorkspaceContext(api);
    const entry = context.dataTypes.find((t) => t.id === "dt-companion");
    if (!entry) throw new Error("dt-companion entry missing");

    expect(entry.pipelineOutput).toBe(false);
    expect(entry.sampleRows).toEqual([]);
    expect(entry.columnStats).toEqual({});
    expect(getDataTypeRowsCalls).toEqual(["dt-output"]); // never called for the companion
  });
});
