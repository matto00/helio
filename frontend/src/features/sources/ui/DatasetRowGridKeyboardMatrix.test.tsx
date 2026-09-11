import { fireEvent, screen, waitFor } from "@testing-library/react";

import { renderWithStore } from "../../../test/renderWithStore";
import { DatasetRowGrid } from "./DatasetRowGrid";
import {
  fetchDatasetSchema as fetchDatasetSchemaRequest,
  fetchSourceRows as fetchSourceRowsRequest,
  patchSourceRow as patchSourceRowRequest,
  deleteSourceRow as deleteSourceRowRequest,
} from "../services/dataSourceService";
import type { DatasetSchemaResponse, RowListResponse, RowResponseRow } from "../types/dataSource";

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

const sourceId = "src-1";
const onePage = (rows: RowResponseRow[]): RowListResponse => ({ rows, total: rows.length });

beforeEach(() => jest.clearAllMocks());

// HEL-1080 tasks.md 5.6 (evaluation-1.md CR3): the full keyboard-operability matrix beyond what
// DatasetRowGrid.test.tsx already covers (edit+save, 4.3a double-commit guard, Escape, Tab/
// Shift+Tab focus-forwarding).
describe("DatasetRowGrid keyboard matrix (tasks.md 5.6)", () => {
  const schema: DatasetSchemaResponse = {
    fields: [{ name: "name", type: "string", required: false }],
  };

  function manyRows(n: number): RowResponseRow[] {
    return Array.from({ length: n }, (_, i) => ({
      id: `r${i}`,
      seq: i,
      updatedAt: "2026-01-01T00:00:00Z",
      data: [`row-${i}`],
    }));
  }

  it("arrow-navigates a full 100-row page, keeping the roving tabindex on exactly one cell throughout", async () => {
    fetchDatasetSchemaMock.mockResolvedValue(schema);
    fetchSourceRowsMock.mockResolvedValue(onePage(manyRows(100)));

    const { container } = renderWithStore(<DatasetRowGrid sourceId={sourceId} />);
    const firstCell = await screen.findByText("row-0");
    fireEvent.click(firstCell);
    const grid = screen.getByRole("grid");

    for (let i = 0; i < 99; i++) {
      fireEvent.keyDown(grid, { key: "ArrowDown" });
      const zeroTabIndexCells = container.querySelectorAll('td[tabindex="0"]');
      expect(zeroTabIndexCells).toHaveLength(1);
      expect(zeroTabIndexCells[0]).toHaveTextContent(`row-${i + 1}`);
    }
  });

  it("ArrowDown on the last row of the page holds the active cell in place (no wrap, no cross-page nav)", async () => {
    fetchDatasetSchemaMock.mockResolvedValue(schema);
    fetchSourceRowsMock.mockResolvedValue(onePage(manyRows(3)));

    const { container } = renderWithStore(<DatasetRowGrid sourceId={sourceId} />);
    const lastCell = await screen.findByText("row-2");
    fireEvent.click(lastCell);
    const grid = screen.getByRole("grid");

    fireEvent.keyDown(grid, { key: "ArrowDown" });
    const active = container.querySelector('td[tabindex="0"]');
    expect(active).toHaveTextContent("row-2");
    // Page indicator unchanged -- no cross-page navigation via arrow keys.
    expect(screen.getByText("Page 1")).toBeInTheDocument();
  });

  it("ArrowUp on the first row of the page holds the active cell in place", async () => {
    fetchDatasetSchemaMock.mockResolvedValue(schema);
    fetchSourceRowsMock.mockResolvedValue(onePage(manyRows(3)));

    const { container } = renderWithStore(<DatasetRowGrid sourceId={sourceId} />);
    const firstCell = await screen.findByText("row-0");
    fireEvent.click(firstCell);
    const grid = screen.getByRole("grid");

    fireEvent.keyDown(grid, { key: "ArrowUp" });
    const active = container.querySelector('td[tabindex="0"]');
    expect(active).toHaveTextContent("row-0");
  });

  it("blur commits an in-progress edit (not just Tab/Enter)", async () => {
    fetchDatasetSchemaMock.mockResolvedValue(schema);
    fetchSourceRowsMock.mockResolvedValue(onePage(manyRows(1)));
    patchSourceRowMock.mockResolvedValue({
      row: { id: "r0", seq: 0, updatedAt: "2026-01-02T00:00:00Z", data: ["changed"] },
      sourceUpdatedAt: "2026-01-02T00:00:00Z",
    });

    renderWithStore(<DatasetRowGrid sourceId={sourceId} />);
    const cell = await screen.findByText("row-0");
    fireEvent.click(cell);
    fireEvent.keyDown(screen.getByRole("grid"), { key: "Enter" });
    const editor = screen.getByDisplayValue("row-0");
    fireEvent.change(editor, { target: { value: "changed" } });
    // A mouse click elsewhere (not Tab/Enter/Escape) — the editor simply loses focus.
    fireEvent.blur(editor);

    await waitFor(() => expect(patchSourceRowMock).toHaveBeenCalledTimes(1));
    expect(patchSourceRowMock).toHaveBeenCalledWith(sourceId, "r0", "2026-01-01T00:00:00Z", [
      "changed",
    ]);
  });

  it("Delete/Backspace edits the cell's text normally while editing, rather than triggering row delete", async () => {
    fetchDatasetSchemaMock.mockResolvedValue(schema);
    fetchSourceRowsMock.mockResolvedValue(onePage(manyRows(1)));

    renderWithStore(<DatasetRowGrid sourceId={sourceId} />);
    const cell = await screen.findByText("row-0");
    fireEvent.click(cell);
    fireEvent.keyDown(screen.getByRole("grid"), { key: "Enter" });
    const editor = screen.getByDisplayValue("row-0") as HTMLInputElement;

    fireEvent.keyDown(editor, { key: "Delete" });
    fireEvent.keyDown(editor, { key: "Backspace" });

    // No confirm-delete affordance appeared -- Delete/Backspace stayed scoped to text editing.
    expect(screen.queryByText(/Delete this row/)).not.toBeInTheDocument();
    expect(deleteSourceRowMock).not.toHaveBeenCalled();
  });

  it("Delete on the active cell (not editing) shows the row-delete confirm", async () => {
    fetchDatasetSchemaMock.mockResolvedValue(schema);
    fetchSourceRowsMock.mockResolvedValue(onePage(manyRows(1)));

    renderWithStore(<DatasetRowGrid sourceId={sourceId} />);
    const cell = await screen.findByText("row-0");
    fireEvent.click(cell);
    fireEvent.keyDown(screen.getByRole("grid"), { key: "Delete" });

    expect(await screen.findByText(/Delete this row/)).toBeInTheDocument();
  });
});

// HEL-1080 tasks.md 5.6a (evaluation-1.md CR3): required-field-emptying matrix across every
// editable field type, not just `string`.
describe("DatasetRowGrid required-field-emptying matrix (tasks.md 5.6a)", () => {
  async function setupAndAttemptEmpty(
    fieldType: "string" | "integer" | "float" | "timestamp" | "string-body",
    required: boolean,
    initialValue: string,
  ) {
    fetchDatasetSchemaMock.mockResolvedValue({
      fields: [{ name: "f", type: fieldType, required }],
    });
    fetchSourceRowsMock.mockResolvedValue(
      onePage([{ id: "r0", seq: 0, updatedAt: "2026-01-01T00:00:00Z", data: [initialValue] }]),
    );
    patchSourceRowMock.mockResolvedValue({
      row: { id: "r0", seq: 0, updatedAt: "2026-01-02T00:00:00Z", data: [null] },
      sourceUpdatedAt: "2026-01-02T00:00:00Z",
    });

    renderWithStore(<DatasetRowGrid sourceId={sourceId} />);
    const cell = await screen.findByText(initialValue);
    fireEvent.click(cell);
    fireEvent.keyDown(screen.getByRole("grid"), { key: "Enter" });
    const editor = screen.getByDisplayValue(initialValue);
    fireEvent.change(editor, { target: { value: "" } });
    fireEvent.keyDown(editor, { key: "Enter" }); // no-op for a textarea (string-body); blur below always commits
    fireEvent.blur(editor);
  }

  it.each([
    ["integer", "42"],
    ["float", "4.2"],
    ["timestamp", "2026-01-01T00:00"],
    ["string-body", "long text"],
  ] as const)(
    "a required %s field with no declared default cannot be emptied — no PATCH sent",
    async (fieldType, initialValue) => {
      await setupAndAttemptEmpty(fieldType, true, initialValue);
      await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/cannot be emptied/));
      expect(patchSourceRowMock).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["integer", "42"],
    ["float", "4.2"],
    ["timestamp", "2026-01-01T00:00"],
    ["string-body", "long text"],
  ] as const)(
    "a non-required %s field CAN be emptied and submits JSON null",
    async (fieldType, initialValue) => {
      await setupAndAttemptEmpty(fieldType, false, initialValue);
      await waitFor(() => expect(patchSourceRowMock).toHaveBeenCalledTimes(1));
      expect(patchSourceRowMock).toHaveBeenCalledWith(sourceId, "r0", "2026-01-01T00:00:00Z", [
        null,
      ]);
    },
  );

  it("a required field WITH a declared default CAN be emptied and submits JSON null", async () => {
    fetchDatasetSchemaMock.mockResolvedValue({
      fields: [{ name: "f", type: "string", required: true, default: "fallback" }],
    });
    fetchSourceRowsMock.mockResolvedValue(
      onePage([{ id: "r0", seq: 0, updatedAt: "2026-01-01T00:00:00Z", data: ["value"] }]),
    );
    patchSourceRowMock.mockResolvedValue({
      row: { id: "r0", seq: 0, updatedAt: "2026-01-02T00:00:00Z", data: [null] },
      sourceUpdatedAt: "2026-01-02T00:00:00Z",
    });

    renderWithStore(<DatasetRowGrid sourceId={sourceId} />);
    const cell = await screen.findByText("value");
    fireEvent.click(cell);
    fireEvent.keyDown(screen.getByRole("grid"), { key: "Enter" });
    const editor = screen.getByDisplayValue("value");
    fireEvent.change(editor, { target: { value: "" } });
    fireEvent.keyDown(editor, { key: "Enter" }); // no-op for a textarea (string-body); blur below always commits
    fireEvent.blur(editor);

    await waitFor(() => expect(patchSourceRowMock).toHaveBeenCalledTimes(1));
    expect(patchSourceRowMock).toHaveBeenCalledWith(sourceId, "r0", "2026-01-01T00:00:00Z", [null]);
  });

  it("a required field with a null DECLARED default cannot be emptied (tasks.md 4.3b: null default is 'no usable default')", async () => {
    fetchDatasetSchemaMock.mockResolvedValue({
      fields: [{ name: "f", type: "string", required: true, default: null }],
    });
    fetchSourceRowsMock.mockResolvedValue(
      onePage([{ id: "r0", seq: 0, updatedAt: "2026-01-01T00:00:00Z", data: ["value"] }]),
    );

    renderWithStore(<DatasetRowGrid sourceId={sourceId} />);
    const cell = await screen.findByText("value");
    fireEvent.click(cell);
    fireEvent.keyDown(screen.getByRole("grid"), { key: "Enter" });
    const editor = screen.getByDisplayValue("value");
    fireEvent.change(editor, { target: { value: "" } });
    fireEvent.keyDown(editor, { key: "Enter" }); // no-op for a textarea (string-body); blur below always commits
    fireEvent.blur(editor);

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/cannot be emptied/));
    expect(patchSourceRowMock).not.toHaveBeenCalled();
  });
});
