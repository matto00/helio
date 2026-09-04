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
import type { PipelineSummaryResponse, RunResultResponse } from "./types.js";

// HEL-907 evaluator-final round-2 CR4: this fixture used to include a stray `outputDataTypeId`
// field that has not existed on `PipelineSummaryResponse` since HEL-904 -- an "evidence-shaped
// non-evidence" fixture drift that let three separate places (types.ts, helioApi.ts, write.ts)
// keep promising/mapping a field the backend has never sent under this model, undetected, because
// nothing in this suite's own fixture matched the REAL wire shape closely enough to
// notice the gap. Mirrors `PipelineProtocol.scala`'s `PipelineSummaryResponse`/`jsonFormat8`
// exactly (HEL-913 tasks 7.2a/9.1: `roots[]` replaces the removed `sourceDataSourceId`/
// `sourceDataSourceName` scalar pair) so a future field addition/removal on either side has a
// real chance of being caught here, not just asserted to match by convention.
const fakeSummary: PipelineSummaryResponse = {
  id: "p1",
  name: "pipeline",
  roots: [{ id: "root-1", dataSourceId: "src-1", dataSourceName: "src" }],
  lastRunStatus: "succeeded",
  lastRunAt: null,
  lastRunRowCount: null,
  ownerId: null,
  tag: null,
};

/** Minimal fake matching only the two methods `runPipeline` actually calls. */
function fakeHttp(runResult: RunResultResponse): HelioHttpClient {
  return {
    post: jest.fn().mockResolvedValue(runResult),
    get: jest.fn().mockResolvedValue(fakeSummary),
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
