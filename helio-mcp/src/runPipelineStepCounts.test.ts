/** HEL-1069 -- `HelioApi.runPipeline` surfaces runId, stepRowCounts and warnings. */

import { HelioApi } from "./helioApi.js";
import type { HelioHttpClient } from "./httpClient.js";
import type { PipelineStepResponse, PipelineSummaryResponse, RunResultResponse } from "./types.js";

const summary: PipelineSummaryResponse = {
  id: "p1",
  name: "pipeline",
  roots: [{ id: "r1", dataSourceId: "src-1", dataSourceName: "src" }],
  lastRunStatus: "succeeded",
  lastRunAt: null,
  lastRunRowCount: null,
  ownerId: null,
  tag: null,
};

const steps: PipelineStepResponse[] = [
  { id: "a", type: "filter", position: 0, config: {}, rootId: "r1" },
  { id: "j", type: "join", position: 0, config: {}, parentStepId: "a" },
];

function api(result: RunResultResponse): HelioApi {
  const http = {
    post: jest.fn().mockResolvedValue(result),
    get: jest
      .fn()
      .mockImplementation(async (path: string) => (path.endsWith("/steps") ? steps : summary)),
  } as unknown as HelioHttpClient;
  return new HelioApi(http);
}

describe("runPipeline step counts (HEL-1069)", () => {
  it("returns runId, stepRowCounts and a warning for a zero-row join from a non-empty input", async () => {
    const outcome = await api({
      rows: [],
      rowCount: 0,
      runId: "run-1",
      sourceRowCount: 5,
      stepRowCounts: { a: 5, j: 0 },
    }).runPipeline("p1");
    expect(outcome.runId).toBe("run-1");
    expect(outcome.stepRowCounts).toEqual({ a: 5, j: 0 });
    expect(outcome.stepCountsAvailable).toBe(true);
    expect(outcome.warnings).toHaveLength(1);
    expect(outcome.warnings?.[0]).toMatchObject({ stepId: "j", type: "join" });
  });

  it("a healthy run carries warnings: [] with counts present", async () => {
    const outcome = await api({
      rows: [],
      rowCount: 3,
      sourceRowCount: 5,
      stepRowCounts: { a: 5, j: 3 },
    }).runPipeline("p1");
    expect(outcome.warnings).toEqual([]);
    expect(outcome.stepRowCounts).toEqual({ a: 5, j: 3 });
  });

  it("empty stepRowCounts => stepCountsAvailable:false and NO warnings key", async () => {
    const outcome = await api({ rows: [], rowCount: 3, sourceRowCount: 5 }).runPipeline("p1");
    expect(outcome.stepCountsAvailable).toBe(false);
    expect(outcome.stepRowCounts).toEqual({});
    expect(outcome).not.toHaveProperty("warnings");
  });
});
