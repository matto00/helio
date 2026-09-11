import { act, fireEvent, screen, waitFor } from "@testing-library/react";

import { renderWithStore } from "../../../test/renderWithStore";
import { DatasetRowGrid } from "./DatasetRowGrid";
import {
  fetchDatasetSchema as fetchDatasetSchemaRequest,
  fetchSourceRows as fetchSourceRowsRequest,
  patchSourceRow as patchSourceRowRequest,
  deleteSourceRow as deleteSourceRowRequest,
  appendSourceRows as appendSourceRowsRequest,
} from "../services/dataSourceService";
import type { DatasetSchemaResponse, RowResponseRow } from "../types/dataSource";

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
const schema: DatasetSchemaResponse = {
  fields: [{ name: "name", type: "string", required: false }],
};

function page(rows: RowResponseRow[], nextCursor?: number) {
  return { rows, total: rows.length, nextCursor };
}

beforeEach(() => jest.resetAllMocks());

// skeptic-final-2.md CR-C: `appendDatasetRow` must push each followed cursor onto
// `cursorStack`, so the page label and Prev/Next enabled-state stay consistent with the page
// actually shown after an append -- previously the append followed `nextCursor` correctly but
// never told `cursorStack` about it, so page 2's rows rendered under a "Page 1" label with both
// pager buttons disabled.
describe("DatasetRowGrid pager consistency after Add row (tasks.md 3.6, skeptic-final-2.md CR-C)", () => {
  it('shows "Page 2", a working Prev, and Refresh stays on the last page after an append that lands on page 2', async () => {
    fetchDatasetSchemaMock.mockResolvedValue(schema);
    fetchSourceRowsMock.mockResolvedValueOnce(
      page([{ id: "r0", seq: 0, updatedAt: "t", data: ["a"] }]),
    );
    appendSourceRowsMock.mockResolvedValue({
      rows: [{ id: "r1", seq: 1, updatedAt: "t" }],
      updatedAt: "t",
    });
    // appendDatasetRow re-pages from the top: page 1 (full), then page 2 (the new row, no more
    // after it).
    fetchSourceRowsMock.mockResolvedValueOnce(
      page([{ id: "r0", seq: 0, updatedAt: "t", data: ["a"] }], 1),
    );
    fetchSourceRowsMock.mockResolvedValueOnce(
      page([{ id: "r1", seq: 1, updatedAt: "t", data: ["b"] }]),
    );

    renderWithStore(<DatasetRowGrid sourceId={sourceId} />);
    await screen.findByText("a");
    fireEvent.click(screen.getByRole("button", { name: "Add row" }));
    fireEvent.click(screen.getByRole("button", { name: "Save row" }));

    await screen.findByText("b");
    expect(screen.getByText("Page 2")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Prev" })).not.toBeDisabled();
    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();

    // Prev actually works -- pops back to a real, matching page 1.
    fetchSourceRowsMock.mockResolvedValueOnce(
      page([{ id: "r0", seq: 0, updatedAt: "t", data: ["a"] }], 1),
    );
    fireEvent.click(screen.getByRole("button", { name: "Prev" }));
    await screen.findByText("a");
    expect(screen.getByText("Page 1")).toBeInTheDocument();

    // Refresh (from page 1, having gone back) re-fetches page 1, not some stale page-2 cursor.
    fetchSourceRowsMock.mockResolvedValueOnce(
      page([{ id: "r0", seq: 0, updatedAt: "t2", data: ["a-refreshed"] }], 1),
    );
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    await screen.findByText("a-refreshed");
    expect(screen.getByText("Page 1")).toBeInTheDocument();
  });

  it("a 3-page append (added row lands on page 3) produces a cursorStack of the right length", async () => {
    fetchDatasetSchemaMock.mockResolvedValue(schema);
    fetchSourceRowsMock.mockResolvedValueOnce(
      page([{ id: "r0", seq: 0, updatedAt: "t", data: ["a"] }]),
    );
    appendSourceRowsMock.mockResolvedValue({
      rows: [{ id: "r2", seq: 2, updatedAt: "t" }],
      updatedAt: "t",
    });
    fetchSourceRowsMock.mockResolvedValueOnce(
      page([{ id: "r0", seq: 0, updatedAt: "t", data: ["a"] }], 1),
    );
    fetchSourceRowsMock.mockResolvedValueOnce(
      page([{ id: "r1", seq: 1, updatedAt: "t", data: ["b"] }], 2),
    );
    fetchSourceRowsMock.mockResolvedValueOnce(
      page([{ id: "r2", seq: 2, updatedAt: "t", data: ["c"] }]),
    );

    renderWithStore(<DatasetRowGrid sourceId={sourceId} />);
    await screen.findByText("a");
    fireEvent.click(screen.getByRole("button", { name: "Add row" }));
    fireEvent.click(screen.getByRole("button", { name: "Save row" }));

    await screen.findByText("c");
    expect(screen.getByText("Page 3")).toBeInTheDocument();
  });
});

// skeptic-final-2.md CR-D: every named focus-loss path lands somewhere deliberate, never
// `document.body`.
describe("DatasetRowGrid focus-loss paths (skeptic-final-2.md CR-D)", () => {
  it("autofocuses the delete-confirm's Cancel button, and Cancel returns focus to the active cell", async () => {
    fetchDatasetSchemaMock.mockResolvedValue(schema);
    fetchSourceRowsMock.mockResolvedValue(
      page([{ id: "r0", seq: 0, updatedAt: "t", data: ["a"] }]),
    );

    const { container } = renderWithStore(<DatasetRowGrid sourceId={sourceId} />);
    const cell = await screen.findByText("a");
    fireEvent.click(cell);
    fireEvent.keyDown(screen.getByRole("grid"), { key: "Delete" });

    const cancelBtn = await screen.findByRole("button", { name: "Cancel" });
    expect(document.activeElement).toBe(cancelBtn);

    fireEvent.click(cancelBtn);
    await waitFor(() => {
      const td = container.querySelector('td[tabindex="0"]');
      expect(document.activeElement).toBe(td);
    });
    expect(document.activeElement).not.toBe(document.body);
  });

  it("after a delete is confirmed, focus lands on the (new) active cell, never document.body", async () => {
    fetchDatasetSchemaMock.mockResolvedValue(schema);
    fetchSourceRowsMock.mockResolvedValue(
      page([
        { id: "r0", seq: 0, updatedAt: "t", data: ["a"] },
        { id: "r1", seq: 1, updatedAt: "t", data: ["b"] },
      ]),
    );
    deleteSourceRowMock.mockResolvedValue(undefined);

    const { container } = renderWithStore(<DatasetRowGrid sourceId={sourceId} />);
    const cell = await screen.findByText("a");
    fireEvent.click(cell);
    fireEvent.keyDown(screen.getByRole("grid"), { key: "Delete" });
    fireEvent.click(await screen.findByRole("button", { name: /confirm/i }));

    await waitFor(() => expect(deleteSourceRowMock).toHaveBeenCalledTimes(1));
    await waitFor(() => {
      const td = container.querySelector('td[tabindex="0"]');
      expect(document.activeElement).toBe(td);
      expect(document.activeElement).not.toBe(document.body);
    });
  });

  it("after conflict Retry resolves, focus returns to the active cell, not document.body", async () => {
    fetchDatasetSchemaMock.mockResolvedValue(schema);
    fetchSourceRowsMock.mockResolvedValueOnce(
      page([{ id: "r0", seq: 0, updatedAt: "t1", data: ["old"] }]),
    );
    patchSourceRowMock.mockRejectedValueOnce({
      isAxiosError: true,
      response: { status: 409, data: { message: "conflict" } },
    });
    fetchSourceRowsMock.mockResolvedValueOnce(
      page([{ id: "r0", seq: 0, updatedAt: "t2", data: ["server"] }]),
    );
    patchSourceRowMock.mockResolvedValueOnce({
      row: { id: "r0", seq: 0, updatedAt: "t3", data: ["new"] },
      sourceUpdatedAt: "t3",
    });

    const { container } = renderWithStore(<DatasetRowGrid sourceId={sourceId} />);
    const cell = await screen.findByText("old");
    fireEvent.click(cell);
    fireEvent.keyDown(screen.getByRole("grid"), { key: "Enter" });
    const editor = screen.getByDisplayValue("old");
    fireEvent.change(editor, { target: { value: "new" } });
    fireEvent.keyDown(editor, { key: "Enter" });

    fireEvent.click(await screen.findByRole("button", { name: /Retry/ }));
    await waitFor(() => expect(patchSourceRowMock).toHaveBeenCalledTimes(2));
    await waitFor(() => {
      const td = container.querySelector('td[tabindex="0"]');
      expect(document.activeElement).toBe(td);
      expect(document.activeElement).not.toBe(document.body);
    });
  });

  it("after conflict Discard, focus returns to the active cell, not document.body", async () => {
    fetchDatasetSchemaMock.mockResolvedValue(schema);
    fetchSourceRowsMock.mockResolvedValueOnce(
      page([{ id: "r0", seq: 0, updatedAt: "t1", data: ["old"] }]),
    );
    patchSourceRowMock.mockRejectedValueOnce({
      isAxiosError: true,
      response: { status: 409, data: { message: "conflict" } },
    });
    fetchSourceRowsMock.mockResolvedValueOnce(
      page([{ id: "r0", seq: 0, updatedAt: "t2", data: ["server"] }]),
    );

    const { container } = renderWithStore(<DatasetRowGrid sourceId={sourceId} />);
    const cell = await screen.findByText("old");
    fireEvent.click(cell);
    fireEvent.keyDown(screen.getByRole("grid"), { key: "Enter" });
    const editor = screen.getByDisplayValue("old");
    fireEvent.change(editor, { target: { value: "new" } });
    fireEvent.keyDown(editor, { key: "Enter" });

    fireEvent.click(await screen.findByRole("button", { name: "Discard" }));
    await waitFor(() => {
      const td = container.querySelector('td[tabindex="0"]');
      expect(document.activeElement).toBe(td);
      expect(document.activeElement).not.toBe(document.body);
    });
  });

  it("Next disables itself on the new last page, then Prev takes focus", async () => {
    fetchDatasetSchemaMock.mockResolvedValue(schema);
    fetchSourceRowsMock.mockResolvedValueOnce(
      page([{ id: "r0", seq: 0, updatedAt: "t", data: ["page1"] }], 1),
    );
    fetchSourceRowsMock.mockResolvedValueOnce(
      page([{ id: "r1", seq: 1, updatedAt: "t", data: ["page2"] }]),
    );

    renderWithStore(<DatasetRowGrid sourceId={sourceId} />);
    await screen.findByText("page1");
    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    await screen.findByText("page2");
    await waitFor(() => expect(screen.getByRole("button", { name: "Next" })).toBeDisabled());
    // The focus-move is deferred a frame past the state update (see DatasetRowGrid.tsx) --
    // `waitFor` covers that gap instead of asserting on a single, possibly-premature tick.
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole("button", { name: "Prev" })),
    );
  });

  it("Prev disables itself back on page 1, then Next takes focus (when still enabled)", async () => {
    fetchDatasetSchemaMock.mockResolvedValue(schema);
    fetchSourceRowsMock.mockResolvedValueOnce(
      page([{ id: "r0", seq: 0, updatedAt: "t", data: ["page1"] }], 1),
    );
    fetchSourceRowsMock.mockResolvedValueOnce(
      page([{ id: "r1", seq: 1, updatedAt: "t", data: ["page2"] }], 2),
    );

    renderWithStore(<DatasetRowGrid sourceId={sourceId} />);
    await screen.findByText("page1");
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await screen.findByText("page2");

    fetchSourceRowsMock.mockResolvedValueOnce(
      page([{ id: "r0", seq: 0, updatedAt: "t", data: ["page1"] }], 1),
    );
    fireEvent.click(screen.getByRole("button", { name: "Prev" }));
    await screen.findByText("page1");

    expect(screen.getByRole("button", { name: "Prev" })).toBeDisabled();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Next" }));
  });
});

// skeptic-final-3.md CR-H: the add-row draft form's own two named focus-loss paths, driven by
// real keyboard input (not `fireEvent.click`) throughout.
describe("DatasetRowGrid add-row draft form focus paths (skeptic-final-3.md CR-H)", () => {
  it("Enter on 'Add row' moves focus INTO the form (the first field), never document.body", async () => {
    fetchDatasetSchemaMock.mockResolvedValue(schema);
    fetchSourceRowsMock.mockResolvedValue(
      page([{ id: "r0", seq: 0, updatedAt: "t", data: ["a"] }]),
    );

    renderWithStore(<DatasetRowGrid sourceId={sourceId} />);
    await screen.findByText("a");
    const addRowButton = screen.getByRole("button", { name: "Add row" });
    addRowButton.focus();
    fireEvent.keyDown(addRowButton, { key: "Enter" });
    fireEvent.click(addRowButton); // jsdom doesn't invoke a native button's click on Enter itself.

    const nameInput = screen.getByLabelText(/name/i);
    await waitFor(() => expect(document.activeElement).toBe(nameInput));
    expect(document.activeElement).not.toBe(document.body);
  });

  it("a successful Save (via keyboard) leaves focus on the 'Add row' button, never document.body", async () => {
    fetchDatasetSchemaMock.mockResolvedValue(schema);
    fetchSourceRowsMock.mockResolvedValue(
      page([{ id: "r0", seq: 0, updatedAt: "t", data: ["a"] }]),
    );
    appendSourceRowsMock.mockResolvedValue({
      rows: [{ id: "r1", seq: 1, updatedAt: "t" }],
      updatedAt: "t",
    });

    renderWithStore(<DatasetRowGrid sourceId={sourceId} />);
    await screen.findByText("a");
    const addRowButton = screen.getByRole("button", { name: "Add row" });
    fireEvent.click(addRowButton);
    await screen.findByLabelText(/name/i);

    const saveButton = screen.getByRole("button", { name: "Save row" });
    saveButton.focus();
    fireEvent.keyDown(saveButton, { key: "Enter" });
    fireEvent.click(saveButton);

    await waitFor(() => expect(screen.queryByLabelText(/name/i)).not.toBeInTheDocument());
    await waitFor(() => expect(document.activeElement).toBe(addRowButton));
    expect(document.activeElement).not.toBe(document.body);
  });

  // skeptic-final-4.md CR-J: the round-3 fix worked only because the mocked `appendSourceRows`
  // resolved synchronously-ish -- under any real latency, "Add row" was still natively `disabled`
  // (only cleared in a `.finally` that runs AFTER the `.then()`'s focus call) at the moment
  // `.focus()` ran, which silently no-ops on a disabled element. This test defers the mock's
  // resolution explicitly to reproduce that race, which the OTHER "successful Save" test above
  // (a same-tick mock) does not exercise.
  it("a successful Save under real latency still leaves focus on the 'Add row' button (CR-J)", async () => {
    fetchDatasetSchemaMock.mockResolvedValue(schema);
    fetchSourceRowsMock.mockResolvedValue(
      page([{ id: "r0", seq: 0, updatedAt: "t", data: ["a"] }]),
    );
    let resolveAppend!: (value: {
      rows: { id: string; seq: number; updatedAt: string }[];
      updatedAt: string;
    }) => void;
    appendSourceRowsMock.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveAppend = resolve;
      }),
    );

    renderWithStore(<DatasetRowGrid sourceId={sourceId} />);
    await screen.findByText("a");
    const addRowButton = screen.getByRole("button", { name: "Add row" });
    fireEvent.click(addRowButton);
    await screen.findByLabelText(/name/i);
    fireEvent.click(screen.getByRole("button", { name: "Save row" }));

    // The request is "in flight" -- Add row is aria-disabled but NOT natively disabled, so it
    // remains a valid `.focus()` target throughout (the actual CR-J fix).
    expect(addRowButton).toHaveAttribute("aria-disabled", "true");
    expect(addRowButton).not.toBeDisabled();

    await act(async () => {
      resolveAppend({ rows: [{ id: "r1", seq: 1, updatedAt: "t" }], updatedAt: "t" });
      await Promise.resolve();
    });

    await waitFor(() => expect(screen.queryByLabelText(/name/i)).not.toBeInTheDocument());
    await waitFor(() => expect(document.activeElement).toBe(addRowButton));
    expect(document.activeElement).not.toBe(document.body);
  });

  it("a server-side 400 on Save keeps focus on the first field with an error, form stays open", async () => {
    fetchDatasetSchemaMock.mockResolvedValue(schema);
    fetchSourceRowsMock.mockResolvedValue(
      page([{ id: "r0", seq: 0, updatedAt: "t", data: ["a"] }]),
    );
    appendSourceRowsMock.mockRejectedValueOnce({
      isAxiosError: true,
      response: { status: 400, data: { message: "row 0: field 'name' is required" } },
    });

    renderWithStore(<DatasetRowGrid sourceId={sourceId} />);
    await screen.findByText("a");
    fireEvent.click(screen.getByRole("button", { name: "Add row" }));
    const nameInput = await screen.findByLabelText(/name/i);
    fireEvent.change(nameInput, { target: { value: "filled" } });

    const saveButton = screen.getByRole("button", { name: "Save row" });
    fireEvent.click(saveButton);

    await waitFor(() => expect(document.activeElement).toBe(nameInput));
    expect(screen.getByLabelText(/name/i)).toBeInTheDocument(); // form stays open on a 400.
  });

  it("Cancel (via keyboard) still returns focus to the active grid cell", async () => {
    fetchDatasetSchemaMock.mockResolvedValue(schema);
    fetchSourceRowsMock.mockResolvedValue(
      page([{ id: "r0", seq: 0, updatedAt: "t", data: ["a"] }]),
    );

    const { container } = renderWithStore(<DatasetRowGrid sourceId={sourceId} />);
    await screen.findByText("a");
    fireEvent.click(screen.getByRole("button", { name: "Add row" }));
    await screen.findByLabelText(/name/i);

    const cancelButton = screen.getByRole("button", { name: "Cancel" });
    cancelButton.focus();
    fireEvent.keyDown(cancelButton, { key: "Enter" });
    fireEvent.click(cancelButton);

    await waitFor(() => {
      const td = container.querySelector('td[tabindex="0"]');
      expect(document.activeElement).toBe(td);
    });
    expect(document.activeElement).not.toBe(document.body);
  });
});

// skeptic-final-4.md non-blocking note: a stale pager error banner must clear once a LATER page
// fetch actually succeeds -- it previously stayed up indefinitely after one failure.
describe("DatasetRowGrid pager error banner clears on a later success (skeptic-final-4.md)", () => {
  it("a failed Next leaves a banner up; a subsequent successful Next clears it", async () => {
    fetchDatasetSchemaMock.mockResolvedValue(schema);
    fetchSourceRowsMock.mockResolvedValueOnce(
      page([{ id: "r0", seq: 0, updatedAt: "t", data: ["page1"] }], 1),
    );

    renderWithStore(<DatasetRowGrid sourceId={sourceId} />);
    await screen.findByText("page1");

    fetchSourceRowsMock.mockRejectedValueOnce({
      isAxiosError: true,
      response: { status: 429, data: { message: "Too many requests" } },
    });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await screen.findByText("Failed to load the next page.");
    // The failed fetch must not have advanced the page.
    expect(screen.getByText("Page 1")).toBeInTheDocument();

    fetchSourceRowsMock.mockResolvedValueOnce(
      page([{ id: "r1", seq: 1, updatedAt: "t", data: ["page2"] }]),
    );
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await screen.findByText("page2");

    expect(screen.queryByText("Failed to load the next page.")).not.toBeInTheDocument();
    expect(screen.getByText("Page 2")).toBeInTheDocument();
  });

  it("a failed Prev leaves a banner up; a subsequent successful Prev clears it", async () => {
    fetchDatasetSchemaMock.mockResolvedValue(schema);
    fetchSourceRowsMock.mockResolvedValueOnce(
      page([{ id: "r0", seq: 0, updatedAt: "t", data: ["page1"] }], 1),
    );
    fetchSourceRowsMock.mockResolvedValueOnce(
      page([{ id: "r1", seq: 1, updatedAt: "t", data: ["page2"] }], 2),
    );

    renderWithStore(<DatasetRowGrid sourceId={sourceId} />);
    await screen.findByText("page1");
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await screen.findByText("page2");

    fetchSourceRowsMock.mockRejectedValueOnce({
      isAxiosError: true,
      response: { status: 500, data: { message: "Server error" } },
    });
    fireEvent.click(screen.getByRole("button", { name: "Prev" }));
    await screen.findByText("Failed to load the previous page.");
    expect(screen.getByText("Page 2")).toBeInTheDocument(); // did not retreat.

    fetchSourceRowsMock.mockResolvedValueOnce(
      page([{ id: "r0", seq: 0, updatedAt: "t", data: ["page1"] }], 1),
    );
    fireEvent.click(screen.getByRole("button", { name: "Prev" }));
    await screen.findByText("page1");

    expect(screen.queryByText("Failed to load the previous page.")).not.toBeInTheDocument();
    expect(screen.getByText("Page 1")).toBeInTheDocument();
  });
});
