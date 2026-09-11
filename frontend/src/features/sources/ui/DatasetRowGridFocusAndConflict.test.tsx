import { act, fireEvent, screen, waitFor } from "@testing-library/react";

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
const schema: DatasetSchemaResponse = {
  fields: [{ name: "name", type: "string", required: false }],
};
const onePage = (rows: RowResponseRow[]): RowListResponse => ({ rows, total: rows.length });

beforeEach(() => jest.resetAllMocks());

// HEL-1080 skeptic-final-1.md CR1/CR2/CR3: real keyboard/DOM-focus assertions -- none of these
// tests start with a mouse click, per the skeptic's own "evidence-shaped non-evidence" finding
// against the prior test suite (every keyboard test began with `fireEvent.click`).
//
// Caveat, stated honestly: jsdom does not implement the browser's native Tab-key focus-traversal
// algorithm (raw `fireEvent.keyDown(el, {key: "Tab"})` never moves `document.activeElement` on
// its own, and this repo has no `@testing-library/user-event` dependency to synthesize it). What
// IS verified here, without ever clicking a cell: (a) exactly one enabled gridcell carries
// `tabIndex=0` on initial render with NO prior interaction -- the actual bug (CR1) was that ZERO
// cells did, so Tab had nothing to land on regardless of jsdom's traversal support -- and (b)
// that cell is a real, focusable DOM node (`.focus()` succeeds), proving it's a genuine tab stop
// and not, e.g., `display:none` or otherwise unreachable.
describe("DatasetRowGrid keyboard entry (tasks.md 5.1/5.6, skeptic-final-1.md CR1)", () => {
  it("exactly one gridcell is a real, focusable tab stop on initial render, before any click", async () => {
    fetchDatasetSchemaMock.mockResolvedValue(schema);
    fetchSourceRowsMock.mockResolvedValue(
      onePage([
        { id: "r0", seq: 0, updatedAt: "2026-01-01T00:00:00Z", data: ["row-0"] },
        { id: "r1", seq: 1, updatedAt: "2026-01-01T00:00:00Z", data: ["row-1"] },
      ]),
    );

    const { container } = renderWithStore(<DatasetRowGrid sourceId={sourceId} />);
    await screen.findByText("row-0");

    const tabbableCells = container.querySelectorAll('td[tabindex="0"]');
    expect(tabbableCells).toHaveLength(1);
    // It defaults to the FIRST row's first column (design.md Decision 0's fix).
    expect(tabbableCells[0]).toHaveTextContent("row-0");

    // No click has happened anywhere in this test -- confirm the cell is a genuine focus target.
    (tabbableCells[0] as HTMLElement).focus();
    expect(document.activeElement).toBe(tabbableCells[0]);
  });

  it("re-defaults activeCell to the new first cell when the active row disappears (page change)", async () => {
    fetchDatasetSchemaMock.mockResolvedValue(schema);
    fetchSourceRowsMock.mockResolvedValueOnce({
      rows: [{ id: "r0", seq: 0, updatedAt: "2026-01-01T00:00:00Z", data: ["page1-row"] }],
      total: 2,
      nextCursor: 1,
    });

    const { container } = renderWithStore(<DatasetRowGrid sourceId={sourceId} />);
    await screen.findByText("page1-row");
    expect(container.querySelectorAll('td[tabindex="0"]')).toHaveLength(1);

    fetchSourceRowsMock.mockResolvedValueOnce({
      rows: [{ id: "r99", seq: 99, updatedAt: "2026-01-01T00:00:00Z", data: ["page2-row"] }],
      total: 2,
      nextCursor: undefined,
    });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await screen.findByText("page2-row");

    const tabbableCells = container.querySelectorAll('td[tabindex="0"]');
    expect(tabbableCells).toHaveLength(1);
    expect(tabbableCells[0]).toHaveTextContent("page2-row");
  });
});

describe("DatasetRowGrid focus survives Refresh/Prev/Next (skeptic-final-1.md CR3)", () => {
  it("keeps the toolbar and grid mounted during a Refresh (no full-page unmount)", async () => {
    fetchDatasetSchemaMock.mockResolvedValue(schema);
    fetchSourceRowsMock.mockResolvedValue(
      onePage([{ id: "r0", seq: 0, updatedAt: "2026-01-01T00:00:00Z", data: ["value"] }]),
    );

    renderWithStore(<DatasetRowGrid sourceId={sourceId} />);
    await screen.findByText("value");
    const refreshButton = screen.getByRole("button", { name: "Refresh" });
    refreshButton.focus();
    expect(document.activeElement).toBe(refreshButton);

    fireEvent.click(refreshButton);

    // The button itself must still be in the document (not torn down into "Loading…") --
    // this is what a full-unmount regression would break.
    expect(screen.getByRole("button", { name: "Refresh" })).toBe(refreshButton);
    expect(screen.queryByText("Loading…")).not.toBeInTheDocument();
    await waitFor(() => expect(fetchSourceRowsMock).toHaveBeenCalledTimes(2));
  });

  it("a cell that held real DOM focus survives a Refresh (same DOM node, index-keyed rows)", async () => {
    fetchDatasetSchemaMock.mockResolvedValue(schema);
    fetchSourceRowsMock.mockResolvedValue(
      onePage([{ id: "r0", seq: 0, updatedAt: "2026-01-01T00:00:00Z", data: ["value"] }]),
    );

    const { container } = renderWithStore(<DatasetRowGrid sourceId={sourceId} />);
    await screen.findByText("value");
    const cell = container.querySelector('td[tabindex="0"]') as HTMLElement;
    cell.focus();
    expect(document.activeElement).toBe(cell);

    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    await waitFor(() => expect(fetchSourceRowsMock).toHaveBeenCalledTimes(2));

    expect(document.activeElement).toBe(cell);
  });
});

describe("DatasetRowGrid arrow-key DOM focus + edit-end focus return (skeptic-final-1.md CR2/CR3)", () => {
  it("arrow-key navigation moves real DOM focus, not just the tabindex", async () => {
    fetchDatasetSchemaMock.mockResolvedValue(schema);
    fetchSourceRowsMock.mockResolvedValue(
      onePage([
        { id: "r0", seq: 0, updatedAt: "2026-01-01T00:00:00Z", data: ["row-0"] },
        { id: "r1", seq: 1, updatedAt: "2026-01-01T00:00:00Z", data: ["row-1"] },
      ]),
    );

    const { container } = renderWithStore(<DatasetRowGrid sourceId={sourceId} />);
    await screen.findByText("row-0");
    const firstCell = container.querySelector('td[tabindex="0"]') as HTMLElement;
    firstCell.focus();

    fireEvent.keyDown(screen.getByRole("grid"), { key: "ArrowDown" });

    const secondCell = container.querySelector('td[tabindex="0"]') as HTMLElement;
    expect(secondCell).toHaveTextContent("row-1");
    expect(document.activeElement).toBe(secondCell);
    expect(document.activeElement).not.toBe(firstCell);
  });

  it("Enter commits, moves the active cell down one row (design.md Decision 0), and returns real focus to it", async () => {
    fetchDatasetSchemaMock.mockResolvedValue(schema);
    fetchSourceRowsMock.mockResolvedValue(
      onePage([
        { id: "r0", seq: 0, updatedAt: "2026-01-01T00:00:00Z", data: ["row-0"] },
        { id: "r1", seq: 1, updatedAt: "2026-01-01T00:00:00Z", data: ["row-1"] },
      ]),
    );
    patchSourceRowMock.mockResolvedValue({
      row: { id: "r0", seq: 0, updatedAt: "2026-01-02T00:00:00Z", data: ["changed"] },
      sourceUpdatedAt: "2026-01-02T00:00:00Z",
    });

    const { container } = renderWithStore(<DatasetRowGrid sourceId={sourceId} />);
    await screen.findByText("row-0");
    const firstCell = container.querySelector('td[tabindex="0"]') as HTMLElement;
    firstCell.focus();
    fireEvent.keyDown(screen.getByRole("grid"), { key: "Enter" });
    const editor = screen.getByDisplayValue("row-0");
    fireEvent.change(editor, { target: { value: "changed" } });
    fireEvent.keyDown(editor, { key: "Enter" });

    await waitFor(() => expect(patchSourceRowMock).toHaveBeenCalledTimes(1));

    const activeCellNow = container.querySelector('td[tabindex="0"]') as HTMLElement;
    expect(activeCellNow).toHaveTextContent("row-1");
    expect(document.activeElement).toBe(activeCellNow);
  });

  it("Escape cancels and returns real DOM focus to the (unchanged) active cell", async () => {
    fetchDatasetSchemaMock.mockResolvedValue(schema);
    fetchSourceRowsMock.mockResolvedValue(
      onePage([{ id: "r0", seq: 0, updatedAt: "2026-01-01T00:00:00Z", data: ["row-0"] }]),
    );

    const { container } = renderWithStore(<DatasetRowGrid sourceId={sourceId} />);
    await screen.findByText("row-0");
    const cell = container.querySelector('td[tabindex="0"]') as HTMLElement;
    cell.focus();
    fireEvent.keyDown(screen.getByRole("grid"), { key: "Enter" });
    const editor = screen.getByDisplayValue("row-0");
    fireEvent.keyDown(editor, { key: "Escape" });

    expect(document.activeElement).toBe(cell);
    expect(patchSourceRowMock).not.toHaveBeenCalled();
  });
});

describe("DatasetRowGrid stale-conflict retry/discard (skeptic-final-1.md CR4/CR5)", () => {
  it("edit conflict: shows current values, Retry re-applies only the edited cell against the fresh row", async () => {
    fetchDatasetSchemaMock.mockResolvedValue({
      fields: [
        { name: "name", type: "string", required: false },
        { name: "note", type: "string", required: false },
      ],
    });
    fetchSourceRowsMock.mockResolvedValueOnce(
      onePage([
        { id: "r0", seq: 0, updatedAt: "2026-01-01T00:00:00Z", data: ["old", "untouched"] },
      ]),
    );
    patchSourceRowMock.mockRejectedValueOnce({
      isAxiosError: true,
      response: { status: 409, data: { message: "conflict" } },
    });
    // The conflict re-fetch returns a row someone else already changed concurrently -- note
    // "untouched" is unchanged, proving Retry must only touch "name".
    fetchSourceRowsMock.mockResolvedValueOnce(
      onePage([
        {
          id: "r0",
          seq: 0,
          updatedAt: "2026-01-02T00:00:00Z",
          data: ["server-changed", "untouched"],
        },
      ]),
    );
    patchSourceRowMock.mockResolvedValueOnce({
      row: { id: "r0", seq: 0, updatedAt: "2026-01-03T00:00:00Z", data: ["new", "untouched"] },
      sourceUpdatedAt: "2026-01-03T00:00:00Z",
    });

    renderWithStore(<DatasetRowGrid sourceId={sourceId} />);
    const cell = await screen.findByText("old");
    fireEvent.click(cell);
    fireEvent.keyDown(screen.getByRole("grid"), { key: "Enter" });
    const editor = screen.getByDisplayValue("old");
    fireEvent.change(editor, { target: { value: "new" } });
    fireEvent.keyDown(editor, { key: "Enter" });

    // The conflict banner shows the CURRENT (server-refetched) values, not the user's stale ones.
    expect((await screen.findAllByText(/server-changed/)).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/untouched/).length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("button", { name: /Retry/ }));

    await waitFor(() => expect(patchSourceRowMock).toHaveBeenCalledTimes(2));
    // Second call: the user's edit ("new") reapplied on top of the FRESH row/updatedAt, with the
    // OTHER cell ("untouched") carried through unchanged -- never the user's stale full row.
    expect(patchSourceRowMock).toHaveBeenNthCalledWith(2, sourceId, "r0", "2026-01-02T00:00:00Z", [
      "new",
      "untouched",
    ]);
  });

  it("edit conflict: Discard clears the banner without retrying", async () => {
    fetchDatasetSchemaMock.mockResolvedValue(schema);
    fetchSourceRowsMock.mockResolvedValueOnce(
      onePage([{ id: "r0", seq: 0, updatedAt: "2026-01-01T00:00:00Z", data: ["old"] }]),
    );
    patchSourceRowMock.mockRejectedValueOnce({
      isAxiosError: true,
      response: { status: 409, data: { message: "conflict" } },
    });
    fetchSourceRowsMock.mockResolvedValueOnce(
      onePage([{ id: "r0", seq: 0, updatedAt: "2026-01-02T00:00:00Z", data: ["server-changed"] }]),
    );

    renderWithStore(<DatasetRowGrid sourceId={sourceId} />);
    const cell = await screen.findByText("old");
    fireEvent.click(cell);
    fireEvent.keyDown(screen.getByRole("grid"), { key: "Enter" });
    const editor = screen.getByDisplayValue("old");
    fireEvent.change(editor, { target: { value: "new" } });
    fireEvent.keyDown(editor, { key: "Enter" });

    await screen.findAllByText(/server-changed/);
    fireEvent.click(screen.getByRole("button", { name: "Discard" }));

    await waitFor(() =>
      expect(
        screen.queryByText("This row was changed concurrently. Current values:"),
      ).not.toBeInTheDocument(),
    );
    expect(patchSourceRowMock).toHaveBeenCalledTimes(1);
  });

  it("delete conflict: row still exists -- 'Delete anyway' retries the delete with the fresh updatedAt", async () => {
    fetchDatasetSchemaMock.mockResolvedValue(schema);
    fetchSourceRowsMock.mockResolvedValueOnce(
      onePage([{ id: "r0", seq: 0, updatedAt: "2026-01-01T00:00:00Z", data: ["value"] }]),
    );
    deleteSourceRowMock.mockRejectedValueOnce({
      isAxiosError: true,
      response: { status: 409, data: { message: "conflict" } },
    });
    fetchSourceRowsMock.mockResolvedValueOnce(
      onePage([{ id: "r0", seq: 0, updatedAt: "2026-01-02T00:00:00Z", data: ["server-changed"] }]),
    );
    deleteSourceRowMock.mockResolvedValueOnce(undefined);

    renderWithStore(<DatasetRowGrid sourceId={sourceId} />);
    const cell = await screen.findByText("value");
    fireEvent.click(cell);
    fireEvent.keyDown(screen.getByRole("grid"), { key: "Delete" });
    fireEvent.click(await screen.findByRole("button", { name: /confirm/i }));

    await screen.findAllByText(/server-changed/);
    fireEvent.click(screen.getByRole("button", { name: "Delete anyway" }));

    await waitFor(() => expect(deleteSourceRowMock).toHaveBeenCalledTimes(2));
    expect(deleteSourceRowMock).toHaveBeenNthCalledWith(2, sourceId, "r0", "2026-01-02T00:00:00Z");
  });

  // skeptic-final-2.md CR-A: the real backend returns 404 (RowMutationFailure.RowNotFound ->
  // ServiceError.NotFound), NEVER 409, for a row someone else already deleted (HEL-1078 D5) --
  // this replaces the round-1 test that (incorrectly) mocked a 409 for this exact scenario, which
  // the real API never produces.
  it("delete on a concurrently deleted row (404): shows 'already deleted' directly, no re-fetch, and Discard dispatches clearConflict (not popCursorStack)", async () => {
    fetchDatasetSchemaMock.mockResolvedValue(schema);
    fetchSourceRowsMock.mockResolvedValueOnce(
      onePage([
        { id: "r0", seq: 0, updatedAt: "2026-01-01T00:00:00Z", data: ["value"] },
        { id: "r1", seq: 1, updatedAt: "2026-01-01T00:00:00Z", data: ["other"] },
      ]),
    );
    deleteSourceRowMock.mockRejectedValueOnce({
      isAxiosError: true,
      response: { status: 404, data: { message: "Row not found" } },
    });

    renderWithStore(<DatasetRowGrid sourceId={sourceId} />);
    const cell = await screen.findByText("value");
    fireEvent.click(cell);
    fireEvent.keyDown(screen.getByRole("grid"), { key: "Delete" });
    fireEvent.click(await screen.findByRole("button", { name: /confirm/i }));

    expect(await screen.findByText(/already deleted/)).toBeInTheDocument();
    // A 404 is conclusive on its own -- no re-fetch happens (only the initial page load call).
    expect(fetchSourceRowsMock).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("value")).not.toBeInTheDocument();
    // The pager was NOT corrupted -- still on page 1 (bug: this used to dispatch
    // `popCursorStack` for the analogous 409 case).
    expect(screen.getByText("Page 1")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Discard" }));
    await waitFor(() => expect(screen.queryByText(/already deleted/)).not.toBeInTheDocument());
  });

  it("edit on a concurrently deleted row (404): shows 'already deleted', no duplicate banner, phantom row removed", async () => {
    fetchDatasetSchemaMock.mockResolvedValue(schema);
    fetchSourceRowsMock.mockResolvedValueOnce(
      onePage([{ id: "r0", seq: 0, updatedAt: "2026-01-01T00:00:00Z", data: ["value"] }]),
    );
    patchSourceRowMock.mockRejectedValueOnce({
      isAxiosError: true,
      response: { status: 404, data: { message: "Row not found" } },
    });

    renderWithStore(<DatasetRowGrid sourceId={sourceId} />);
    const cell = await screen.findByText("value");
    fireEvent.click(cell);
    fireEvent.keyDown(screen.getByRole("grid"), { key: "Enter" });
    const editor = screen.getByDisplayValue("value");
    fireEvent.change(editor, { target: { value: "new" } });
    fireEvent.keyDown(editor, { key: "Enter" });

    // Exactly ONE "already deleted" banner -- not the round-2 double-banner defect.
    expect(await screen.findAllByText(/already deleted/)).toHaveLength(1);
    expect(screen.queryByText("value")).not.toBeInTheDocument();
    expect(fetchSourceRowsMock).toHaveBeenCalledTimes(1);
  });
});

describe("DatasetRowGrid pessimistic edits (amended design.md Decision 4, skeptic-final-1.md CR6)", () => {
  it("shows a pending indicator while a patch is in flight, and a failure leaves the displayed value unchanged", async () => {
    fetchDatasetSchemaMock.mockResolvedValue(schema);
    fetchSourceRowsMock.mockResolvedValue(
      onePage([{ id: "r0", seq: 0, updatedAt: "2026-01-01T00:00:00Z", data: ["original"] }]),
    );
    let rejectPatch!: (err: unknown) => void;
    patchSourceRowMock.mockReturnValueOnce(
      new Promise((_resolve, reject) => {
        rejectPatch = reject;
      }),
    );

    renderWithStore(<DatasetRowGrid sourceId={sourceId} />);
    const cell = await screen.findByText("original");
    fireEvent.click(cell);
    fireEvent.keyDown(screen.getByRole("grid"), { key: "Enter" });
    const editor = screen.getByDisplayValue("original");
    fireEvent.change(editor, { target: { value: "changed" } });
    fireEvent.keyDown(editor, { key: "Enter" });

    // Pessimistic: the DISPLAYED value is still the original while the request is in flight.
    expect(screen.getByText("original")).toBeInTheDocument();
    expect(screen.queryByText("changed")).not.toBeInTheDocument();
    expect(await screen.findByText("Saving…")).toBeInTheDocument();

    await act(async () => {
      rejectPatch({
        isAxiosError: true,
        response: {
          status: 400,
          data: { message: "row 0: field 'name' — expected string, got integer" },
        },
      });
      await Promise.resolve();
    });

    await waitFor(() => expect(screen.queryByText("Saving…")).not.toBeInTheDocument());
    expect(screen.getByText("original")).toBeInTheDocument();
    expect(screen.queryByText("changed")).not.toBeInTheDocument();
  });
});
