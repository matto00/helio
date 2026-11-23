import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { TRIGGER_SOURCES } from "../types/pipelineStep";
import { triggerSourceLabel } from "../utils/triggerSourceLabel";
import { fetchRunHistory } from "./pipelineService";
import { httpClient } from "../../../services/httpClient";

// HEL-1815: the client half of the run-history wire seam. The fixture is the body the real route writes (one run per
// trigger source, with the sparse omitted-when-unset shapes); the backend spec PipelineRunHistorySchemaSpec holds it to
// the route and to schemas/pipelines/pipeline-run-record.schema.json.

jest.mock("../../../services/httpClient", () => ({ httpClient: { get: jest.fn() } }));

const root = resolve(__dirname, "../../../../..");
const read = (p: string) => JSON.parse(readFileSync(resolve(root, p), "utf8"));

describe("run-history wire contract (HEL-1815)", () => {
  const fixture = read("shared-test-fixtures/pipeline-run/run-history-response.json") as unknown[];

  it("the schema's triggerSource enum is exactly TRIGGER_SOURCES", () => {
    const schema = read("schemas/pipelines/pipeline-run-record.schema.json");
    expect([...schema.properties.triggerSource.enum].sort()).toEqual([...TRIGGER_SOURCES].sort());
  });

  it("every fixture record normalises to a known trigger source, with omitted fields as null", async () => {
    (httpClient.get as jest.Mock).mockResolvedValue({ data: fixture });
    const records = await fetchRunHistory("p-1");
    expect(records.map((r) => r.triggerSource).sort()).toEqual([...TRIGGER_SOURCES].sort());
    expect(records.map((r) => triggerSourceLabel(r.triggerSource)).sort()).toEqual([
      "Auto-run",
      "External",
      "Manual",
      "Scheduled",
    ]);
    for (const r of records) {
      expect(TRIGGER_SOURCES).toContain(r.triggerSource);
      expect(r.completedAt === null || typeof r.completedAt === "string").toBe(true);
      expect(r.rowCount === null || typeof r.rowCount === "number").toBe(true);
      expect(r.errorLog === null || typeof r.errorLog === "string").toBe(true);
    }
    const queued = records.find((r) => r.triggerSource === "external");
    expect(queued).toMatchObject({ completedAt: null, rowCount: null, errorLog: null });
    expect(records.find((r) => r.triggerSource === "manual")?.errorLog).toBeNull();
    expect(records.find((r) => r.triggerSource === "auto-run")?.rowCount).toBe(3);
  });
});
