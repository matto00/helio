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
import { MemoryRouter } from "react-router-dom";

import { httpClient } from "../../../../services/httpClient";
import { outputsReducer } from "../../state/outputsSlice";
import { OutputEditorSheet } from "./OutputEditorSheet";
import type { Step } from "../../types/step";
import type { Output } from "../../types/output";

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

// HEL-1139 -- a markdown Output's Content is literal-only. The backend
// (`OutputBindingSpec.Markdown`, no slots) rejects `fieldMapping.content`
// with a 400 and the renderer never reads it, so the sheet must not offer
// (or persist) a bound mode.
describe("OutputEditorSheet -- markdown Content is literal-only (HEL-1139)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedHttpClient.get.mockImplementation((url: string) => {
      if (url.endsWith("/panels")) return Promise.resolve({ data: [] });
      return Promise.resolve({
        data: {
          columns: [{ name: "notes", dataType: "string", nullable: false }],
          capabilities: {},
          rows: [],
          rowCount: 0,
          stepRowCounts: {},
          sourceRowCount: 0,
          blocked: false,
          sourceTruncated: false,
          truncatedReads: [],
        },
      });
    });
    mockedHttpClient.post.mockResolvedValue({
      data: { id: "o-1", pipelineId: "p-1", kind: "markdown", name: "n", config: {}, schema: [] },
    });
    mockedHttpClient.patch.mockResolvedValue({
      data: { id: "o-9", pipelineId: "p-1", kind: "markdown", name: "n", config: {}, schema: [] },
    });
  });

  const legacyOutput: Output = {
    id: "o-9",
    pipelineId: "p-1",
    nodeStepId: "step-1",
    ownerId: "u-1",
    name: "Legacy md",
    kind: "markdown",
    config: { content: "", fieldMapping: { content: "notes" } },
    schema: [],
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  };

  it("offers only a literal Content editor (no mode toggle, no field picker) and saves an empty fieldMapping", async () => {
    renderSheet();
    const kindTrigger = await screen.findByRole("combobox", { name: "Output kind" });
    fireEvent.click(kindTrigger);
    const listbox = await screen.findByRole("listbox");
    await act(async () => {
      fireEvent.click(within(listbox).getByRole("option", { name: "Markdown" }));
    });

    expect(screen.queryByRole("group", { name: "Content mode" })).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "Content field" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Bind to field" })).not.toBeInTheDocument();
    const textarea = await screen.findByRole("textbox", { name: "Content text" });
    fireEvent.change(textarea, { target: { value: "# Hello" } });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
    });

    await waitFor(() => expect(mockedHttpClient.post).toHaveBeenCalled());
    const [url, body] = mockedHttpClient.post.mock.calls.find(([u]) =>
      String(u).endsWith("/outputs"),
    ) as [string, { kind: string; config: Record<string, unknown> }];
    expect(url).toBe("/api/pipelines/p-1/outputs");
    expect(body.kind).toBe("markdown");
    expect(body.config).toEqual({ content: "# Hello", fieldMapping: {} });
  });

  it("opens a legacy markdown Output holding fieldMapping.content in literal mode and saves an empty fieldMapping", async () => {
    const store = buildStore();
    render(
      <MemoryRouter>
        <Provider store={store}>
          <OutputEditorSheet
            open
            onClose={jest.fn()}
            pipelineId="p-1"
            output={legacyOutput}
            steps={STEPS}
          />
        </Provider>
      </MemoryRouter>,
    );

    expect(await screen.findByRole("textbox", { name: "Content text" })).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Content mode" })).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "Content field" })).not.toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
    });

    await waitFor(() => expect(mockedHttpClient.patch).toHaveBeenCalled());
    const [url, body] = mockedHttpClient.patch.mock.calls[0] as [
      string,
      { config: Record<string, unknown> },
    ];
    expect(url).toBe("/api/outputs/o-9");
    expect(body.config).toEqual({ content: "", fieldMapping: {} });
  });
});
