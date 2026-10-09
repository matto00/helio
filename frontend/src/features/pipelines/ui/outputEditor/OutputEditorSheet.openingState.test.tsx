// HEL-1430 -- characterization of the editor's OPENING state for every Output kind, edit and
// create mode. It pins what the user sees on open (an exhaustive serialization of every control
// in the Name/Step/Kind group, the Configuration card and the History card) and, for create, the
// exact `config` a Save sends. It was committed green on the unmodified sheet BEFORE the seeding
// was extracted into `useOutputKindState`, so it is the independent signal that the extraction
// changed no opening state: after the extraction both the sheet and `configPatch.ts`'s baseline
// derive from `openingParams`, which makes "an untouched Save sends no config" tautological.

import { configureStore } from "@reduxjs/toolkit";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { Provider } from "react-redux";
import { MemoryRouter } from "react-router-dom";

import { httpClient } from "../../../../services/httpClient";
import { outputsReducer } from "../../state/outputsSlice";
import { OutputEditorSheet } from "./OutputEditorSheet";
import type { Output, OutputKind } from "../../types/output";

jest.mock("../../../../services/httpClient", () => ({
  httpClient: { get: jest.fn(), post: jest.fn(), patch: jest.fn(), delete: jest.fn() },
}));
const http = jest.mocked(httpClient);

const COLUMNS = ["a", "b", "c"];

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
          columns: COLUMNS.map((name) => ({ name, dataType: "string", nullable: false })),
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
  http.patch.mockResolvedValue({
    data: { id: "o-1", pipelineId: "p-1", kind: "chart", name: "n", config: {}, schema: [] },
  });
  http.post.mockResolvedValue({
    data: { id: "o-2", pipelineId: "p-1", kind: "chart", name: "n", config: {}, schema: [] },
  });
});

function outputOf(
  kind: OutputKind,
  config: Record<string, unknown>,
  extra: Partial<Output> = {},
): Output {
  return {
    id: "o-1",
    pipelineId: "p-1",
    nodeStepId: "step-1",
    ownerId: "u-1",
    name: "Out",
    kind,
    config,
    schema: [],
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...extra,
  };
}

async function renderSheet(output: Output | null) {
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
          steps={[{ id: "step-1", label: "First step" } as never]}
          onAddAsTailWithAggregate={jest.fn()}
        />
      </Provider>
    </MemoryRouter>,
  );
  await waitFor(() =>
    expect(http.get.mock.calls.some(([u]) => String(u).includes("/capabilities"))).toBe(true),
  );
  await act(async () => {});
}

async function choose(name: string, option: string) {
  fireEvent.click(await screen.findByRole("combobox", { name }));
  const listbox = await screen.findByRole("listbox");
  await act(async () => {
    fireEvent.click(within(listbox).getByRole("option", { name: option }));
  });
}

const CONTROLS =
  'h3, input, textarea, select, button, [role="combobox"], [role="group"], [role="switch"], [role="checkbox"], [role="radio"]';

function nameOf(el: Element): string {
  const aria = el.getAttribute("aria-label");
  if (aria) return aria;
  const labels = (el as HTMLInputElement).labels;
  if (labels && labels.length > 0) {
    return Array.from(labels)
      .map((l) => l.textContent?.trim() ?? "")
      .join(" ");
  }
  return el.tagName === "BUTTON" ? (el.textContent?.trim() ?? "") : "";
}

/** One line per control in document order: role/tag, accessible name, value and state flags. */
function serializeControls(): string[] {
  const dialog = document.querySelector("dialog");
  if (!dialog) throw new Error("no dialog");
  return Array.from(dialog.querySelectorAll(CONTROLS)).map((el) => {
    const role = el.getAttribute("role") ?? el.tagName.toLowerCase();
    const parts = [role];
    if (el.tagName === "H3") return `${role}: ${el.textContent?.trim()}`;
    parts.push(`name=${JSON.stringify(nameOf(el))}`);
    if (el instanceof HTMLInputElement) {
      parts.push(
        el.type === "checkbox" || el.type === "radio"
          ? `checked=${el.checked}`
          : `value=${JSON.stringify(el.value)}`,
      );
    } else if (el instanceof HTMLTextAreaElement) {
      parts.push(`value=${JSON.stringify(el.value)}`);
    } else if (el.getAttribute("role") === "combobox") {
      parts.push(`value=${JSON.stringify(el.textContent?.trim())}`);
    }
    const pressed = el.getAttribute("aria-pressed");
    if (pressed !== null) parts.push(`pressed=${pressed}`);
    if ((el as HTMLButtonElement).disabled || el.getAttribute("aria-disabled") === "true") {
      parts.push("disabled");
    }
    const describedBy = el.getAttribute("aria-describedby");
    if (describedBy) {
      parts.push(
        `describedBy=${JSON.stringify(document.getElementById(describedBy)?.textContent)}`,
      );
    }
    return parts.join(" ");
  });
}

const EDIT_CASES: [string, OutputKind, Record<string, unknown>, Partial<Output>?][] = [
  [
    "chart: bar, bound annotation, aggregation, bar options, compare",
    "chart",
    {
      chartType: "bar",
      fieldMapping: { category: "a", value: "b", annotation: "c" },
      aggregation: { groupBy: "a", agg: "sum", yField: "b" },
      chartOptions: { bar: { orientation: "horizontal", stacking: "stacked", barGapPct: 30 } },
      compare: "7d",
    },
  ],
  [
    "chart: pie, literal annotation, pie options",
    "chart",
    {
      chartType: "pie",
      annotation: "Note",
      chartOptions: { pie: { donutHolePct: 40, showPercentLabels: true } },
    },
  ],
  [
    "chart: line options",
    "chart",
    {
      chartType: "line",
      fieldMapping: { xAxis: "a", yAxis: "b" },
      chartOptions: { line: { smooth: true, showPoints: true, areaFill: true } },
    },
  ],
  [
    "chart: scatter, size and colour fields",
    "chart",
    {
      chartType: "scatter",
      fieldMapping: { xAxis: "a", yAxis: "b" },
      chartOptions: { scatter: { sizeField: "c", colorField: "b" } },
    },
  ],
  [
    "table: columnOrder + columnFormats",
    "table",
    {
      fieldMapping: {},
      columnOrder: ["c", "a"],
      columnFormats: {
        a: { type: "currency", decimals: 2, currency: "EUR" },
        c: { type: "date", datePattern: "long" },
      },
    },
  ],
  [
    "metric: bound value/label/unit, percent, compare 30d",
    "metric",
    { fieldMapping: { value: "a", label: "b", unit: "c" }, format: "percent", compare: "30d" },
  ],
  [
    "metric: aggregated {agg,value}, literal label/unit, currency, compare previous_run",
    "metric",
    {
      fieldMapping: {},
      aggregation: { value: "b", agg: "avg" },
      label: "Revenue",
      unit: "$",
      format: "currency",
      compare: "previous_run",
    },
  ],
  ["metric: no stored format (default seed)", "metric", { fieldMapping: { value: "a" } }],
  [
    "collection: mapping + list layout + integer format",
    "collection",
    { fieldMapping: { value: "a", label: "b", unit: "c" }, layout: "list", format: "integer" },
  ],
  [
    "timeline: mapping + sort desc",
    "timeline",
    { fieldMapping: { time: "a", event: "b" }, sort: "desc" },
  ],
  [
    "markdown: content, legacy fieldMapping.content, history payloads on",
    "markdown",
    { content: "# Hi", fieldMapping: { content: "a" }, historyPayloads: true },
    { historyPayloadsAvailable: true },
  ],
  ["markdown: empty config", "markdown", {}],
];

const KIND_LABEL: Record<OutputKind, string> = {
  chart: "Chart",
  table: "Table",
  metric: "Metric",
  collection: "Collection",
  timeline: "Timeline",
  markdown: "Markdown",
};

describe("OutputEditorSheet opening state (HEL-1430 characterization)", () => {
  describe("edit mode", () => {
    it.each(EDIT_CASES)("%s", async (_title, kind, config, extra = {}) => {
      await renderSheet(outputOf(kind, config, extra));
      expect(serializeControls()).toMatchSnapshot();
    });
  });

  describe("create mode (kind chosen after open)", () => {
    it.each(Object.keys(KIND_LABEL) as OutputKind[])("%s", async (kind) => {
      await renderSheet(null);
      if (kind !== "chart") await choose("Output kind", KIND_LABEL[kind]);
      await act(async () => {});
      const controls = serializeControls();
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Save" }));
      });
      await waitFor(() => expect(http.post).toHaveBeenCalled());
      const body = JSON.parse(JSON.stringify(http.post.mock.calls[0][1]));
      expect({ controls, body }).toMatchSnapshot();
    });
  });

  describe("state with no form control that still reaches the wire (edit, touched)", () => {
    it("keeps a chart's stored non-default fieldMapping keys when only the annotation binding changes", async () => {
      const stored = {
        chartType: "bar",
        fieldMapping: { xAxis: "a", yAxis: "b", category: "c", value: "a" },
      };
      await renderSheet(outputOf("chart", stored));
      await choose("Annotation field", "b");
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Save" }));
      });
      await waitFor(() => expect(http.patch).toHaveBeenCalled());
      const body = JSON.parse(JSON.stringify(http.patch.mock.calls[0][1]));
      expect(body.config.fieldMapping).toEqual({
        xAxis: "a",
        yAxis: "b",
        category: "c",
        value: "a",
        annotation: "b",
      });
    });
  });
});
