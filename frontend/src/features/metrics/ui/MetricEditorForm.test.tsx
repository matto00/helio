// HEL-553 task 4.4 — create/edit happy path, DataType-constrained pickers,
// inline 400/422 error display.

import { fireEvent, screen, waitFor } from "@testing-library/react";

import * as metricService from "../services/metricService";
import { renderWithStore } from "../../../test/renderWithStore";
import type { DataType } from "../../dataTypes/types/dataType";
import type { Metric } from "../types/metric";
import { MetricEditorForm } from "./MetricEditorForm";

jest.mock("../services/metricService", () => ({
  createMetric: jest.fn(),
  updateMetric: jest.fn(),
}));

const createMetricMock = jest.mocked(metricService.createMetric);
const updateMetricMock = jest.mocked(metricService.updateMetric);

const dataType: DataType = {
  id: "dt-1",
  name: "Sales",
  sourceId: null,
  version: 1,
  fields: [
    { name: "amount", displayName: "amount", dataType: "number", nullable: false },
    { name: "region", displayName: "region", dataType: "string", nullable: false },
  ],
  computedFields: [],
  createdAt: "2026-07-01T00:00:00Z",
  updatedAt: "2026-07-01T00:00:00Z",
};

const testMetric: Metric = {
  id: "m-1",
  ownerId: "u-1",
  dataTypeId: "dt-1",
  name: "Total Revenue",
  description: null,
  measureField: "amount",
  aggregation: "sum",
  allowedDimensions: [],
  format: { unit: null, decimals: null, prefix: null, suffix: null },
  deprecated: false,
  createdAt: "2026-07-01T00:00:00Z",
  updatedAt: "2026-07-01T00:00:00Z",
};

function renderForm(props: Partial<Parameters<typeof MetricEditorForm>[0]> = {}) {
  const onSaved = jest.fn();
  const onCancel = jest.fn();
  const utils = renderWithStore(
    <MetricEditorForm mode="create" onSaved={onSaved} onCancel={onCancel} {...props} />,
    { dataTypes: { items: [dataType], status: "succeeded" } },
  );
  return { onSaved, onCancel, ...utils };
}

/** Fills name + picks the DataType + measure field — the minimum required
 *  fields for a successful create submit. */
function fillRequiredCreateFields(name: string) {
  fireEvent.change(screen.getByLabelText("Metric name"), { target: { value: name } });
  fireEvent.click(screen.getByText("Sales"));
  fireEvent.click(screen.getByRole("combobox", { name: "Measure field" }));
  fireEvent.click(screen.getByRole("option", { name: "amount" }));
}

beforeEach(() => {
  createMetricMock.mockReset();
  updateMetricMock.mockReset();
});

describe("MetricEditorForm — create", () => {
  it("fills required fields and calls createMetric with the expected payload on submit", async () => {
    createMetricMock.mockResolvedValueOnce(testMetric);
    const { onSaved } = renderForm();

    fillRequiredCreateFields("Total Revenue");
    fireEvent.click(screen.getByRole("button", { name: "Create metric" }));

    await waitFor(() => expect(createMetricMock).toHaveBeenCalledTimes(1));
    expect(createMetricMock).toHaveBeenCalledWith(
      expect.objectContaining({
        dataTypeId: "dt-1",
        name: "Total Revenue",
        measureField: "amount",
        aggregation: "sum",
        allowedDimensions: [],
      }),
    );
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(testMetric));
  });

  it("constrains the measure-field picker to the selected DataType's fields", () => {
    renderForm();

    fireEvent.click(screen.getByText("Sales"));
    fireEvent.click(screen.getByRole("combobox", { name: "Measure field" }));

    expect(screen.getByRole("option", { name: "amount" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "region" })).toBeInTheDocument();
  });

  it("constrains the allowed-dimensions picker to the selected DataType's fields", () => {
    renderForm();

    fireEvent.click(screen.getByText("Sales"));
    fireEvent.click(screen.getByRole("button", { name: "Allowed dimensions" }));

    expect(screen.getByRole("listbox", { name: "Allowed dimensions options" })).toBeInTheDocument();
    expect(screen.getByText("amount")).toBeInTheDocument();
    expect(screen.getByText("region")).toBeInTheDocument();
  });

  it("shows a 400 error inline near the name field, preserving in-progress edits", async () => {
    createMetricMock.mockRejectedValueOnce({
      isAxiosError: true,
      response: { status: 400, data: { message: "Metric name cannot be empty." } },
    });
    renderForm();

    fillRequiredCreateFields("Total Revenue");
    fireEvent.click(screen.getByRole("button", { name: "Create metric" }));

    await waitFor(() =>
      expect(screen.getByText("Metric name cannot be empty.")).toBeInTheDocument(),
    );
    expect(screen.getByLabelText("Metric name")).toHaveValue("Total Revenue");
  });

  it("shows a 422 binding-shape error inline, preserving in-progress edits", async () => {
    createMetricMock.mockRejectedValueOnce({
      isAxiosError: true,
      response: {
        status: 422,
        data: { message: "measureField must be a field of the bound DataType." },
      },
    });
    renderForm();

    fillRequiredCreateFields("Total Revenue");
    fireEvent.click(screen.getByRole("button", { name: "Create metric" }));

    await waitFor(() =>
      expect(
        screen.getByText("measureField must be a field of the bound DataType."),
      ).toBeInTheDocument(),
    );
    expect(screen.getByLabelText("Metric name")).toHaveValue("Total Revenue");
  });
});

describe("MetricEditorForm — edit", () => {
  it("PATCHes only the changed field when editing a metric's name", async () => {
    updateMetricMock.mockResolvedValueOnce({ ...testMetric, name: "Renamed Revenue" });
    const { onSaved } = renderForm({ mode: "edit", metric: testMetric });

    fireEvent.change(screen.getByLabelText("Metric name"), {
      target: { value: "Renamed Revenue" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(updateMetricMock).toHaveBeenCalledTimes(1));
    expect(updateMetricMock).toHaveBeenCalledWith("m-1", { name: "Renamed Revenue" });
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
  });

  it("shows the bound DataType read-only (not the picker) in edit mode", () => {
    renderForm({ mode: "edit", metric: testMetric });

    expect(screen.getByText("Sales", { exact: false })).toBeInTheDocument();
    expect(screen.queryByPlaceholderText("Search data types…")).not.toBeInTheDocument();
  });

  it("PATCHes deprecated: true when the deprecate toggle is switched on", async () => {
    updateMetricMock.mockResolvedValueOnce({ ...testMetric, deprecated: true });
    renderForm({ mode: "edit", metric: testMetric });

    fireEvent.click(screen.getByRole("switch", { name: "Deprecated" }));
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(updateMetricMock).toHaveBeenCalledTimes(1));
    expect(updateMetricMock).toHaveBeenCalledWith("m-1", { deprecated: true });
  });
});
