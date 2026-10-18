import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import Ajv2020 from "ajv/dist/2020";

import { fetchSourceSample } from "./services/dataSourceService";
import { httpClient } from "../../services/httpClient";

// HEL-1648, client half of the pipeline-scoped sample seam.
//  - The request URL the client builds equals the committed template, which the backend's
//    SourceScopedSampleRoutesSpec requests verbatim against the real route (so a rename on either side fails one).
//  - The analyze response schema (also validated server-side against the real response) requires `callerRole`.

jest.mock("../../services/httpClient", () => ({ httpClient: { get: jest.fn() } }));
const get = jest.mocked(httpClient.get);

const root = resolve(__dirname, "../../../..");
const read = (p: string) => JSON.parse(readFileSync(resolve(root, p), "utf8"));

describe("scoped sample request URL (shared-test-fixtures/source-sample/scoped-sample-request-url.json)", () => {
  it("is exactly the template with the ids filled in", async () => {
    const { template } = read("shared-test-fixtures/source-sample/scoped-sample-request-url.json");
    get.mockResolvedValueOnce({
      data: {
        rows: [],
        capturedAt: "2026-10-16T12:00:00Z",
        sourceRowCount: 0,
        truncated: false,
        live: false,
      },
    });
    await fetchSourceSample("src-1", "0b6f5d5e-1111-4222-8333-444455556666");
    expect(get).toHaveBeenLastCalledWith(
      (template as string)
        .replace("{sourceId}", "src-1")
        .replace("{pipelineId}", "0b6f5d5e-1111-4222-8333-444455556666"),
    );
  });
});

describe("pipeline analyze response schema: callerRole (HEL-1648)", () => {
  const validate = new Ajv2020({ allErrors: true, validateFormats: false, strict: false }).compile(
    read("schemas/pipelines/pipeline-analyze-response.schema.json"),
  );
  const base = {
    id: "p1",
    name: "P",
    sourceSchemas: [],
    steps: [],
    costVerdict: { autoRunnable: true, stepCount: 0, reasons: [], canRun: true },
    warnings: [],
  };

  it.each(["owner", "editor", "viewer"])("accepts callerRole %s", (callerRole) => {
    expect(validate({ ...base, callerRole })).toBe(true);
  });

  it("rejects a missing or unknown callerRole", () => {
    expect(validate(base)).toBe(false);
    expect(validate({ ...base, callerRole: "admin" })).toBe(false);
  });
});
