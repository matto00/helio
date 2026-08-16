// Regression coverage for the wire-shape gap behind evaluation-1's "Invalid
// Date" bug: spray-json's default `Option` formatter omits `None` fields
// entirely from the wire (does not serialize `null`) — `nextRunAt`/`lastRunAt`
// are `Option[String]` on the backend, so a not-yet-computed value arrives
// with the key **absent**, not `null`. `getPipelineSchedule`/
// `putPipelineSchedule` must normalize both to `null` before the value
// reaches Redux/the UI, matching the established pattern in
// `dataTypeService.test.ts` for the same class of bug.

import { httpClient } from "../../../services/httpClient";
import {
  duplicatePipelineStep,
  expandPipelineShape,
  fetchRunHistory,
  getPipelineSchedule,
  getPipelineShapeCatalog,
  getPipelineSteps,
  putPipelineSchedule,
  updatePipelineStepEnabled,
} from "./pipelineService";

jest.mock("../../../services/httpClient", () => ({
  httpClient: { get: jest.fn(), put: jest.fn(), post: jest.fn(), patch: jest.fn() },
}));

const mockedHttpClient = jest.mocked(httpClient);

// No `nextRunAt` / `lastRunAt` keys at all — exactly how a freshly-saved or
// cadence-changed schedule arrives before the scheduler's next tick.
const wireScheduleMissingTimestamps = {
  id: "sched-1",
  pipelineId: "p-1",
  kind: "interval",
  expression: "15m",
  enabled: true,
  timezone: "UTC",
  createdAt: "2026-07-01T00:00:00Z",
  updatedAt: "2026-07-01T00:00:00Z",
};

const wireScheduleWithTimestamps = {
  ...wireScheduleMissingTimestamps,
  nextRunAt: "2026-07-01T01:00:00Z",
  lastRunAt: "2026-06-30T01:00:00Z",
};

describe("pipelineService schedule timestamp normalization", () => {
  it("getPipelineSchedule maps absent nextRunAt/lastRunAt to null", async () => {
    mockedHttpClient.get.mockResolvedValueOnce({ data: wireScheduleMissingTimestamps });

    const result = await getPipelineSchedule("p-1");

    expect(result.nextRunAt).toBeNull();
    expect(result.lastRunAt).toBeNull();
    expect("nextRunAt" in wireScheduleMissingTimestamps).toBe(false);
  });

  it("getPipelineSchedule preserves present nextRunAt/lastRunAt values", async () => {
    mockedHttpClient.get.mockResolvedValueOnce({ data: wireScheduleWithTimestamps });

    const result = await getPipelineSchedule("p-1");

    expect(result.nextRunAt).toBe("2026-07-01T01:00:00Z");
    expect(result.lastRunAt).toBe("2026-06-30T01:00:00Z");
  });

  it("putPipelineSchedule maps absent nextRunAt/lastRunAt to null", async () => {
    mockedHttpClient.put.mockResolvedValueOnce({ data: wireScheduleMissingTimestamps });

    const result = await putPipelineSchedule("p-1", {
      kind: "interval",
      expression: "15m",
      enabled: true,
      timezone: "UTC",
    });

    expect(result.nextRunAt).toBeNull();
    expect(result.lastRunAt).toBeNull();
  });
});

// HEL-417: `triggerSource` is server-side-defaulted and non-optional on the
// Scala wire shape, so a compliant backend always sends it -- but
// `fetchRunHistory` normalizes defensively at the boundary anyway (same
// discipline as the schedule-timestamp normalization above) in case a
// legacy/mocked response omits the field.
describe("pipelineService run history triggerSource normalization", () => {
  it("fetchRunHistory defaults a missing triggerSource to manual", async () => {
    const wireRunMissingTriggerSource = {
      id: "run-1",
      pipelineId: "p-1",
      status: "succeeded",
      startedAt: "2026-07-01T00:00:00Z",
      completedAt: "2026-07-01T00:01:00Z",
      rowCount: 5,
      errorLog: null,
    };
    mockedHttpClient.get.mockResolvedValueOnce({ data: [wireRunMissingTriggerSource] });

    const result = await fetchRunHistory("p-1");

    expect(result).toHaveLength(1);
    expect(result[0].triggerSource).toBe("manual");
    expect("triggerSource" in wireRunMissingTriggerSource).toBe(false);
  });

  it("fetchRunHistory preserves a present triggerSource value", async () => {
    const wireRunWithTriggerSource = {
      id: "run-2",
      pipelineId: "p-1",
      status: "succeeded",
      startedAt: "2026-07-01T00:00:00Z",
      completedAt: "2026-07-01T00:01:00Z",
      rowCount: 5,
      errorLog: null,
      triggerSource: "scheduled",
    };
    mockedHttpClient.get.mockResolvedValueOnce({ data: [wireRunWithTriggerSource] });

    const result = await fetchRunHistory("p-1");

    expect(result[0].triggerSource).toBe("scheduled");
  });
});

// HEL-402: pipeline shape catalog + expand service calls.
describe("pipelineService shape catalog + expand", () => {
  it("getPipelineShapeCatalog GETs /api/pipeline-shapes and returns the response data", async () => {
    const catalog = [
      {
        id: "single-row",
        label: "Single row",
        description: "Reduces a source to exactly one row.",
        paramsSchema: [],
        outputContract: {
          rowCount: { kind: "exactly-one" },
          description: "",
        },
      },
    ];
    mockedHttpClient.get.mockResolvedValueOnce({ data: catalog });

    const result = await getPipelineShapeCatalog();

    expect(mockedHttpClient.get).toHaveBeenCalledWith("/api/pipeline-shapes");
    expect(result).toEqual(catalog);
  });

  it("expandPipelineShape POSTs params wrapped in {params} and returns the expansions", async () => {
    const expansions = [{ kind: "aggregate", config: { groupBy: [], aggregations: [] } }];
    mockedHttpClient.post.mockResolvedValueOnce({ data: expansions });

    const result = await expandPipelineShape("single-row", {
      mode: "aggregate",
      measures: [{ fn: "sum", field: "amount", alias: "total" }],
    });

    expect(mockedHttpClient.post).toHaveBeenCalledWith("/api/pipeline-shapes/single-row/expand", {
      params: { mode: "aggregate", measures: [{ fn: "sum", field: "amount", alias: "total" }] },
    });
    expect(result).toEqual(expansions);
  });

  it("expandPipelineShape lets a non-2xx rejection propagate (caller surfaces the message)", async () => {
    const rejection = {
      isAxiosError: true,
      response: { status: 422, data: { message: "single-row shape: missing required field" } },
    };
    mockedHttpClient.post.mockRejectedValueOnce(rejection);

    await expect(expandPipelineShape("single-row", { mode: "aggregate" })).rejects.toBe(rejection);
  });
});

// HEL-412 — `enabled` normalize-at-boundary (`enabled ?? true`) + the two new
// step endpoints (PATCH {enabled}, POST duplicate). The backend always sends
// `enabled`, but this mirrors the schedule/run-history normalization above
// rather than trusting every caller/fixture to include it.
describe("pipelineService enabled normalization + duplicate (HEL-412)", () => {
  const wireStepMissingEnabled = {
    id: "step-1",
    pipelineId: "p-1",
    position: 0,
    type: "select",
    config: { fields: [] },
    createdAt: "2026-07-01T00:00:00Z",
    updatedAt: "2026-07-01T00:00:00Z",
  };

  it("getPipelineSteps defaults a missing enabled field to true", async () => {
    mockedHttpClient.get.mockResolvedValueOnce({ data: [wireStepMissingEnabled] });

    const result = await getPipelineSteps("p-1");

    expect(result[0].enabled).toBe(true);
    expect("enabled" in wireStepMissingEnabled).toBe(false);
  });

  it("getPipelineSteps preserves a present enabled: false", async () => {
    mockedHttpClient.get.mockResolvedValueOnce({
      data: [{ ...wireStepMissingEnabled, enabled: false }],
    });

    const result = await getPipelineSteps("p-1");

    expect(result[0].enabled).toBe(false);
  });

  it("updatePipelineStepEnabled PATCHes {enabled} and normalizes the response", async () => {
    mockedHttpClient.patch.mockResolvedValueOnce({ data: wireStepMissingEnabled });

    const result = await updatePipelineStepEnabled("step-1", false);

    expect(mockedHttpClient.patch).toHaveBeenCalledWith("/api/pipeline-steps/step-1", {
      enabled: false,
    });
    expect(result.enabled).toBe(true); // normalized from the (missing-field) mock response
  });

  it("duplicatePipelineStep POSTs with no body and normalizes the response", async () => {
    mockedHttpClient.post.mockResolvedValueOnce({ data: wireStepMissingEnabled });

    const result = await duplicatePipelineStep("step-1");

    expect(mockedHttpClient.post).toHaveBeenCalledWith("/api/pipeline-steps/step-1/duplicate");
    expect(result.enabled).toBe(true);
  });
});
