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

  it("saving a chart Output omits compare so the server's shallow merge keeps it", async () => {
    renderSheet(
      outputOf("chart", { chartType: "bar", fieldMapping: {}, aggregation: null, compare: "30d" }),
    );
    expect(screen.queryByRole("combobox", { name: "Compare" })).toBeNull();
    expect("compare" in (await save())).toBe(false);
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
      buildAggregateTailConfigs({ ...base, metricCompare: "7d" }, undefined)?.outputConfig.compare,
    ).toBe("7d");
    expect(
      buildAggregateTailConfigs({ ...base, metricCompare: "none" }, undefined)?.outputConfig
        .compare,
    ).toBeNull();
  });
});
