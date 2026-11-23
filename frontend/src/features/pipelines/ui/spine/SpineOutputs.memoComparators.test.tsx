// HEL-1809: SpineOutputs is memoised on a value comparator. Every value it compares must reach the DOM when it changes.

import { fireEvent, render, screen } from "@testing-library/react";

import { buildLaneGraph } from "../../state/stepTree";
import { OP_TYPES } from "../../state/stepNarrowing";
import type { Output } from "../../types/output";
import type { Step } from "../../types/step";
import { SpineOutputs } from "./SpineOutputs";

const ROOTS = [{ id: "r1", dataSourceId: "src", dataSourceName: "Orders" }];
const step = (id: string, label: string, parentStepId?: string): Step => ({
  id,
  opType: OP_TYPES.find((o) => o.id === "limit")!,
  label,
  config: { count: 1 } as Step["config"],
  enabled: true,
  rootId: parentStepId === undefined ? "r1" : undefined,
  parentStepId: parentStepId ?? null,
  position: 0,
});
const STEPS = [step("s1", "First"), step("s2", "Second", "s1")];
const output = (over: Partial<Output> = {}): Output =>
  ({
    id: "o1",
    pipelineId: "p",
    nodeStepId: "s2",
    ownerId: "u",
    name: "Revenue",
    kind: "table",
    config: {},
    schema: [],
    createdAt: "",
    updatedAt: "",
    ...over,
  }) as Output;

const noop = () => undefined;
const props = (over: Record<string, unknown> = {}) => {
  const steps = (over.steps as Step[] | undefined) ?? STEPS;
  return {
    outputs: [output()],
    steps,
    laneGraph: buildLaneGraph(steps, ROOTS),
    onOpenOutput: noop,
    onOpenHistory: noop,
    onAddOutput: noop,
    ...over,
  };
};
const from = () => screen.getByRole("button", { name: "Open Revenue output" }).textContent ?? "";

describe("SpineOutputs comparator: a changed value always reaches the DOM (HEL-1809)", () => {
  it("source line: relabelling the step an Output reads from updates its 'from ...' text", () => {
    const { rerender } = render(<SpineOutputs {...props()} />);
    const before = from();
    const steps = [step("s1", "First"), step("s2", "Renamed step", "s1")];
    rerender(<SpineOutputs {...props({ steps })} />);
    expect(from()).not.toBe(before);
    expect(from()).toContain("Renamed step");
  });

  it("source line: moving the Output to another step updates the text", () => {
    const { rerender } = render(<SpineOutputs {...props()} />);
    const before = from();
    rerender(<SpineOutputs {...props({ outputs: [output({ nodeStepId: "s1" })] })} />);
    expect(from()).not.toBe(before);
  });

  it("name and kind and panel count", () => {
    const { rerender } = render(<SpineOutputs {...props()} />);
    rerender(
      <SpineOutputs
        {...props({ outputs: [output({ name: "Costs", kind: "chart", panelCount: 3 })] })}
      />,
    );
    const text = screen.getByRole("button", { name: "Open Costs output" }).textContent;
    expect(text).toContain("Chart");
    expect(text).toContain("used in 3 panels");
  });

  it("edited ids", () => {
    const { rerender } = render(<SpineOutputs {...props()} />);
    expect(from()).not.toContain("Edited");
    rerender(<SpineOutputs {...props({ editedOutputIds: new Set(["o1"]) })} />);
    expect(from()).toContain("Edited");
  });

  it("blockedReason", () => {
    const { rerender } = render(<SpineOutputs {...props()} />);
    rerender(<SpineOutputs {...props({ blockedReason: "Outputs are still loading" })} />);
    expect(screen.getByRole("button", { name: "New output" })).toBeDisabled();
  });

  it("variant", () => {
    const { rerender, container } = render(<SpineOutputs {...props()} />);
    rerender(<SpineOutputs {...props({ variant: "phone" })} />);
    expect(container.querySelector(".spine-card__chevron")).not.toBeNull();
  });

  it("callbacks: a new handler is the one a click reaches", () => {
    const first = jest.fn();
    const second = jest.fn();
    const { rerender } = render(<SpineOutputs {...props({ onAddOutput: first })} />);
    rerender(<SpineOutputs {...props({ onAddOutput: second })} />);
    fireEvent.click(screen.getByRole("button", { name: "New output" }));
    expect(second).toHaveBeenCalledTimes(1);
    expect(first).not.toHaveBeenCalled();
  });
});

describe("SpineOutputs readOnly (HEL-1794)", () => {
  it("flipping readOnly removes and restores New output (a role flip reaches the DOM)", () => {
    const { rerender } = render(<SpineOutputs {...props()} readOnly={false} />);
    expect(screen.getByRole("button", { name: "New output" })).toBeVisible();
    rerender(<SpineOutputs {...props()} readOnly />);
    expect(screen.queryByRole("button", { name: "New output" })).toBeNull();
    rerender(<SpineOutputs {...props()} readOnly={false} />);
    expect(screen.getByRole("button", { name: "New output" })).toBeVisible();
  });
});
