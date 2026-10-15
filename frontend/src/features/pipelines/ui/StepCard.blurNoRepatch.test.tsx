// HEL-1507: leaving a step-config text field must not re-save the config it already committed per keystroke.

import { act, fireEvent, screen } from "@testing-library/react";

import { StepCard } from "./StepCard";
import { renderWithStore } from "../../../test/renderWithStore";
import { OP_TYPES } from "../state/stepNarrowing";
import { updatePipelineStep } from "../services/pipelineService";
import type { Step } from "../types/step";

// HEL-1600 -- stands in for GET /api/data-sources, which this test reaches but does not exercise
// (the network guard fails an unmocked request); rejects (a plain Error) in place of the AxiosError network failure.
jest.mock("../../sources/services/dataSourceService", () => ({
  ...jest.requireActual("../../sources/services/dataSourceService"),
  fetchSources: jest.fn(() =>
    Promise.reject(new Error("fetchSources: unmocked request stubbed (HEL-1600)")),
  ),
}));

jest.mock("../services/pipelineService", () => ({
  fetchStepPreview: jest.fn(),
  updatePipelineStep: jest.fn(),
}));

const updatePipelineStepMock = jest.mocked(updatePipelineStep);

function baseProps(step: Step) {
  return {
    step,
    stepIndex: 0,
    pipelineId: "pipe-1",
    onRemove: jest.fn(),
    analyzeColumns: ["amount", "region"],
    analyzeSchema: [
      { name: "amount", type: "number" },
      { name: "region", type: "string" },
    ],
    analyzeOutputSchema: [],
    onConfigChange: jest.fn(),
    rowCount: null,
    onStepDragStart: jest.fn(),
    onStepDragEnd: jest.fn(),
    onToggleEnabled: jest.fn(),
    onDuplicate: jest.fn(),
    isDuplicating: false,
    enabledBits: "1",
    outputs: [],
    previewRowCountByOutputId: {},
    onOpenOutput: jest.fn(),
    onAddOutput: jest.fn(),
  };
}

const CASES: {
  id: "convertformat" | "compute" | "upsertsource";
  field: string;
  config: Step["config"];
  typed: string;
  expectedConfig: unknown;
}[] = [
  {
    id: "convertformat",
    field: "Destination field",
    config: { field: "region", from: "csv", to: "json" },
    typed: "dest",
    expectedConfig: { field: "region", from: "csv", to: "json", outputField: "dest" },
  },
  {
    id: "compute",
    field: "Output field name",
    config: { column: "dbl", expression: "amount * 2", type: "number" },
    typed: "dbl2",
    expectedConfig: { column: "dbl2", expression: "amount * 2", type: "number" },
  },
  {
    id: "compute",
    field: "Expression",
    config: { column: "dbl", expression: "amount * 2", type: "number" },
    typed: "amount * 3",
    expectedConfig: { column: "dbl", expression: "amount * 3", type: "number" },
  },
  {
    id: "upsertsource",
    field: "New source name",
    config: { target: { kind: "newSource", name: "sink" }, mode: "append" },
    typed: "sink2",
    expectedConfig: { target: { kind: "newSource", name: "sink2" }, mode: "append" },
  },
];

async function openCard(c: (typeof CASES)[number]) {
  const opType = OP_TYPES.find((op) => op.id === c.id)!;
  const step: Step = {
    id: "persisted-step-1",
    opType,
    label: opType.label,
    config: c.config,
    enabled: true,
  };
  renderWithStore(<StepCard {...baseProps(step)} />);
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: opType.label }));
  });
}

async function settle() {
  await act(async () => {
    jest.advanceTimersByTime(1000);
  });
}

describe("StepCard — blurring a text field does not re-save (HEL-1507)", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    window.localStorage.clear();
    updatePipelineStepMock.mockResolvedValue(undefined as never);
  });
  afterEach(() => {
    jest.clearAllMocks();
    jest.useRealTimers();
  });

  it.each(CASES)("$id / $field: change, debounce, blur sends exactly one save", async (c) => {
    await openCard(c);
    const input = screen.getByRole("textbox", { name: c.field });

    fireEvent.change(input, { target: { value: c.typed } });
    await settle();
    fireEvent.blur(input);
    await settle();

    expect(updatePipelineStepMock).toHaveBeenCalledTimes(1);
    expect(updatePipelineStepMock).toHaveBeenCalledWith("persisted-step-1", c.expectedConfig);
  });

  it.each(CASES)("$id / $field: focus then blur with no edit sends no save", async (c) => {
    await openCard(c);
    const input = screen.getByRole("textbox", { name: c.field });

    fireEvent.focus(input);
    fireEvent.blur(input);
    await settle();

    expect(updatePipelineStepMock).not.toHaveBeenCalled();
  });
});
