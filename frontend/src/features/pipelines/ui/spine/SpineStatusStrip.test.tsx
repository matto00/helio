// HEL-1579: the desktop counterpart of `PipelineDetailFooter.denial.test.tsx` / `.stepConfigInvalid.test.tsx`
// (HEL-1096 design.md D5, HEL-1266): the cost-verdict denial and "Run to update" now render in the strip under
// the header. The step-config-invalid fixture is the SAME committed backend fixture, so drift on either side
// turns a test red.
import { readFileSync } from "fs";
import { resolve } from "path";

import { render, screen } from "@testing-library/react";

import type { CostVerdict } from "../../types/pipelineStep";
import { SpineStatusStrip } from "./SpineStatusStrip";

const FIXTURE_PATH = resolve(
  __dirname,
  "../../../../../../backend/src/test/resources/analyze/step-config-invalid-cost-verdict.json",
);
const invalidVerdict = JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as CostVerdict;

const aiVerdict: CostVerdict = {
  autoRunnable: false,
  stepCount: 1,
  reasons: [{ code: "ai-step", detail: "uses AI", stepId: "s1" }],
  canRun: true,
};

const MISCONFIGURED_COPY =
  "A step in this pipeline has a problem, so its results may be wrong or missing until that step is fixed.";

describe("SpineStatusStrip", () => {
  it("renders nothing when there is no verdict yet, the verdict allows auto-run and there is no notice", () => {
    const { container, rerender } = render(
      <SpineStatusStrip costVerdict={null} onRunToUpdate={jest.fn()} truncationNotice={null} />,
    );
    expect(container).toBeEmptyDOMElement();
    rerender(
      <SpineStatusStrip
        costVerdict={{ autoRunnable: true, stepCount: 1, reasons: [], canRun: true }}
        onRunToUpdate={jest.fn()}
        truncationNotice={null}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("renders the specific-rule reason in a polite live region with a described 'Run to update' that calls the handler", () => {
    const onRunToUpdate = jest.fn();
    render(
      <SpineStatusStrip
        costVerdict={aiVerdict}
        onRunToUpdate={onRunToUpdate}
        truncationNotice={null}
      />,
    );
    const region = screen.getByRole("status");
    expect(region).toHaveAttribute("aria-live", "polite");
    expect(region).toHaveTextContent(/\bAI\b/);
    const button = screen.getByRole("button", { name: "Run to update" });
    const describedBy = button.getAttribute("aria-describedby") as string;
    expect(document.getElementById(describedBy)).toHaveTextContent(/\bAI\b/);
    button.click();
    expect(onRunToUpdate).toHaveBeenCalledTimes(1);
  });

  it("shows the reason but no 'Run to update' when the caller cannot run the pipeline", () => {
    render(
      <SpineStatusStrip
        costVerdict={{ ...aiVerdict, canRun: false }}
        onRunToUpdate={jest.fn()}
        truncationNotice={null}
      />,
    );
    expect(screen.getByRole("status")).toHaveTextContent(/\bAI\b/);
    expect(screen.queryByRole("button", { name: "Run to update" })).not.toBeInTheDocument();
  });

  it("shows the misconfigured-step wording (and no 'Run to update') for the shared backend fixture", () => {
    render(
      <SpineStatusStrip
        costVerdict={invalidVerdict}
        onRunToUpdate={jest.fn()}
        truncationNotice={null}
      />,
    );
    expect(screen.getByRole("status")).toHaveTextContent(MISCONFIGURED_COPY);
    expect(screen.queryByText(/Run to update/)).not.toBeInTheDocument();
  });

  it("says the sentence once when two steps are misconfigured", () => {
    const two: CostVerdict = {
      ...invalidVerdict,
      reasons: [
        { code: "step-config-invalid", detail: "a", stepId: "s1" },
        { code: "step-config-invalid", detail: "b", stepId: "s2" },
      ],
    };
    render(
      <SpineStatusStrip costVerdict={two} onRunToUpdate={jest.fn()} truncationNotice={null} />,
    );
    expect(screen.getByRole("status").textContent).toBe(MISCONFIGURED_COPY);
  });

  it("shows the truncation notice as an alert, with or without a denial", () => {
    render(
      <SpineStatusStrip
        costVerdict={aiVerdict}
        onRunToUpdate={jest.fn()}
        truncationNotice="Only 1,000 of 5,000 rows were read."
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Only 1,000 of 5,000 rows were read.");
    expect(screen.getByRole("status")).toBeInTheDocument();
  });
});
