// pipelinesSlice.exports.test.ts — HEL-1501 characterization.
//
// Pins the public import surface of `pipelinesSlice` (55 importers) so the thunk/state split can
// re-export every moved name without any importer changing. Runtime names are pinned by value;
// the type-only exports (`FetchRunHistoryArg`, `PipelinesState`) are invisible at runtime, so they
// are pinned by use in type positions and enforced by `npm run typecheck` (tsc includes tests).

import * as pipelinesSliceModule from "./pipelinesSlice";
import type { FetchRunHistoryArg, PipelinesState } from "./pipelinesSlice";

describe("pipelinesSlice public export surface", () => {
  it("exports exactly the runtime names the slice exported before the split", () => {
    expect(Object.keys(pipelinesSliceModule).sort()).toEqual([
      "analyzePipeline",
      "applyPipelineProposal",
      "clearRunState",
      "createPipeline",
      "deletePipeline",
      "deletePipelineSchedule",
      "fetchPipelineById",
      "fetchPipelineRunHistory",
      "fetchPipelineSchedule",
      "fetchPipelineSteps",
      "fetchPipelines",
      "pipelinesReducer",
      "savePipelineSchedule",
      "setCreatePipelineModalOpen",
      "setRunStatus",
      "submitPipelineRun",
      "updatePipeline",
    ]);
  });

  it("keeps every thunk a usable action creator with its original type prefix", () => {
    expect(pipelinesSliceModule.fetchPipelineSteps.typePrefix).toBe("pipelines/fetchPipelineSteps");
    expect(pipelinesSliceModule.fetchPipelineRunHistory.typePrefix).toBe(
      "pipelines/fetchPipelineRunHistory",
    );
    expect(typeof pipelinesSliceModule.pipelinesReducer).toBe("function");
  });

  it("keeps the type-only exports importable from the slice module", () => {
    // Type positions: deleting either type re-export turns `npm run typecheck` red.
    const arg: FetchRunHistoryArg = { pipelineId: "p", openId: 1 };
    const stepsKey: keyof PipelinesState = "steps";
    expect(arg.pipelineId).toBe("p");
    expect(stepsKey).toBe("steps");
  });
});
