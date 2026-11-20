// HEL-1696: the run chip counts a finished run from the response's `rowCount`, never from the (at most 10) preview rows.
// The response is the body the real `POST /run` route writes (shared-test-fixtures/pipeline-run/run-capped-response.json,
// held to the server by PipelineRunResponseCapSpec).
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { configureStore } from "@reduxjs/toolkit";
import { render, screen } from "@testing-library/react";

import type { RunResult } from "../../services/pipelineService";
import { pipelinesReducer, submitPipelineRun } from "../../state/pipelinesSlice";
import { SpineRunStatus, type SpineRunState } from "./SpineRunStatus";

const fixture = JSON.parse(
  readFileSync(
    resolve(
      __dirname,
      "../../../../../../shared-test-fixtures/pipeline-run/run-capped-response.json",
    ),
    "utf8",
  ),
) as RunResult;

function runStateAfterRun(isDry: boolean): SpineRunState {
  const store = configureStore({ reducer: { pipelines: pipelinesReducer } });
  store.dispatch(submitPipelineRun.pending("req-1", { pipelineId: "p-1", dryRun: isDry }));
  store.dispatch(
    submitPipelineRun.fulfilled(fixture, "req-1", { pipelineId: "p-1", dryRun: isDry }),
  );
  const p = store.getState().pipelines;
  return {
    sseStatus: null,
    sseRowCount: null,
    sseErrorLog: null,
    runStatus: p.runStatus,
    runError: p.runError,
    runIsDry: isDry,
    runRowCount: p.runRowCount,
  };
}

describe("SpineRunStatus with a capped run response", () => {
  it("shows the response's rowCount (25), not its 10 preview rows", () => {
    expect(fixture.rows).toHaveLength(10);
    expect(fixture.rowCount).toBe(25);
    expect(fixture.rowsTruncated).toBe(true);
    render(<SpineRunStatus run={runStateAfterRun(false)} lastRunStatus={null} />);
    expect(screen.getByLabelText("Run status: succeeded")).toHaveTextContent(
      "Snapshot replaced: 25 rows",
    );
  });

  it("shows a dry run's preview count from rowCount", () => {
    render(<SpineRunStatus run={runStateAfterRun(true)} lastRunStatus={null} />);
    expect(screen.getByLabelText("Run status: succeeded")).toHaveTextContent("Preview: 25 rows");
  });
});
