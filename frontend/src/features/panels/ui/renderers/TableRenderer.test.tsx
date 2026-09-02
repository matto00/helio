import { screen } from "@testing-library/react";

import { TableRenderer } from "./TableRenderer";
import { renderWithStore } from "../../../../test/renderWithStore";

// HEL-909: per-panel column-width/density persistence (`updatePanelColumnWidths`,
// `panel.config.columnWidths`/`density`) had no Output-config equivalent once
// this kind repointed onto the Output model — `OutputPanelConfig` carries only
// `outputId`. Those persistence/density describe blocks are retired outright,
// not rewritten; `columnOrder` (from `TableOutputConfig`) and the load-more
// pagination behavior are unaffected and still covered below.

// HEL-528 design.md D7/6.7 — "load more" is short in-place work over
// already-rendered rows, not an initial structural load, so it keeps the
// accent border-spinner (unchanged by this ticket's skeleton sweep).
describe("TableRenderer — load-more keeps the accent spinner, not a skeleton (HEL-528 6.7)", () => {
  it("shows the shared Spinner while loading the next page, with the existing rows still rendered", () => {
    const { container } = renderWithStore(
      <TableRenderer
        panelId="panel-1"
        paginationRows={[{ a: "1", b: "2" }]}
        paginationHasMore
        paginationIsLoadingMore
        onLoadMore={jest.fn()}
      />,
    );

    expect(container.querySelector(".ui-spinner--sm")).toBeInTheDocument();
    expect(container.querySelector(".ui-skeleton")).not.toBeInTheDocument();
    expect(screen.getAllByRole("columnheader").length).toBeGreaterThan(0);
  });

  it("shows a plain 'Load more' button (no spinner) when not currently loading the next page", () => {
    const { container } = renderWithStore(
      <TableRenderer
        panelId="panel-1"
        paginationRows={[{ a: "1", b: "2" }]}
        paginationHasMore
        paginationIsLoadingMore={false}
        onLoadMore={jest.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: "Load more" })).toBeInTheDocument();
    expect(container.querySelector(".ui-spinner")).not.toBeInTheDocument();
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
