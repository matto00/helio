import { fireEvent, screen } from "@testing-library/react";

import { TableRenderer } from "./TableRenderer";
import { renderWithStore } from "../../../../test/renderWithStore";

// HEL-448: `updateOutput` is the persistence write under test in several
// blocks below — mocked so no real HTTP call is attempted and every call's
// arguments can be asserted directly.
jest.mock("../../../pipelines/services/outputService", () => ({
  updateOutput: jest.fn(),
}));

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
        outputId="panel-1"
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
        outputId="panel-1"
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
      <TableRenderer outputId="p" rawRows={[["1", "2", "3"]]} headers={["a", "b", "c"]} />,
    );
    expect(headerKeys()).toEqual(["a", "b", "c"]);
  });

  it("reorders and hides columns per columnOrder", () => {
    renderWithStore(
      <TableRenderer
        outputId="p"
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
        outputId="p"
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
        outputId="p"
        paginationRows={[{ a: "1", b: "2", c: "3" }]}
        columnOrder={["b", "a"]}
      />,
    );
    expect(headerKeys()).toEqual(["b", "a"]);
  });
});

// ── HEL-448: in-panel column sort ────────────────────────────────────────
describe("TableRenderer — sort (HEL-448)", () => {
  const outputServiceModule = jest.requireMock<{
    updateOutput: jest.Mock;
  }>("../../../pipelines/services/outputService");

  beforeEach(() => {
    outputServiceModule.updateOutput.mockReset().mockResolvedValue(undefined);
  });

  afterEach(() => jest.useRealTimers());

  function headerButtons(): HTMLElement[] {
    return screen
      .getAllByRole("columnheader")
      .map((th) => th.querySelector("button") as HTMLElement);
  }

  function cellTextByColumn(columnIndex: number): string[] {
    const rows = screen.getAllByRole("row").slice(1); // skip header row
    return rows.map((row) => {
      const cells = row.querySelectorAll("td");
      return cells[columnIndex]?.textContent ?? "";
    });
  }

  it("2.5a PROOF: a decimal-valued string column sorts numerically, not lexically (rawRows branch)", () => {
    renderWithStore(
      <TableRenderer
        outputId="p"
        rawRows={[["1.5"], ["1.25"], ["1.9"], ["10"], ["2"]]}
        headers={["n"]}
      />,
    );
    const buttons = headerButtons();
    fireEvent.click(buttons[0]);
    expect(cellTextByColumn(0)).toEqual(["1.25", "1.5", "1.9", "2", "10"]);
  });

  it("2.5b: blanks (null/undefined AND empty/whitespace strings) sort last in both directions, never as zero", () => {
    renderWithStore(
      <TableRenderer
        outputId="p"
        paginationRows={[{ n: "3" }, { n: "" }, { n: "-5" }, { n: "   " }, { n: "10" }]}
      />,
    );
    const buttons = headerButtons();
    fireEvent.click(buttons[0]); // ascending
    expect(cellTextByColumn(0)).toEqual(["-5", "3", "10", "", "   "]);
    fireEvent.click(buttons[0]); // descending
    expect(cellTextByColumn(0)).toEqual(["10", "3", "-5", "", "   "]);
  });

  it("spans the whole loaded set and merges newly loaded rows into the order, not trailing them", () => {
    const { rerender } = renderWithStore(
      <TableRenderer outputId="p" paginationRows={[{ n: "5" }, { n: "1" }]} />,
    );
    fireEvent.click(headerButtons()[0]);
    expect(cellTextByColumn(0)).toEqual(["1", "5"]);

    rerender(<TableRenderer outputId="p" paginationRows={[{ n: "5" }, { n: "1" }, { n: "3" }]} />);
    expect(cellTextByColumn(0)).toEqual(["1", "3", "5"]);
  });

  it(
    "2.4 REGRESSION GUARD: a never-sorted panel renders source order via the sentinel passthrough " +
      "(mutation-failable — see the mutated variant below)",
    () => {
      renderWithStore(<TableRenderer outputId="p" paginationRows={[{ n: "b" }, { n: "a" }]} />);
      // Source order preserved -- neither sorted ascending nor descending.
      expect(cellTextByColumn(0)).toEqual(["b", "a"]);
    },
  );

  it(
    "3.4a REGRESSION GUARD: merely rendering a never-sorted panel attempts no config write, ever, " +
      "and never with the sentinel key",
    () => {
      jest.useFakeTimers();
      renderWithStore(<TableRenderer outputId="p" paginationRows={[{ n: "b" }, { n: "a" }]} />);
      jest.advanceTimersByTime(5000);
      expect(outputServiceModule.updateOutput).not.toHaveBeenCalled();
    },
  );

  it(
    "3.4 REGRESSION GUARD: the PATCH body carries only columnSort; fieldMapping/columnOrder are untouched " +
      "(no config spread)",
    () => {
      jest.useFakeTimers();
      renderWithStore(
        <TableRenderer outputId="out-1" ownerId="me" paginationRows={[{ n: "b" }, { n: "a" }]} />,
        { auth: { currentUser: { id: "me" } as never } },
      );
      fireEvent.click(headerButtons()[0]);
      jest.advanceTimersByTime(500);
      expect(outputServiceModule.updateOutput).toHaveBeenCalledWith("out-1", {
        config: { columnSort: { key: "n", direction: "asc" } },
      });
    },
  );

  it("3.3b: a sort activated then unmounted inside the debounce window still flushes the write", () => {
    jest.useFakeTimers();
    const { unmount } = renderWithStore(
      <TableRenderer outputId="out-1" ownerId="me" paginationRows={[{ n: "b" }, { n: "a" }]} />,
      { auth: { currentUser: { id: "me" } as never } },
    );
    fireEvent.click(headerButtons()[0]);
    // Unmount BEFORE the debounce timer would have fired on its own.
    unmount();
    expect(outputServiceModule.updateOutput).toHaveBeenCalledWith("out-1", {
      config: { columnSort: { key: "n", direction: "asc" } },
    });
  });

  it(
    "REGRESSION GUARD (skeptic final-1 CR1): a rejected updateOutput (e.g. a legacy Output's 400) " +
      "produces no unhandled rejection and does not disturb the on-screen sort -- mutation-failable: " +
      "removing the .catch in persistColumnSort turns this red with an unhandled-rejection warning",
    async () => {
      jest.useFakeTimers({ doNotFake: ["queueMicrotask"] });
      outputServiceModule.updateOutput.mockReset().mockRejectedValue(
        Object.assign(new Error("Request failed with status code 400"), {
          isAxiosError: true,
          response: { status: 400 },
        }),
      );
      const unhandled: unknown[] = [];
      const onUnhandled = (reason: unknown) => unhandled.push(reason);
      process.on("unhandledRejection", onUnhandled);

      renderWithStore(
        <TableRenderer outputId="out-1" ownerId="me" paginationRows={[{ n: "b" }, { n: "a" }]} />,
        { auth: { currentUser: { id: "me" } as never } },
      );
      fireEvent.click(headerButtons()[0]);
      jest.advanceTimersByTime(500);
      // Let the rejected promise's microtask (and its .catch handler) run.
      await Promise.resolve();
      await Promise.resolve();

      process.off("unhandledRejection", onUnhandled);
      expect(unhandled).toEqual([]);
      expect(outputServiceModule.updateOutput).toHaveBeenCalledTimes(1);
      // The sort itself stayed applied on screen -- a failed persist never
      // reverts the in-progress user action (D7: session-local, not undone).
      expect(cellTextByColumn(0)).toEqual(["a", "b"]);
    },
  );

  it("3.5: a non-writable Output (viewer/grantee) sorts on screen but attempts no PATCH", () => {
    jest.useFakeTimers();
    renderWithStore(
      <TableRenderer
        outputId="out-1"
        ownerId="owner-x"
        paginationRows={[{ n: "b" }, { n: "a" }]}
      />,
      { auth: { currentUser: { id: "someone-else" } as never } },
    );
    fireEvent.click(headerButtons()[0]);
    jest.advanceTimersByTime(5000);
    expect(cellTextByColumn(0)).toEqual(["a", "b"]);
    expect(outputServiceModule.updateOutput).not.toHaveBeenCalled();
  });

  // Task 3.6's parse coverage (readTableConfig/readColumnSort round-trip,
  // malformed input, unknown-column key) lives in
  // outputConfigTypes.test.ts, which calls the real parse function
  // directly (HEL-448 CR1) -- this test only covers the seeding half: a
  // `columnSort` value already accepted by that parse seeds the initial
  // sort here.
  it("3.1 (seeding): a columnSort value accepted by readTableConfig seeds the initial sort", () => {
    renderWithStore(
      <TableRenderer
        outputId="p"
        paginationRows={[{ n: "b" }, { n: "a" }]}
        columnSort={{ key: "n", direction: "asc" }}
      />,
    );
    expect(cellTextByColumn(0)).toEqual(["a", "b"]);
  });

  it("no sort controls exist on the empty-skeleton branch", () => {
    const { container } = renderWithStore(<TableRenderer outputId="p" />);
    expect(container.querySelector(".sortable-th__btn")).not.toBeInTheDocument();
  });
});

// ── HEL-448 3b: truncation qualifier ─────────────────────────────────────
describe("TableRenderer — truncation qualifier (HEL-448 D9a)", () => {
  it("is absent when the loaded set is not truncated", () => {
    renderWithStore(
      <TableRenderer outputId="p" paginationRows={[{ a: "1" }]} paginationHasMore={false} />,
    );
    expect(screen.queryByText(/loaded rows/)).not.toBeInTheDocument();
  });

  it("is present when the loaded set is truncated (paginationHasMore)", () => {
    renderWithStore(
      <TableRenderer
        outputId="p"
        paginationRows={[{ a: "1" }]}
        paginationHasMore
        onLoadMore={jest.fn()}
      />,
    );
    expect(screen.getByText(/loaded rows/)).toBeInTheDocument();
  });

  it("is absent entirely on the rawRows branch (no pagination there)", () => {
    renderWithStore(<TableRenderer outputId="p" rawRows={[["1", "2"]]} headers={["a", "b"]} />);
    expect(screen.queryByText(/loaded rows/)).not.toBeInTheDocument();
  });
});
