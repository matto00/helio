import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import Ajv2020 from "ajv/dist/2020";

import { Integral } from "../pipelines/evaluator/value";
import { decodeRow } from "../pipelines/evaluator/wire";
import type { SourceSample } from "./types/dataSource";

// HEL-1628 (standing constraint C1), client half of the sample wire seam. The fixtures are NOT hand-built: the
// backend spec SourceSampleSeamSpec asserts they equal what the real production serializer emits, and fails if
// they drift. Here the same files are validated with Ajv against the committed schema and run through the
// evaluator's wire decoder.

const root = resolve(__dirname, "../../../..");
const read = (p: string) => JSON.parse(readFileSync(resolve(root, p), "utf8"));

const schema = read("schemas/sources/source-sample-response.schema.json");
const validate = new Ajv2020({ allErrors: true, validateFormats: false }).compile(schema);
const errors = (v: unknown): string[] => {
  validate(v);
  return (validate.errors ?? []).map((e) => `${e.instancePath} ${e.message}`);
};

const exact = read(
  "shared-test-fixtures/source-sample/source-sample-response.json",
) as SourceSample;
const unknownTotal = read(
  "shared-test-fixtures/source-sample/source-sample-response-unknown-total.json",
) as SourceSample;

describe("source sample response contract (schemas/sources/source-sample-response.schema.json)", () => {
  it("accepts the serializer's exact and unknown-total bodies", () => {
    expect(errors(exact)).toEqual([]);
    expect(errors(unknownTotal)).toEqual([]);
    expect(unknownTotal.sourceRowCount).toBeNull();
  });

  it("decodes Int/Long cells to Integral of the right kind and plain numbers to number", () => {
    const row = decodeRow(exact.rows[0]);
    expect(row.i).toBeInstanceOf(Integral);
    expect((row.i as Integral).kind).toBe("int");
    expect(row.big).toBeInstanceOf(Integral);
    expect((row.big as Integral).kind).toBe("long");
    expect(row.d).toBe(1.5);
    expect(typeof row.d).toBe("number");
    expect(row.nan).toBeNaN();
    expect(row.z).toBeNull();
    expect(row.s).toBe("alpha");
    const second = decodeRow(exact.rows[1]);
    expect(Object.is(second.d, -0)).toBe(true);
    expect(second.nan).toBe(-Infinity);
  });

  it("rejects a response missing capturedAt, omitting sourceRowCount, or with a malformed cell", () => {
    const { capturedAt: _c, ...noCaptured } = exact;
    const { sourceRowCount: _n, ...noCount } = exact;
    expect(errors(noCaptured)).not.toEqual([]);
    expect(errors(noCount)).not.toEqual([]);
    const withCell = (cell: unknown) => ({ ...exact, rows: [{ c: cell }] });
    expect(errors(withCell({ $int: 1.5 }))).not.toEqual([]);
    expect(errors(withCell({ $long: 5 }))).not.toEqual([]);
    expect(errors(withCell({ $double: "bogus" }))).not.toEqual([]);
    expect(errors(withCell({ nested: "map" }))).not.toEqual([]);
  });
});
