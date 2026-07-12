import { fireEvent, render, screen } from "@testing-library/react";

import { TableRenderer } from "./TableRenderer";
import { updatePanelColumnWidths } from "../../services/panelService";

jest.mock("../../services/panelService", () => ({
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
    render(
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
    render(<TableRenderer panelId="panel-1" rawRows={[["1", "2"]]} headers={["a", "b"]} />);
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
    const { container } = render(
      <TableRenderer panelId="panel-1" rawRows={[["1", "2"]]} headers={["a", "b"]} />,
    );

    fireEvent.mouseDown(getHandle(container, "a"), { clientX: 100 });
    fireEvent.mouseMove(window, { clientX: 150 });
    fireEvent.mouseUp(window);

    // No network call yet — still within the debounce window.
    expect(mockUpdatePanelColumnWidths).not.toHaveBeenCalled();

    jest.advanceTimersByTime(400);

    expect(mockUpdatePanelColumnWidths).toHaveBeenCalledTimes(1);
    expect(mockUpdatePanelColumnWidths).toHaveBeenCalledWith("panel-1", { a: 250 });
  });

  it("coalesces several rapid resizes of the same column into one persisted call", () => {
    stubColumnWidth(200);
    const { container } = render(
      <TableRenderer panelId="panel-1" rawRows={[["1", "2"]]} headers={["a", "b"]} />,
    );

    fireEvent.mouseDown(getHandle(container, "a"), { clientX: 100 });
    fireEvent.mouseMove(window, { clientX: 120 });
    jest.advanceTimersByTime(100);
    fireEvent.mouseMove(window, { clientX: 140 });
    jest.advanceTimersByTime(100);
    fireEvent.mouseMove(window, { clientX: 160 });
    fireEvent.mouseUp(window);

    jest.advanceTimersByTime(400);

    expect(mockUpdatePanelColumnWidths).toHaveBeenCalledTimes(1);
    expect(mockUpdatePanelColumnWidths).toHaveBeenCalledWith("panel-1", { a: 260 });
  });
});
