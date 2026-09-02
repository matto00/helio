import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { OutputsGalleryTab } from "./OutputsGalleryTab";
import type { Output } from "../types/output";
import type { Step } from "../types/step";
import { listOutputPanels } from "../services/outputService";

jest.mock("../services/outputService", () => ({
  listOutputPanels: jest.fn(),
}));

const mockListOutputPanels = listOutputPanels as jest.MockedFunction<typeof listOutputPanels>;

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

function buildStep(overrides: Partial<Step> = {}): Step {
  return {
    id: "step-1",
    opType: { id: "filter", label: "Filter", icon: {} as Step["opType"]["icon"] },
    label: "Filter",
    config: { type: "filter", conditions: [] } as unknown as Step["config"],
    enabled: true,
    ...overrides,
  };
}

describe("OutputsGalleryTab", () => {
  beforeEach(() => {
    mockListOutputPanels.mockResolvedValue([]);
  });

  it("renders one card per Output with its off-step subtitle", async () => {
    const outputs = [
      buildOutput({ id: "out-1", name: "Revenue", nodeStepId: "step-1" }),
      buildOutput({ id: "out-2", name: "Trend", kind: "chart", nodeStepId: undefined }),
    ];
    render(
      <OutputsGalleryTab
        outputs={outputs}
        steps={[buildStep()]}
        previewRowCountByOutputId={{}}
        onOpenOutput={jest.fn()}
        onAddOutput={jest.fn()}
      />,
    );
    expect(screen.getByText("Revenue")).toBeInTheDocument();
    expect(screen.getByText("Trend")).toBeInTheDocument();
    expect(screen.getByText("off Filter")).toBeInTheDocument();
    expect(screen.getByText("off the pipeline root")).toBeInTheDocument();
    await waitFor(() => expect(mockListOutputPanels).toHaveBeenCalledTimes(2));
  });

  it("shows the placement count once the lazy per-card fetch resolves", async () => {
    mockListOutputPanels.mockResolvedValue([
      { panelId: "pan-1", dashboardId: "dash-1" },
      { panelId: "pan-2", dashboardId: "dash-2" },
    ]);
    render(
      <OutputsGalleryTab
        outputs={[buildOutput()]}
        steps={[buildStep()]}
        previewRowCountByOutputId={{}}
        onOpenOutput={jest.fn()}
        onAddOutput={jest.fn()}
      />,
    );
    await waitFor(() => expect(screen.getByText("on 2 dashboards")).toBeInTheDocument());
  });

  it("calls onOpenOutput when a card is clicked", async () => {
    const onOpenOutput = jest.fn();
    render(
      <OutputsGalleryTab
        outputs={[buildOutput()]}
        steps={[buildStep()]}
        previewRowCountByOutputId={{}}
        onOpenOutput={onOpenOutput}
        onAddOutput={jest.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Open Revenue output/i }));
    expect(onOpenOutput).toHaveBeenCalledWith(expect.objectContaining({ id: "out-1" }));
    await waitFor(() => expect(mockListOutputPanels).toHaveBeenCalled());
  });

  it("calls onAddOutput when '+ New output' is clicked", () => {
    const onAddOutput = jest.fn();
    render(
      <OutputsGalleryTab
        outputs={[]}
        steps={[]}
        previewRowCountByOutputId={{}}
        onOpenOutput={jest.fn()}
        onAddOutput={onAddOutput}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /New output/i }));
    expect(onAddOutput).toHaveBeenCalled();
  });

  it("shows an empty state when there are no Outputs", () => {
    render(
      <OutputsGalleryTab
        outputs={[]}
        steps={[]}
        previewRowCountByOutputId={{}}
        onOpenOutput={jest.fn()}
        onAddOutput={jest.fn()}
      />,
    );
    expect(screen.getByText(/No Outputs yet/i)).toBeInTheDocument();
  });
});
