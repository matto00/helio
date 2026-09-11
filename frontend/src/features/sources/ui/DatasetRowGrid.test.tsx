import { fireEvent, screen, waitFor } from "@testing-library/react";

import { renderWithStore } from "../../../test/renderWithStore";
import { DatasetRowGrid } from "./DatasetRowGrid";
import {
  fetchDatasetSchema as fetchDatasetSchemaRequest,
  fetchSourceRows as fetchSourceRowsRequest,
  patchSourceRow as patchSourceRowRequest,
  deleteSourceRow as deleteSourceRowRequest,
  appendSourceRows as appendSourceRowsRequest,
} from "../services/dataSourceService";
import type { DatasetSchemaResponse, RowListResponse } from "../types/dataSource";

jest.mock("../services/dataSourceService", () => ({
  fetchDatasetSchema: jest.fn(),
  fetchSourceRows: jest.fn(),
  patchSourceRow: jest.fn(),
  deleteSourceRow: jest.fn(),
  appendSourceRows: jest.fn(),
}));

const fetchDatasetSchemaMock = jest.mocked(fetchDatasetSchemaRequest);
const fetchSourceRowsMock = jest.mocked(fetchSourceRowsRequest);
const patchSourceRowMock = jest.mocked(patchSourceRowRequest);
const deleteSourceRowMock = jest.mocked(deleteSourceRowRequest);
const appendSourceRowsMock = jest.mocked(appendSourceRowsRequest);

const sourceId = "src-1";

const requiredNoDefaultSchema: DatasetSchemaResponse = {
  fields: [
    { name: "name", type: "string", required: true },
    { name: "note", type: "string", required: false },
  ],
};

const onePage = (rows: RowListResponse["rows"]): RowListResponse => ({
  rows,
  total: rows.length,
});

beforeEach(() => {
  jest.clearAllMocks();
});

describe("DatasetRowGrid", () => {
  it("renders declared columns and row values once schema + rows resolve", async () => {
    fetchDatasetSchemaMock.mockResolvedValue(requiredNoDefaultSchema);
    fetchSourceRowsMock.mockResolvedValue(
      onePage([{ id: "r1", seq: 0, updatedAt: "2026-01-01T00:00:00Z", data: ["Alice", "hi"] }]),
    );

    renderWithStore(<DatasetRowGrid sourceId={sourceId} />);

    expect(await screen.findByText("Alice")).toBeInTheDocument();
    expect(screen.getByText("hi")).toBeInTheDocument();
  });

  it('always passes variant="preview" to DataGrid (tasks.md 5.8 — structural virtualization guard)', async () => {
    fetchDatasetSchemaMock.mockResolvedValue(requiredNoDefaultSchema);
    fetchSourceRowsMock.mockResolvedValue(
      onePage([{ id: "r1", seq: 0, updatedAt: "2026-01-01T00:00:00Z", data: ["Alice", "hi"] }]),
    );

    const { container } = renderWithStore(<DatasetRowGrid sourceId={sourceId} />);
    await screen.findByText("Alice");
    expect(container.querySelector(".ui-data-grid--preview")).not.toBeNull();
    expect(container.querySelector(".ui-data-grid--full")).toBeNull();
  });

  it("edit + save: commits an edited cell via a single PATCH call", async () => {
    fetchDatasetSchemaMock.mockResolvedValue(requiredNoDefaultSchema);
    fetchSourceRowsMock.mockResolvedValue(
      onePage([{ id: "r1", seq: 0, updatedAt: "2026-01-01T00:00:00Z", data: ["Alice", "hi"] }]),
    );
    patchSourceRowMock.mockResolvedValue({
      row: { id: "r1", seq: 0, updatedAt: "2026-01-02T00:00:00Z", data: ["Alicia", "hi"] },
      sourceUpdatedAt: "2026-01-02T00:00:00Z",
    });

    renderWithStore(<DatasetRowGrid sourceId={sourceId} />);
    const cell = await screen.findByText("Alice");
    fireEvent.click(cell);
    fireEvent.keyDown(screen.getByRole("grid"), { key: "Enter" });
    const editor = screen.getByDisplayValue("Alice");
    fireEvent.change(editor, { target: { value: "Alicia" } });
    fireEvent.keyDown(editor, { key: "Enter" });

    await waitFor(() => expect(patchSourceRowMock).toHaveBeenCalledTimes(1));
    expect(patchSourceRowMock).toHaveBeenCalledWith(sourceId, "r1", "2026-01-01T00:00:00Z", [
      "Alicia",
      "hi",
    ]);
  });

  it("tasks.md 4.3a (required, not optional): Enter-then-blur fires exactly one save, never two", async () => {
    fetchDatasetSchemaMock.mockResolvedValue(requiredNoDefaultSchema);
    fetchSourceRowsMock.mockResolvedValue(
      onePage([{ id: "r1", seq: 0, updatedAt: "2026-01-01T00:00:00Z", data: ["Alice", "hi"] }]),
    );
    patchSourceRowMock.mockResolvedValue({
      row: { id: "r1", seq: 0, updatedAt: "2026-01-02T00:00:00Z", data: ["Alicia", "hi"] },
      sourceUpdatedAt: "2026-01-02T00:00:00Z",
    });

    renderWithStore(<DatasetRowGrid sourceId={sourceId} />);
    const cell = await screen.findByText("Alice");
    fireEvent.click(cell);
    fireEvent.keyDown(screen.getByRole("grid"), { key: "Enter" });
    const editor = screen.getByDisplayValue("Alice");
    fireEvent.change(editor, { target: { value: "Alicia" } });
    fireEvent.keyDown(editor, { key: "Enter" });
    // Enter's own handler doesn't blur the element in jsdom, but a real Tab/blur sequence would
    // fire `onBlur` immediately after — simulate that second commit attempt directly.
    fireEvent.blur(editor);

    await waitFor(() => expect(patchSourceRowMock).toHaveBeenCalledTimes(1));
  });

  it("tasks.md 4.3a: Escape commits zero saves", async () => {
    fetchDatasetSchemaMock.mockResolvedValue(requiredNoDefaultSchema);
    fetchSourceRowsMock.mockResolvedValue(
      onePage([{ id: "r1", seq: 0, updatedAt: "2026-01-01T00:00:00Z", data: ["Alice", "hi"] }]),
    );

    renderWithStore(<DatasetRowGrid sourceId={sourceId} />);
    const cell = await screen.findByText("Alice");
    fireEvent.click(cell);
    fireEvent.keyDown(screen.getByRole("grid"), { key: "Enter" });
    const editor = screen.getByDisplayValue("Alice");
    fireEvent.change(editor, { target: { value: "Alicia" } });
    fireEvent.keyDown(editor, { key: "Escape" });
    fireEvent.blur(editor);

    await waitFor(() => expect(screen.getByText("Alice")).toBeInTheDocument());
    expect(patchSourceRowMock).not.toHaveBeenCalled();
  });

  it("a required field with no declared default cannot be emptied — no PATCH is sent, and a cell error renders", async () => {
    fetchDatasetSchemaMock.mockResolvedValue(requiredNoDefaultSchema);
    fetchSourceRowsMock.mockResolvedValue(
      onePage([{ id: "r1", seq: 0, updatedAt: "2026-01-01T00:00:00Z", data: ["Alice", "hi"] }]),
    );

    renderWithStore(<DatasetRowGrid sourceId={sourceId} />);
    const cell = await screen.findByText("Alice");
    fireEvent.click(cell);
    fireEvent.keyDown(screen.getByRole("grid"), { key: "Enter" });
    const editor = screen.getByDisplayValue("Alice");
    fireEvent.change(editor, { target: { value: "" } });
    fireEvent.keyDown(editor, { key: "Enter" });

    await waitFor(() => expect(screen.getByText(/cannot be emptied/)).toBeInTheDocument());
    expect(patchSourceRowMock).not.toHaveBeenCalled();
  });

  it('a non-required field CAN be emptied and submits JSON null (not "")', async () => {
    fetchDatasetSchemaMock.mockResolvedValue(requiredNoDefaultSchema);
    fetchSourceRowsMock.mockResolvedValue(
      onePage([{ id: "r1", seq: 0, updatedAt: "2026-01-01T00:00:00Z", data: ["Alice", "hi"] }]),
    );
    patchSourceRowMock.mockResolvedValue({
      row: { id: "r1", seq: 0, updatedAt: "2026-01-02T00:00:00Z", data: ["Alice", null] },
      sourceUpdatedAt: "2026-01-02T00:00:00Z",
    });

    renderWithStore(<DatasetRowGrid sourceId={sourceId} />);
    const cell = await screen.findByText("hi");
    fireEvent.click(cell);
    fireEvent.keyDown(screen.getByRole("grid"), { key: "Enter" });
    const editor = screen.getByDisplayValue("hi");
    fireEvent.change(editor, { target: { value: "" } });
    fireEvent.keyDown(editor, { key: "Enter" });

    await waitFor(() => expect(patchSourceRowMock).toHaveBeenCalledTimes(1));
    expect(patchSourceRowMock).toHaveBeenCalledWith(sourceId, "r1", "2026-01-01T00:00:00Z", [
      "Alice",
      null,
    ]);
  });

  it("an unparseable 400 message renders a grid-level banner rather than being silently dropped (tasks.md 5.9)", async () => {
    fetchDatasetSchemaMock.mockResolvedValue(requiredNoDefaultSchema);
    fetchSourceRowsMock.mockResolvedValue(
      onePage([{ id: "r1", seq: 0, updatedAt: "2026-01-01T00:00:00Z", data: ["Alice", "hi"] }]),
    );
    patchSourceRowMock.mockRejectedValue({
      isAxiosError: true,
      response: { status: 400, data: { message: "some future validator message shape" } },
    });

    renderWithStore(<DatasetRowGrid sourceId={sourceId} />);
    const cell = await screen.findByText("hi");
    fireEvent.click(cell);
    fireEvent.keyDown(screen.getByRole("grid"), { key: "Enter" });
    const editor = screen.getByDisplayValue("hi");
    fireEvent.change(editor, { target: { value: "bye" } });
    fireEvent.keyDown(editor, { key: "Enter" });

    expect(await screen.findByText("some future validator message shape")).toBeInTheDocument();
  });

  it("delete: pressing Delete on the active cell shows a confirm, and confirming issues one DELETE call", async () => {
    fetchDatasetSchemaMock.mockResolvedValue(requiredNoDefaultSchema);
    fetchSourceRowsMock.mockResolvedValue(
      onePage([{ id: "r1", seq: 0, updatedAt: "2026-01-01T00:00:00Z", data: ["Alice", "hi"] }]),
    );
    deleteSourceRowMock.mockResolvedValue(undefined);

    renderWithStore(<DatasetRowGrid sourceId={sourceId} />);
    const cell = await screen.findByText("Alice");
    fireEvent.click(cell);
    fireEvent.keyDown(screen.getByRole("grid"), { key: "Delete" });

    fireEvent.click(await screen.findByRole("button", { name: /confirm/i }));
    await waitFor(() => expect(deleteSourceRowMock).toHaveBeenCalledTimes(1));
    expect(deleteSourceRowMock).toHaveBeenCalledWith(sourceId, "r1", "2026-01-01T00:00:00Z");
  });

  // skeptic-final-2.md CR-B: `requiredNoDefaultSchema`'s `name` field is required with no
  // default -- the real backend 400s an all-`null` append for this exact schema (the round-1/2
  // defect). This exercises the real draft-form flow: fill the required field, THEN submit.
  it("add row: fills the required field in the draft form before submitting, then pages forward to the last page", async () => {
    fetchDatasetSchemaMock.mockResolvedValue(requiredNoDefaultSchema);
    fetchSourceRowsMock.mockResolvedValueOnce(
      onePage([{ id: "r1", seq: 0, updatedAt: "2026-01-01T00:00:00Z", data: ["Alice", "hi"] }]),
    );
    appendSourceRowsMock.mockResolvedValue({
      rows: [{ id: "r2", seq: 1, updatedAt: "2026-01-01T00:00:00Z" }],
      updatedAt: "2026-01-01T00:00:00Z",
    });
    fetchSourceRowsMock.mockResolvedValueOnce(
      onePage([
        { id: "r1", seq: 0, updatedAt: "2026-01-01T00:00:00Z", data: ["Alice", "hi"] },
        { id: "r2", seq: 1, updatedAt: "2026-01-01T00:00:00Z", data: ["Bob", null] },
      ]),
    );

    renderWithStore(<DatasetRowGrid sourceId={sourceId} />);
    await screen.findByText("Alice");
    fireEvent.click(screen.getByRole("button", { name: "Add row" }));

    const nameInput = screen.getByLabelText(/name/i);
    fireEvent.change(nameInput, { target: { value: "Bob" } });
    fireEvent.click(screen.getByRole("button", { name: "Save row" }));

    await waitFor(() => expect(appendSourceRowsMock).toHaveBeenCalledTimes(1));
    // The required field's real value went out, never `null`.
    expect(appendSourceRowsMock).toHaveBeenCalledWith(sourceId, [["Bob", null]]);
  });

  it("add row: Save is blocked client-side when the required field is left blank -- never posts an all-null row the backend would 400", async () => {
    fetchDatasetSchemaMock.mockResolvedValue(requiredNoDefaultSchema);
    fetchSourceRowsMock.mockResolvedValue(
      onePage([{ id: "r1", seq: 0, updatedAt: "2026-01-01T00:00:00Z", data: ["Alice", "hi"] }]),
    );

    renderWithStore(<DatasetRowGrid sourceId={sourceId} />);
    await screen.findByText("Alice");
    fireEvent.click(screen.getByRole("button", { name: "Add row" }));
    fireEvent.click(screen.getByRole("button", { name: "Save row" }));

    expect(await screen.findByText(/is required and has no default/)).toBeInTheDocument();
    expect(appendSourceRowsMock).not.toHaveBeenCalled();
  });

  it("add row: a server-side 400 (e.g. a stricter rule the client hasn't caught up to) attaches to the right draft field, not just a banner", async () => {
    fetchDatasetSchemaMock.mockResolvedValue(requiredNoDefaultSchema);
    fetchSourceRowsMock.mockResolvedValue(
      onePage([{ id: "r1", seq: 0, updatedAt: "2026-01-01T00:00:00Z", data: ["Alice", "hi"] }]),
    );
    appendSourceRowsMock.mockRejectedValueOnce({
      isAxiosError: true,
      response: { status: 400, data: { message: "row 0: field 'name' is required" } },
    });

    renderWithStore(<DatasetRowGrid sourceId={sourceId} />);
    await screen.findByText("Alice");
    fireEvent.click(screen.getByRole("button", { name: "Add row" }));
    fireEvent.change(screen.getByLabelText(/name/i), { target: { value: "Bob" } });
    fireEvent.click(screen.getByRole("button", { name: "Save row" }));

    expect(await screen.findByText("row 0: field 'name' is required")).toBeInTheDocument();
  });

  it("evaluation-1.md CR1 (tasks.md 4.2a/5.6, design.md Decision 0): Shift+Tab from inside the editor lands focus OUTSIDE the grid, not back on the same cell", async () => {
    fetchDatasetSchemaMock.mockResolvedValue(requiredNoDefaultSchema);
    fetchSourceRowsMock.mockResolvedValue(
      onePage([{ id: "r1", seq: 0, updatedAt: "2026-01-01T00:00:00Z", data: ["Alice", "hi"] }]),
    );
    patchSourceRowMock.mockResolvedValue({
      row: { id: "r1", seq: 0, updatedAt: "2026-01-02T00:00:00Z", data: ["Alice", "hi"] },
      sourceUpdatedAt: "2026-01-02T00:00:00Z",
    });

    const { container } = renderWithStore(<DatasetRowGrid sourceId={sourceId} />);
    const cell = await screen.findByText("Alice");
    fireEvent.click(cell);
    fireEvent.keyDown(screen.getByRole("grid"), { key: "Enter" });
    const editor = screen.getByDisplayValue("Alice");
    const enclosingCell = editor.closest("td");

    fireEvent.keyDown(editor, { key: "Tab", shiftKey: true });

    const grid = container.querySelector('[role="grid"]');
    expect(grid).not.toBeNull();
    expect(grid!.contains(document.activeElement)).toBe(false);
    expect(document.activeElement).not.toBe(enclosingCell);
    // The nearest preceding ENABLED focusable element is "Refresh" -- "Next" is disabled
    // (single-page fixture, no `nextCursor`), so it is correctly skipped as a non-tab-stop.
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Refresh" }));
  });

  it("evaluation-1.md CR1: Tab from the grid's last focusable page element falls back to default browser tab order (tasks.md 4.3b) rather than throwing", async () => {
    fetchDatasetSchemaMock.mockResolvedValue(requiredNoDefaultSchema);
    fetchSourceRowsMock.mockResolvedValue(
      onePage([{ id: "r1", seq: 0, updatedAt: "2026-01-01T00:00:00Z", data: ["Alice", "hi"] }]),
    );
    patchSourceRowMock.mockResolvedValue({
      row: { id: "r1", seq: 0, updatedAt: "2026-01-02T00:00:00Z", data: ["Alice", "hi"] },
      sourceUpdatedAt: "2026-01-02T00:00:00Z",
    });

    renderWithStore(<DatasetRowGrid sourceId={sourceId} />);
    const cell = await screen.findByText("Alice");
    fireEvent.click(cell);
    fireEvent.keyDown(screen.getByRole("grid"), { key: "Enter" });
    const editor = screen.getByDisplayValue("Alice");

    // No focusable element follows the grid in this fixture's DOM — forward Tab should not throw
    // and should not call preventDefault (falls back to the browser's own default traversal).
    expect(() => fireEvent.keyDown(editor, { key: "Tab" })).not.toThrow();
  });
});
