import { act, fireEvent, screen } from "@testing-library/react";

import { TableRenderer } from "./TableRenderer";
import { updatePanelColumnWidths } from "../../services/panelService";
import { renderWithStore } from "../../../../test/renderWithStore";

/** Permissive read shape for asserting the stored table panel's persisted
 *  widths without wrestling the loosely-typed test store's `getState()`. */
type StoredTablePanel = { config?: { columnWidths?: Record<string, number> } };

jest.mock("../../services/panelService", () => ({
  ...jest.requireActual("../../services/panelService"),
  updatePanelColumnWidths: jest.fn().mockResolvedValue({}),
}));

const mockUpdatePanelColumnWidths = jest.mocked(updatePanelColumnWidths);

/** JSDOM's `getBoundingClientRect` returns all-zero by default — stub a
 * deterministic width so the resize-gesture tests below have predictable
 * drag-delta math (HEL-253, mirrors `DataGrid.test.tsx`). */
function stubColumnWidth(width: number) {
  jest.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
    width,
    height: 20,
    top: 0,
    left: 0,
    right: width,
    bottom: 20,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  } as DOMRect);
}

function getHandle(container: HTMLElement, columnKey: string): HTMLElement {
  const headers = Array.from(container.querySelectorAll("th"));
  const th = headers.find((h) => h.textContent?.startsWith(columnKey));
  if (!th) throw new Error(`no <th> found for column "${columnKey}"`);
  const handle = th.querySelector(".ui-data-grid__resize-handle");
  if (!handle) throw new Error(`no resize handle found for column "${columnKey}"`);
  return handle as HTMLElement;
}

describe("TableRenderer — column widths load on mount", () => {
  afterEach(() => jest.restoreAllMocks());

  it("passes config.columnWidths through to DataGrid as the applied widths", () => {
    renderWithStore(
      <TableRenderer
        panelId="panel-1"
        rawRows={[["1", "2"]]}
        headers={["a", "b"]}
        columnWidths={{ a: 240 }}
      />,
    );
    const headers = screen.getAllByRole("columnheader");
    const colA = headers.find((h) => h.textContent?.startsWith("a"));
    expect(colA).toHaveStyle({ width: "240px" });
  });

  it("falls back to DataGrid's seeded default width when columnWidths is absent", () => {
    // HEL-253 cycle 2: every full-variant column needs an explicit width once
    // `table-layout: fixed` is active (see DataGrid.tsx `DEFAULT_COLUMN_WIDTH`),
    // so an un-configured column is no longer style-less — it renders at the
    // shared default rather than collapsing under fixed table layout.
    renderWithStore(
      <TableRenderer panelId="panel-1" rawRows={[["1", "2"]]} headers={["a", "b"]} />,
    );
    const headers = screen.getAllByRole("columnheader");
    const colA = headers.find((h) => h.textContent?.startsWith("a"));
    expect(colA).toHaveStyle({ width: "160px" });
  });
});

describe("TableRenderer — debounced width persistence", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockUpdatePanelColumnWidths.mockClear();
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it("debounces a resize into a single updatePanelColumnWidths call 400ms after the drag settles", () => {
    stubColumnWidth(200);
    const { container } = renderWithStore(
      <TableRenderer panelId="panel-1" rawRows={[["1", "2"]]} headers={["a", "b"]} />,
    );

    fireEvent.mouseDown(getHandle(container, "a"), { clientX: 100 });
    fireEvent.mouseMove(window, { clientX: 150 });
    fireEvent.mouseUp(window);

    // No network call yet — still within the debounce window.
    expect(mockUpdatePanelColumnWidths).not.toHaveBeenCalled();

    act(() => {
      jest.advanceTimersByTime(400);
    });

    expect(mockUpdatePanelColumnWidths).toHaveBeenCalledTimes(1);
    expect(mockUpdatePanelColumnWidths).toHaveBeenCalledWith("panel-1", { a: 250 });
  });

  it("coalesces several rapid resizes of the same column into one persisted call", () => {
    stubColumnWidth(200);
    const { container } = renderWithStore(
      <TableRenderer panelId="panel-1" rawRows={[["1", "2"]]} headers={["a", "b"]} />,
    );

    fireEvent.mouseDown(getHandle(container, "a"), { clientX: 100 });
    fireEvent.mouseMove(window, { clientX: 120 });
    jest.advanceTimersByTime(100);
    fireEvent.mouseMove(window, { clientX: 140 });
    jest.advanceTimersByTime(100);
    fireEvent.mouseMove(window, { clientX: 160 });
    fireEvent.mouseUp(window);

    act(() => {
      jest.advanceTimersByTime(400);
    });

    expect(mockUpdatePanelColumnWidths).toHaveBeenCalledTimes(1);
    expect(mockUpdatePanelColumnWidths).toHaveBeenCalledWith("panel-1", { a: 260 });
  });
});

describe("TableRenderer — resize syncs widths into the stored panel (HEL-255 CR#1)", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockUpdatePanelColumnWidths.mockReset();
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it("dispatches the width-persist thunk so the stored panel's columnWidths updates without reload", async () => {
    stubColumnWidth(200);
    // The debounced PATCH resolves with the persisted panel; the thunk's
    // fulfilled reducer must fold it back into the store so a same-session
    // edit-pane open sees the widths (Reset button enables without reload).
    const persisted = {
      id: "panel-1",
      dashboardId: "d-1",
      title: "Rows",
      type: "table",
      meta: { createdBy: "u", createdAt: "", lastUpdated: "" },
      appearance: { background: "transparent", color: "inherit", transparency: 0 },
      config: { dataTypeId: "dt1", fieldMapping: {}, columnWidths: { a: 250 } },
    };
    mockUpdatePanelColumnWidths.mockResolvedValue(persisted as never);

    const { store, container } = renderWithStore(
      <TableRenderer panelId="panel-1" rawRows={[["1", "2"]]} headers={["a", "b"]} />,
      {
        panels: {
          items: [{ id: "panel-1", dashboardId: "d-1", title: "Rows", type: "table" }],
        },
      },
    );

    // Before any resize the stored panel has no widths.
    const before = store.getState().panels.items.find((p: { id: string }) => p.id === "panel-1") as
      | StoredTablePanel
      | undefined;
    expect(before?.config?.columnWidths).toBeUndefined();

    fireEvent.mouseDown(getHandle(container, "a"), { clientX: 100 });
    fireEvent.mouseMove(window, { clientX: 150 });
    fireEvent.mouseUp(window);

    await act(async () => {
      jest.advanceTimersByTime(400);
    });

    expect(mockUpdatePanelColumnWidths).toHaveBeenCalledWith("panel-1", { a: 250 });
    const after = store.getState().panels.items.find((p: { id: string }) => p.id === "panel-1") as
      | StoredTablePanel
      | undefined;
    expect(after?.config?.columnWidths).toEqual({ a: 250 });
  });
});

describe("TableRenderer — density (HEL-255)", () => {
  afterEach(() => jest.restoreAllMocks());

  it("passes the density prop through to DataGrid's density class", () => {
    const { container } = renderWithStore(
      <TableRenderer
        panelId="panel-1"
        rawRows={[["1", "2"]]}
        headers={["a", "b"]}
        density="spacious"
      />,
    );
    expect(container.querySelector(".ui-data-grid--spacious")).not.toBeNull();
  });

  it("falls back to DataGrid's full-variant default (normal) when density is absent", () => {
    const { container } = renderWithStore(
      <TableRenderer panelId="panel-1" rawRows={[["1", "2"]]} headers={["a", "b"]} />,
    );
    expect(container.querySelector(".ui-data-grid--normal")).not.toBeNull();
    expect(container.querySelector(".ui-data-grid--spacious")).toBeNull();
  });
});

describe("TableRenderer — columnOrder (HEL-255)", () => {
  afterEach(() => jest.restoreAllMocks());

  function headerKeys(): string[] {
    return screen.getAllByRole("columnheader").map((h) => h.textContent?.trim() ?? "");
  }

  it("renders all columns in natural order when columnOrder is absent", () => {
    renderWithStore(
      <TableRenderer panelId="p" rawRows={[["1", "2", "3"]]} headers={["a", "b", "c"]} />,
    );
    expect(headerKeys()).toEqual(["a", "b", "c"]);
  });

  it("reorders and hides columns per columnOrder", () => {
    renderWithStore(
      <TableRenderer
        panelId="p"
        rawRows={[["1", "2", "3"]]}
        headers={["a", "b", "c"]}
        columnOrder={["c", "a"]}
      />,
    );
    expect(headerKeys()).toEqual(["c", "a"]);
  });

  it("skips stale keys not present in the data (no empty column)", () => {
    renderWithStore(
      <TableRenderer
        panelId="p"
        rawRows={[["1", "2"]]}
        headers={["a", "b"]}
        columnOrder={["gone", "a"]}
      />,
    );
    expect(headerKeys()).toEqual(["a"]);
  });

  it("applies columnOrder on the paginated-rows path too", () => {
    renderWithStore(
      <TableRenderer
        panelId="p"
        paginationRows={[{ a: "1", b: "2", c: "3" }]}
        columnOrder={["b", "a"]}
      />,
    );
    expect(headerKeys()).toEqual(["b", "a"]);
  });
});

describe("TableRenderer — width re-seed on external clear (HEL-255 design D6)", () => {
  afterEach(() => jest.restoreAllMocks());

  it("re-seeds local widths to defaults when persisted columnWidths clears for the same panel", () => {
    const { rerender } = renderWithStore(
      <TableRenderer
        panelId="panel-1"
        rawRows={[["1", "2"]]}
        headers={["a", "b"]}
        columnWidths={{ a: 240 }}
      />,
    );
    let colA = screen.getAllByRole("columnheader").find((h) => h.textContent?.startsWith("a"));
    expect(colA).toHaveStyle({ width: "240px" });

    // Simulate a Reset-widths save clearing the persisted widths for the same panel.
    rerender(
      <TableRenderer
        panelId="panel-1"
        rawRows={[["1", "2"]]}
        headers={["a", "b"]}
        columnWidths={{}}
      />,
    );
    colA = screen.getAllByRole("columnheader").find((h) => h.textContent?.startsWith("a"));
    expect(colA).toHaveStyle({ width: "160px" });
  });
});
