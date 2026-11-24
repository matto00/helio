// HEL-1837: the chip's read-only variant is a non-interactive element carrying the same state text; it renders nothing
// without a schedule and never offers "Add schedule".
import { fireEvent, render, screen } from "@testing-library/react";

import type { PipelineSchedule } from "../../types/pipelineSchedule";
import { SpineScheduleChip } from "./SpineScheduleChip";

const SCHEDULE: PipelineSchedule = {
  id: "s",
  pipelineId: "p",
  kind: "interval",
  expression: "30m",
  enabled: true,
  timezone: "UTC",
  nextRunAt: null,
  lastRunAt: null,
  createdAt: "",
  updatedAt: "",
};

describe("SpineScheduleChip readOnly", () => {
  it("renders a non-button with the expression and next-run text, and ignores clicks", () => {
    const onOpen = jest.fn();
    render(<SpineScheduleChip schedule={SCHEDULE} onOpen={onOpen} readOnly />);
    expect(screen.queryByRole("button")).toBeNull();
    const text = screen.getByText("Every 30m");
    expect(text).toBeVisible();
    expect(screen.getByText("no next run yet")).toBeVisible();
    fireEvent.click(text);
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("shows Paused for a disabled schedule", () => {
    render(
      <SpineScheduleChip schedule={{ ...SCHEDULE, enabled: false }} onOpen={jest.fn()} readOnly />,
    );
    expect(screen.getByText("Paused")).toBeVisible();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("carries the static modifier (no pointer, no hover wash, no tap overlay) and the button does not", () => {
    const { container, rerender } = render(
      <SpineScheduleChip schedule={SCHEDULE} onOpen={jest.fn()} readOnly />,
    );
    expect(container.querySelector(".spine-header__chip")).toHaveClass(
      "spine-header__chip--static",
    );
    rerender(<SpineScheduleChip schedule={SCHEDULE} onOpen={jest.fn()} readOnly={false} />);
    expect(screen.getByRole("button", { name: "Edit schedule" })).not.toHaveClass(
      "spine-header__chip--static",
    );
  });

  it("is read-only by default (fail closed)", () => {
    render(<SpineScheduleChip schedule={SCHEDULE} onOpen={jest.fn()} />);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("renders nothing when there is no schedule", () => {
    const { container } = render(<SpineScheduleChip schedule={null} onOpen={jest.fn()} readOnly />);
    expect(container).toBeEmptyDOMElement();
  });

  it("with readOnly={false} (the owner) the chip is still a button that opens", () => {
    const onOpen = jest.fn();
    render(<SpineScheduleChip schedule={null} onOpen={onOpen} readOnly={false} />);
    fireEvent.click(screen.getByRole("button", { name: "Add schedule" }));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });
});
