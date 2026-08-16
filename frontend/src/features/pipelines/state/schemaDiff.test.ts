// schemaDiff.test.ts — HEL-405: pure-function coverage for computeSchemaDiff.
// Cases per design.md Decision 5 / tasks.md 3.1.

import { computeSchemaDiff } from "./schemaDiff";
import type { SchemaField } from "../types/pipelineStep";

describe("computeSchemaDiff", () => {
  it("classifies added, dropped, and retyped columns (spec scenario 1)", () => {
    const input: SchemaField[] = [
      { name: "a", type: "string" },
      { name: "b", type: "number" },
      { name: "c", type: "string" },
    ];
    const output: SchemaField[] = [
      { name: "a", type: "string" },
      { name: "c", type: "number" },
      { name: "d", type: "string" },
    ];

    const diff = computeSchemaDiff(input, output);

    expect(diff.added).toEqual([{ name: "d", type: "string" }]);
    expect(diff.dropped).toEqual([{ name: "b", type: "number" }]);
    expect(diff.retyped).toEqual([{ name: "c", fromType: "string", toType: "number" }]);
    expect(diff.renamed).toEqual([]);
  });

  it("reports only added columns when the output strictly extends the input", () => {
    const input: SchemaField[] = [{ name: "a", type: "string" }];
    const output: SchemaField[] = [
      { name: "a", type: "string" },
      { name: "b", type: "number" },
    ];

    const diff = computeSchemaDiff(input, output);

    expect(diff.added).toEqual([{ name: "b", type: "number" }]);
    expect(diff.dropped).toEqual([]);
    expect(diff.retyped).toEqual([]);
    expect(diff.renamed).toEqual([]);
  });

  it("reports only dropped columns when the output strictly narrows the input", () => {
    const input: SchemaField[] = [
      { name: "a", type: "string" },
      { name: "b", type: "number" },
    ];
    const output: SchemaField[] = [{ name: "a", type: "string" }];

    const diff = computeSchemaDiff(input, output);

    expect(diff.added).toEqual([]);
    expect(diff.dropped).toEqual([{ name: "b", type: "number" }]);
    expect(diff.retyped).toEqual([]);
    expect(diff.renamed).toEqual([]);
  });

  it("pairs a rename op's config entry as a rename, not an add+drop (spec scenario 2)", () => {
    const input: SchemaField[] = [
      { name: "a", type: "string" },
      { name: "b", type: "number" },
    ];
    const output: SchemaField[] = [
      { name: "a", type: "string" },
      { name: "b2", type: "number" },
    ];

    const diff = computeSchemaDiff(input, output, { b: "b2" });

    expect(diff.renamed).toEqual([{ from: "b", to: "b2", type: "number" }]);
    expect(diff.added).toEqual([]);
    expect(diff.dropped).toEqual([]);
  });

  it("leaves an unpaired rename entry as add/drop when the schemas don't back it up", () => {
    const input: SchemaField[] = [{ name: "a", type: "string" }];
    const output: SchemaField[] = [{ name: "c", type: "string" }];

    // "b" (from) isn't in the input, and "b2" (to) isn't in the output — the
    // rename map entry can't be confirmed against the actual schemas.
    const diff = computeSchemaDiff(input, output, { b: "b2" });

    expect(diff.renamed).toEqual([]);
    expect(diff.added).toEqual([{ name: "c", type: "string" }]);
    expect(diff.dropped).toEqual([{ name: "a", type: "string" }]);
  });

  it("non-rename callers (no renames map) never report renames (spec scenario 3)", () => {
    const input: SchemaField[] = [{ name: "b", type: "string" }];
    const output: SchemaField[] = [{ name: "b2", type: "string" }];

    const diff = computeSchemaDiff(input, output);

    expect(diff.dropped).toEqual([{ name: "b", type: "string" }]);
    expect(diff.added).toEqual([{ name: "b2", type: "string" }]);
    expect(diff.renamed).toEqual([]);
  });

  it("pairs a rename even when the renamed column's type also changed (type taken from output side)", () => {
    const input: SchemaField[] = [{ name: "b", type: "string" }];
    const output: SchemaField[] = [{ name: "b2", type: "number" }];

    const diff = computeSchemaDiff(input, output, { b: "b2" });

    expect(diff.renamed).toEqual([{ from: "b", to: "b2", type: "number" }]);
    expect(diff.added).toEqual([]);
    expect(diff.dropped).toEqual([]);
    expect(diff.retyped).toEqual([]);
  });

  it("produces an empty diff for identical schemas (spec scenario 4 — includes the validationError identity fallback)", () => {
    const schema: SchemaField[] = [
      { name: "a", type: "string" },
      { name: "b", type: "number" },
    ];

    const diff = computeSchemaDiff(schema, schema, { x: "y" });

    expect(diff).toEqual({ added: [], dropped: [], renamed: [], retyped: [] });
  });

  it("produces an empty diff for empty input/output arrays", () => {
    expect(computeSchemaDiff([], [])).toEqual({
      added: [],
      dropped: [],
      renamed: [],
      retyped: [],
    });
  });
});
