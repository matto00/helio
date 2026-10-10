// HEL-1432 -- every visible <label> in the Output editor whose htmlFor used to point at nothing
// (the shared `Select` took no `id`) now resolves to its combobox. Proven through the <label>
// element itself (`document.getElementById(label.htmlFor)`), because `getByLabelText` also
// matches `aria-label` and would already pass for the four labels whose text equals the
// Select's aria-label (Chart type, both Format, Cell density).

import { configureStore } from "@reduxjs/toolkit";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { Provider } from "react-redux";
import { MemoryRouter } from "react-router-dom";

import { httpClient } from "../../../../services/httpClient";
import { outputsReducer } from "../../state/outputsSlice";
import { OutputEditorSheet } from "./OutputEditorSheet";
import type { Output } from "../../types/output";
import type { Step } from "../../types/step";

jest.mock("../../../../services/httpClient", () => ({
  httpClient: { get: jest.fn(), post: jest.fn(), patch: jest.fn(), delete: jest.fn() },
}));
const http = jest.mocked(httpClient);

const REASON =
  "An Output's kind can't be changed after it's created. Create a new Output for a different kind.";

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = jest.fn(function (this: HTMLDialogElement) {
    this.setAttribute("open", "");
  });
  HTMLDialogElement.prototype.close = jest.fn(function (this: HTMLDialogElement) {
    this.removeAttribute("open");
  });
  jest.clearAllMocks();
  http.get.mockImplementation((url: string) => {
    if (url.endsWith("/panels")) return Promise.resolve({ data: [] });
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
  });
});

const STEPS = [{ id: "step-1", name: "Step one", op: "filter" }] as unknown as Step[];

const STORED: Output = {
  id: "o-1",
  pipelineId: "p-1",
  nodeStepId: "step-1",
  ownerId: "u-1",
  name: "Out",
  kind: "chart",
  config: {},
  schema: [],
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};

function renderSheet(output: Output | null) {
  const store = configureStore({ reducer: { outputs: outputsReducer } });
  render(
    <MemoryRouter>
      <Provider store={store}>
        <OutputEditorSheet
          open
          onClose={jest.fn()}
          pipelineId="p-1"
          output={output}
          createTargetStepId="step-1"
          steps={STEPS}
        />
      </Provider>
    </MemoryRouter>,
  );
}

async function choose(comboName: string, optionName: string) {
  fireEvent.click(await screen.findByRole("combobox", { name: comboName }));
  const listbox = await screen.findByRole("listbox");
  await act(async () => {
    fireEvent.click(within(listbox).getByRole("option", { name: optionName }));
  });
}

/** The <label> reads `labelText`, its `htmlFor` is `id`, and that id is carried by the combobox. */
function expectLabelControls(labelText: string, id: string, comboName: string) {
  const label = screen.getByText(labelText, { selector: "label" }) as HTMLLabelElement;
  expect(label.htmlFor).toBe(id);
  const target = document.getElementById(id);
  expect(target).not.toBeNull();
  expect(target).toBe(screen.getByRole("combobox", { name: comboName }));
}

function expectNoDuplicateIds() {
  const ids = Array.from(document.querySelectorAll("[id]")).map((el) => el.id);
  expect(ids.filter((id, i) => ids.indexOf(id) !== i)).toEqual([]);
}

describe("Output editor labels are associated with their Select (HEL-1432)", () => {
  it("create: Kind and Step resolve via getByLabelText and the label element", async () => {
    renderSheet(null);
    const kind = await screen.findByRole("combobox", { name: "Output kind" });
    expect(screen.getByLabelText("Kind")).toBe(kind);
    expect(screen.getByLabelText("Step")).toBe(
      screen.getByRole("combobox", { name: "Target step" }),
    );
    expectLabelControls("Kind", "output-kind", "Output kind");
    expectLabelControls("Step", "output-step", "Target step");
    expectNoDuplicateIds();
  });

  it("edit: Kind resolves, is disabled and keeps the HEL-1388 description", async () => {
    renderSheet(STORED);
    const kind = await screen.findByRole("combobox", { name: "Output kind" });
    expect(screen.getByLabelText("Kind")).toBe(kind);
    expect(kind).toBeDisabled();
    expect(kind).toHaveAccessibleDescription(REASON);
    expectLabelControls("Kind", "output-kind", "Output kind");
    expectNoDuplicateIds();
  });

  it("clicking the Kind label opens the listbox in create mode", async () => {
    renderSheet(null);
    await screen.findByRole("combobox", { name: "Output kind" });
    fireEvent.click(screen.getByText("Kind", { selector: "label" }));
    expect(await screen.findByRole("listbox")).toBeInTheDocument();
  });

  it("clicking the Kind label is a no-op in edit mode", async () => {
    renderSheet(STORED);
    await screen.findByRole("combobox", { name: "Output kind" });
    fireEvent.click(screen.getByText("Kind", { selector: "label" }));
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("chart (line): chart type and aggregation labels", async () => {
    renderSheet(null);
    await screen.findByRole("combobox", { name: "Chart type" });
    expectLabelControls("Chart type", "output-chart-type", "Chart type");
    expectLabelControls("Group by", "agg-group-by", "Group by field");
    expectLabelControls("Value field", "agg-field", "Aggregation value field");
    expectLabelControls("Function", "agg-fn", "Aggregation function");
    expectNoDuplicateIds();
  });

  it("chart (bar): orientation and stacking labels", async () => {
    renderSheet(null);
    await choose("Chart type", "Bar");
    expectLabelControls("Orientation", "bar-orientation", "Bar orientation");
    expectLabelControls("Stacking", "bar-stacking", "Bar stacking");
    expectNoDuplicateIds();
  });

  it("chart (scatter, bound fields): size and color labels", async () => {
    renderSheet(null);
    await choose("Chart type", "Scatter");
    expectLabelControls("Point size field", "scatter-size-field", "Scatter point size field");
    expectLabelControls("Color by field", "scatter-color-field", "Scatter color-by field");
    expectNoDuplicateIds();
  });

  it("metric: format, value field and reduce labels", async () => {
    renderSheet(null);
    await choose("Output kind", "Metric");
    expectLabelControls("Format", "output-metric-format", "Format");
    expectLabelControls("Field", "metric-value-field", "Value field");
    expectLabelControls("Reduce", "metric-value-reduce", "Reduce function");
    expectNoDuplicateIds();
  });

  it("collection: format and slot labels", async () => {
    renderSheet(null);
    await choose("Output kind", "Collection");
    expectLabelControls("Format", "output-collection-format", "Format");
    expectLabelControls("Value", "output-slot-value", "Value field");
    expectLabelControls("Label", "output-slot-label", "Label field");
    expectLabelControls("Unit", "output-slot-unit", "Unit field");
    expectNoDuplicateIds();
  });

  it("timeline: slot labels", async () => {
    renderSheet(null);
    await choose("Output kind", "Timeline");
    expectLabelControls("Time", "output-slot-time", "Time field");
    expectLabelControls("Event", "output-slot-event", "Event field");
    expectNoDuplicateIds();
  });

  it("table: cell density label", async () => {
    renderSheet(null);
    await choose("Output kind", "Table");
    expectLabelControls("Cell density", "table-density", "Cell density");
    expectNoDuplicateIds();
  });
});
