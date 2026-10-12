// StepCard.castSaveError.test.tsx — HEL-1514: the cast editor surfaces the server's message when a
// config save is rejected (a stored legacy target makes every full-map PATCH a 422), as HEL-1416 does
// for fillnull / window / pivot.

import { act, fireEvent, screen } from "@testing-library/react";
import { AxiosError, type AxiosResponse } from "axios";

import { StepCard } from "./StepCard";
import { renderWithStore } from "../../../test/renderWithStore";
import { OP_TYPES } from "../state/stepNarrowing";
import { updatePipelineStep } from "../services/pipelineService";
import type { Step } from "../types/step";

jest.mock("../services/pipelineService", () => ({
  fetchStepPreview: jest.fn(),
  updatePipelineStep: jest.fn(),
}));

const updatePipelineStepMock = jest.mocked(updatePipelineStep);

function rejection(message: string, status = 422): AxiosError {
  return new AxiosError(
    `Request failed with status code ${status}`,
    "ERR_BAD_REQUEST",
    undefined,
    null,
    { status, data: { message } } as AxiosResponse,
  );
}

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

function pick(comboboxName: string, optionLabel: string) {
  fireEvent.click(screen.getByRole("combobox", { name: comboboxName }));
  fireEvent.click(screen.getByRole("option", { name: optionLabel }));
}

const LEGACY_MESSAGE =
  "cast: unsupported target type 'binary-ref' for field 'amount'. Supported: string, integer";

async function openCastAndEditOtherRow(rejectWith: AxiosError) {
  updatePipelineStepMock.mockRejectedValue(rejectWith);
  const step: Step = {
    id: "persisted-step-1",
    opType: OP_TYPES.find((op) => op.id === "cast")!,
    label: "Cast step",
    config: { casts: { amount: "binary-ref" } },
    enabled: true,
  };
  renderWithStore(<StepCard {...baseProps(step)} />);
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Cast step" }));
  });
  pick("Target type for region", "integer");
  await act(async () => {
    jest.advanceTimersByTime(1000);
  });
}

describe("StepCard — rejected cast save (HEL-1514)", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    window.localStorage.clear();
  });
  afterEach(() => {
    jest.clearAllMocks();
    jest.useRealTimers();
  });

  it("editing another row of a cast with a stored legacy target shows the server's 422 message", async () => {
    await openCastAndEditOtherRow(rejection(LEGACY_MESSAGE));

    expect(updatePipelineStepMock).toHaveBeenCalledTimes(1);
    expect(screen.getByText(LEGACY_MESSAGE)).toBeInTheDocument();
  });

  it("also shows a non-422 failure message (nothing looks saved)", async () => {
    await openCastAndEditOtherRow(rejection("Internal boom", 500));

    expect(screen.getByText("Internal boom")).toBeInTheDocument();
  });

  it("clears the message on the next successful save", async () => {
    await openCastAndEditOtherRow(rejection(LEGACY_MESSAGE));
    expect(screen.getByText(LEGACY_MESSAGE)).toBeInTheDocument();
    updatePipelineStepMock.mockResolvedValue(undefined as never);
    pick("Target type for amount", "— keep as is —");
    await act(async () => {
      jest.advanceTimersByTime(1000);
    });

    expect(screen.queryByText(LEGACY_MESSAGE)).not.toBeInTheDocument();
  });
});
