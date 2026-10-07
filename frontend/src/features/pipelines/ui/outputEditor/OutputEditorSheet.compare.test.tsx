// HEL-1275 design.md D7 -- the metric Output editor's Compare picker and what it persists.

import { configureStore } from "@reduxjs/toolkit";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { Provider } from "react-redux";

import { httpClient } from "../../../../services/httpClient";
import { outputsReducer } from "../../state/outputsSlice";
import { OutputEditorSheet } from "./OutputEditorSheet";
import { buildAggregateTailConfigs } from "./buildOutputConfig";
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
    url.endsWith("/panels")
      ? Promise.resolve({ data: [] })
      : Promise.resolve({
          data: {
            columns: [{ name: "amount", dataType: "number", nullable: false }],
            capabilities: {},
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
  http.patch.mockResolvedValue({
    data: { id: "o-1", pipelineId: "p-1", kind: "metric", name: "n", config: {}, schema: [] },
  });
});

function outputOf(kind: string, config: Record<string, unknown>): Output {
  return {
    id: "o-1",
    pipelineId: "p-1",
    nodeStepId: "step-1",
    ownerId: "u-1",
    name: "Revenue",
    kind,
    config,
    schema: [],
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  };
}

function renderSheet(output: Output) {
  render(
    <Provider store={configureStore({ reducer: { outputs: outputsReducer } })}>
      <OutputEditorSheet open onClose={jest.fn()} pipelineId="p-1" output={output} steps={[]} />
    </Provider>,
  );
}

async function save(): Promise<Record<string, unknown>> {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
  });
  await waitFor(() => expect(http.patch).toHaveBeenCalled());
  return (http.patch.mock.calls[0][1] as { config: Record<string, unknown> }).config;
}

async function choose(label: string) {
  fireEvent.click(await screen.findByRole("combobox", { name: "Compare" }));
  const listbox = await screen.findByRole("listbox");
  await act(async () => {
    fireEvent.click(within(listbox).getByRole("option", { name: label }));
  });
}

const METRIC = { fieldMapping: {}, aggregation: { value: "amount", agg: "sum" } };

describe("OutputEditorSheet -- Compare picker (HEL-1275)", () => {
  it("choosing 7 days persists compare: '7d'", async () => {
    renderSheet(outputOf("metric", METRIC));
    await choose("7 days");
    expect((await save()).compare).toBe("7d");
  });

  it("saving an aggregated metric keeps its aggregation (field lives in aggregation.value)", async () => {
    renderSheet(outputOf("metric", METRIC));
    await choose("7 days");
    expect((await save()).aggregation).toEqual({ value: "amount", agg: "sum" });
  });

  it("choosing None sends a literal null compare (the key is present)", async () => {
    renderSheet(outputOf("metric", { ...METRIC, compare: "7d" }));
    await choose("None");
    const config = await save();
    expect("compare" in config).toBe(true);
    expect(config.compare).toBeNull();
  });

  it("keeps an existing custom value as a selectable option and saves it unchanged", async () => {
    renderSheet(outputOf("metric", { ...METRIC, compare: "custom:P3D" }));
    expect(await screen.findByRole("combobox", { name: "Compare" })).toHaveTextContent(
      "Custom (P3D)",
    );
    expect((await save()).compare).toBe("custom:P3D");
  });
});

const CLEAN_CHART = {
  chartType: "line",
  fieldMapping: { xAxis: "day", yAxis: "amount" },
  aggregation: null,
};
const HELP = /Adds a .vs. line or bars to dashboard charts/;

describe("OutputEditorSheet -- chart Compare picker (HEL-1350)", () => {
  it.each(["line", "bar", "pie", "scatter"])("is offered for a %s chart Output", async (t) => {
    renderSheet(outputOf("chart", { ...CLEAN_CHART, chartType: t }));
    expect(await screen.findByRole("combobox", { name: "Compare" })).toBeInTheDocument();
  });

  it("choosing 7 days persists compare: '7d'", async () => {
    renderSheet(outputOf("chart", CLEAN_CHART));
    await choose("7 days");
    expect((await save()).compare).toBe("7d");
  });

  it("choosing None sends a literal null compare", async () => {
    renderSheet(outputOf("chart", { ...CLEAN_CHART, compare: "7d" }));
    await choose("None");
    const config = await save();
    expect("compare" in config).toBe(true);
    expect(config.compare).toBeNull();
  });

  it("an untouched stored compare round-trips unchanged", async () => {
    renderSheet(outputOf("chart", { ...CLEAN_CHART, compare: "30d" }));
    expect((await save()).compare).toBe("30d");
  });

  it("keeps a stored previous_run and custom value as options", async () => {
    renderSheet(outputOf("chart", { ...CLEAN_CHART, compare: "previous_run" }));
    expect(await screen.findByRole("combobox", { name: "Compare" })).toHaveTextContent("Previous");
    expect((await save()).compare).toBe("previous_run");
  });

  it("shows a stored custom value and saves it unchanged", async () => {
    renderSheet(outputOf("chart", { ...CLEAN_CHART, compare: "custom:P3D" }));
    expect(await screen.findByRole("combobox", { name: "Compare" })).toHaveTextContent(
      "Custom (P3D)",
    );
    expect((await save()).compare).toBe("custom:P3D");
  });

  it("offers Previous exactly once, alongside the other five choices (HEL-1285)", async () => {
    renderSheet(outputOf("chart", CLEAN_CHART));
    fireEvent.click(await screen.findByRole("combobox", { name: "Compare" }));
    const listbox = await screen.findByRole("listbox");
    expect(within(listbox).getAllByRole("option", { name: "Previous" })).toHaveLength(1);
    expect(within(listbox).getAllByRole("option")).toHaveLength(5);
  });

  it("choosing Previous persists compare: 'previous_run' (HEL-1285)", async () => {
    renderSheet(outputOf("chart", CLEAN_CHART));
    await choose("Previous");
    expect((await save()).compare).toBe("previous_run");
  });

  it("links the fixed help text to the select", async () => {
    renderSheet(outputOf("chart", CLEAN_CHART));
    const select = await screen.findByRole("combobox", { name: "Compare" });
    expect(select).toHaveAccessibleDescription(HELP);
    expect(screen.getByText(HELP).textContent).not.toMatch(/previous/i);
    expect(screen.getByText(HELP).textContent).not.toMatch(/aggregated/i);
    expect(screen.getByText(HELP).textContent).toMatch(/more than 200 rows/);
  });

  it.each([
    ["series", { fieldMapping: { xAxis: "day", yAxis: "amount", series: "r" } }, /several series/],
    ["unmapped", { fieldMapping: {} }, /doesn't name x and y/],
    ["horizontal", { chartOptions: { bar: { orientation: "horizontal" } } }, /Horizontal bars/],
    ["normalized", { chartOptions: { bar: { stacking: "normalized" } } }, /100% stacked/],
  ])("shows the %s note when compare is set", async (_n, patch, text) => {
    renderSheet(outputOf("chart", { ...CLEAN_CHART, ...patch, compare: "7d" }));
    await screen.findByRole("combobox", { name: "Compare" });
    const note = document.querySelector("#output-chart-compare-note");
    expect(note?.textContent).toMatch(text);
    expect(note?.textContent).not.toMatch(/previous/i);
    expect(screen.getByRole("combobox", { name: "Compare" })).toHaveAccessibleDescription(
      expect.stringContaining(note?.textContent ?? "missing"),
    );
  });

  it("shows no note for an aggregated config, even with a series mapping or no x/y (HEL-1351)", async () => {
    renderSheet(
      outputOf("chart", {
        chartType: "bar",
        fieldMapping: { series: "region" },
        aggregation: { groupBy: "day", agg: "sum", yField: "amount" },
        compare: "7d",
      }),
    );
    await screen.findByRole("combobox", { name: "Compare" });
    expect(document.querySelector("#output-chart-compare-note")).toBeNull();
    expect(screen.getByRole("combobox", { name: "Compare" })).toHaveAccessibleDescription(HELP);
  });

  it("shows no note for a clean raw-rows line config or a pie chartType alone", async () => {
    renderSheet(outputOf("chart", { ...CLEAN_CHART, chartType: "pie", compare: "7d" }));
    await screen.findByRole("combobox", { name: "Compare" });
    expect(document.querySelector("#output-chart-compare-note")).toBeNull();
  });

  it("shows no note for a clean raw-rows line Output at 7 days", async () => {
    renderSheet(outputOf("chart", { ...CLEAN_CHART, compare: "7d" }));
    await screen.findByRole("combobox", { name: "Compare" });
    expect(document.querySelector("#output-chart-compare-note")).toBeNull();
  });

  const AGG = { aggregation: { groupBy: "day", agg: "sum", yField: "amount" } };

  it("scatter with a leftover aggregation and a clean mapping shows no note", async () => {
    renderSheet(outputOf("chart", { ...CLEAN_CHART, ...AGG, chartType: "scatter", compare: "7d" }));
    await screen.findByRole("combobox", { name: "Compare" });
    expect(document.querySelector("#output-chart-compare-note")).toBeNull();
  });

  it.each([
    ["horizontal", { chartOptions: { bar: { orientation: "horizontal" } } }, /Horizontal bars/],
    ["series", { fieldMapping: { xAxis: "day", yAxis: "amount", series: "r" } }, /several series/],
    ["unmapped", { fieldMapping: {} }, /doesn't name x and y/],
  ])(
    "scatter with a leftover aggregation still shows the later %s note",
    async (_n, patch, text) => {
      renderSheet(
        outputOf("chart", {
          ...CLEAN_CHART,
          ...AGG,
          ...patch,
          chartType: "scatter",
          compare: "7d",
        }),
      );
      await screen.findByRole("combobox", { name: "Compare" });
      expect(document.querySelector("#output-chart-compare-note")?.textContent).toMatch(text);
    },
  );

  it("shows no note when compare is None even if the Output is aggregated", async () => {
    renderSheet(
      outputOf("chart", {
        ...CLEAN_CHART,
        aggregation: { groupBy: "day", agg: "sum", yField: "amount" },
      }),
    );
    await screen.findByRole("combobox", { name: "Compare" });
    expect(document.querySelector("#output-chart-compare-note")).toBeNull();
  });
});

describe("buildAggregateTailConfigs -- chart compare (HEL-1350)", () => {
  it("a chart tail's Output config carries the picker value", () => {
    const base = {
      kind: "chart" as const,
      groupBy: "day",
      chartAggFn: "sum",
      yField: "amount",
      chartType: "bar" as const,
      chartOptionsState: {},
      annotationState: { mode: "field", literalValue: "" } as never,
      metricField: "",
      metricAggFn: "",
      metricLabelState: { mode: "field" } as never,
      metricUnitState: { mode: "field" } as never,
      metricFormat: "number",
    };
    expect(
      buildAggregateTailConfigs({ ...base, compare: "7d" }, undefined)?.outputConfig.compare,
    ).toBe("7d");
    expect(
      buildAggregateTailConfigs({ ...base, compare: "none" }, undefined)?.outputConfig.compare,
    ).toBeNull();
  });
});

describe("buildAggregateTailConfigs -- compare (HEL-1275)", () => {
  it("a metric tail's Output config carries the picker value", () => {
    const base = {
      kind: "metric" as const,
      groupBy: "",
      chartAggFn: "",
      yField: "",
      chartType: "line" as const,
      chartOptionsState: {},
      annotationState: {} as never,
      metricField: "amount",
      metricAggFn: "sum",
      metricLabelState: { mode: "field" } as never,
      metricUnitState: { mode: "field" } as never,
      metricFormat: "number",
    };
    expect(
      buildAggregateTailConfigs({ ...base, compare: "7d" }, undefined)?.outputConfig.compare,
    ).toBe("7d");
    expect(
      buildAggregateTailConfigs({ ...base, compare: "none" }, undefined)?.outputConfig.compare,
    ).toBeNull();
  });
});
