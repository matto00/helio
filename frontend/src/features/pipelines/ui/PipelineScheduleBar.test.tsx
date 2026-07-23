import { fireEvent, render, screen } from "@testing-library/react";
import { PipelineScheduleBar } from "./PipelineScheduleBar";
import type { PipelineSchedule } from "../types/pipelineSchedule";

const enabledSchedule: PipelineSchedule = {
  id: "sched-1",
  pipelineId: "p-1",
  kind: "interval",
  expression: "15m",
  enabled: true,
  timezone: "UTC",
  nextRunAt: "2026-05-01T11:00:00Z",
  lastRunAt: null,
  createdAt: "2026-05-01T10:00:00Z",
  updatedAt: "2026-05-01T10:00:00Z",
};

describe("PipelineScheduleBar", () => {
  it("shows 'No schedule set' and a 'Set schedule' button when schedule is null", () => {
    render(
      <PipelineScheduleBar
        schedule={null}
        onEditSchedule={jest.fn()}
        onToggleEnabled={jest.fn()}
      />,
    );
    expect(screen.getByText("No schedule set")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Set schedule" })).toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  });

  it("clicking 'Set schedule' calls onEditSchedule", () => {
    const onEditSchedule = jest.fn();
    render(
      <PipelineScheduleBar
        schedule={null}
        onEditSchedule={onEditSchedule}
        onToggleEnabled={jest.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Set schedule" }));
    expect(onEditSchedule).toHaveBeenCalledTimes(1);
  });

  it("shows the expression and next-run time when enabled with a computed next run", () => {
    render(
      <PipelineScheduleBar
        schedule={enabledSchedule}
        onEditSchedule={jest.fn()}
        onToggleEnabled={jest.fn()}
      />,
    );
    expect(screen.getByText("Every 15m")).toBeInTheDocument();
    expect(screen.getByText(/next run/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Edit schedule" })).toBeInTheDocument();
  });

  it("shows 'no next run yet' (not an error) when enabled but nextRunAt is null", () => {
    const schedule: PipelineSchedule = { ...enabledSchedule, nextRunAt: null };
    render(
      <PipelineScheduleBar
        schedule={schedule}
        onEditSchedule={jest.fn()}
        onToggleEnabled={jest.fn()}
      />,
    );
    expect(screen.getByText("no next run yet")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  // Regression test (evaluation-1 change request 1): spray-json's default
  // `Option` formatter omits `None` fields from the wire entirely rather than
  // serializing `null` — a freshly-saved/cadence-changed schedule's
  // not-yet-computed `nextRunAt` deserializes with the key **absent**, not
  // `null`. Simulate that exact wire shape (key omitted, not set to `null`)
  // rather than `nextRunAt: null`, per the project's established
  // spray-json-omits-`None` testing guidance.
  it("shows 'no next run yet' (not 'Invalid Date') when nextRunAt is omitted entirely from the payload", () => {
    const { nextRunAt: _omitted, ...rest } = enabledSchedule;
    const scheduleWithOmittedNextRun = rest as unknown as PipelineSchedule;
    expect("nextRunAt" in scheduleWithOmittedNextRun).toBe(false);

    render(
      <PipelineScheduleBar
        schedule={scheduleWithOmittedNextRun}
        onEditSchedule={jest.fn()}
        onToggleEnabled={jest.fn()}
      />,
    );
    expect(screen.getByText("no next run yet")).toBeInTheDocument();
    expect(screen.queryByText(/Invalid Date/)).not.toBeInTheDocument();
  });

  it("shows a Disabled badge and no next-run text when disabled", () => {
    const schedule: PipelineSchedule = { ...enabledSchedule, enabled: false };
    render(
      <PipelineScheduleBar
        schedule={schedule}
        onEditSchedule={jest.fn()}
        onToggleEnabled={jest.fn()}
      />,
    );
    expect(screen.getByText("Disabled")).toBeInTheDocument();
    expect(screen.queryByText(/next run/)).not.toBeInTheDocument();
  });

  it("the enabled toggle reflects schedule.enabled and calls onToggleEnabled with the new value", () => {
    const onToggleEnabled = jest.fn();
    render(
      <PipelineScheduleBar
        schedule={enabledSchedule}
        onEditSchedule={jest.fn()}
        onToggleEnabled={onToggleEnabled}
      />,
    );
    const toggle = screen.getByRole("checkbox", { name: "Disable schedule" });
    expect(toggle).toBeChecked();
    fireEvent.click(toggle);
    expect(onToggleEnabled).toHaveBeenCalledWith(false);
  });

  it("clicking 'Edit schedule' calls onEditSchedule", () => {
    const onEditSchedule = jest.fn();
    render(
      <PipelineScheduleBar
        schedule={enabledSchedule}
        onEditSchedule={onEditSchedule}
        onToggleEnabled={jest.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Edit schedule" }));
    expect(onEditSchedule).toHaveBeenCalledTimes(1);
  });

  it("shows a cron expression verbatim (no 'Every' prefix) for kind: cron", () => {
    const cronSchedule: PipelineSchedule = {
      ...enabledSchedule,
      kind: "cron",
      expression: "0 * * * *",
    };
    render(
      <PipelineScheduleBar
        schedule={cronSchedule}
        onEditSchedule={jest.fn()}
        onToggleEnabled={jest.fn()}
      />,
    );
    expect(screen.getByText("0 * * * *")).toBeInTheDocument();
  });
});
