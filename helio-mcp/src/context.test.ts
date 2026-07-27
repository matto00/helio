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
  classifySemanticRole,
  computeColumnStats,
  computeJoinHints,
  normalizedNameTokens,
  sanitizeSampleRows,
  type ColumnStats,
  type SemanticRole,
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
      // HEL-373 skeptic-final-4.md requirement 4: assert the EXACT expected
      // value (independently confirmed via a direct probe: `(1+2+...+499 +
      // 1.7e308) / 500 === 3.3999999999999998e+305` in plain JS arithmetic —
      // matching the Scala side's own independently-computed result exactly),
      // not just a magnitude bound — closes the test-strength gap the round-4
      // skeptic flagged relative to the Scala sibling test.
      expect(stats?.mean).toBe(3.3999999999999998e305);
    },
  );

  // ── HEL-373 skeptic-final-4.md: cross-language rounding tie-break
  //    convention must be identical. Round 4 switched the Scala side's
  //    rounding technique to BigDecimal.setScale(4, HALF_UP) ("round half
  //    AWAY FROM ZERO") but left the TS side on Math.round ("round half
  //    TOWARD +Infinity") — the two conventions disagree ONLY at an exact
  //    binary tie at the 4th decimal place. A mean of exactly -0.00005 is the
  //    skeptic's own reproduction case: HALF_UP rounds to -0.0001;
  //    Math.round's own tie-break rounds to -0/0. This pins the now-fixed TS
  //    side to the SAME expected value the Scala side already produces
  //    (mirrored in WorkspaceContextServiceComputeColumnStatsSpec.scala) —
  //    the actual mechanical determinism check design.md D5/D6 promises, not
  //    just prose. ────────────────────────────────────────────────────────

  it(
    "rounds an exact -0.00005 mean tie AWAY FROM ZERO (to -0.0001), matching the Scala side's " +
      "HALF_UP tie-break convention",
    () => {
      const fields = [structuredField("amount", "float")];
      const rawRows = [{ amount: -0.00005 }];

      const stats = computeColumnStats(fields, rawRows).amount;

      expect(stats?.mean).toBe(-0.0001);
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

/**
 * HEL-374 tasks.md 5.3 — MCP-side unit tests for `classifySemanticRole`/
 * `normalizedNameTokens`, mirroring `WorkspaceContextServiceClassifySemanticRoleSpec`
 * (Scala) case-for-case. INDEPENDENT TypeScript implementation of the
 * identical 8-step precedence the Scala side enforces (design.md D1) — no
 * shared runtime, so parity is achieved by duplicating the rules and testing
 * each side separately.
 */
describe("normalizedNameTokens", () => {
  it("splits snake_case names on underscore", () => {
    expect(normalizedNameTokens("user_id")).toEqual(["user", "id"]);
  });

  it("inserts a boundary before an uppercase letter following a lowercase/digit (camelCase)", () => {
    expect(normalizedNameTokens("userId")).toEqual(["user", "id"]);
    expect(normalizedNameTokens("createdAt")).toEqual(["created", "at"]);
  });

  it("collapses a run of uppercase letters preceded by lowercase into one boundary (UserID)", () => {
    expect(normalizedNameTokens("UserID")).toEqual(["user", "id"]);
  });

  it("produces a single token for a name with no boundary", () => {
    expect(normalizedNameTokens("guidance")).toEqual(["guidance"]);
  });
});

describe("classifySemanticRole", () => {
  const field = (name: string, dataType: string) => ({ name, dataType });

  const emptyStats = (overrides: Partial<ColumnStats> = {}): ColumnStats => ({
    nullRate: 0,
    distinctCount: 0,
    distinctCountCapped: false,
    exampleValues: [],
    ...overrides,
  });

  // ── HEL-374 spec.md scenarios ("Deterministic column semantic role") ────

  it("classifies a declared boolean column as boolean", () => {
    expect(classifySemanticRole(field("is_active", "boolean"), undefined)).toBe("boolean");
  });

  it("classifies a declared timestamp column as temporal", () => {
    expect(classifySemanticRole(field("created_at", "timestamp"), undefined)).toBe("temporal");
  });

  it("classifies a string column with a date-like name as temporal", () => {
    expect(classifySemanticRole(field("signup_date", "string"), undefined)).toBe("temporal");
  });

  it(
    "classifies an id-named column as identifier regardless of declared type, even with " +
      "high-cardinality stats exceeding the distinct-count cap",
    () => {
      const stats = emptyStats({ distinctCount: 100, distinctCountCapped: true });
      expect(classifySemanticRole(field("user_id", "integer"), stats)).toBe("identifier");
    },
  );

  it("classifies a numeric non-id column as measure", () => {
    expect(classifySemanticRole(field("amount", "float"), undefined)).toBe("measure");
  });

  it("classifies a low-cardinality string column as dimension", () => {
    const stats = emptyStats({ distinctCount: 2 });
    expect(classifySemanticRole(field("status", "string"), stats)).toBe("dimension");
  });

  it("classifies a Content-category column as text without inspecting stats", () => {
    expect(classifySemanticRole(field("notes", "string-body"), undefined)).toBe("text");
  });

  // ── design-gate round-1 finding: token-exact, not substring, matching ───

  it("does not classify validated/paid/avoid as identifier (no _id/uuid/guid token)", () => {
    expect(classifySemanticRole(field("validated", "string"), undefined)).not.toBe("identifier");
    expect(classifySemanticRole(field("paid", "string"), undefined)).not.toBe("identifier");
    expect(classifySemanticRole(field("avoid", "string"), undefined)).not.toBe("identifier");
  });

  it("does not classify estimated as temporal (no date/time/timestamp/dob token, no trailing _at)", () => {
    expect(classifySemanticRole(field("estimated", "string"), undefined)).not.toBe("temporal");
  });

  it("does not classify guidance/guideline/misguided as identifier (guid is a substring, not a whole token)", () => {
    expect(classifySemanticRole(field("guidance", "string"), undefined)).not.toBe("identifier");
    expect(classifySemanticRole(field("guideline", "string"), undefined)).not.toBe("identifier");
    expect(classifySemanticRole(field("misguided", "string"), undefined)).not.toBe("identifier");
  });

  it("still classifies a genuinely _guid-suffixed camelCase name as identifier", () => {
    expect(classifySemanticRole(field("extGuid", "string"), undefined)).toBe("identifier");
  });

  it("classifies a bare id/uuid/guid-named column as identifier", () => {
    expect(classifySemanticRole(field("id", "string"), undefined)).toBe("identifier");
    expect(classifySemanticRole(field("external_uuid", "string"), undefined)).toBe("identifier");
  });

  // ── remaining precedence branches ────────────────────────────────────────

  it("classifies a string column with no stats as text, not dimension", () => {
    expect(classifySemanticRole(field("status", "string"), undefined)).toBe("text");
  });

  it(
    "classifies a string column with distinctCount 0 as text, not dimension " +
      "(the all-empty-snapshot case must not read as confirmed low cardinality)",
    () => {
      expect(
        classifySemanticRole(field("status", "string"), emptyStats({ distinctCount: 0 })),
      ).toBe("text");
    },
  );

  it("classifies a string column with distinctCountCapped true as text even when distinctCount <= threshold", () => {
    const stats = emptyStats({ distinctCount: 5, distinctCountCapped: true });
    expect(classifySemanticRole(field("status", "string"), stats)).toBe("text");
  });

  it("classifies a string column whose distinctCount exceeds the dimension threshold (50) as text", () => {
    const stats = emptyStats({ distinctCount: 51 });
    expect(classifySemanticRole(field("status", "string"), stats)).toBe("text");
  });

  it("classifies an unparseable declared dataType as text", () => {
    expect(classifySemanticRole(field("mystery", "not-a-real-type"), undefined)).toBe("text");
  });
});

/**
 * HEL-374 tasks.md 5.3 — MCP-side unit tests for `computeJoinHints`, mirroring
 * `WorkspaceContextServiceComputeJoinHintsSpec` (Scala) case-for-case.
 */
describe("computeJoinHints", () => {
  interface Col {
    name: string;
    dataType: string;
    semanticRole: SemanticRole;
  }
  interface DT {
    id: string;
    columns: Col[];
    columnStats: Record<string, ColumnStats>;
  }

  function identifierColumn(
    name: string,
    dataType: string,
    distinctCount: number,
    exampleValues: unknown[],
    distinctCountCapped = false,
  ): [Col, ColumnStats] {
    return [
      { name, dataType, semanticRole: "identifier" },
      { nullRate: 0, distinctCount, distinctCountCapped, exampleValues },
    ];
  }

  function dataTypeEntry(
    id: string,
    columns: Array<[Col, ColumnStats]>,
    columnStatsLimit = Infinity,
  ): DT {
    const columnStats: Record<string, ColumnStats> = {};
    columns.slice(0, columnStatsLimit).forEach(([c, s]) => {
      columnStats[c.name] = s;
    });
    return { id, columns: columns.map(([c]) => c), columnStats };
  }

  it("produces a hint with confidence > 0.5 for a matching identifier column pair with partial overlap", () => {
    const a = dataTypeEntry("dt-a", [identifierColumn("customer_id", "integer", 20, [1, 2, 3])]);
    const b = dataTypeEntry("dt-b", [identifierColumn("customer_id", "integer", 20, [2, 3, 4])]);

    const hints = computeJoinHints([a, b]);

    expect(hints).toHaveLength(1);
    expect(hints[0]?.leftColumn).toBe("customer_id");
    expect(hints[0]?.rightColumn).toBe("customer_id");
    expect(hints[0]?.confidence).toBeGreaterThan(0.5);
  });

  it("produces no hint for a matching non-identifier column pair (measure), even with identical values", () => {
    const measureCol = (name: string): [Col, ColumnStats] => [
      { name, dataType: "float", semanticRole: "measure" },
      { nullRate: 0, distinctCount: 20, distinctCountCapped: false, exampleValues: ["x"] },
    ];
    const a = dataTypeEntry("dt-a", [measureCol("amount")]);
    const b = dataTypeEntry("dt-b", [measureCol("amount")]);

    expect(computeJoinHints([a, b])).toEqual([]);
  });

  it("never pairs a column against itself within the same DataType", () => {
    const a = dataTypeEntry("dt-a", [
      identifierColumn("customer_id", "integer", 20, [1]),
      identifierColumn("customer_id2", "integer", 20, [1]),
    ]);

    expect(computeJoinHints([a])).toEqual([]);
  });

  it("only compares columns whose declared-type buckets match (skip a string id vs. an integer id)", () => {
    const a = dataTypeEntry("dt-a", [identifierColumn("order_id", "string", 20, ["1"])]);
    const b = dataTypeEntry("dt-b", [identifierColumn("order_id", "integer", 20, [1])]);

    expect(computeJoinHints([a, b])).toEqual([]);
  });

  it("yields confidence exactly 0.5, not a fabricated NaN, for two all-null identifier columns", () => {
    const a = dataTypeEntry("dt-a", [identifierColumn("user_id", "integer", 0, [])]);
    const b = dataTypeEntry("dt-b", [identifierColumn("user_id", "integer", 0, [])]);

    const hints = computeJoinHints([a, b]);

    expect(hints).toHaveLength(1);
    expect(hints[0]?.confidence).toBe(0.5);
    expect(Number.isNaN(hints[0]?.confidence)).toBe(false);
  });

  // ── confidence damping (post-design-gate human-review fix, design.md D2's
  //    evidenceWeight — REQUIRED per the ticket's addendum) ────────────────

  it(
    "does NOT let two unrelated low-cardinality identifier columns sharing an identical small " +
      "example-value set read as near-certain",
    () => {
      const sharedValues = ["1", "2", "3", "4", "5"];
      const a = dataTypeEntry("dt-low-a", [identifierColumn("id", "string", 5, sharedValues)]);
      const b = dataTypeEntry("dt-low-b", [identifierColumn("id", "string", 5, sharedValues)]);

      const hints = computeJoinHints([a, b]);

      expect(hints).toHaveLength(1);
      expect(hints[0]?.confidence).toBeLessThanOrEqual(0.65);
    },
  );

  it(
    "allows a well-evidenced (distinctCount >= MinDistinctForFullConfidence) full-overlap pair to reach " +
      "a high confidence — proving the damping targets low cardinality specifically, not overlap itself",
    () => {
      const sharedValues = ["1", "2", "3", "4", "5"];
      const a = dataTypeEntry("dt-high-a", [identifierColumn("id", "string", 20, sharedValues)]);
      const b = dataTypeEntry("dt-high-b", [identifierColumn("id", "string", 20, sharedValues)]);

      const hints = computeJoinHints([a, b]);

      expect(hints).toHaveLength(1);
      expect(hints[0]?.confidence).toBe(1.0);
    },
  );

  // ── design-gate round-1 finding: candidate gathering MUST be bounded via
  //    columnStats membership, not the unbounded columns list alone ────────

  it(
    "draws at most SAMPLE_COLUMN_LIMIT (40) identifier candidates from a DataType declaring more " +
      "than that, via the columnStats-membership restriction",
    () => {
      const wideColumns: Array<[Col, ColumnStats]> = Array.from({ length: 45 }, (_, i) =>
        identifierColumn(`id${i}`, "string", 20, ["x"]),
      );
      const wide = dataTypeEntry("wide-dt", wideColumns, 40);

      const overflowMatch = dataTypeEntry("overflow-dt", [
        identifierColumn("id40", "string", 20, ["x"]),
      ]);
      const withinCapMatch = dataTypeEntry("within-cap-dt", [
        identifierColumn("id0", "string", 20, ["x"]),
      ]);

      const hints = computeJoinHints([wide, overflowMatch, withinCapMatch]);

      expect(hints.some((h) => h.leftColumn === "id40" || h.rightColumn === "id40")).toBe(false);
      expect(hints.some((h) => h.leftColumn === "id0" || h.rightColumn === "id0")).toBe(true);
    },
  );

  it(
    "contributes zero candidates for a DataType whose columnStats is empty (source-companion case), " +
      "even though its columns array lists an identifier-role column",
    () => {
      const companion = dataTypeEntry(
        "companion-dt",
        [identifierColumn("customer_id", "integer", 20, [1])],
        0,
      );
      const other = dataTypeEntry("other-dt", [
        identifierColumn("customer_id", "integer", 20, [1]),
      ]);

      expect(computeJoinHints([companion, other])).toEqual([]);
    },
  );

  // ── bounding the comparison work (design.md D2) ──────────────────────────

  it(
    "caps a single name-bucket at MAX_COLUMNS_PER_NAME_BUCKET (50) BEFORE pairwise comparison, so a " +
      "higher-confidence candidate past the cap never enters the comparison set",
    () => {
      const pad = (i: number) => String(i).padStart(2, "0");
      const lowConfidenceTypes = Array.from({ length: 50 }, (_, i) =>
        dataTypeEntry(`dt-${pad(i)}`, [identifierColumn("id", "string", 20, [`v${i}`])]),
      );
      const highConfidenceTypesPastCap = Array.from({ length: 5 }, (_, i) =>
        dataTypeEntry(`dt-${pad(i + 50)}`, [identifierColumn("id", "string", 20, ["shared"])]),
      );

      const hints = computeJoinHints([...lowConfidenceTypes, ...highConfidenceTypesPastCap]);

      for (const h of hints) {
        expect(h.leftDataTypeId < "dt-50").toBe(true);
        expect(h.rightDataTypeId < "dt-50").toBe(true);
      }
    },
  );

  it("truncates total output to MAX_JOIN_HINTS (50) even when more qualifying pairs exist across many buckets", () => {
    const pad = (i: number) => String(i).padStart(2, "0");
    const types = Array.from({ length: 60 }, (_, i) => {
      const name = `key${i}`;
      return [
        dataTypeEntry(`dt-${pad(i)}-a`, [identifierColumn(name, "string", 20, ["x"])]),
        dataTypeEntry(`dt-${pad(i)}-b`, [identifierColumn(name, "string", 20, ["x"])]),
      ];
    }).flat();

    expect(computeJoinHints(types)).toHaveLength(50);
  });

  // ── canonical (left, right) assignment ───────────────────────────────────

  it("always assigns the lexicographically smaller dataTypeId as left, regardless of input order", () => {
    const a = dataTypeEntry("dt-z", [identifierColumn("order_id", "integer", 20, [1])]);
    const b = dataTypeEntry("dt-a", [identifierColumn("order_id", "integer", 20, [1])]);

    const hints = computeJoinHints([a, b]);

    expect(hints).toHaveLength(1);
    expect(hints[0]?.leftDataTypeId).toBe("dt-a");
    expect(hints[0]?.rightDataTypeId).toBe("dt-z");
  });
});

/**
 * HEL-374 tasks.md 5.3 — shared cross-language regression fixture: the SAME
 * input, asserted to produce the SAME `semanticRole`/`confidence` output on
 * both sides (mirrored in WorkspaceContextServiceSpec's "HEL-374 6.1/6.2"
 * DB-backed integration tests and the pure-unit specs above) — one
 * non-trivial case per role, plus one join-hint case, per carried finding #4
 * (cross-language parity is a hard requirement, tested on both sides).
 */
describe("cross-language parity fixture (HEL-374 tasks.md 5.3)", () => {
  it("agrees with the Scala side on semanticRole for one representative column per role", () => {
    const lowCardStats: ColumnStats = {
      nullRate: 0,
      distinctCount: 2,
      distinctCountCapped: false,
      exampleValues: ["active", "inactive"],
    };
    expect(classifySemanticRole({ name: "is_active", dataType: "boolean" }, undefined)).toBe(
      "boolean",
    );
    expect(classifySemanticRole({ name: "created_at", dataType: "timestamp" }, undefined)).toBe(
      "temporal",
    );
    expect(classifySemanticRole({ name: "user_id", dataType: "integer" }, undefined)).toBe(
      "identifier",
    );
    expect(classifySemanticRole({ name: "amount", dataType: "float" }, undefined)).toBe("measure");
    expect(classifySemanticRole({ name: "status", dataType: "string" }, lowCardStats)).toBe(
      "dimension",
    );
    expect(classifySemanticRole({ name: "notes", dataType: "string-body" }, undefined)).toBe(
      "text",
    );
  });

  it(
    "agrees with the Scala side on the confidence for a partial-overlap identifier join hint " +
      "(customer_id, [1,2,3] vs [2,3,4], distinctCount 20 both sides -> 0.5 + 0.5*0.5*1 = 0.75)",
    () => {
      const a = {
        id: "dt-a",
        columns: [
          { name: "customer_id", dataType: "integer", semanticRole: "identifier" as SemanticRole },
        ],
        columnStats: {
          customer_id: {
            nullRate: 0,
            distinctCount: 20,
            distinctCountCapped: false,
            exampleValues: [1, 2, 3],
          },
        },
      };
      const b = {
        id: "dt-b",
        columns: [
          { name: "customer_id", dataType: "integer", semanticRole: "identifier" as SemanticRole },
        ],
        columnStats: {
          customer_id: {
            nullRate: 0,
            distinctCount: 20,
            distinctCountCapped: false,
            exampleValues: [2, 3, 4],
          },
        },
      };

      const hints = computeJoinHints([a, b]);

      expect(hints).toHaveLength(1);
      expect(hints[0]?.confidence).toBe(0.75);
    },
  );
});
