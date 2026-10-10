// StepCard.enumSaveError.test.tsx — HEL-1416: the fillnull / window / pivot editors surface the
// server's 422 message when a config save is rejected (the other kinds keep swallowing it).

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

const CASES: {
  id: "fillnull" | "window" | "pivot";
  label: string;
  config: Step["config"];
  edit: () => void;
  /** The enum control the server's rejection is about, and the value the edit picks. */
  control: string;
  chosen: string;
}[] = [
  {
    id: "fillnull",
    label: "Fill step",
    config: { columns: [], strategy: "constant", value: null },
    edit: () => pick("Fill strategy", "mean"),
    control: "Fill strategy",
    chosen: "mean",
  },
  {
    id: "window",
    label: "Window step",
    config: { partitionBy: [], orderBy: [], function: "row_number", outputColumn: "" },
    edit: () => pick("Window function", "rank"),
    control: "Window function",
    chosen: "rank",
  },
  {
    id: "pivot",
    label: "Pivot step",
    config: { index: [], column: "", values: "", agg: "sum" },
    edit: () => pick("Pivot aggregation function", "first"),
    control: "Pivot aggregation function",
    chosen: "first",
  },
];

describe("StepCard — rejected config save (HEL-1416)", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    window.localStorage.clear();
  });
  afterEach(() => {
    jest.clearAllMocks();
    jest.useRealTimers();
  });

  it.each(CASES)(
    "$id editor shows the server's 422 message",
    async ({ id, label, config, edit }) => {
      updatePipelineStepMock.mockRejectedValue(
        rejection("Unsupported thing: 'bogus'. Supported: a, b"),
      );
      const step: Step = {
        id: "persisted-step-1",
        opType: OP_TYPES.find((op) => op.id === id)!,
        label,
        config,
        enabled: true,
      };
      renderWithStore(<StepCard {...baseProps(step)} />);
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: label }));
      });

      edit();
      await act(async () => {
        jest.advanceTimersByTime(1000);
      });

      expect(updatePipelineStepMock).toHaveBeenCalledTimes(1);
      expect(screen.getByText("Unsupported thing: 'bogus'. Supported: a, b")).toBeInTheDocument();
    },
  );

  describe("HEL-1422: a 422 keeps the choice and marks the control invalid", () => {
    async function openAndEdit(c: (typeof CASES)[number], rejectWith: AxiosError) {
      updatePipelineStepMock.mockRejectedValue(rejectWith);
      const step: Step = {
        id: "persisted-step-1",
        opType: OP_TYPES.find((op) => op.id === c.id)!,
        label: c.label,
        config: c.config,
        enabled: true,
      };
      renderWithStore(<StepCard {...baseProps(step)} />);
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: c.label }));
      });
      c.edit();
      await act(async () => {
        jest.advanceTimersByTime(1000);
      });
    }

    it.each(CASES)("$id: keeps the value, aria-invalid + describedby the error", async (c) => {
      await openAndEdit(c, rejection("Unsupported thing: 'bogus'. Supported: a, b"));
      const control = screen.getByRole("combobox", { name: c.control });
      expect(control).toHaveTextContent(c.chosen);
      expect(control).toHaveAttribute("aria-invalid", "true");
      const describedBy = control.getAttribute("aria-describedby");
      expect(describedBy).toBeTruthy();
      expect(document.getElementById(describedBy!)).toHaveTextContent(
        "Unsupported thing: 'bogus'. Supported: a, b",
      );
    });

    it.each(CASES)("$id: a 500 shows the message but marks nothing invalid", async (c) => {
      await openAndEdit(c, rejection("Internal boom", 500));
      expect(screen.getByText("Internal boom")).toBeInTheDocument();
      const control = screen.getByRole("combobox", { name: c.control });
      expect(control).not.toHaveAttribute("aria-invalid");
      expect(control).not.toHaveAttribute("aria-describedby");
    });

    it("clears the mark on the next save attempt", async () => {
      const c = CASES[0];
      await openAndEdit(c, rejection("Unsupported thing: 'bogus'"));
      expect(screen.getByRole("combobox", { name: c.control })).toHaveAttribute(
        "aria-invalid",
        "true",
      );
      updatePipelineStepMock.mockResolvedValue(undefined as never);
      pick("Fill strategy", "median");
      await act(async () => {
        jest.advanceTimersByTime(1000);
      });
      const control = screen.getByRole("combobox", { name: c.control });
      expect(control).not.toHaveAttribute("aria-invalid");
      expect(screen.queryByText("Unsupported thing: 'bogus'")).not.toBeInTheDocument();
    });
  });

  it("falls back to a kind-neutral message when the server gives none", async () => {
    updatePipelineStepMock.mockRejectedValue(new Error("boom"));
    const step: Step = {
      id: "persisted-step-1",
      opType: OP_TYPES.find((op) => op.id === "fillnull")!,
      label: "Fill step",
      config: { columns: [], strategy: "constant", value: null },
      enabled: true,
    };
    renderWithStore(<StepCard {...baseProps(step)} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Fill step" }));
    });
    pick("Fill strategy", "mean");
    await act(async () => {
      jest.advanceTimersByTime(1000);
    });
    expect(screen.getByText(/Failed to save this step/)).toBeInTheDocument();
    expect(screen.queryByText(/target or mode/)).not.toBeInTheDocument();
  });
});
