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

import { buildWorkspaceContext, sanitizeSampleRows } from "./context.js";
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
      ) => {
        getDataTypeRowsCalls.push(dataTypeId);
        expect(limit).toBe(5);
        expect(excludeContentFields).toBe(true);
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

  it("reports [] for a source-companion DataType, and never calls getDataTypeRows for it", async () => {
    const { api, getDataTypeRowsCalls } = makeFakeApi();

    const context = await buildWorkspaceContext(api);
    const entry = context.dataTypes.find((t) => t.id === "dt-companion");
    if (!entry) throw new Error("dt-companion entry missing");

    expect(entry.pipelineOutput).toBe(false);
    expect(entry.sampleRows).toEqual([]);
    expect(getDataTypeRowsCalls).toEqual(["dt-output"]); // never called for the companion
  });
});
