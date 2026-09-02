import { fireEvent, render, screen } from "@testing-library/react";

import { OutputsRail } from "./OutputsRail";
import type { Output } from "../types/output";

function buildOutput(overrides: Partial<Output> = {}): Output {
  return {
    id: "out-1",
    pipelineId: "p-1",
    nodeStepId: "step-1",
    ownerId: "u-1",
    name: "Revenue",
    kind: "metric",
    config: {},
    schema: [],
    createdAt: "2026-08-01T00:00:00Z",
    updatedAt: "2026-08-01T00:00:00Z",
    ...overrides,
  };
}

describe("OutputsRail", () => {
  it("renders one chip per Output on this node", () => {
    const outputs = [
      buildOutput({ id: "out-1", name: "Revenue" }),
      buildOutput({ id: "out-2", name: "Trend", kind: "chart" }),
    ];
    render(
      <OutputsRail
        outputs={outputs}
        previewRowCountByOutputId={{}}
        onOpenOutput={jest.fn()}
        onAddOutput={jest.fn()}
      />,
    );
    expect(screen.getByText("Revenue")).toBeInTheDocument();
    expect(screen.getByText("Trend")).toBeInTheDocument();
  });

  it("shows a live-preview-derived thumbnail once a row count is known", () => {
    render(
      <OutputsRail
        outputs={[buildOutput({ kind: "table" })]}
        previewRowCountByOutputId={{ "out-1": 7 }}
        onOpenOutput={jest.fn()}
        onAddOutput={jest.fn()}
      />,
    );
    expect(screen.getByText("7 rows")).toBeInTheDocument();
  });

  it("calls onOpenOutput with the clicked Output, and onAddOutput for the + chip", () => {
    const onOpenOutput = jest.fn();
    const onAddOutput = jest.fn();
    const output = buildOutput();
    render(
      <OutputsRail
        outputs={[output]}
        previewRowCountByOutputId={{}}
        onOpenOutput={onOpenOutput}
        onAddOutput={onAddOutput}
      />,
    );

    fireEvent.click(screen.getByLabelText("Open Revenue output"));
    expect(onOpenOutput).toHaveBeenCalledWith(output);

    fireEvent.click(screen.getByLabelText("Add output"));
    expect(onAddOutput).toHaveBeenCalledTimes(1);
  });
});
