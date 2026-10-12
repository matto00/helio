// HEL-1311 -- the chart Output editor's Heatmap / Histogram options: slot pickers fed by the server's
// numeric eligibility, the bin-count control, and what Save persists.

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

const COLUMNS = ["day", "test", "failures", "label", "duration"];

function mockCapabilities(numeric: string[]) {
  http.get.mockImplementation((url: string) =>
    url.endsWith("/panels")
      ? Promise.resolve({ data: [] })
      : Promise.resolve({
          data: {
            columns: COLUMNS.map((name) => ({
              name,
              dataType: numeric.includes(name) ? "integer" : "string",
              nullable: false,
            })),
            capabilities: {
              chart: {
                bindable: true,
                requiredSlots: ["xAxis", "yAxis"],
                optionalSlots: ["series", "annotation"],
                eligibleColumns: { xAxis: COLUMNS, series: COLUMNS, yAxis: numeric },
              },
            },
            rows: [],
            rowCount: 0,
            stepRowCounts: {},
            sourceRowCount: 0,
            blocked: false,
            sourceTruncated: false,
            truncatedReads: [],
          },
        }),
  );
}

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = jest.fn(function (this: HTMLDialogElement) {
    this.setAttribute("open", "");
  });
  HTMLDialogElement.prototype.close = jest.fn(function (this: HTMLDialogElement) {
    this.removeAttribute("open");
  });
  jest.clearAllMocks();
  mockCapabilities(["failures"]);
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

async function save(): Promise<Record<string, unknown>> {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
  });
  await waitFor(() => expect(http.patch).toHaveBeenCalled());
  return (http.patch.mock.calls[0][1] as { config?: Record<string, unknown> }).config ?? {};
}

async function openOptions(name: string) {
  fireEvent.click(await screen.findByRole("combobox", { name }));
  return screen.findByRole("listbox");
}

async function choose(selectName: string, option: string) {
  const listbox = await openOptions(selectName);
  await act(async () => {
    fireEvent.click(within(listbox).getByRole("option", { name: option }));
  });
}

const AGG_BAR = {
  chartType: "bar",
  fieldMapping: { xAxis: "day", yAxis: "failures" },
  aggregation: { groupBy: "day", agg: "sum", yField: "failures" },
};

describe("OutputEditorSheet -- Heatmap (HEL-1311)", () => {
  it("offers Heatmap and Histogram in the chart-type selector", async () => {
    renderSheet(chartOutput({ chartType: "line", fieldMapping: {} }));
    const listbox = await openOptions("Chart type");
    expect(within(listbox).getByRole("option", { name: "Heatmap" })).toBeInTheDocument();
    expect(within(listbox).getByRole("option", { name: "Histogram" })).toBeInTheDocument();
  });

  it("saves Columns/Rows/Value as xAxis/series/yAxis with aggregation cleared to null", async () => {
    renderSheet(chartOutput(AGG_BAR));
    await choose("Chart type", "Heatmap");
    await choose("Columns field", "day");
    await choose("Rows field", "test");
    await choose("Value field", "failures");
    const config = await save();
    expect(config.chartType).toBe("heatmap");
    expect(config.fieldMapping).toEqual({ xAxis: "day", series: "test", yAxis: "failures" });
    // The stored bar's aggregation must be cleared or the server rejects the pair.
    expect(config.aggregation).toBeNull();
  });

  it("hides the aggregation fields behind a hint", async () => {
    renderSheet(chartOutput(AGG_BAR));
    await choose("Chart type", "Heatmap");
    expect(
      screen.getByText(
        "Aggregation isn't available for heatmap — rows with the same column and row are summed into one cell.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: /Group by/i })).not.toBeInTheDocument();
  });

  it("lists only the server's numeric columns for Value", async () => {
    renderSheet(chartOutput({ chartType: "heatmap", fieldMapping: {} }));
    const listbox = await openOptions("Value field");
    expect(
      within(listbox)
        .getAllByRole("option")
        .map((o) => o.textContent),
    ).toEqual(["failures"]);
  });

  it("keeps a stored non-numeric Value selected, marked, and saves it unchanged", async () => {
    renderSheet(
      chartOutput({
        chartType: "heatmap",
        fieldMapping: { xAxis: "day", series: "test", yAxis: "label" },
      }),
    );
    expect(await screen.findByRole("combobox", { name: "Value field" })).toHaveTextContent(
      "label (not numeric)",
    );
    expect(await save()).toEqual({});
  });

  it("disables the numeric picker with a cast hint when no column is numeric", async () => {
    mockCapabilities([]);
    renderSheet(chartOutput({ chartType: "heatmap", fieldMapping: {} }));
    const picker = await screen.findByRole("combobox", { name: "Value field" });
    await waitFor(() => expect(picker).toBeDisabled());
    expect(
      screen.getByText(
        "No numeric columns here. Cast a column to a number in the pipeline to use it.",
      ),
    ).toBeInTheDocument();
  });
});

describe("OutputEditorSheet -- Histogram (HEL-1311)", () => {
  it("saves Field as xAxis and the bin count under chartOptions.histogram", async () => {
    mockCapabilities(["failures", "duration"]);
    renderSheet(chartOutput(AGG_BAR));
    await choose("Chart type", "Histogram");
    await choose("Histogram field", "duration");
    fireEvent.change(screen.getByRole("spinbutton", { name: "Bin count" }), {
      target: { value: "12" },
    });
    const config = await save();
    expect(config.chartType).toBe("histogram");
    expect(config.fieldMapping).toEqual({ xAxis: "duration", yAxis: "failures" });
    expect(config.chartOptions).toEqual({ histogram: { binCount: 12 } });
    expect(config.aggregation).toBeNull();
  });

  it("Automatic (empty) saves no binCount", async () => {
    renderSheet(
      chartOutput({
        chartType: "histogram",
        fieldMapping: { xAxis: "failures" },
        chartOptions: { histogram: { binCount: 12 } },
      }),
    );
    fireEvent.change(await screen.findByRole("spinbutton", { name: "Bin count" }), {
      target: { value: "" },
    });
    const config = await save();
    expect(config.chartOptions).toEqual({});
  });

  it("flags an out-of-range bin count and blocks Save until it is fixed", async () => {
    renderSheet(
      chartOutput({
        chartType: "histogram",
        fieldMapping: { xAxis: "failures" },
        chartOptions: { histogram: { binCount: 12 } },
      }),
    );
    const input = await screen.findByRole("spinbutton", { name: "Bin count" });
    fireEvent.change(input, { target: { value: "1" } });
    expect(screen.getByRole("alert")).toHaveTextContent("whole number from 2 to 100");
    const saveButton = screen.getByRole("button", { name: "Save" });
    expect(saveButton).toBeDisabled();
    fireEvent.click(saveButton);
    expect(http.patch).not.toHaveBeenCalled();
    // Fixing the draft re-enables Save and saves the value shown.
    fireEvent.change(input, { target: { value: "7" } });
    expect(saveButton).toBeEnabled();
    expect((await save()).chartOptions).toEqual({ histogram: { binCount: 7 } });
  });

  it("blocks Save for an invalid draft typed from Automatic", async () => {
    renderSheet(chartOutput({ chartType: "histogram", fieldMapping: { xAxis: "failures" } }));
    fireEvent.change(await screen.findByRole("spinbutton", { name: "Bin count" }), {
      target: { value: "101" },
    });
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("shows Automatic for a stored binCount outside 2-100", async () => {
    renderSheet(
      chartOutput({
        chartType: "histogram",
        fieldMapping: { xAxis: "failures" },
        chartOptions: { histogram: { binCount: 1000 } },
      }),
    );
    expect(await screen.findByRole("spinbutton", { name: "Bin count" })).toHaveValue(null);
  });

  it("names the chart type in the Compare note", async () => {
    renderSheet(
      chartOutput({ chartType: "histogram", fieldMapping: { xAxis: "failures" }, compare: "7d" }),
    );
    expect(
      await screen.findByText("The vs overlay doesn't show for histogram charts."),
    ).toBeInTheDocument();
  });
});
