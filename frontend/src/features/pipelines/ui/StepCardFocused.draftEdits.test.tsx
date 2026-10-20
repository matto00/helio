// StepCardFocused.draftEdits.test.tsx -- HEL-1631. It replaces StepCardFocused.castSaveError.test.tsx (HEL-1514) and
// StepCardFocused.enumSaveError.test.tsx (HEL-1416/HEL-1422), which pinned the inline display of a PATCH the server rejected
// (a 422 on a stored legacy cast target, an unsupported fillnull/window/pivot enum). The editor no longer sends a PATCH: an edit
// goes into the page's client-only draft, and the server's verdict arrives when the draft is saved (the draft-mode page test
// covers that notice, naming the step). What still has to hold here: the edit reaches the draft with the value the user
// chose, nothing is sent, and no stale inline error or invalid mark appears.

import { fireEvent, screen } from "@testing-library/react";

import { StepCardFocused } from "./StepCardFocused";
import { renderWithStore } from "../../../test/renderWithStore";
import { OP_TYPES } from "../state/stepNarrowing";
import { updatePipelineStep } from "../services/pipelineService";
import type { Step } from "../types/step";

jest.mock("../services/pipelineService", () => ({
  fetchStepPreview: jest.fn(),
  updatePipelineStep: jest.fn(),
}));

const updatePipelineStepMock = jest.mocked(updatePipelineStep);

function baseProps(step: Step, onConfigChange = jest.fn()) {
  return {
    step,
    stepNumber: 1,
    onRemove: jest.fn(),
    analyzeColumns: ["amount", "region"],
    analyzeSchema: [
      { name: "amount", type: "number" },
      { name: "region", type: "string" },
    ],
    onConfigChange,
    onToggleEnabled: jest.fn(),
    onDuplicate: jest.fn(),
    isDuplicating: false,
  };
}

function pick(comboboxName: string, optionLabel: string) {
  fireEvent.click(screen.getByRole("combobox", { name: comboboxName }));
  fireEvent.click(screen.getByRole("option", { name: optionLabel }));
}

const step = (id: string, label: string, config: Step["config"]): Step => ({
  id: "persisted-step-1",
  opType: OP_TYPES.find((op) => op.id === id)!,
  label,
  config,
  enabled: true,
});

beforeEach(() => {
  window.localStorage.clear();
  updatePipelineStepMock.mockReset();
});

describe("StepCardFocused -- enum and cast edits go to the draft (HEL-1631)", () => {
  it("editing another row of a cast with a stored legacy target reports the edit and sends nothing", () => {
    const onConfigChange = jest.fn();
    renderWithStore(
      <StepCardFocused
        {...baseProps(
          step("cast", "Cast step", { casts: { amount: "binary-ref" } }),
          onConfigChange,
        )}
      />,
    );

    pick("Target type for region", "integer");

    expect(onConfigChange).toHaveBeenCalledTimes(1);
    expect(onConfigChange).toHaveBeenCalledWith("persisted-step-1", {
      casts: { amount: "binary-ref", region: "integer" },
    });
    expect(updatePipelineStepMock).not.toHaveBeenCalled();
  });

  const ENUM_CASES = [
    {
      id: "fillnull",
      label: "Fill step",
      config: { columns: [], strategy: "constant", value: null },
      control: "Fill strategy",
      chosen: "mean",
    },
    {
      id: "window",
      label: "Window step",
      config: { partitionBy: [], orderBy: [], function: "row_number", outputColumn: "" },
      control: "Window function",
      chosen: "rank",
    },
    {
      id: "pivot",
      label: "Pivot step",
      config: { index: [], column: "", values: "", agg: "sum" },
      control: "Pivot aggregation function",
      chosen: "first",
    },
  ] as const;

  it.each(ENUM_CASES)(
    "$id: the chosen value is kept and reported, the control is not marked invalid, nothing is sent",
    ({ id, label, config, control, chosen }) => {
      const onConfigChange = jest.fn();
      renderWithStore(
        <StepCardFocused
          {...baseProps(step(id, label, config as unknown as Step["config"]), onConfigChange)}
        />,
      );

      pick(control, chosen);

      expect(onConfigChange).toHaveBeenCalledTimes(1);
      expect(screen.getByRole("combobox", { name: control })).toHaveTextContent(chosen);
      expect(screen.getByRole("combobox", { name: control })).not.toHaveAttribute("aria-invalid");
      expect(updatePipelineStepMock).not.toHaveBeenCalled();
    },
  );
});
