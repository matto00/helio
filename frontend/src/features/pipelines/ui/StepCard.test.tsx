// StepCard.test.tsx — HEL-404 inline per-step output preview (rows + schema).
//
// Renders StepCard directly (not through PipelineDetailPage) so these tests
// isolate the preview-tray behavior: activation fetch, debounced
// refresh-on-edit, the output-schema chip strip, and the persistent
// previewOpen preference. Config-editor interactions are out of scope here
// (covered by the per-op *Config.test.tsx files); config "changes" are
// simulated by re-rendering with a new `step` prop, matching design.md's
// "step.config only changes after a successful PATCH" contract.

import type { ComponentProps } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";

import { StepCard } from "./StepCard";
import { OP_TYPES } from "../state/stepNarrowing";
import { fetchStepPreview, updatePipelineStep } from "../services/pipelineService";
import type { Step } from "../types/step";
import type { SchemaField } from "../types/pipelineStep";

jest.mock("../services/pipelineService", () => ({
  fetchStepPreview: jest.fn(),
  updatePipelineStep: jest.fn(),
}));

const fetchStepPreviewMock = jest.mocked(fetchStepPreview);
const updatePipelineStepMock = jest.mocked(updatePipelineStep);

const LIMIT_OP_TYPE = OP_TYPES.find((op) => op.id === "limit")!;

function makeStep(overrides: Partial<Step> = {}): Step {
  return {
    id: "step-1",
    opType: LIMIT_OP_TYPE,
    label: "Limit rows",
    config: { count: 5 },
    ...overrides,
  };
}

const outputSchema: SchemaField[] = [
  { name: "id", type: "number" },
  { name: "name", type: "string" },
];

function baseProps(overrides: Partial<ComponentProps<typeof StepCard>> = {}) {
  return {
    step: makeStep(),
    pipelineId: "pipe-1",
    onRemove: jest.fn(),
    analyzeColumns: [],
    analyzeSchema: [],
    analyzeOutputSchema: outputSchema,
    onConfigChange: jest.fn(),
    rowCount: null,
    ...overrides,
  };
}

/** Clicks a button by accessible name, wrapped in `act` so any state update
 *  a resolved (or already-settled) promise makes is flushed before the next
 *  assertion. Safe for never-resolving mocks too — `act` only drains
 *  already-queued microtasks, it does not block on unrelated pending
 *  promises. */
async function click(name: string) {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name }));
  });
}

beforeEach(() => {
  window.localStorage.clear();
  updatePipelineStepMock.mockResolvedValue({
    id: "step-1",
    pipelineId: "pipe-1",
    position: 0,
    type: "limit",
    config: { count: 5 },
    createdAt: "",
    updatedAt: "",
  });
});

afterEach(() => {
  jest.clearAllMocks();
  jest.useRealTimers();
});

describe("StepCard preview — rows + schema (3.1)", () => {
  it("renders sample rows and the output schema together when the preview is activated", async () => {
    fetchStepPreviewMock.mockResolvedValue({
      rows: [{ id: 1, name: "alice" }],
      rowCount: 1,
    });

    const { container } = render(<StepCard {...baseProps()} />);
    await click("Limit rows");
    await click("Preview data");

    expect(fetchStepPreviewMock).toHaveBeenCalledWith("pipe-1", "step-1");
    expect(screen.getByText("alice")).toBeInTheDocument();

    const chips = container.querySelectorAll(".pipeline-detail-page__step-preview-schema-chip");
    expect(chips).toHaveLength(2);
    expect(chips[0]).toHaveTextContent("id: number");
    expect(chips[1]).toHaveTextContent("name: string");
  });

  it("omits the schema strip (rows still render) when analyzeOutputSchema is empty", async () => {
    fetchStepPreviewMock.mockResolvedValue({
      rows: [{ id: 1, name: "alice" }],
      rowCount: 1,
    });

    const { container } = render(<StepCard {...baseProps({ analyzeOutputSchema: [] })} />);
    await click("Limit rows");
    await click("Preview data");

    expect(screen.getByText("alice")).toBeInTheDocument();
    expect(
      container.querySelector(".pipeline-detail-page__step-preview-schema"),
    ).not.toBeInTheDocument();
  });

  it("shows a loading indicator while the preview request is in flight", async () => {
    fetchStepPreviewMock.mockReturnValue(new Promise<never>(() => {}));

    render(<StepCard {...baseProps()} />);
    await click("Limit rows");
    await click("Preview data");

    expect(screen.getByText("Loading preview…")).toBeInTheDocument();
  });

  it("shows an inline error message when the preview request fails", async () => {
    fetchStepPreviewMock.mockRejectedValue(new Error("Network error"));

    render(<StepCard {...baseProps()} />);
    await click("Limit rows");
    await click("Preview data");

    expect(screen.getByRole("alert")).toHaveTextContent("Network error");
  });

  it("second toggle hides the preview", async () => {
    fetchStepPreviewMock.mockResolvedValue({ rows: [{ id: 1, name: "alice" }], rowCount: 1 });

    render(<StepCard {...baseProps()} />);
    await click("Limit rows");
    await click("Preview data");
    expect(screen.getByText("alice")).toBeInTheDocument();

    await click("Hide preview");

    expect(screen.queryByText("alice")).not.toBeInTheDocument();
  });
});

describe("StepCard preview — refresh on edit (3.2)", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  it("re-fetches exactly once, debounced, when the config changes while the preview is open", async () => {
    fetchStepPreviewMock.mockResolvedValue({ rows: [{ id: 1 }], rowCount: 1 });

    const { rerender } = render(<StepCard {...baseProps()} />);
    await click("Limit rows");
    await click("Preview data");

    expect(fetchStepPreviewMock).toHaveBeenCalledTimes(1);

    // Simulate a config PATCH settling: the parent re-renders StepCard with
    // the new persisted config (design.md Decision 2 — StepCard does not
    // drive the PATCH itself here).
    await act(async () => {
      rerender(<StepCard {...baseProps({ step: makeStep({ config: { count: 10 } }) })} />);
    });

    // Not yet — still inside the debounce window.
    expect(fetchStepPreviewMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      jest.advanceTimersByTime(500);
    });

    expect(fetchStepPreviewMock).toHaveBeenCalledTimes(2);

    // A further re-render with the *same* config should not trigger another fetch.
    await act(async () => {
      rerender(<StepCard {...baseProps({ step: makeStep({ config: { count: 10 } }) })} />);
    });
    await act(async () => {
      jest.advanceTimersByTime(500);
    });
    expect(fetchStepPreviewMock).toHaveBeenCalledTimes(2);
  });

  it("does not fetch on config change while the preview is closed", async () => {
    const { rerender } = render(<StepCard {...baseProps()} />);
    await click("Limit rows");

    await act(async () => {
      rerender(<StepCard {...baseProps({ step: makeStep({ config: { count: 10 } }) })} />);
    });

    await act(async () => {
      jest.advanceTimersByTime(500);
    });

    expect(fetchStepPreviewMock).not.toHaveBeenCalled();
  });
});

describe("StepCard preview — persistent open preference (3.3)", () => {
  it("auto-opens the preview on expand when the stored preference is true", async () => {
    window.localStorage.setItem("helio-step-preview-open", "true");
    fetchStepPreviewMock.mockResolvedValue({ rows: [{ id: 1 }], rowCount: 1 });

    render(<StepCard {...baseProps()} />);
    await click("Limit rows");

    expect(screen.getByRole("button", { name: "Hide preview" })).toBeInTheDocument();
    expect(fetchStepPreviewMock).toHaveBeenCalledWith("pipe-1", "step-1");
  });

  it("writes false to storage when the user hides an open preview", async () => {
    fetchStepPreviewMock.mockResolvedValue({ rows: [{ id: 1 }], rowCount: 1 });

    render(<StepCard {...baseProps()} />);
    await click("Limit rows");
    await click("Preview data");
    expect(screen.getByRole("button", { name: "Hide preview" })).toBeInTheDocument();

    await click("Hide preview");

    expect(window.localStorage.getItem("helio-step-preview-open")).toBe("false");
  });

  it("defaults closed when no value is stored", async () => {
    render(<StepCard {...baseProps()} />);
    await click("Limit rows");

    expect(screen.getByRole("button", { name: "Preview data" })).toBeInTheDocument();
  });

  it("defaults closed when the stored value is invalid", async () => {
    window.localStorage.setItem("helio-step-preview-open", "yes-please");

    render(<StepCard {...baseProps()} />);
    await click("Limit rows");

    expect(screen.getByRole("button", { name: "Preview data" })).toBeInTheDocument();
  });
});

describe("StepCard preview — cross-card same-session preference (3.4)", () => {
  it("re-syncs from localStorage on expand, not just at mount", async () => {
    fetchStepPreviewMock.mockResolvedValue({ rows: [{ id: 1 }], rowCount: 1 });

    // Both cards mount unconditionally (as in PipelineRiverView.steps.map),
    // before either is expanded — so both read the not-yet-set preference
    // (false) in their mount-time lazy initializer.
    render(
      <>
        <StepCard {...baseProps({ step: makeStep({ id: "step-1", label: "Card one" }) })} />
        <StepCard {...baseProps({ step: makeStep({ id: "step-2", label: "Card two" }) })} />
      </>,
    );

    await click("Card one");
    await click("Preview data");
    expect(screen.getByRole("button", { name: "Hide preview" })).toBeInTheDocument();

    // Card two expands *after* card one's toggle wrote the preference —
    // a mount-time-only read would still show "Preview data" here.
    await click("Card two");

    expect(screen.getAllByRole("button", { name: "Hide preview" })).toHaveLength(2);
  });
});
