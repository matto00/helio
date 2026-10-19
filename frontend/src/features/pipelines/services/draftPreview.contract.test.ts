import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import Ajv2020 from "ajv/dist/2020";

import { decodeRow, encodeRow } from "../evaluator/wire";
import type { DraftPreviewLine, DraftPreviewRequest } from "../types/draftPreview";
import { isDraftPreviewLine, readDraftPreviewStream } from "./draftPreviewClient";
import { findExceededCap } from "./draftPreviewCaps";
import { chunkedResponse } from "./draftPreviewTestSupport";

// HEL-1630 task 5.11, the client half of the draft-preview wire seam. The fixtures are NOT hand-built: the backend spec
// DraftPreviewSeamSpec asserts they equal what the real route writes, and fails if they drift. Here the same files are
// validated with Ajv against the committed schemas, run through the type guards and the stream reader, and the guards are
// held to agree with the schema on every negative case.

const root = resolve(__dirname, "../../../../..");
const read = (p: string): string => readFileSync(resolve(root, p), "utf8");
const readJson = (p: string): unknown => JSON.parse(read(p));

const ajv = new Ajv2020({ allErrors: true, validateFormats: false });
const lineSchema = ajv.compile(
  readJson("schemas/pipelines/draft-preview-line.schema.json") as object,
);
const requestSchema = ajv.compile(
  readJson("schemas/pipelines/draft-preview-request.schema.json") as object,
);

const request = readJson(
  "shared-test-fixtures/draft-preview/draft-preview-request.json",
) as DraftPreviewRequest;
const responseText = read("shared-test-fixtures/draft-preview/draft-preview-response.ndjson");
const responseLines = responseText
  .split("\n")
  .filter((l) => l !== "")
  .map((l) => JSON.parse(l) as Record<string, unknown>);
const failedLine = readJson(
  "shared-test-fixtures/draft-preview/draft-preview-failed-line.json",
) as Record<string, unknown>;

describe("draft-preview wire contract (schemas/pipelines/draft-preview-*.schema.json)", () => {
  it("accepts the request fixture, which the cap pre-check also lets through", () => {
    expect(requestSchema(request)).toBe(true);
    expect(findExceededCap(request)).toBeUndefined();
  });

  it("round-trips the fixture's cells through the evaluator's wire decoder and the request encoder unchanged", () => {
    // A $long beyond 2^53 is the evaluator's documented precision gap (value.ts): `long()` holds a JS number. The fixture keeps
    // one so the SERVER half proves Long fidelity; it is excluded here rather than asserted away.
    const safe = (cell: unknown): boolean =>
      !(
        typeof cell === "object" &&
        cell !== null &&
        "$long" in cell &&
        !Number.isSafeInteger(Number((cell as { $long: string }).$long))
      );
    let compared = 0;
    for (const row of request.roots[0].rows)
      for (const [k, cell] of Object.entries(row)) {
        if (!safe(cell)) continue;
        expect(encodeRow(decodeRow({ [k]: cell }))).toEqual({ [k]: cell });
        compared += 1;
      }
    expect(compared).toBeGreaterThan(0);
  });

  it("accepts every line the real route wrote, and every one passes the client's type guard", () => {
    expect(new Set(responseLines.map((l) => l.type))).toEqual(
      new Set(["step", "unavailable", "error", "rows"]),
    );
    for (const line of [...responseLines, failedLine]) {
      expect(lineSchema(line)).toBe(true);
      expect(isDraftPreviewLine(line)).toBe(true);
    }
  });

  it("delivers the whole recorded response through the stream reader, in order", async () => {
    const seen: DraftPreviewLine[] = [];
    await readDraftPreviewStream(chunkedResponse([responseText]), (l) => seen.push(l));
    expect(seen).toEqual(responseLines);
    expect(seen[seen.length - 1].type).toBe("rows");
  });

  it("makes the type guard and the schema agree on every negative case", () => {
    const step = responseLines.find((l) => l.type === "step") as Record<string, unknown>;
    const unavailable = responseLines.find((l) => l.type === "unavailable") as Record<
      string,
      unknown
    >;
    const error = responseLines.find((l) => l.type === "error") as Record<string, unknown>;
    const rows = responseLines.find((l) => l.type === "rows") as Record<string, unknown>;
    const renamed = (l: Record<string, unknown>, from: string, to: string) => {
      const { [from]: value, ...rest } = l;
      return { ...rest, [to]: value };
    };
    const without = (l: Record<string, unknown>, key: string) => {
      const { [key]: dropped, ...rest } = l;
      expect(dropped).not.toBeUndefined();
      return rest;
    };
    const negatives: Array<Record<string, unknown>> = [
      renamed(step, "count", "n"),
      without(step, "schema"),
      { ...step, extra: 1 },
      { ...step, schema: [{ name: "k", type: "decimal" }] },
      { ...step, count: -1 },
      { ...unavailable, reason: "because" },
      renamed(unavailable, "reason", "why"),
      renamed(error, "message", "error"),
      renamed(rows, "truncated", "cut"),
      { ...rows, available: "yes" },
      { ...rows, step: 4 },
      { type: "progress", step: "a" },
      { ...failedLine, message: "other" },
    ];
    for (const line of negatives) {
      expect([JSON.stringify(line), lineSchema(line)]).toEqual([JSON.stringify(line), false]);
      expect([JSON.stringify(line), isDraftPreviewLine(line)]).toEqual([
        JSON.stringify(line),
        false,
      ]);
    }
  });

  it("rejects request bodies that break the schema, as the server's decoder does", () => {
    const { roots, ...noRoots } = request;
    expect(roots).toHaveLength(1);
    expect(requestSchema(noRoots)).toBe(false);
    expect(requestSchema({ ...request, extra: true })).toBe(false);
    expect(
      requestSchema({ ...request, roots: [{ id: "r", rows: [{ c: { nested: "x" } }] }] }),
    ).toBe(false);
    expect(requestSchema({ ...request, roots: [{ id: "r", rows: [{ c: { $long: 5 } }] }] })).toBe(
      false,
    );
  });
});
