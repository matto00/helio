// HEL-1809: rows are memoised on what they show, so a row can be skipped while the lane's menu closures change. The handler a
// click reaches must still be the one from the lane's LATEST render, never the one the row last rendered with.

import { fireEvent, render, screen } from "@testing-library/react";

import { buildLaneGraph } from "../../state/stepTree";
import { OP_TYPES } from "../../state/stepNarrowing";
import type { Step } from "../../types/step";
import { SpineLane, type SpineLaneContext } from "./SpineLane";

const STEPS: Step[] = [
  {
    id: "s1",
    opType: OP_TYPES.find((o) => o.id === "filter")!,
    label: "Filter rows",
    config: {} as Step["config"],
    enabled: true,
    rootId: "r1",
  },
];
const SELECT = () => undefined;
const ROOTS = [{ id: "r1", dataSourceId: "src", dataSourceName: "Orders" }];

function contextWith(onClick: () => void): SpineLaneContext {
  return {
    laneGraph: buildLaneGraph(STEPS, ROOTS),
    selectedStepId: null,
    rowCountFor: () => null,
    countsPartial: false,
    hasValidationError: () => false,
    warningCountFor: () => 0,
    stepSaveErrors: {},
    creatingStepIds: new Set<string>(),
    nodePathByStepId: {},
    onSelectStep: SELECT,
    menuItemsFor: () => [{ label: "Do it", onClick }],
    reorderFor: () => undefined,
    dropIndicatorAt: () => false,
    phone: false,
  };
}

describe("SpineLane row handlers (HEL-1809)", () => {
  it("calls the latest render's menu handler even when the memoised row did not re-render", () => {
    const first = jest.fn();
    const second = jest.fn();
    const lane = buildLaneGraph(STEPS, ROOTS).lanes[0];
    const { rerender } = render(
      <SpineLane lane={lane} context={contextWith(first)} label={null} />,
    );
    rerender(<SpineLane lane={lane} context={contextWith(second)} label={null} />);

    fireEvent.click(screen.getByRole("button", { name: "Step actions for Filter rows" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Do it" }));

    expect(second).toHaveBeenCalledTimes(1);
    expect(first).not.toHaveBeenCalled();
  });
});
