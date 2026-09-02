// task 9.1 -- component-level coverage for `OutputEditorSheet`/
// `OutputKindFields`/`OutputPreviewPane`, closing the two genuine Jest gaps
// Cycle 11 flagged: (1) the sheet's field-select slots are populated from
// capabilities-at-node, not a DataType (design.md decision 3); (2) the
// preview pane survives a live pie<->bar chart-type switch without throwing
// (HEL-629, design.md decision 8) -- `ChartPanel`'s existing `notMerge`
// already prevents the underlying crash class; this asserts the SHEET'S OWN
// `key={chartType}` remount doesn't itself blow up on a rapid switch.

import { configureStore } from "@reduxjs/toolkit";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { Provider } from "react-redux";

import { httpClient } from "../../../../services/httpClient";
import { outputsReducer } from "../../state/outputsSlice";
import { OutputEditorSheet } from "./OutputEditorSheet";
import type { Step } from "../../types/step";

jest.mock("../../../../services/httpClient", () => ({
  httpClient: { get: jest.fn(), post: jest.fn(), patch: jest.fn(), delete: jest.fn() },
}));

const mockedHttpClient = jest.mocked(httpClient);

// `OutputEditorSheet` renders inside the shared `Modal` (<dialog>
// showModal/close), which jsdom doesn't implement -- same stub pattern as
// `PanelList.test.tsx`.
beforeEach(() => {
  HTMLDialogElement.prototype.showModal = jest.fn(function (this: HTMLDialogElement) {
    this.setAttribute("open", "");
  });
  HTMLDialogElement.prototype.close = jest.fn(function (this: HTMLDialogElement) {
    this.removeAttribute("open");
  });
});

const STEPS: Step[] = [];

function buildStore() {
  return configureStore({ reducer: { outputs: outputsReducer } });
}

function renderSheet() {
  const store = buildStore();
  render(
    <Provider store={store}>
      <OutputEditorSheet
        open
        onClose={jest.fn()}
        pipelineId="p-1"
        output={null}
        createTargetStepId="step-1"
        steps={STEPS}
      />
    </Provider>,
  );
  return store;
}

describe("OutputEditorSheet -- capabilities-at-node slot options (task 9.1)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedHttpClient.get.mockImplementation((url: string) => {
      if (url.includes("/capabilities")) {
        return Promise.resolve({
          data: {
            columns: [
              { name: "amount", dataType: "number", nullable: false },
              { name: "category", dataType: "string", nullable: false },
            ],
            capabilities: {},
          },
        });
      }
      if (url.includes("/preview")) {
        return Promise.resolve({
          data: {
            rows: [],
            rowCount: 0,
            stepRowCounts: {},
            sourceRowCount: 0,
            blocked: false,
            sourceTruncated: false,
            truncatedReads: [],
          },
        });
      }
      return Promise.resolve({ data: {} });
    });
  });

  it("populates the chart 'value field' select from capabilities-at-node columns, not a DataType", async () => {
    renderSheet();

    await waitFor(() => {
      expect(mockedHttpClient.get.mock.calls.some(([url]) => url.includes("/capabilities"))).toBe(
        true,
      );
    });

    const valueFieldTrigger = await screen.findByRole("combobox", {
      name: "Aggregation value field",
    });
    fireEvent.click(valueFieldTrigger);

    const listbox = await screen.findByRole("listbox");
    const optionLabels = within(listbox)
      .getAllByRole("option")
      .map((el) => el.textContent);

    // The two capability columns from the mocked `/capabilities` response --
    // NOT any DataType-sourced field name (there is no DataType left to
    // pick from, HEL-903).
    expect(optionLabels).toContain("amount");
    expect(optionLabels).toContain("category");
  });
});

describe("OutputEditorSheet -- pie<->bar live chart-type switch (HEL-629, task 9.1)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedHttpClient.get.mockResolvedValue({
      data: {
        columns: [{ name: "amount", dataType: "number", nullable: false }],
        capabilities: {},
      },
    });
  });

  it("does not throw when switching the chart type from pie to bar and back", async () => {
    renderSheet();

    const chartTypeTrigger = await screen.findByRole("combobox", { name: "Chart type" });

    async function chooseChartType(label: string) {
      fireEvent.click(chartTypeTrigger);
      const listbox = await screen.findByRole("listbox");
      const option = within(listbox).getByRole("option", { name: label });
      await act(async () => {
        fireEvent.click(option);
      });
    }

    await expect(chooseChartType("Pie")).resolves.not.toThrow();
    await expect(chooseChartType("Bar")).resolves.not.toThrow();
    await expect(chooseChartType("Pie")).resolves.not.toThrow();

    // The sheet is still mounted and responsive after the rapid pie<->bar
    // round trip -- a crash would have unmounted or thrown inside the
    // preview pane's ECharts instance well before this point.
    expect(await screen.findByRole("combobox", { name: "Chart type" })).toBeInTheDocument();
  });
});
