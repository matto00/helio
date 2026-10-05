// HEL-1266 seam test (design.md D5). The costVerdict rendered here is the SAME committed fixture
// the backend's `PipelineAnalyzeCanRunRoutesSpec` compares with the real `GET .../analyze`
// response, so drift on either side turns one of the two tests red.

import { readFileSync } from "fs";
import { resolve } from "path";

import { render, screen } from "@testing-library/react";

import { PipelineDetailFooter } from "./PipelineDetailFooter";
import type { CostVerdict } from "../types/pipelineStep";

const FIXTURE_PATH = resolve(
  __dirname,
  "../../../../../backend/src/test/resources/analyze/step-config-invalid-cost-verdict.json",
);
const fixtureVerdict = JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as CostVerdict;

const baseProps = {
  editingOutputName: false,
  outputName: "My Pipeline",
  pipelineName: "My Pipeline",
  setOutputName: jest.fn(),
  setEditingOutputName: jest.fn(),
  stepCount: 1,
  outputSchema: [],
  sseData: { status: null, rowCount: null, errorLog: null },
  runStatus: null,
  runError: null,
  runIsDry: null,
  runResult: null,
  isDirty: false,
  updateError: null,
  updateStatus: "idle",
  isConfirmingCancel: false,
  handleSave: jest.fn(),
  confirmCancelDiscard: jest.fn(),
  dismissCancelConfirm: jest.fn(),
  handleCancel: jest.fn(),
  handleDryRun: jest.fn(),
  handleRunPipeline: jest.fn(),
  handleRunToUpdate: jest.fn(),
  lastRunAt: null,
  lastRunRowCount: null,
  lastRunStatus: null,
  lastRunTruncated: null,
};

const MISCONFIGURED_COPY =
  "A step in this pipeline is misconfigured, so it can't run until that step is fixed.";

describe("PipelineDetailFooter with the shared step-config-invalid analyze verdict (HEL-1266)", () => {
  afterEach(() => {
    document.documentElement.removeAttribute("data-theme");
  });

  it("the fixture is the denied, non-runnable shape the backend emits", () => {
    expect(fixtureVerdict.canRun).toBe(false);
    expect(fixtureVerdict.autoRunnable).toBe(false);
    expect(fixtureVerdict.reasons.map((r) => r.code)).toEqual(["step-config-invalid"]);
  });

  it.each(["light", "dark"] as const)(
    "shows the misconfigured-step wording and no 'Run to update' control (%s theme)",
    (theme) => {
      document.documentElement.setAttribute("data-theme", theme);
      render(<PipelineDetailFooter {...baseProps} costVerdict={fixtureVerdict} />);

      expect(screen.getByRole("status")).toHaveTextContent(MISCONFIGURED_COPY);
      expect(screen.queryByRole("button", { name: "Run to update" })).not.toBeInTheDocument();
      expect(screen.queryByText(/Run to update/)).not.toBeInTheDocument();
    },
  );

  it("says the sentence once when two steps are misconfigured", () => {
    const two: CostVerdict = {
      ...fixtureVerdict,
      reasons: [
        { code: "step-config-invalid", detail: "a", stepId: "s1" },
        { code: "step-config-invalid", detail: "b", stepId: "s2" },
      ],
    };
    render(<PipelineDetailFooter {...baseProps} costVerdict={two} />);

    expect(screen.getByRole("status").textContent).toBe(MISCONFIGURED_COPY);
  });
});
