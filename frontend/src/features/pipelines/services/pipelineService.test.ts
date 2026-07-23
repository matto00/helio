// Regression coverage for the wire-shape gap behind evaluation-1's "Invalid
// Date" bug: spray-json's default `Option` formatter omits `None` fields
// entirely from the wire (does not serialize `null`) — `nextRunAt`/`lastRunAt`
// are `Option[String]` on the backend, so a not-yet-computed value arrives
// with the key **absent**, not `null`. `getPipelineSchedule`/
// `putPipelineSchedule` must normalize both to `null` before the value
// reaches Redux/the UI, matching the established pattern in
// `dataTypeService.test.ts` for the same class of bug.

import { httpClient } from "../../../services/httpClient";
import { fetchRunHistory, getPipelineSchedule, putPipelineSchedule } from "./pipelineService";

jest.mock("../../../services/httpClient", () => ({
  httpClient: { get: jest.fn(), put: jest.fn() },
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
