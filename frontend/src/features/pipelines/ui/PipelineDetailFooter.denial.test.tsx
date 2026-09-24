// HEL-1096 tasks.md 3.8 (design.md D5, Standing Constraint C4): the pipeline detail page's
// denial block — the reason is rendered, "Run to update" is gated on `costVerdict.canRun`, and
// both are exposed via COMPUTED ARIA (not mere DOM presence), verified under both `data-theme`
// values (DESIGN.md binding — light/dark token parity).

import { render, screen } from "@testing-library/react";

import { PipelineDetailFooter } from "./PipelineDetailFooter";
import type { CostVerdict } from "../types/pipelineStep";

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
  lastRunAt: null,
  lastRunRowCount: null,
  lastRunStatus: null,
  lastRunTruncated: null,
};

const deniedVerdict: CostVerdict = {
  autoRunnable: false,
  stepCount: 1,
  reasons: [{ code: "ai-step", detail: "Step 's1' uses AI op 'analyzewithai'", stepId: "s1" }],
  canRun: true,
};

function setTheme(theme: "light" | "dark") {
  document.documentElement.setAttribute("data-theme", theme);
}

describe("PipelineDetailFooter denial block (HEL-1096 design.md D5)", () => {
  afterEach(() => {
    document.documentElement.removeAttribute("data-theme");
  });

  it("renders nothing when costVerdict is null (analyze hasn't returned yet)", () => {
    render(
      <PipelineDetailFooter {...baseProps} costVerdict={null} handleRunToUpdate={jest.fn()} />,
    );
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("renders nothing when the verdict allows auto-run", () => {
    const allowed: CostVerdict = { autoRunnable: true, stepCount: 1, reasons: [], canRun: true };
    render(
      <PipelineDetailFooter {...baseProps} costVerdict={allowed} handleRunToUpdate={jest.fn()} />,
    );
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it.each(["light", "dark"] as const)(
    "renders the specific-rule reason via a computed ARIA live region, and a 'Run to update' " +
      "button when canRun is true (%s theme)",
    (theme) => {
      setTheme(theme);
      const handleRunToUpdate = jest.fn();
      render(
        <PipelineDetailFooter
          {...baseProps}
          costVerdict={deniedVerdict}
          handleRunToUpdate={handleRunToUpdate}
        />,
      );

      // Computed ARIA, not mere DOM presence (C4): `role="status"` exposes the reason as a real
      // accessible live region, not just visible text.
      const region = screen.getByRole("status");
      expect(region).toHaveAttribute("aria-live", "polite");
      expect(region).toHaveTextContent(/\bAI\b/);

      const runBtn = screen.getByRole("button", { name: "Run to update" });
      expect(runBtn).toBeInTheDocument();
      expect(runBtn).toHaveAttribute("aria-describedby");
      const describedById = runBtn.getAttribute("aria-describedby") as string;
      expect(document.getElementById(describedById)).toHaveTextContent(/\bAI\b/);

      runBtn.click();
      expect(handleRunToUpdate).toHaveBeenCalledTimes(1);
    },
  );

  it("shows the reason but NO 'Run to update' control when canRun is false", () => {
    const viewerVerdict: CostVerdict = { ...deniedVerdict, canRun: false };
    render(
      <PipelineDetailFooter
        {...baseProps}
        costVerdict={viewerVerdict}
        handleRunToUpdate={jest.fn()}
      />,
    );

    expect(screen.getByRole("status")).toHaveTextContent(/\bAI\b/);
    expect(screen.queryByRole("button", { name: "Run to update" })).not.toBeInTheDocument();
  });
});
