// HEL-1389 -- the edit-mode Save sends a config PATCH (only what the user changed, explicit `null`
// for a clear), never a rebuild of the whole kind config. `PATCH /api/outputs/:id` shallow-merges
// `config`, so each case asserts the MERGED result (`{...stored, ...sentConfig}`, JSON round-tripped
// like the wire) in addition to the sent keys: that is what the user actually sees afterwards.

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

function mockGet(capabilitiesPending = false) {
  http.get.mockImplementation((url: string) => {
    if (url.endsWith("/panels")) return Promise.resolve({ data: [] });
    if (url.includes("/capabilities")) {
      if (capabilitiesPending) return new Promise(() => {});
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
}

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = jest.fn(function (this: HTMLDialogElement) {
    this.setAttribute("open", "");
  });
  HTMLDialogElement.prototype.close = jest.fn(function (this: HTMLDialogElement) {
    this.removeAttribute("open");
  });
  jest.clearAllMocks();
  mockGet();
  http.patch.mockResolvedValue({
    data: { id: "o-1", pipelineId: "p-1", kind: "chart", name: "n", config: {}, schema: [] },
  });
  http.post.mockResolvedValue({
    data: { id: "o-2", pipelineId: "p-1", kind: "chart", name: "n", config: {}, schema: [] },
  });
});

function outputOf(kind: OutputKind, config: Record<string, unknown>): Output {
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
  };
}

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
          steps={[]}
        />
      </Provider>
    </MemoryRouter>,
  );
}

async function choose(name: string, option: string) {
  fireEvent.click(await screen.findByRole("combobox", { name }));
  const listbox = await screen.findByRole("listbox");
  await act(async () => {
    fireEvent.click(within(listbox).getByRole("option", { name: option }));
  });
}

/** Clicks Save and returns the PATCH body (JSON round-tripped, i.e. as the server sees it). */
async function saveEdit(): Promise<{ name?: string; config?: Record<string, unknown> }> {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
  });
  await waitFor(() => expect(http.patch).toHaveBeenCalled());
  return JSON.parse(JSON.stringify(http.patch.mock.calls[0][1]));
}

/** What the server stores: the shallow merge of the stored config and the sent patch. */
function merged(stored: Record<string, unknown>, body: { config?: Record<string, unknown> }) {
  return { ...stored, ...(body.config ?? {}) } as Record<string, unknown>;
}

async function openAndWaitForColumns(output: Output) {
  renderSheet(output);
  await waitFor(() =>
    expect(http.get.mock.calls.some(([u]) => String(u).includes("/capabilities"))).toBe(true),
  );
}

describe("OutputEditorSheet edit Save -- config patch (HEL-1389)", () => {
  it("keeps a stored collection layout: 'list' when only the format changes", async () => {
    const stored = { fieldMapping: { value: "a" }, layout: "list", format: "number" };
    await openAndWaitForColumns(outputOf("collection", stored));
    await choose("Format", "Percent (%)");
    const body = await saveEdit();
    expect(body.config).toEqual({ format: "percent" });
    expect(merged(stored, body).layout).toBe("list");
  });

  it("keeps a stored timeline sort: 'desc' when only the field mapping changes", async () => {
    const stored = { fieldMapping: { time: "a", event: "b" }, sort: "desc" };
    await openAndWaitForColumns(outputOf("timeline", stored));
    await choose("Event field", "c");
    const body = await saveEdit();
    expect(body.config).toEqual({ fieldMapping: { time: "a", event: "c" } });
    expect(merged(stored, body).sort).toBe("desc");
  });

  it("clears a stored metric literal label/unit when both are switched to field bindings", async () => {
    const stored = { fieldMapping: { value: "a" }, label: "Revenue", unit: "$" };
    await openAndWaitForColumns(outputOf("metric", stored));
    const labelMode = screen.getByRole("group", { name: "Label mode" });
    fireEvent.click(within(labelMode).getByRole("button", { name: "Bind to field" }));
    await choose("Label field", "b");
    const unitMode = screen.getByRole("group", { name: "Unit mode" });
    fireEvent.click(within(unitMode).getByRole("button", { name: "Bind to field" }));
    await choose("Unit field", "c");
    const body = await saveEdit();
    const after = merged(stored, body);
    // The stored literals must no longer be there to render.
    expect(after.label).toBeNull();
    expect(after.unit).toBeNull();
    expect(after.fieldMapping).toEqual({ value: "a", label: "b", unit: "c" });
  });

  it("resets a stored table columnOrder to null when every column is visible in natural order", async () => {
    const stored = { fieldMapping: {}, columnOrder: ["b", "a"] };
    await openAndWaitForColumns(outputOf("table", stored));
    await screen.findByText("c");
    fireEvent.click(screen.getByRole("checkbox", { name: "c" }));
    fireEvent.click(screen.getByRole("button", { name: "Move a up" }));
    const body = await saveEdit();
    expect(body.config).toEqual({ columnOrder: null });
    expect(Array.isArray(merged(stored, body).columnOrder)).toBe(false);
  });

  it("persists a reorder that leaves a column hidden as an explicit columnOrder array", async () => {
    const stored = { fieldMapping: {}, columnOrder: ["b", "a"] };
    await openAndWaitForColumns(outputOf("table", stored));
    await screen.findByText("c");
    fireEvent.click(screen.getByRole("button", { name: "Move a up" }));
    const body = await saveEdit();
    expect(body.config).toEqual({ columnOrder: ["a", "b"] });
    expect(merged(stored, body).columnOrder).toEqual(["a", "b"]);
  });

  it("drops fieldMapping.annotation when the annotation binding is switched to a literal", async () => {
    const stored = {
      chartType: "bar",
      fieldMapping: { category: "a", value: "b", annotation: "c" },
    };
    await openAndWaitForColumns(outputOf("chart", stored));
    const mode = await screen.findByRole("group", { name: "Annotation mode" });
    fireEvent.click(within(mode).getByRole("button", { name: "Fixed text" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Annotation text" }), {
      target: { value: "Plain note" },
    });
    const body = await saveEdit();
    const after = merged(stored, body);
    expect(after.fieldMapping).toEqual({ category: "a", value: "b" });
    expect(after.annotation).toBe("Plain note");
  });

  it("drops fieldMapping.annotation when the annotation field binding is removed", async () => {
    const stored = {
      chartType: "bar",
      fieldMapping: { category: "a", value: "b", annotation: "c" },
    };
    await openAndWaitForColumns(outputOf("chart", stored));
    await choose("Annotation field", "— None —");
    const body = await saveEdit();
    expect(merged(stored, body).fieldMapping).toEqual({ category: "a", value: "b" });
  });

  it("repairs an already-damaged chart (literal annotation + stale fieldMapping.annotation) on an untouched save", async () => {
    const stored = {
      chartType: "bar",
      fieldMapping: { category: "a", value: "b", annotation: "c" },
      annotation: "Plain note",
    };
    await openAndWaitForColumns(outputOf("chart", stored));
    await screen.findByRole("group", { name: "Annotation mode" });
    const body = await saveEdit();
    expect(Object.keys(body.config ?? {})).toEqual(["fieldMapping"]);
    expect(merged(stored, body).fieldMapping).toEqual({ category: "a", value: "b" });
  });

  it("repairs an already-damaged aggregated metric (literal label + stale fieldMapping.label), keeping it bound", async () => {
    const stored = {
      fieldMapping: { value: "a", label: "b" },
      aggregation: { agg: "sum" },
      label: "Revenue",
    };
    await openAndWaitForColumns(outputOf("metric", stored));
    await screen.findByRole("group", { name: "Label mode" });
    const body = await saveEdit();
    expect(Object.keys(body.config ?? {}).sort()).toEqual(["aggregation", "fieldMapping"]);
    const after = merged(stored, body);
    expect(after.fieldMapping).toEqual({ value: "a" });
    expect(after.aggregation).toEqual({ value: "a", agg: "sum" });
    expect(after.label).toBe("Revenue");
  });

  // Red on the WHOLE pre-fix tree (6f2351e8^, measured there, not by dropping its sheet into this
  // tree): the pre-fix builder omits `fieldMapping.value` for an aggregated metric. On current
  // code it is failable by removing the D4a `fieldMapping`/`aggregation` pairing in `buildConfigPatch`.
  it("keeps an aggregated {agg} metric bound after binding only its label to a field", async () => {
    const stored = { fieldMapping: { value: "a" }, aggregation: { agg: "sum" } };
    await openAndWaitForColumns(outputOf("metric", stored));
    await choose("Label field", "b");
    const body = await saveEdit();
    expect(body.config).toHaveProperty("fieldMapping");
    expect(body.config).toHaveProperty("aggregation");
    const after = merged(stored, body);
    expect(after.fieldMapping).toEqual({ value: "a", label: "b" });
    expect((after.aggregation as { agg: string }).agg).toBe("sum");
  });

  describe("an untouched open + Save sends no config", () => {
    const cases: [string, OutputKind, Record<string, unknown>][] = [
      [
        "chart with a bound annotation",
        "chart",
        { chartType: "bar", fieldMapping: { category: "a", value: "b", annotation: "c" } },
      ],
      ["chart with a literal annotation", "chart", { chartType: "line", annotation: "Note" }],
      ["table", "table", { fieldMapping: {}, columnOrder: ["b", "a"] }],
      ["metric", "metric", { fieldMapping: { value: "a" }, label: "Rev", unit: "$" }],
      [
        "aggregated metric ({agg} + fieldMapping.value)",
        "metric",
        { fieldMapping: { value: "a" }, aggregation: { agg: "sum" } },
      ],
      ["collection", "collection", { fieldMapping: { value: "a" }, layout: "list" }],
      ["timeline", "timeline", { fieldMapping: { time: "a" }, sort: "desc" }],
      [
        "markdown (legacy fieldMapping.content)",
        "markdown",
        { content: "x", fieldMapping: { content: "a" } },
      ],
    ];
    it.each(cases)("%s", async (_label, kind, stored) => {
      await openAndWaitForColumns(outputOf(kind, stored));
      if (kind === "table") await screen.findByText("c");
      const body = await saveEdit();
      expect(body).not.toHaveProperty("config");
    });

    it("a table saved BEFORE its columns have loaded", async () => {
      mockGet(true);
      renderSheet(outputOf("table", { fieldMapping: {}, columnOrder: ["b", "a"] }));
      const body = await saveEdit();
      expect(body).not.toHaveProperty("config");
    });
  });
});

describe("OutputEditorSheet create Save -- still sends the full config (HEL-1389)", () => {
  async function saveCreate(): Promise<Record<string, unknown>> {
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
    });
    await waitFor(() => expect(http.post).toHaveBeenCalled());
    return (http.post.mock.calls[0][1] as { config: Record<string, unknown> }).config;
  }

  it("collection create writes layout: 'grid'", async () => {
    renderSheet(null);
    await choose("Output kind", "Collection");
    expect((await saveCreate()).layout).toBe("grid");
  });

  it("timeline create writes sort: 'asc'", async () => {
    renderSheet(null);
    await choose("Output kind", "Timeline");
    expect((await saveCreate()).sort).toBe("asc");
  });

  it("table create with a hidden column and no reorder writes the visible array", async () => {
    renderSheet(null);
    await choose("Output kind", "Table");
    await screen.findByText("c");
    fireEvent.click(screen.getByRole("checkbox", { name: "c" }));
    expect((await saveCreate()).columnOrder).toEqual(["a", "b"]);
  });
});
