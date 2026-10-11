// HEL-1306 -- the chart Output editor's Reference lines / bands section.

import { configureStore } from "@reduxjs/toolkit";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { Provider } from "react-redux";
import { MemoryRouter } from "react-router-dom";

import { httpClient } from "../../../../services/httpClient";
import { outputsReducer } from "../../state/outputsSlice";
import { OutputEditorSheet } from "./OutputEditorSheet";
import type { Output } from "../../types/output";

jest.mock("../../../../services/httpClient", () => ({
  httpClient: { get: jest.fn(), post: jest.fn(), patch: jest.fn(), delete: jest.fn() },
}));
const http = jest.mocked(httpClient);

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = jest.fn(function (this: HTMLDialogElement) {
    this.setAttribute("open", "");
  });
  HTMLDialogElement.prototype.close = jest.fn(function (this: HTMLDialogElement) {
    this.removeAttribute("open");
  });
  jest.clearAllMocks();
  http.get.mockImplementation((url: string) =>
    Promise.resolve(
      url.endsWith("/panels")
        ? { data: [] }
        : {
            data: {
              columns: [{ name: "day", dataType: "string", nullable: false }],
              capabilities: {},
              rows: [],
              rowCount: 0,
              stepRowCounts: {},
              sourceRowCount: 0,
              blocked: false,
              sourceTruncated: false,
              truncatedReads: [],
            },
          },
    ),
  );
  http.patch.mockResolvedValue({
    data: { id: "o-1", pipelineId: "p-1", kind: "chart", name: "n", config: {}, schema: [] },
  });
});

function chartOutput(config: Record<string, unknown>): Output {
  return {
    id: "o-1",
    pipelineId: "p-1",
    nodeStepId: "step-1",
    ownerId: "u-1",
    name: "CI",
    kind: "chart",
    config,
    schema: [],
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  };
}

function renderSheet(output: Output) {
  render(
    <MemoryRouter>
      <Provider store={configureStore({ reducer: { outputs: outputsReducer } })}>
        <OutputEditorSheet open onClose={jest.fn()} pipelineId="p-1" output={output} steps={[]} />
      </Provider>
    </MemoryRouter>,
  );
}

const saveButton = () => screen.getByRole("button", { name: "Save" });

async function save(): Promise<Record<string, unknown>> {
  await act(async () => {
    fireEvent.click(saveButton());
  });
  await waitFor(() => expect(http.patch).toHaveBeenCalled());
  return (http.patch.mock.calls[0][1] as { config?: Record<string, unknown> }).config ?? {};
}

const type = (name: string, value: string) =>
  fireEvent.change(screen.getByRole("textbox", { name }), { target: { value } });

const BAR = { chartType: "bar", fieldMapping: { xAxis: "day", yAxis: "n" } };

describe("OutputEditorSheet -- reference marks (HEL-1306)", () => {
  it("adds a line, trims the label, and saves exactly the new keys", async () => {
    renderSheet(chartOutput(BAR));
    fireEvent.click(await screen.findByRole("button", { name: "Add line" }));
    type("Line 1 value", "95");
    type("Line 1 label", "  SLO  ");
    fireEvent.click(screen.getByRole("combobox", { name: "Line 1 tone" }));
    fireEvent.click(await screen.findByRole("option", { name: "Warning" }));
    expect(await save()).toEqual({
      referenceLines: [{ value: 95, label: "SLO", tone: "warning" }],
    });
  });

  it("adds a band and saves it", async () => {
    renderSheet(chartOutput(BAR));
    fireEvent.click(await screen.findByRole("button", { name: "Add band" }));
    type("Band 1 from", "0");
    type("Band 1 to", "50");
    expect(await save()).toEqual({ referenceBands: [{ from: 0, to: 50 }] });
  });

  it("an untouched Output with stored marks saves neither key", async () => {
    renderSheet(
      chartOutput({
        ...BAR,
        referenceLines: [{ value: 95, label: "SLO", tone: "warning" }],
        referenceBands: [{ from: 0, to: 50, tone: "success" }],
      }),
    );
    expect(await screen.findByRole("textbox", { name: "Line 1 value" })).toHaveValue("95");
    expect(await save()).toEqual({});
  });

  it("removing every line saves an explicit null", async () => {
    renderSheet(chartOutput({ ...BAR, referenceLines: [{ value: 95 }] }));
    fireEvent.click(await screen.findByRole("button", { name: "Remove line 1" }));
    expect(await save()).toEqual({ referenceLines: null });
  });

  it.each([
    ["an empty value", "", "Enter a finite number."],
    ["a non-numeric value", "abc", "Enter a finite number."],
    ["a non-finite value", "1e400", "Enter a finite number."],
  ])("blocks Save on %s with an inline error", async (_name, value, message) => {
    renderSheet(chartOutput(BAR));
    fireEvent.click(await screen.findByRole("button", { name: "Add line" }));
    type("Line 1 value", value);
    expect(screen.getByRole("alert")).toHaveTextContent(message);
    expect(saveButton()).toBeDisabled();
    type("Line 1 value", "5");
    expect(saveButton()).toBeEnabled();
  });

  it("blocks Save on a band whose from is not less than to", async () => {
    renderSheet(chartOutput(BAR));
    fireEvent.click(await screen.findByRole("button", { name: "Add band" }));
    type("Band 1 from", "5");
    type("Band 1 to", "5");
    expect(screen.getByRole("alert")).toHaveTextContent("From must be less than To.");
    expect(saveButton()).toBeDisabled();
  });

  it("accepts a 60 code-point label (60 emoji) and flags 61 inline, blocking Save", async () => {
    renderSheet(chartOutput({ ...BAR, referenceLines: [{ value: 1 }] }));
    await screen.findByRole("textbox", { name: "Line 1 label" });
    type("Line 1 label", "\u{1F600}".repeat(60));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(saveButton()).toBeEnabled();
    type("Line 1 label", "\u{1F600}".repeat(61));
    expect(screen.getByRole("alert")).toHaveTextContent("Label must be 60 characters or fewer.");
    expect(saveButton()).toBeDisabled();
  });

  it("disables Add line at 5 lines and Add band at 3 bands", async () => {
    renderSheet(
      chartOutput({
        ...BAR,
        referenceLines: [1, 2, 3, 4, 5].map((value) => ({ value })),
        referenceBands: [0, 1, 2].map((from) => ({ from, to: from + 1 })),
      }),
    );
    expect(await screen.findByRole("button", { name: "Add line" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Add band" })).toBeDisabled();
  });

  it("is hidden for pie and heatmap, and a saved Output keeps its stored marks", async () => {
    renderSheet(
      chartOutput({ chartType: "pie", fieldMapping: {}, referenceLines: [{ value: 3 }] }),
    );
    await screen.findByRole("combobox", { name: "Chart type" });
    expect(screen.queryByRole("group", { name: "Reference lines" })).not.toBeInTheDocument();
    expect(await save()).toEqual({});
  });

  it.each(["line", "scatter", "histogram"])("shows the field for a %s chart", async (chartType) => {
    renderSheet(chartOutput({ chartType, fieldMapping: {} }));
    expect(await screen.findByRole("group", { name: "Reference lines" })).toBeInTheDocument();
  });

  it("explains marks are not drawn on a 100% stacked bar", async () => {
    renderSheet(chartOutput({ ...BAR, chartOptions: { bar: { stacking: "normalized" } } }));
    const group = await screen.findByRole("group", { name: "Reference lines" });
    expect(within(group).getByText(/not drawn on a 100% stacked bar/)).toBeInTheDocument();
  });

  it("an invalid draft does not leave Save blocked once the field is hidden", async () => {
    renderSheet(chartOutput(BAR));
    fireEvent.click(await screen.findByRole("button", { name: "Add line" }));
    expect(saveButton()).toBeDisabled();
    fireEvent.click(screen.getByRole("combobox", { name: "Chart type" }));
    fireEvent.click(await screen.findByRole("option", { name: "Pie" }));
    await waitFor(() => expect(saveButton()).toBeEnabled());
  });
});
