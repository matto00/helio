// HEL-1316 seam test, frontend half. `shared-test-fixtures/window-rolling-seam.json` holds the exact
// config the window editor persists for a rolling frame; the backend half (`WindowRollingSeamSpec`)
// creates a step from the SAME config through the real routes, analyzes it and previews it over the
// fixture's input. This drives the real editor (`StepOpEditor` + `useStepCardState`) with
// `updatePipelineStep` mocked and asserts the outgoing PATCH body equals the fixture config with an
// EXACT key set (never editor-local state), so a key renamed or leaked in the persist payload fails here.

import { act, fireEvent, screen } from "@testing-library/react";
import fs from "node:fs";
import path from "node:path";

import { renderWithStore } from "../../../../test/renderWithStore";
import { updatePipelineStep } from "../../services/pipelineService";
import { useStepCardState } from "../../hooks/useStepCardState";
import { OP_TYPES } from "../../state/stepNarrowing";
import type { PipelineStep } from "../../types/pipelineStep";
import type { Step } from "../../types/step";
import { StepOpEditor } from "../StepOpEditor";

jest.mock("../../services/pipelineService", () => ({
  updatePipelineStep: jest.fn(),
}));
const updatePipelineStepMock = jest.mocked(updatePipelineStep);

function findRepoRoot(dir: string): string {
  return fs.existsSync(path.join(dir, "shared-test-fixtures"))
    ? dir
    : findRepoRoot(path.dirname(dir));
}

const fixture = JSON.parse(
  fs.readFileSync(
    path.join(findRepoRoot(__dirname), "shared-test-fixtures/window-rolling-seam.json"),
    "utf8",
  ),
) as { config: Record<string, unknown> };

const WINDOW_OP = OP_TYPES.find((op) => op.id === "window")!;

// What a user starts from: a saved row_number window over the fixture's partition and ordering.
const windowStep: Step = {
  id: "persisted-window-1",
  opType: WINDOW_OP,
  label: "Window",
  config: {
    partitionBy: fixture.config.partitionBy,
    orderBy: fixture.config.orderBy,
    function: "row_number",
    outputColumn: fixture.config.outputColumn,
  } as unknown as Step["config"],
  enabled: true,
};

function Harness() {
  const state = useStepCardState(windowStep, jest.fn());
  return (
    <StepOpEditor
      step={windowStep}
      allSteps={[windowStep]}
      analyzeColumns={["team", "date", "v"]}
      analyzeSchema={[
        { name: "team", type: "string" },
        { name: "date", type: "string" },
        { name: "v", type: "number" },
      ]}
      isOwner
      stepCardState={state}
    />
  );
}

function choose(comboboxName: string, optionLabel: string) {
  fireEvent.click(screen.getByRole("combobox", { name: comboboxName }));
  fireEvent.click(screen.getByRole("option", { name: optionLabel }));
}

async function lastPersistedBody(): Promise<Record<string, unknown>> {
  await act(async () => {
    jest.runAllTimers();
  });
  const calls = updatePipelineStepMock.mock.calls;
  return calls[calls.length - 1][1] as unknown as Record<string, unknown>;
}

describe("window rolling step config seam (shared fixture)", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    updatePipelineStepMock.mockReset();
    updatePipelineStepMock.mockResolvedValue({} as PipelineStep);
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it("persists exactly the fixture config", async () => {
    renderWithStore(<Harness />);
    expect(updatePipelineStepMock).not.toHaveBeenCalled();
    choose("Window function", fixture.config.function as string);
    choose("Source field", fixture.config.field as string);
    fireEvent.change(screen.getByRole("spinbutton", { name: /frame size/i }), {
      target: { value: String(fixture.config.frameSize) },
    });
    choose("Frame unit", fixture.config.frameUnit as string);
    const body = await lastPersistedBody();
    expect(body).toEqual(fixture.config);
    expect(Object.keys(body).sort()).toEqual(Object.keys(fixture.config).sort());
  });

  it("persists the chosen source field for a rolling function (the old hard-coded field list dropped it)", async () => {
    renderWithStore(<Harness />);
    choose("Window function", "rolling_avg");
    choose("Source field", "v");
    const body = await lastPersistedBody();
    expect(body.field).toBe("v");
    // 7 / rows is filled on the switch, and nothing else leaks (no offset).
    expect(Object.keys(body).sort()).toEqual(
      [
        "field",
        "frameSize",
        "frameUnit",
        "function",
        "orderBy",
        "outputColumn",
        "partitionBy",
      ].sort(),
    );
    expect(body).toMatchObject({ frameSize: 7, frameUnit: "rows", function: "rolling_avg" });
  });

  it("keeps the legacy wire shape for a non-rolling function (no frame keys)", async () => {
    renderWithStore(<Harness />);
    choose("Window function", "lag");
    choose("Source field", "v");
    const body = await lastPersistedBody();
    expect(Object.keys(body).sort()).toEqual(
      ["field", "function", "offset", "orderBy", "outputColumn", "partitionBy"].sort(),
    );
  });
});
