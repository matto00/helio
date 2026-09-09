import { readFileSync } from "fs";
import { join } from "path";
import type { ReactElement } from "react";

import { fireEvent, render, screen } from "@testing-library/react";

import {
  DataGrid,
  FRAME_FILTER_COLLAPSE_THRESHOLD_PX,
  GRID_MIN_USABLE_HEIGHT_PX,
} from "./DataGrid";
import type { SortState } from "./useSortedRows";

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

  // HEL a11y/ux sweep F-127: a plain string sort orders "col_10" before
  // "col_2" — confusing for any real dataset with numeric-suffixed field
  // names. A live repro hit this on a 30-field DataType (col_0..col_29).
  it("orders numeric-suffixed keys naturally (col_2 before col_10), not by plain string sort", () => {
    const row: Record<string, unknown> = {};
    for (const n of [0, 1, 2, 10, 11, 20]) row[`col_${n}`] = n;
    render(<DataGrid variant="preview" rows={[row]} />);

    const headers = screen.getAllByRole("columnheader").map((el) => el.textContent);
    expect(headers).toEqual(["col_0", "col_1", "col_2", "col_10", "col_11", "col_20"]);
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

  // HEL-451 skeptic-evaluator CR2 — the density modifier mirrored onto the
  // frame (`.ui-data-grid--condensed` etc.) must have a REAL matching CSS
  // selector, not just be present in the class list: the seven tests above
  // only assert the class NAME, which is exactly how the mirror shipped
  // inert once already (nothing selected `.ui-data-grid__filter-toolbar`
  // by density). Static-source, mutation-failable: deleting the density
  // rules for the frame-level chrome must turn this red.
  it("REGRESSION GUARD: the frame's mirrored density modifier has a real CSS rule reaching the chrome, not just a class name", () => {
    const css = readFileSync(join(__dirname, "DataGrid.css"), "utf8");
    expect(css).toMatch(/\.ui-data-grid--condensed \.ui-data-grid__filter-toolbar/);
    expect(css).toMatch(/\.ui-data-grid--spacious \.ui-data-grid__filter-toolbar/);
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
// HEL a11y/ux sweep F-164: an overflowing table gave phone users zero
// indication that more columns exist off-screen. `useScrollEdges` is unit
// tested on its own (useScrollEdges.test.tsx); this checks DataGrid actually
// wires the resulting edge state into its modifier classes.
describe("DataGrid — scroll-shadow affordance (F-164)", () => {
  function stubScrollMetrics(el: HTMLElement, scrollWidth: number, clientWidth: number) {
    Object.defineProperty(el, "scrollWidth", { configurable: true, value: scrollWidth });
    Object.defineProperty(el, "clientWidth", { configurable: true, value: clientWidth });
    Object.defineProperty(el, "scrollLeft", { configurable: true, writable: true, value: 0 });
  }

  it("applies no scroll-edge modifier class when the table fits its container", () => {
    const { container } = render(<DataGrid variant="full" rows={[{ a: 1, b: 2 }]} />);
    // HEL-451 design D10-2: the scroll-shadow modifiers stay on the scroll
    // container (`.ui-data-grid`), not the frame — the frame is the
    // OUTER wrapper (`container.firstChild`) now that D10 introduces it.
    const root = container.querySelector(".ui-data-grid") as HTMLElement;
    stubScrollMetrics(root, 300, 300);
    fireEvent.scroll(root);

    expect(root).not.toHaveClass("ui-data-grid--scroll-left");
    expect(root).not.toHaveClass("ui-data-grid--scroll-right");
  });

  it("applies the scroll-right modifier when scrolled to the start of overflowing content", () => {
    const { container } = render(<DataGrid variant="full" rows={[{ a: 1, b: 2 }]} />);
    const root = container.querySelector(".ui-data-grid") as HTMLElement;
    stubScrollMetrics(root, 900, 300);
    fireEvent.scroll(root);

    expect(root).not.toHaveClass("ui-data-grid--scroll-left");
    expect(root).toHaveClass("ui-data-grid--scroll-right");
  });
});

describe("DataGrid — table-layout:fixed regression guard (static source)", () => {
  const css = readFileSync(join(__dirname, "DataGrid.css"), "utf8");

  it("scopes `table-layout: fixed` to the full variant only, so preview keeps auto layout", () => {
    expect(css).toMatch(
      /\.ui-data-grid--full\s+\.ui-data-grid__table\s*{[^}]*table-layout:\s*fixed/,
    );
  });

  // HEL a11y/ux sweep F-153: header cells hard-clipped mid-word with no
  // ellipsis, unlike body cells.
  it("thead th truncates with an ellipsis, matching tbody td's existing truncation", () => {
    expect(css).toMatch(
      /\.ui-data-grid__table thead th\s*{[^}]*overflow:\s*hidden[^}]*text-overflow:\s*ellipsis/,
    );
  });

  // HEL a11y/ux sweep F-239: a numeric font-weight literal bypassed the
  // --weight-semibold token inside the shared primitive itself.
  it("thead th uses the --weight-semibold token, not a numeric literal", () => {
    const theadRule = css.match(/\.ui-data-grid__table thead th\s*{[^}]*}/)?.[0] ?? "";
    expect(theadRule).toMatch(/font-weight:\s*var\(--weight-semibold\)/);
    expect(theadRule).not.toMatch(/font-weight:\s*[0-9]/);
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

  // HEL-451 design D10-9(a) — retargeted (round 1-2's colSpan/sticky-cell
  // mechanism was DELETED by the D10 reframe: chrome moved outside the
  // table entirely, so there is no longer a `colSpan` cell whose width
  // needs a sticky, viewport-bounded wrapper to fix). This is the
  // mutation-failable success criterion for the reframe itself: no element
  // inside `<table>` carries `colSpan`, on any of the three chrome shapes
  // that used to.
  it("D10-9(a): no element inside <table> carries colSpan (toggle/quick-filter/filtered-empty chrome all moved outside the table)", () => {
    const { container } = render(
      <DataGrid
        variant="full"
        rows={[]}
        columns={[{ key: "a" }, { key: "b" }]}
        filters={{ quick: "nothing matches" }}
        onFilterChange={jest.fn()}
        emptyText="No rows match your filter."
      />,
    );
    const table = container.querySelector("table");
    expect(table).not.toBeNull();
    expect(table?.querySelector("[colspan]")).toBeNull();
  });

  // HEL-451 design D10-9(c) — retargeted: all frame chrome (toolbar,
  // quick-filter row, filtered-empty message) precedes `.ui-data-grid`
  // (the scroll container) in DOM order, per D10-2's ordering requirement.
  // This is the failable form of that ordering: comparing
  // `compareDocumentPosition` catches a regression that puts any of the
  // three AFTER the scroller, which is exactly the mistake an earlier
  // draft of D10 made and withdrew (D10-2).
  it("D10-9(c): toolbar, quick-filter row, and filtered-empty message all precede .ui-data-grid in DOM order", () => {
    const { container } = render(
      <DataGrid
        variant="full"
        rows={[]}
        columns={[{ key: "a" }, { key: "b" }]}
        filters={{ quick: "nothing matches" }}
        onFilterChange={jest.fn()}
        emptyText="No rows match your filter."
      />,
    );
    const scroller = container.querySelector(".ui-data-grid") as HTMLElement;
    const toolbar = container.querySelector(".ui-data-grid__filter-toolbar") as HTMLElement;
    const quickRow = container.querySelector(".ui-data-grid__quick-filter-row") as HTMLElement;
    const filteredEmpty = container.querySelector(".ui-data-grid__filtered-empty") as HTMLElement;
    for (const chrome of [toolbar, quickRow, filteredEmpty]) {
      expect(chrome).not.toBeNull();
      // DOCUMENT_POSITION_FOLLOWING (4) on `scroller` relative to `chrome`
      // means `chrome` precedes `scroller` -- the required order.
      expect(chrome.compareDocumentPosition(scroller) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(
        Node.DOCUMENT_POSITION_FOLLOWING,
      );
    }
  });

  // The per-column filter row keeps its per-column `<th>` shape (design
  // D10-2: it STAYS in the table because its inputs align to individual
  // columns) — still exactly one filter row inside the table, distinct
  // from the toolbar/quick-filter chrome now outside it.
  it("the per-column filter row renders one <th> per column, inside the table, distinct from the frame chrome outside it", () => {
    const { container } = render(
      <DataGrid
        variant="full"
        rows={[{ a: 1, b: 2 }]}
        filters={{ quick: "x" }} // active -> seeded expanded
        onFilterChange={jest.fn()}
      />,
    );
    const columnsRow = container.querySelector(".ui-data-grid__filter-row--columns");
    expect(columnsRow?.querySelectorAll("th")).toHaveLength(2);
    expect(container.querySelector("table .ui-data-grid__filter-toolbar")).toBeNull();
    expect(container.querySelector("table .ui-data-grid__quick-filter-row")).toBeNull();
  });
});

// HEL-448: sortable header rendering. `DataGrid` never orders rows itself
// (the caller does, via `useSortedRows`) — these tests only cover the
// affordance: glyph, `aria-sort`, click/keyboard activation, and the two
// gates (variant + `onSort` presence) on rendering it at all.
describe("DataGrid — sortable headers (HEL-448)", () => {
  it("renders no sort button when onSort is omitted, even in the full variant", () => {
    const { container } = render(<DataGrid variant="full" rows={[{ a: 1, b: 2 }]} />);
    expect(container.querySelector(".sortable-th__btn")).not.toBeInTheDocument();
  });

  it("renders no sort button on the preview variant, even when onSort is supplied", () => {
    const onSort = jest.fn();
    const { container } = render(
      <DataGrid variant="preview" rows={[{ a: 1, b: 2 }]} onSort={onSort} />,
    );
    expect(container.querySelector(".sortable-th__btn")).not.toBeInTheDocument();
  });

  it("marks the active column's aria-sort and leaves every other sortable column at 'none'", () => {
    const sort: SortState<string> = { key: "a", direction: "asc" };
    render(<DataGrid variant="full" rows={[{ a: 1, b: 2 }]} sort={sort} onSort={jest.fn()} />);
    const headers = screen.getAllByRole("columnheader");
    const colA = headers.find((h) => h.textContent?.startsWith("a"));
    const colB = headers.find((h) => h.textContent?.startsWith("b"));
    expect(colA).toHaveAttribute("aria-sort", "ascending");
    expect(colB).toHaveAttribute("aria-sort", "none");
  });

  it("reflects a descending sort as aria-sort='descending' on the active column", () => {
    const sort: SortState<string> = { key: "a", direction: "desc" };
    render(<DataGrid variant="full" rows={[{ a: 1, b: 2 }]} sort={sort} onSort={jest.fn()} />);
    const colA = screen.getAllByRole("columnheader").find((h) => h.textContent?.startsWith("a"));
    expect(colA).toHaveAttribute("aria-sort", "descending");
  });

  it("clicking a sortable header's button fires onSort with that column's key", () => {
    const onSort = jest.fn();
    const { container } = render(
      <DataGrid variant="full" rows={[{ a: 1, b: 2 }]} onSort={onSort} />,
    );
    const buttons = container.querySelectorAll(".sortable-th__btn");
    fireEvent.click(buttons[1]);
    expect(onSort).toHaveBeenCalledWith("b");
  });

  it("Enter/Space on the sort button activates it, natively, without a custom key handler", () => {
    const onSort = jest.fn();
    render(<DataGrid variant="full" rows={[{ a: 1, b: 2 }]} onSort={onSort} />);
    const button = screen.getAllByRole("button", { name: "a" })[0];
    // A real <button> fires `click` for both Enter and Space natively —
    // asserting the click fires confirms the affordance IS a real <button>
    // (not a styled <div>), which is what makes Enter/Space "just work"
    // without any bespoke onKeyDown here.
    fireEvent.click(button);
    expect(onSort).toHaveBeenCalledWith("a");
  });

  it("resizing a column's handle does not fire onSort (the two controls don't interfere)", () => {
    jest.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      width: 200,
      height: 20,
      top: 0,
      left: 0,
      right: 200,
      bottom: 20,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect);
    const onSort = jest.fn();
    const { container } = render(
      <DataGrid variant="full" rows={[{ a: 1, b: 2 }]} onSort={onSort} />,
    );
    const handle = container.querySelector(".ui-data-grid__resize-handle") as HTMLElement;
    fireEvent.mouseDown(handle, { clientX: 100 });
    fireEvent.mouseMove(window, { clientX: 150 });
    fireEvent.mouseUp(window);
    expect(onSort).not.toHaveBeenCalled();
    jest.restoreAllMocks();
  });

  it("uses the shared sortable-th__btn/glyph classes, not a parallel class family", () => {
    const { container } = render(
      <DataGrid
        variant="full"
        rows={[{ a: 1 }]}
        sort={{ key: "a", direction: "asc" }}
        onSort={jest.fn()}
      />,
    );
    expect(container.querySelector(".sortable-th__btn")).toBeInTheDocument();
    expect(container.querySelector(".sortable-th__glyph")).toBeInTheDocument();
  });
});

// HEL-451: filter row rendering (task 3.1-3.2). Matching semantics live in
// `TableRenderer`'s `tableFilterPredicate.ts` — `DataGrid` only renders
// controls and reports raw changes.
describe("DataGrid — filter row (HEL-451)", () => {
  // HEL-451 design D4d: both filter rows sit behind ONE toggle, collapsed by
  // default when no filter is already active (seeded from `filters`).
  function expandFilters() {
    fireEvent.click(screen.getByRole("button", { name: "Filters" }));
  }

  it("renders no filter toggle when onFilterChange is omitted, even in the full variant", () => {
    const { container } = render(<DataGrid variant="full" rows={[{ a: 1, b: 2 }]} />);
    expect(container.querySelector(".ui-data-grid__filter-toolbar")).not.toBeInTheDocument();
    expect(container.querySelector(".ui-data-grid__filter-row")).not.toBeInTheDocument();
  });

  it("renders no filter toggle on the preview variant, even when onFilterChange is supplied", () => {
    const { container } = render(
      <DataGrid variant="preview" rows={[{ a: 1, b: 2 }]} onFilterChange={jest.fn()} />,
    );
    expect(container.querySelector(".ui-data-grid__filter-toolbar")).not.toBeInTheDocument();
  });

  it("the filter rows are collapsed by default (no active filter) and the toggle reveals them", () => {
    render(<DataGrid variant="full" rows={[{ a: 1, b: 2 }]} onFilterChange={jest.fn()} />);
    expect(
      screen.queryByRole("textbox", { name: "Quick filter across all columns" }),
    ).not.toBeInTheDocument();
    expandFilters();
    expect(
      screen.getByRole("textbox", { name: "Quick filter across all columns" }),
    ).toBeInTheDocument();
  });

  it("renders a quick-filter input and one per-column filter input, with accessible names, once expanded", () => {
    render(<DataGrid variant="full" rows={[{ a: 1, b: 2 }]} onFilterChange={jest.fn()} />);
    expandFilters();
    expect(
      screen.getByRole("textbox", { name: "Quick filter across all columns" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Filter column a" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Filter column b" })).toBeInTheDocument();
  });

  it("typing in the quick filter reports the FULL next filters value", () => {
    const onFilterChange = jest.fn();
    render(
      <DataGrid
        variant="full"
        rows={[{ a: 1, b: 2 }]}
        filters={{ columns: { a: "existing" } }}
        onFilterChange={onFilterChange}
      />,
    );
    // Already-active filter (`columns.a`) seeds the toggle expanded — no
    // click needed here.
    fireEvent.change(screen.getByRole("textbox", { name: "Quick filter across all columns" }), {
      target: { value: "term" },
    });
    expect(onFilterChange).toHaveBeenCalledWith({ quick: "term", columns: { a: "existing" } });
  });

  it("typing in a per-column filter reports the FULL next filters value, keyed by that column", () => {
    const onFilterChange = jest.fn();
    render(
      <DataGrid
        variant="full"
        rows={[{ a: 1, b: 2 }]}
        filters={{ quick: "existing" }}
        onFilterChange={onFilterChange}
      />,
    );
    fireEvent.change(screen.getByRole("textbox", { name: "Filter column b" }), {
      target: { value: "term" },
    });
    expect(onFilterChange).toHaveBeenCalledWith({ quick: "existing", columns: { b: "term" } });
  });
});

// HEL-451 design D4d/task 3c: the toggle row itself.
describe("DataGrid — filter toggle row (HEL-451 design D4d)", () => {
  it("renders the toggle ALWAYS when filterable, collapsed or not", () => {
    render(<DataGrid variant="full" rows={[{ a: 1 }]} onFilterChange={jest.fn()} />);
    expect(screen.getByRole("button", { name: "Filters" })).toBeInTheDocument();
  });

  it("with no filters active, the toggle carries no count and no Clear-all action", () => {
    render(<DataGrid variant="full" rows={[{ a: 1 }]} onFilterChange={jest.fn()} />);
    expect(screen.getByRole("button", { name: "Filters" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Clear all" })).not.toBeInTheDocument();
  });

  it("with an active filter, collapsed, the toggle shows the active count and Clear-all is reachable without expanding (task 3c.3)", () => {
    render(
      <DataGrid
        variant="full"
        rows={[{ a: 1 }]}
        filters={{ quick: "x" }}
        onFilterChange={jest.fn()}
      />,
    );
    // Collapse it back explicitly, to isolate "collapsed" from the
    // already-active-on-mount auto-expand seeding.
    fireEvent.click(screen.getByRole("button", { name: /Filters/ }));
    expect(
      screen.queryByRole("textbox", { name: "Quick filter across all columns" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Filters (1)" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Clear all" })).toBeInTheDocument();
  });

  it("counts the quick filter as one, and ANDs with active per-column terms", () => {
    render(
      <DataGrid
        variant="full"
        rows={[{ a: 1, b: 2 }]}
        filters={{ quick: "x", columns: { a: "y", b: "" } }}
        onFilterChange={jest.fn()}
      />,
    );
    // quick (1) + column a (1); column b is empty and does not count.
    expect(screen.getByRole("button", { name: "Filters (2)" })).toBeInTheDocument();
  });

  it("the active toggle is visually distinct (a dedicated modifier class), not merely a different label", () => {
    render(
      <DataGrid
        variant="full"
        rows={[{ a: 1 }]}
        filters={{ quick: "x" }}
        onFilterChange={jest.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: "Filters (1)" })).toHaveClass(
      "ui-data-grid__filter-toggle-btn--active",
    );
  });

  it("Clear all fires onFilterChange with an empty filters value, reachable while collapsed", () => {
    const onFilterChange = jest.fn();
    render(
      <DataGrid
        variant="full"
        rows={[{ a: 1 }]}
        filters={{ quick: "x" }}
        onFilterChange={onFilterChange}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Filters/ })); // collapse
    fireEvent.click(screen.getByRole("button", { name: "Clear all" }));
    expect(onFilterChange).toHaveBeenCalledWith({});
  });
});

// HEL-451 design D10-11 (owner-ruled): auto-collapse below a measured
// height threshold, so a persisted filter cannot force-expand chrome the
// enforced minimum panel size cannot hold (evaluation-2's blocking
// finding). jsdom's `clientHeight` is always 0 unless a test stubs it, so
// the height-based override is inert by default (see DataGrid.tsx's
// comment on why 0 means "unmeasured", not "collapse") — these tests stub
// the frame's `clientHeight` explicitly and RE-RENDER to retrigger the
// measuring `useLayoutEffect`, mirroring this file's existing
// `stubColumnWidth`/sticky-offset stubbing pattern.
describe("DataGrid — height-based filter auto-collapse (HEL-451 design D10-11)", () => {
  function stubFrameHeight(root: HTMLElement, height: number) {
    Object.defineProperty(root, "clientHeight", { configurable: true, value: height });
  }

  /**
   * The measuring `useLayoutEffect`'s dep array is `[filterable,
   * applyHeightBasedDefault]`, and `applyHeightBasedDefault` only changes
   * identity when `filtering` changes -- so a prop change that leaves both
   * unchanged (e.g. `density`) does NOT retrigger it, matching real usage
   * (the effect re-runs on a real ancestor resize via the `ResizeObserver`
   * effect, which jsdom does not implement). To retrigger the effect
   * WITHOUT changing `filtering` (so the "already active filter" scenario
   * stays realistic throughout), this toggles `onFilterChange`
   * undefined-then-defined, flipping `filterable` off and back on -- the
   * SAME dependency the real `ResizeObserver` effect also gates on.
   */
  function retriggerMeasurement(
    rerender: (el: ReactElement) => void,
    props: Parameters<typeof DataGrid>[0],
  ) {
    rerender(<DataGrid {...props} onFilterChange={undefined} />);
    rerender(<DataGrid {...props} />);
  }

  it("collapses the filter chrome by default when the frame is measured BELOW the threshold, even with a persisted filter already active", () => {
    const props = {
      variant: "full" as const,
      rows: [{ a: 1 }],
      filters: { quick: "x" }, // already active -> would otherwise seed expanded
      onFilterChange: jest.fn(),
    };
    const { container, rerender } = render(<DataGrid {...props} />);
    const frame = container.querySelector(".ui-data-grid__frame") as HTMLElement;
    stubFrameHeight(frame, FRAME_FILTER_COLLAPSE_THRESHOLD_PX - 1); // threshold - 1
    retriggerMeasurement(rerender, props);

    expect(
      screen.queryByRole("textbox", { name: "Quick filter across all columns" }),
    ).not.toBeInTheDocument();
    // Invariant 6 (D10-10): collapsed must not hide an active filter.
    expect(screen.getByRole("button", { name: "Filters (1)" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Clear all" })).toBeInTheDocument();
  });

  it("allows the filter chrome to expand by default when the frame is measured AT/ABOVE the threshold", () => {
    const props = {
      variant: "full" as const,
      rows: [{ a: 1 }],
      filters: { quick: "x" },
      onFilterChange: jest.fn(),
    };
    const { container, rerender } = render(<DataGrid {...props} />);
    const frame = container.querySelector(".ui-data-grid__frame") as HTMLElement;
    stubFrameHeight(frame, FRAME_FILTER_COLLAPSE_THRESHOLD_PX + 1); // threshold + 1
    retriggerMeasurement(rerender, props);

    expect(
      screen.getByRole("textbox", { name: "Quick filter across all columns" }),
    ).toBeInTheDocument();
  });

  it("REGRESSION GUARD (mutation-failable): a tall-enough frame with NO active filter is never force-EXPANDED (the override only ever COLLAPSES, it never fabricates an expand)", () => {
    const props = {
      variant: "full" as const,
      rows: [{ a: 1 }],
      onFilterChange: jest.fn(), // no `filters` -> filtering is false
    };
    const { container, rerender } = render(<DataGrid {...props} />);
    const frame = container.querySelector(".ui-data-grid__frame") as HTMLElement;
    stubFrameHeight(frame, 500); // well above threshold
    retriggerMeasurement(rerender, props);

    // Still collapsed -- nothing to expand into, since no filter is
    // active. The mutation this guards against: the height check alone
    // driving expansion regardless of `filtering`.
    expect(
      screen.queryByRole("textbox", { name: "Quick filter across all columns" }),
    ).not.toBeInTheDocument();
  });

  it("a user's explicit toggle click overrides the height-based default from then on ('collapse is a default, not a lock')", () => {
    const props = {
      variant: "full" as const,
      rows: [{ a: 1 }],
      filters: { quick: "x" },
      onFilterChange: jest.fn(),
    };
    const { container, rerender } = render(<DataGrid {...props} />);
    const frame = container.querySelector(".ui-data-grid__frame") as HTMLElement;
    stubFrameHeight(frame, 100); // well below threshold -> auto-collapsed
    retriggerMeasurement(rerender, props);
    expect(
      screen.queryByRole("textbox", { name: "Quick filter across all columns" }),
    ).not.toBeInTheDocument();

    // The user explicitly expands despite the short panel.
    fireEvent.click(screen.getByRole("button", { name: /Filters/ }));
    expect(
      screen.getByRole("textbox", { name: "Quick filter across all columns" }),
    ).toBeInTheDocument();

    // A subsequent re-measurement (e.g. another resize event) must NOT
    // re-collapse it -- the user's choice wins from here on.
    retriggerMeasurement(rerender, props);
    expect(
      screen.getByRole("textbox", { name: "Quick filter across all columns" }),
    ).toBeInTheDocument();
  });

  // HEL-451 design D10-11, CORRECTED (skeptic-evaluator cycle 3 CR1,
  // BLOCKING) — the message must render UNCONDITIONALLY. An earlier
  // revision gated it on `filterExpanded` too, which suppressed the
  // explanation entirely at exactly the short-panel heights where
  // auto-collapse forces the default -- "a filter matching nothing
  // renders as a confident wrong answer," the defect this ticket exists
  // to fix. This is the required mutation-failable guard: it must be
  // present in BOTH expansion states.
  it("REGRESSION GUARD: with a filter active and zero matches, an explanation is present in BOTH the collapsed and expanded states (D10-11 must never suppress it)", () => {
    const props = {
      variant: "full" as const,
      rows: [] as Record<string, unknown>[],
      columns: [{ key: "a" }],
      filters: { quick: "nothing matches" },
      onFilterChange: jest.fn(),
      emptyText: "No rows match your filter.",
    };

    // Collapsed (below threshold).
    const { container, rerender } = render(<DataGrid {...props} />);
    const frame = container.querySelector(".ui-data-grid__frame") as HTMLElement;
    stubFrameHeight(frame, 100);
    retriggerMeasurement(rerender, props);

    let filteredEmpty = container.querySelector(".ui-data-grid__filtered-empty");
    expect(filteredEmpty).not.toBeNull();
    expect(filteredEmpty).toHaveTextContent("No rows match your filter.");
    expect(filteredEmpty).toHaveClass("ui-data-grid__filtered-empty--compact");
    // The escape hatch (invariant 6) is still reachable via the toolbar too.
    expect(screen.getByRole("button", { name: "Filters (1)" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Clear all" })).toBeInTheDocument();

    // Expanded (above threshold): explanation still present, now full-form.
    stubFrameHeight(frame, 500);
    retriggerMeasurement(rerender, props);
    filteredEmpty = container.querySelector(".ui-data-grid__filtered-empty");
    expect(filteredEmpty).not.toBeNull();
    expect(filteredEmpty).toHaveTextContent("No rows match your filter.");
    expect(filteredEmpty).not.toHaveClass("ui-data-grid__filtered-empty--compact");
  });

  it("the compact presentation clamps the text but keeps it accessible via the title attribute", () => {
    const props = {
      variant: "full" as const,
      rows: [] as Record<string, unknown>[],
      columns: [{ key: "a" }],
      filters: { quick: "nothing matches" },
      onFilterChange: jest.fn(),
      emptyText: "No rows match your filter in the 200 rows loaded so far.",
    };
    const { container, rerender } = render(<DataGrid {...props} />);
    const frame = container.querySelector(".ui-data-grid__frame") as HTMLElement;
    stubFrameHeight(frame, 100);
    retriggerMeasurement(rerender, props);

    const message = container.querySelector(".ui-data-grid__filtered-empty .ui-data-grid__empty");
    expect(message).toHaveAttribute(
      "title",
      "No rows match your filter in the 200 rows loaded so far.",
    );
  });

  // HEL-451 design D10-12 (skeptic-evaluator cycle 4, BLOCKING) — the
  // cycle-3 threshold (151px) excluded the filtered-empty message on the
  // reasoning that it was "separately bounded", which is true only of its
  // COMPACT (44px) form. At/above the threshold the message reverts to
  // its FULL (86px, measured live) form, so the real chrome the app must
  // hold in the filtered-empty state at its own threshold was
  // `37 + 37 + 86 = 160px` -- MORE than 151px. This is the mutation-
  // failable form of that arithmetic: the exported constant must be large
  // enough to hold the full-message worst case plus a minimum usable
  // grid, not merely the chrome controls alone. Lowering the threshold
  // back toward the chrome-only floor (143-151px) must turn this red.
  it("REGRESSION GUARD (mutation-failable): the threshold holds the FULL (unclamped) filtered-empty message, not only the chrome controls", () => {
    const TOOLBAR_HEIGHT = 37;
    const QUICK_FILTER_ROW_HEIGHT = 37;
    const FULL_MESSAGE_HEIGHT = 86; // evaluation-3.md, measured live
    const honestExpandedFloor =
      TOOLBAR_HEIGHT + QUICK_FILTER_ROW_HEIGHT + FULL_MESSAGE_HEIGHT + GRID_MIN_USABLE_HEIGHT_PX;
    expect(FRAME_FILTER_COLLAPSE_THRESHOLD_PX).toBeGreaterThanOrEqual(honestExpandedFloor);
  });

  // HEL-451 design D10-12 — THE LOAD-BEARING GUARD for "the table shell
  // survives collapse [or a user override], not just the explanation"
  // (the invariant the evaluator named explicitly; `:861` covers the
  // message, this covers the GRID). This is the guard that actually
  // enforces the invariant: jsdom cannot compute enforced `min-height`
  // layout, so a DOM-presence check (see the NEXT test) cannot tell a
  // crushed grid from a usable one -- evaluation-3.md measured 61
  // per-column inputs present in the DOM inside a 7px crushed grid, so
  // "present in the DOM" was never the failing property, rendered height
  // was. Only a static assertion on the CSS RULE that enforces the pixel
  // floor is mutation-failable against the actual defect. Kept in sync
  // with the exported `GRID_MIN_USABLE_HEIGHT_PX` constant per its own
  // doc comment.
  it("STATIC SOURCE REGRESSION GUARD (THE invariant guard for grid-survives-collapse): .ui-data-grid--full carries a min-height floor matching GRID_MIN_USABLE_HEIGHT_PX", () => {
    const css = readFileSync(join(__dirname, "DataGrid.css"), "utf8");
    const rule = css.match(/\.ui-data-grid--full\s*{[^}]*}/)?.[0] ?? "";
    expect(rule).toMatch(new RegExp(`min-height:\\s*${GRID_MIN_USABLE_HEIGHT_PX}px`));
  });

  // HEL-451 design D10-12 — CORRECTED (skeptic-evaluator cycle 5): this
  // test previously claimed to guard "the table shell survives collapse",
  // which OVERSTATED what it proves. The header row and per-column filter
  // inputs were ALREADY present in the DOM in the crushed-grid defect
  // state (evaluation-3.md: 61 inputs inside a 7px grid) -- so a
  // DOM-presence assertion would not have caught either crush. Kept, per
  // the evaluator's instruction, as a STRUCTURAL check with an honest
  // description: it documents that the shell's markup is unconditional
  // (never removed by the collapse/override logic), which is a real,
  // narrower property worth locking in on its own -- it is NOT a
  // substitute for the CSS floor guard above, which is the one that
  // actually protects the invariant jsdom cannot lay out for itself.
  it("STRUCTURAL CHECK (not a layout guard -- see the CSS floor guard above for the real invariant): the header row and per-column filter markup is never conditionally removed by the collapse/override logic", () => {
    const props = {
      variant: "full" as const,
      rows: [{ a: 1, b: 2 }],
      filters: { quick: "x" },
      onFilterChange: jest.fn(),
    };
    const { container, rerender } = render(<DataGrid {...props} />);
    const frame = container.querySelector(".ui-data-grid__frame") as HTMLElement;
    // Far below even the pre-D10-12 threshold -- a panel no expanded
    // chrome could ever fit, exactly the state the CSS floor (not the
    // threshold) must keep usable. This height alone proves nothing about
    // whether the grid is actually VISIBLE at this size (jsdom cannot
    // say) -- only that the markup itself is not stripped out.
    stubFrameHeight(frame, 80);
    retriggerMeasurement(rerender, props);

    // Collapsed by default at this height.
    expect(
      screen.queryByRole("textbox", { name: "Quick filter across all columns" }),
    ).not.toBeInTheDocument();

    // The user overrides it anyway (D10-11 sanctions this).
    fireEvent.click(screen.getByRole("button", { name: /Filters/ }));

    expect(container.querySelector(".ui-data-grid__header-row")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Filter column a" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Filter column b" })).toBeInTheDocument();
  });
});

// HEL-451 design D5: the extended empty state (task 3.3/3.3a).
describe("DataGrid — extended empty state (HEL-451 design D5)", () => {
  it("with no emptyAction and no active filter, renders EXACTLY the pre-HEL-451 markup (bare <p>)", () => {
    // Named non-panel consumer (task 3.3): matches SourceDetailPanel's own
    // call shape (preview variant, custom emptyText, no filtering at all).
    const { container } = render(
      <DataGrid variant="preview" rows={[]} emptyText="Source returned no rows." />,
    );
    expect(container.innerHTML).toBe('<p class="ui-data-grid__empty">Source returned no rows.</p>');
  });

  it("with an emptyAction supplied and no filter active, renders the message plus the action beneath it", () => {
    render(
      <DataGrid
        variant="full"
        rows={[]}
        emptyText="Nothing here."
        emptyAction={<button type="button">Do something</button>}
      />,
    );
    expect(screen.getByText("Nothing here.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Do something" })).toBeInTheDocument();
  });

  it("a FILTERED empty result renders the full grid shell (region, table, thead+filter row), not a bare <p>", () => {
    const { container } = render(
      <DataGrid
        variant="full"
        rows={[]}
        columns={[{ key: "a" }]}
        filters={{ quick: "nothing matches" }}
        onFilterChange={jest.fn()}
        emptyText="No rows match your filter."
        emptyAction={<button type="button">Clear filters</button>}
      />,
    );
    expect(container.querySelector('[role="region"]')).toBeInTheDocument();
    expect(container.querySelector("table")).toBeInTheDocument();
    expect(container.querySelector(".ui-data-grid__filter-row")).toBeInTheDocument();
    expect(screen.getByText("No rows match your filter.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Clear filters" })).toBeInTheDocument();
  });

  // HEL-451 design D10-6/D10-8 — retargeted: the filtered-empty message no
  // longer renders as a `colSpan` row inside `tbody` (that mechanism is
  // exactly what D10 deletes). Instead the message renders as frame chrome
  // BEFORE the scroll container (D10-2), and `tbody` itself is genuinely
  // empty (no `<tr>` at all) rather than filled with one spanning row.
  it("D10-6/D10-8: the filtered-empty message renders as frame chrome, and tbody has zero rows", () => {
    const { container } = render(
      <DataGrid
        variant="full"
        rows={[]}
        columns={[{ key: "a" }, { key: "b" }]}
        filters={{ quick: "x" }}
        onFilterChange={jest.fn()}
        emptyText="No rows match your filter."
      />,
    );
    expect(container.querySelector("tbody td")).toBeNull();
    expect(container.querySelector("tbody")?.children).toHaveLength(0);
    const filteredEmpty = container.querySelector(".ui-data-grid__filtered-empty");
    expect(filteredEmpty).not.toBeNull();
    expect(filteredEmpty).toHaveTextContent("No rows match your filter.");
    // The shell (thead + per-column filter row) still renders (D10-8): the
    // input that produced the empty result stays visible and editable.
    expect(container.querySelector(".ui-data-grid__filter-row--columns")).toBeInTheDocument();
  });
});

// HEL-451 design D10-9 — retargeted. The mechanism these two describe
// blocks guarded (three sticky `<thead>` rows all colliding on `top: 0`,
// and a `colSpan` chrome cell's width unbounded against the scroll
// viewport) no longer exists after the D10 reframe: the toggle row and
// quick-filter row moved OUTSIDE the table as ordinary block-level chrome
// (D10-2), so there is nothing left inside `<thead>` to collide except the
// column-header row and the one remaining sticky row, the per-column
// filter row (which STAYS in the table, D10-2). `:840`'s property —
// "sticky offsets must be measured, not hardcoded to a colliding
// constant" — is real machinery D10 KEEPS (D10-7) and is retargeted below,
// not dropped.
describe("DataGrid — sticky filter-row offset (HEL-451 design D4e/D10-7)", () => {
  const HEADER_HEIGHT = 34;

  function stubHeaderRowHeight() {
    jest.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
      this: HTMLElement,
    ) {
      const cls = this.className || "";
      const height = cls.includes("ui-data-grid__header-row") ? HEADER_HEIGHT : 20;
      return {
        height,
        width: 100,
        top: 0,
        left: 0,
        right: 100,
        bottom: height,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      } as DOMRect;
    });
  }

  afterEach(() => jest.restoreAllMocks());

  it("resolves the per-column filter row's top to the MEASURED column-header row height, not a guessed constant", () => {
    stubHeaderRowHeight();
    const { container } = render(
      <DataGrid
        variant="full"
        rows={[{ a: 1 }]}
        filters={{ quick: "x" }} // already active -> seeded expanded
        onFilterChange={jest.fn()}
      />,
    );

    const columnsTh = container.querySelector(
      ".ui-data-grid__filter-row--columns th",
    ) as HTMLElement;
    expect(parseFloat(columnsTh.style.top)).toBe(HEADER_HEIGHT);
  });

  it("REGRESSION GUARD (mutation-failable): hardcoding the per-column filter row's top to 0 is exactly the collapse-onto-the-header defect this measurement guards against", () => {
    stubHeaderRowHeight();
    const { container } = render(
      <DataGrid
        variant="full"
        rows={[{ a: 1 }]}
        filters={{ quick: "x" }}
        onFilterChange={jest.fn()}
      />,
    );
    const columnsTh = container.querySelector(
      ".ui-data-grid__filter-row--columns th",
    ) as HTMLElement;
    // The bug this guards against: `top` resolving to "0px" (the header
    // row's own default) instead of the header row's measured height.
    expect(columnsTh.style.top).not.toBe("0px");
    expect(parseFloat(columnsTh.style.top)).toBe(HEADER_HEIGHT);
  });
});

// HEL-451 design D10-5 — retargeted. `stickyCellMaxWidth` and the
// `.ui-data-grid__sticky-cell` mechanism it fed are DELETED by the D10
// reframe (finding 3 from HANDOFF.md dies at the root: no `colSpan` chrome
// cell remains inside `table-layout: fixed`, so nothing needs a
// viewport-bounded width). These are the mutation-failable forms of D10-5's
// own success criterion.
describe("DataGrid — no measured viewport width anywhere in DataGrid (HEL-451 design D10-5)", () => {
  const css = readFileSync(join(__dirname, "DataGrid.css"), "utf8");

  it("D10-9(b): no inline maxWidth is computed anywhere in DataGrid — the failable form of D10-5's success criterion", () => {
    const { container } = render(
      <DataGrid
        variant="full"
        rows={[]}
        columns={[{ key: "a" }, { key: "b" }]}
        filters={{ quick: "nothing matches" }}
        onFilterChange={jest.fn()}
        emptyText="No rows match your filter."
      />,
    );
    const elementsWithInlineMaxWidth = Array.from(container.querySelectorAll("*")).filter(
      (el) => (el as HTMLElement).style.maxWidth !== "",
    );
    expect(elementsWithInlineMaxWidth).toHaveLength(0);
  });

  it("STATIC SOURCE: .ui-data-grid__sticky-cell no longer exists in DataGrid.css", () => {
    expect(css).not.toMatch(/\.ui-data-grid__sticky-cell/);
  });

  it("STATIC SOURCE: no CSS rule in DataGrid.css selects stickyCellMaxWidth's old colSpan chrome classes", () => {
    expect(css).not.toMatch(/\.ui-data-grid__filter-toggle-row\s+th\s*{/);
    expect(css).not.toMatch(/\.ui-data-grid__empty-row\s*{/);
  });

  it("STATIC SOURCE: the re-homed frame chrome carries the same surface/border/padding recipe as before (design D10-4)", () => {
    const toolbarRule = css.match(/\.ui-data-grid__filter-toolbar\s*{[^}]*}/)?.[0] ?? "";
    expect(toolbarRule).toMatch(/background:\s*var\(--app-surface-soft\)/);
    expect(toolbarRule).toMatch(/border-bottom:\s*1px solid var\(--app-border-subtle\)/);
    expect(toolbarRule).toMatch(/padding:\s*var\(--space-1\)\s*var\(--space-2\)/);

    const filteredEmptyRule = css.match(/\.ui-data-grid__filtered-empty\s*{[^}]*}/)?.[0] ?? "";
    expect(filteredEmptyRule).toMatch(/padding:\s*var\(--space-4\)\s*var\(--space-3\)/);
    expect(filteredEmptyRule).toMatch(/text-align:\s*left/);
  });

  it("STATIC SOURCE: the filtered-empty message still guards against a single unbroken long token (carried forward from the deleted sticky-cell)", () => {
    const filteredEmptyRule = css.match(/\.ui-data-grid__filtered-empty\s*{[^}]*}/)?.[0] ?? "";
    expect(filteredEmptyRule).toMatch(/overflow-wrap:\s*anywhere/);
  });

  // HEL-451 design D10-3a — evaluator-1 finding: the frame's full-variant
  // flex declaration is the ONE property whose absence fails SILENTLY
  // (renders fine, nothing goes red, sticky just stops engaging) — jsdom
  // cannot compute resolved CSS layout, so this is a static-source
  // assertion on the CSS rule DataGrid.tsx's `full`-variant class targets,
  // shown mutation-failable: deleting either declaration, or the DOM's
  // `ui-data-grid__frame--full` class itself, must turn this red.
  it("D10-3a REGRESSION GUARD (mutation-failable): the frame carries flex:1;min-height:0 for the full variant", () => {
    const { container } = render(<DataGrid variant="full" rows={[{ a: 1 }]} />);
    const frame = container.querySelector(".ui-data-grid__frame") as HTMLElement;
    expect(frame).toHaveClass("ui-data-grid__frame--full");

    const frameFullRule = css.match(/\.ui-data-grid__frame--full\s*{[^}]*}/)?.[0] ?? "";
    expect(frameFullRule).toMatch(/flex:\s*1/);
    expect(frameFullRule).toMatch(/min-height:\s*0/);
    // The mutation this guards against: the rule existing but scoped to
    // the wrong class, or the class never applied to the rendered frame.
    expect(frameFullRule).not.toBe("");
  });

  it("the preview variant's frame gets no full-variant flex rule (stays layout-neutral, D10-3a)", () => {
    const { container } = render(<DataGrid variant="preview" rows={[{ a: 1 }]} />);
    const frame = container.querySelector(".ui-data-grid__frame") as HTMLElement;
    expect(frame).not.toHaveClass("ui-data-grid__frame--full");
  });
});
