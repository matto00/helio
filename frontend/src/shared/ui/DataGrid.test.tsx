import { readFileSync } from "fs";
import { join } from "path";

import { fireEvent, render, screen } from "@testing-library/react";

import { DataGrid } from "./DataGrid";

/** JSDOM's `getBoundingClientRect` returns all-zero by default (no real
 * layout engine) — stub a deterministic width so drag-delta math is
 * predictable across the resize-gesture tests below (HEL-253). */
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

describe("DataGrid — empty state", () => {
  it("renders the default empty-state message and no table when rows is empty", () => {
    const { container } = render(<DataGrid variant="preview" rows={[]} />);

    expect(screen.getByText("No data to preview.")).toBeInTheDocument();
    expect(container.querySelector("table")).not.toBeInTheDocument();
  });

  it("renders a custom emptyText message when rows is empty", () => {
    const { container } = render(
      <DataGrid variant="preview" rows={[]} emptyText="Source returned no rows." />,
    );

    expect(screen.getByText("Source returned no rows.")).toBeInTheDocument();
    expect(container.querySelector("table")).not.toBeInTheDocument();
  });
});

describe("DataGrid — column derivation", () => {
  it("derives columns from the union of row keys in first-seen order when columns is omitted", () => {
    const rows = [
      { a: 1, b: 2 },
      { b: 3, c: 4 },
    ];
    render(<DataGrid variant="preview" rows={rows} />);

    const headers = screen.getAllByRole("columnheader").map((el) => el.textContent);
    expect(headers).toEqual(["a", "b", "c"]);
  });

  it("uses explicit columns verbatim, ignoring row keys, when columns is provided", () => {
    const rows = [{ a: 1, b: 2, c: 3 }];
    render(<DataGrid variant="preview" rows={rows} columns={[{ key: "c" }, { key: "a" }]} />);

    const headers = screen.getAllByRole("columnheader").map((el) => el.textContent);
    expect(headers).toEqual(["c", "a"]);
  });
});

describe("DataGrid — variants and density", () => {
  it("full variant renders a table with row/column data", () => {
    const rows = [{ name: "alice" }, { name: "bob" }];
    const { container } = render(<DataGrid variant="full" rows={rows} />);

    expect(container.querySelector("table")).toBeInTheDocument();
    expect(screen.getByText("alice")).toBeInTheDocument();
    expect(screen.getByText("bob")).toBeInTheDocument();
    expect(container.firstChild).toHaveClass("ui-data-grid--normal");
  });

  it("preview variant defaults to condensed density", () => {
    const { container } = render(<DataGrid variant="preview" rows={[{ a: 1 }]} />);
    expect(container.firstChild).toHaveClass("ui-data-grid--condensed");
  });

  it("full variant defaults to normal density", () => {
    const { container } = render(<DataGrid variant="full" rows={[{ a: 1 }]} />);
    expect(container.firstChild).toHaveClass("ui-data-grid--normal");
  });

  it("an explicit density overrides the variant default", () => {
    const { container } = render(
      <DataGrid variant="preview" rows={[{ a: 1 }]} density="spacious" />,
    );
    expect(container.firstChild).toHaveClass("ui-data-grid--spacious");
  });

  it("an explicit condensed density overrides the full variant's normal default", () => {
    const { container } = render(<DataGrid variant="full" rows={[{ a: 1 }]} density="condensed" />);
    expect(container.firstChild).toHaveClass("ui-data-grid--condensed");
  });

  it("an explicit normal density overrides the preview variant's condensed default", () => {
    const { container } = render(<DataGrid variant="preview" rows={[{ a: 1 }]} density="normal" />);
    expect(container.firstChild).toHaveClass("ui-data-grid--normal");
  });

  it("an explicit spacious density applies to the full variant too", () => {
    const { container } = render(<DataGrid variant="full" rows={[{ a: 1 }]} density="spacious" />);
    expect(container.firstChild).toHaveClass("ui-data-grid--spacious");
  });
});

describe("DataGrid — default cell formatting", () => {
  it("renders null and undefined values as an em dash", () => {
    render(<DataGrid variant="preview" rows={[{ a: null, b: undefined }]} />);
    const cells = screen.getAllByRole("cell").map((el) => el.textContent);
    expect(cells).toEqual(["—", "—"]);
  });

  it("renders object values as their JSON string representation", () => {
    render(<DataGrid variant="preview" rows={[{ a: { x: 1 } }]} />);
    expect(screen.getByText(JSON.stringify({ x: 1 }))).toBeInTheDocument();
  });

  it("renders other values via their string representation", () => {
    render(<DataGrid variant="preview" rows={[{ a: 42, b: true }]} />);
    expect(screen.getByText("42")).toBeInTheDocument();
    expect(screen.getByText("true")).toBeInTheDocument();
  });
});

describe("DataGrid — custom column render", () => {
  it("uses a column's render output instead of the default formatter", () => {
    const rows = [{ nullable: true }, { nullable: false }];
    render(
      <DataGrid
        variant="preview"
        rows={rows}
        columns={[{ key: "nullable", render: (_row, value) => (value ? "yes" : "no") }]}
      />,
    );

    expect(screen.getByText("yes")).toBeInTheDocument();
    expect(screen.getByText("no")).toBeInTheDocument();
  });
});

// ── HEL-253: column-resize drag handles ─────────────────────────────────────

describe("DataGrid — column-resize handle rendering", () => {
  afterEach(() => jest.restoreAllMocks());

  it("full variant renders a resize handle per column", () => {
    const { container } = render(<DataGrid variant="full" rows={[{ a: 1, b: 2 }]} />);
    const handles = container.querySelectorAll(".ui-data-grid__resize-handle");
    expect(handles).toHaveLength(2);
  });

  it("preview variant renders no resize handle, even when columnWidths/onColumnResize are passed", () => {
    const onColumnResize = jest.fn();
    const { container } = render(
      <DataGrid
        variant="preview"
        rows={[{ a: 1, b: 2 }]}
        columnWidths={{ a: 300 }}
        onColumnResize={onColumnResize}
      />,
    );
    expect(container.querySelector(".ui-data-grid__resize-handle")).not.toBeInTheDocument();
  });

  it("applies a columnWidths override instead of the derived/default width", () => {
    render(<DataGrid variant="full" rows={[{ a: 1, b: 2 }]} columnWidths={{ a: 240 }} />);
    const headers = screen.getAllByRole("columnheader");
    const colA = headers.find((h) => h.textContent?.startsWith("a"));
    expect(colA).toHaveStyle({ width: "240px" });
  });

  it("preview variant ignores a columnWidths override entirely", () => {
    render(<DataGrid variant="preview" rows={[{ a: 1, b: 2 }]} columnWidths={{ a: 240 }} />);
    const headers = screen.getAllByRole("columnheader");
    const colA = headers.find((h) => h.textContent?.startsWith("a"));
    expect(colA).not.toHaveStyle({ width: "240px" });
  });
});

describe("DataGrid — column-resize drag gesture", () => {
  afterEach(() => jest.restoreAllMocks());

  function getHandle(container: HTMLElement, columnKey: string): HTMLElement {
    const headers = Array.from(container.querySelectorAll("th"));
    const th = headers.find((h) => h.textContent?.startsWith(columnKey));
    if (!th) throw new Error(`no <th> found for column "${columnKey}"`);
    const handle = th.querySelector(".ui-data-grid__resize-handle");
    if (!handle) throw new Error(`no resize handle found for column "${columnKey}"`);
    return handle as HTMLElement;
  }

  it("dragging one column's handle resizes only that column and reports the live width", () => {
    stubColumnWidth(200);
    const onColumnResize = jest.fn();
    const { container } = render(
      <DataGrid variant="full" rows={[{ a: 1, b: 2 }]} onColumnResize={onColumnResize} />,
    );

    fireEvent.mouseDown(getHandle(container, "a"), { clientX: 100 });
    fireEvent.mouseMove(window, { clientX: 150 });

    expect(onColumnResize).toHaveBeenCalledWith("a", 250);
    const headers = screen.getAllByRole("columnheader");
    const colA = headers.find((h) => h.textContent?.startsWith("a"));
    const colB = headers.find((h) => h.textContent?.startsWith("b"));
    expect(colA).toHaveStyle({ width: "250px" });
    // Column "b" was never dragged — it must keep its own (unset) width.
    expect(colB).not.toHaveStyle({ width: "250px" });

    fireEvent.mouseUp(window);
  });

  it("clamps the dragged width to the 60px minimum", () => {
    stubColumnWidth(200);
    const onColumnResize = jest.fn();
    const { container } = render(
      <DataGrid variant="full" rows={[{ a: 1, b: 2 }]} onColumnResize={onColumnResize} />,
    );

    fireEvent.mouseDown(getHandle(container, "a"), { clientX: 100 });
    fireEvent.mouseMove(window, { clientX: -1000 });

    expect(onColumnResize).toHaveBeenCalledWith("a", 60);

    fireEvent.mouseUp(window);
  });

  it("stops mousedown propagation so an ancestor drag/resize listener never sees it", () => {
    stubColumnWidth(200);
    const ancestorMouseDown = jest.fn();
    const { container } = render(
      <div onMouseDown={ancestorMouseDown}>
        <DataGrid variant="full" rows={[{ a: 1, b: 2 }]} />
      </div>,
    );

    fireEvent.mouseDown(getHandle(container, "a"), { clientX: 100 });

    expect(ancestorMouseDown).not.toHaveBeenCalled();
  });
});

describe("DataGrid — keyboard-operable resize (arrow-key nudge)", () => {
  afterEach(() => jest.restoreAllMocks());

  function getHandle(container: HTMLElement, columnKey: string): HTMLElement {
    const headers = Array.from(container.querySelectorAll("th"));
    const th = headers.find((h) => h.textContent?.startsWith(columnKey));
    if (!th) throw new Error(`no <th> found for column "${columnKey}"`);
    const handle = th.querySelector(".ui-data-grid__resize-handle");
    if (!handle) throw new Error(`no resize handle found for column "${columnKey}"`);
    return handle as HTMLElement;
  }

  it("is focusable (tabIndex 0) so it can receive arrow-key input", () => {
    const { container } = render(<DataGrid variant="full" rows={[{ a: 1, b: 2 }]} />);
    expect(getHandle(container, "a")).toHaveAttribute("tabindex", "0");
  });

  it("ArrowRight grows the focused column's width and reports it live", () => {
    stubColumnWidth(200);
    const onColumnResize = jest.fn();
    const { container } = render(
      <DataGrid variant="full" rows={[{ a: 1, b: 2 }]} onColumnResize={onColumnResize} />,
    );

    fireEvent.keyDown(getHandle(container, "a"), { key: "ArrowRight" });

    expect(onColumnResize).toHaveBeenCalledWith("a", 210);
    const colA = screen.getAllByRole("columnheader").find((h) => h.textContent?.startsWith("a"));
    expect(colA).toHaveStyle({ width: "210px" });
  });

  it("ArrowLeft shrinks the focused column's width, clamped to the 60px minimum", () => {
    stubColumnWidth(65);
    const onColumnResize = jest.fn();
    const { container } = render(
      <DataGrid variant="full" rows={[{ a: 1, b: 2 }]} onColumnResize={onColumnResize} />,
    );

    fireEvent.keyDown(getHandle(container, "a"), { key: "ArrowLeft" });

    expect(onColumnResize).toHaveBeenCalledWith("a", 60);
  });

  it("ignores keys other than ArrowLeft/ArrowRight", () => {
    stubColumnWidth(200);
    const onColumnResize = jest.fn();
    const { container } = render(
      <DataGrid variant="full" rows={[{ a: 1, b: 2 }]} onColumnResize={onColumnResize} />,
    );

    fireEvent.keyDown(getHandle(container, "a"), { key: "Enter" });

    expect(onColumnResize).not.toHaveBeenCalled();
  });
});

// ── HEL-253 cycle 2: table-layout:fixed regression guard ────────────────────
//
// jsdom has no real CSS layout engine, so no jsdom-based assertion can verify
// that a resized `<th>`'s inline `width` actually changes the *rendered*
// column width (`toHaveStyle` only checks the inline attribute, not computed
// layout) — that gap is exactly what let the original bug (auto table-layout
// silently ignoring inline `width`) ship undetected through the full Jest
// suite in cycle 1. See evaluation-1.md for the live-browser repro and
// verification-2.md for the cycle-2 live re-verification. The tests below are
// a static-source guard — they fail if a future refactor drops the
// `table-layout: fixed` rule or the `DEFAULT_COLUMN_WIDTH` fallback that
// makes it safe — not a substitute for that live-browser check.
describe("DataGrid — table-layout:fixed regression guard (static source)", () => {
  const css = readFileSync(join(__dirname, "DataGrid.css"), "utf8");

  it("scopes `table-layout: fixed` to the full variant only, so preview keeps auto layout", () => {
    expect(css).toMatch(
      /\.ui-data-grid--full\s+\.ui-data-grid__table\s*{[^}]*table-layout:\s*fixed/,
    );
  });

  it("every full-variant column receives an explicit width, even when unresized", () => {
    const rows = [{ a: 1, b: 2, c: 3 }];
    const { container } = render(<DataGrid variant="full" rows={rows} />);
    const headers = Array.from(container.querySelectorAll("th"));
    expect(headers).toHaveLength(3);
    for (const th of headers) {
      // With `table-layout: fixed` active, an unset width here means the
      // column collapses toward ~0px in a real browser (evaluation-1.md).
      expect(th.style.width).not.toBe("");
    }
  });
});
