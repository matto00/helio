import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Provider } from "react-redux";
import { configureStore } from "@reduxjs/toolkit";

import { PipelineScheduleDialog } from "./PipelineScheduleDialog";
import { pipelinesReducer } from "../state/pipelinesSlice";
import {
  getPipelineSchedule,
  putPipelineSchedule,
  deletePipelineSchedule,
} from "../services/pipelineService";
import type { PipelineSchedule } from "../types/pipelineSchedule";

jest.mock("../services/pipelineService", () => ({
  getPipelineSchedule: jest.fn(),
  putPipelineSchedule: jest.fn(),
  deletePipelineSchedule: jest.fn(),
}));

const getPipelineScheduleMock = jest.mocked(getPipelineSchedule);
const putPipelineScheduleMock = jest.mocked(putPipelineSchedule);
const deletePipelineScheduleMock = jest.mocked(deletePipelineSchedule);

const existingSchedule: PipelineSchedule = {
  id: "sched-1",
  pipelineId: "p-1",
  kind: "interval",
  expression: "15m",
  enabled: true,
  timezone: "America/Los_Angeles",
  nextRunAt: "2026-05-01T11:00:00Z",
  lastRunAt: null,
  createdAt: "2026-05-01T10:00:00Z",
  updatedAt: "2026-05-01T10:00:00Z",
};

function makeStore() {
  return configureStore({ reducer: { pipelines: pipelinesReducer } as never });
}

function renderDialog(schedule: PipelineSchedule | null, open = true, onClose = jest.fn()) {
  const store = makeStore();
  const utils = render(
    <Provider store={store}>
      <PipelineScheduleDialog pipelineId="p-1" schedule={schedule} open={open} onClose={onClose} />
    </Provider>,
  );
  return { store, onClose, ...utils };
}

describe("PipelineScheduleDialog", () => {
  beforeAll(() => {
    HTMLDialogElement.prototype.showModal = jest.fn(function (this: HTMLDialogElement) {
      this.setAttribute("open", "");
    });
    HTMLDialogElement.prototype.close = jest.fn(function (this: HTMLDialogElement) {
      this.removeAttribute("open");
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it("never calls getPipelineSchedule itself — it reads the schedule from props/Redux", () => {
    renderDialog(existingSchedule);
    expect(getPipelineScheduleMock).not.toHaveBeenCalled();
  });

  it("edit pre-fills fields from the passed-in schedule", () => {
    renderDialog(existingSchedule);
    expect(screen.getByRole("spinbutton", { name: "Interval number" })).toHaveValue(15);
    expect(screen.getByRole("textbox", { name: "Timezone" })).toHaveValue("America/Los_Angeles");
    expect(screen.getByRole("checkbox", { name: "Enabled" })).toBeChecked();
    expect(screen.getByRole("button", { name: "Clear schedule" })).toBeInTheDocument();
  });

  it("create: defaults to a new schedule with the browser timezone and no 'Clear schedule' button", () => {
    renderDialog(null);
    expect(screen.getByRole("textbox", { name: "Timezone" })).toHaveValue(
      Intl.DateTimeFormat().resolvedOptions().timeZone,
    );
    expect(screen.queryByRole("button", { name: "Clear schedule" })).not.toBeInTheDocument();
  });

  it("create: interval picker composes '<n><unit>' and calls PUT on save", async () => {
    putPipelineScheduleMock.mockResolvedValueOnce({
      ...existingSchedule,
      expression: "30m",
    });
    const onClose = jest.fn();
    renderDialog(null, true, onClose);

    fireEvent.change(screen.getByRole("spinbutton", { name: "Interval number" }), {
      target: { value: "30" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(putPipelineScheduleMock).toHaveBeenCalledWith(
        "p-1",
        expect.objectContaining({ kind: "interval", expression: "30m" }),
      );
    });
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it("clear calls DELETE and closes the dialog on success", async () => {
    deletePipelineScheduleMock.mockResolvedValueOnce(undefined);
    const onClose = jest.fn();
    renderDialog(existingSchedule, true, onClose);

    fireEvent.click(screen.getByRole("button", { name: "Clear schedule" }));

    await waitFor(() => {
      expect(deletePipelineScheduleMock).toHaveBeenCalledWith("p-1");
    });
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it("renders InlineError with the backend's message on a 400, without closing the dialog or clearing input", async () => {
    putPipelineScheduleMock.mockRejectedValueOnce({
      isAxiosError: true,
      response: { status: 400, data: { message: "field 2 ('99') is malformed" } },
    });
    const onClose = jest.fn();
    renderDialog(null, true, onClose);

    fireEvent.change(screen.getByRole("spinbutton", { name: "Interval number" }), {
      target: { value: "99" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(screen.getByText("field 2 ('99') is malformed")).toBeInTheDocument();
    });
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("spinbutton", { name: "Interval number" })).toHaveValue(99);
  });

  it("switching kind to cron shows the mono cron TextField with a format hint", () => {
    renderDialog(null);
    fireEvent.click(screen.getByRole("combobox", { name: "Schedule kind" }));
    fireEvent.click(screen.getByRole("option", { name: "Cron" }));
    expect(screen.getByRole("textbox", { name: "Cron expression" })).toBeInTheDocument();
    expect(screen.getByText(/5-field cron/)).toBeInTheDocument();
  });

  it("edit: decomposes a persisted interval expression into number + unit fields", () => {
    renderDialog({ ...existingSchedule, expression: "2h" });
    expect(screen.getByRole("spinbutton", { name: "Interval number" })).toHaveValue(2);
  });

  it("edit: pre-fills the cron TextField for a cron schedule", () => {
    renderDialog({ ...existingSchedule, kind: "cron", expression: "0 * * * *" });
    expect(screen.getByRole("textbox", { name: "Cron expression" })).toHaveValue("0 * * * *");
  });
});
