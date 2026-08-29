/**
 * HEL-861 tasks.md 4.4 — `HelioApi.runPipeline` must pass the backend's truncation fields (notice
 * text, available-row count, the `truncated` boolean) through to `RunOutcome` unmodified, not drop
 * or reshape them. This is a PASS-THROUGH FIDELITY test, not coverage of the notice's wording: the
 * `RunResultResponse` fixtures below are supplied by the test itself, so it stays green under ANY
 * backend wording change (evaluation-1 item 4). `PipelineRunService.composeTruncationNotice`'s own
 * unit tests (`PipelineRunServiceSpec.scala`) are what verify the wording. `guarded`/`jsonResult`
 * (write.ts) stringify `RunOutcome` verbatim with no bespoke formatter, so whatever this test
 * proves about the pass-through is exactly what an agent reads.
 */

import { HelioApi } from "./helioApi.js";
import type { HelioHttpClient } from "./httpClient.js";
import type { RunResultResponse } from "./types.js";

/** Minimal fake matching only the two methods `runPipeline` actually calls. */
function fakeHttp(runResult: RunResultResponse): HelioHttpClient {
  return {
    post: jest.fn().mockResolvedValue(runResult),
    get: jest.fn().mockResolvedValue({
      lastRunStatus: "succeeded",
      outputDataTypeId: "dt-1",
    }),
  } as unknown as HelioHttpClient;
}

describe("HelioApi.runPipeline truncation surfacing (HEL-861)", () => {
  it("a truncated run is content-distinguishable: truncated=true, the real available count, and a notice naming both the read and available counts", async () => {
    const runResult: RunResultResponse = {
      rows: [],
      rowCount: 1000,
      sourceRowCount: 1000,
      sourceTruncated: true,
      sourceAvailableRowCount: 3303,
      truncationNotice:
        'Source "big-source" truncated: this run read the first 1000 rows returned, out of 3303 ' +
        "available, because of the 1000-row run cap. Results computed from this run — including " +
        "any filter, sort, or aggregate — describe only that partial population, not the full source.",
    };
    const api = new HelioApi(fakeHttp(runResult));

    const outcome = await api.runPipeline("pipe-1");

    // Pins that the fixture's content passes through unmodified — not key-presence on RunOutcome,
    // and not coverage of the notice's own wording (that's PipelineRunServiceSpec.scala's job).
    expect(outcome.truncated).toBe(true);
    expect(outcome.availableRowCount).toBe(3303);
    expect(outcome.truncationNotice).toContain("1000");
    expect(outcome.truncationNotice).toContain("3303");
    expect(outcome.truncationNotice).toContain("truncated");
  });

  it("a complete run (under the cap) is distinguishable from the truncated case above: truncated=false, no notice", async () => {
    const runResult: RunResultResponse = {
      rows: [],
      rowCount: 5,
      sourceRowCount: 5,
      sourceTruncated: false,
    };
    const api = new HelioApi(fakeHttp(runResult));

    const outcome = await api.runPipeline("pipe-2");

    expect(outcome.truncated).toBe(false);
    expect(outcome.availableRowCount).toBeUndefined();
    expect(outcome.truncationNotice).toBeUndefined();
  });

  it("truncated always defaults to false, never undefined, when the backend omits sourceTruncated entirely", async () => {
    const runResult: RunResultResponse = { rows: [], rowCount: 2 };
    const api = new HelioApi(fakeHttp(runResult));

    const outcome = await api.runPipeline("pipe-3");

    expect(outcome.truncated).toBe(false);
    expect(outcome.truncated).not.toBeUndefined();
  });
});
