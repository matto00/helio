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
        rowsTruncated
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
        rowsTruncated
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

  // HEL-451 added a filter-row `<th>` per column (plus a colSpan'd quick-
  // filter `<th>`) to `<thead>` unconditionally — both also carry
  // `role="columnheader"`, so this excludes any `<th>` inside a
  // `ui-data-grid__filter-row` to isolate the real sort header row.
  function headerKeys(): string[] {
    return screen
      .getAllByRole("columnheader")
      .filter((h) => !h.closest(".ui-data-grid__filter-row, .ui-data-grid__filter-toggle-row"))
      .map((h) => h.textContent?.trim() ?? "");
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

  // Same filter-row exclusion as `headerKeys` above.
  function headerButtons(): HTMLElement[] {
    return screen
      .getAllByRole("columnheader")
      .filter((th) => !th.closest(".ui-data-grid__filter-row, .ui-data-grid__filter-toggle-row"))
      .map((th) => th.querySelector("button") as HTMLElement);
  }

  function cellTextByColumn(columnIndex: number): string[] {
    // Scoped to `tbody tr` (not `getAllByRole("row").slice(1)`) — HEL-451
    // added the filter-row `<tr>`s to `<thead>` unconditionally, which also
    // carry `role="row"` and would otherwise be miscounted as data rows.
    const rows = screen.getAllByRole("row").filter((row) => row.closest("tbody") != null);
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

// ── HEL-448 3b / HEL-451 task 4.0-4.0g: truncation qualifier, re-gated on
// the branch-independent `rowsTruncated` prop ──────────────────────────────
describe("TableRenderer — truncation qualifier (HEL-448 D9a, re-gated per HEL-451 design D4)", () => {
  it("is absent when rowsTruncated is false (design D4: rowsTruncated is the sole source of truth; `paginationHasMore` no longer even exists as a prop -- HEL-451 skeptic CR6)", () => {
    renderWithStore(
      <TableRenderer outputId="p" paginationRows={[{ a: "1" }]} rowsTruncated={false} />,
    );
    expect(screen.queryByText(/loaded rows/)).not.toBeInTheDocument();
  });

  it("is present when rowsTruncated is true, on the pagination branch", () => {
    renderWithStore(
      <TableRenderer
        outputId="p"
        paginationRows={[{ a: "1" }]}
        rowsTruncated
        onLoadMore={jest.fn()}
      />,
    );
    expect(screen.getByText(/loaded rows/)).toBeInTheDocument();
  });

  // Task 4.0d: this is the HEL-448 regression being fixed — a sorted
  // 200-row sample presenting as complete in the panel detail modal, which
  // renders `rawRows` only. Requires a DIRECT test, not inherited coverage.
  it(
    "4.0d PROOF: the re-gated sort qualifier RENDERS on the rawRows branch when rowsTruncated is " +
      "true (this never rendered before HEL-451 — the modal has no pagination props at all)",
    () => {
      renderWithStore(
        <TableRenderer outputId="p" rawRows={[["1", "2"]]} headers={["a", "b"]} rowsTruncated />,
      );
      expect(screen.getByText(/loaded rows/)).toBeInTheDocument();
    },
  );

  it("is absent on the rawRows branch when rowsTruncated is false (default)", () => {
    renderWithStore(<TableRenderer outputId="p" rawRows={[["1", "2"]]} headers={["a", "b"]} />);
    expect(screen.queryByText(/loaded rows/)).not.toBeInTheDocument();
  });

  // Task 4.0e REGRESSION GUARD (mutation-failable): on the `rawRows` branch
  // with `rowsTruncated` true and no `onLoadMore`, the note renders and NO
  // Load-more button renders — re-gating both on one shared conditional
  // (reverting the note/button split) turns this red.
  it(
    "4.0e REGRESSION GUARD: rawRows branch, rowsTruncated=true, no onLoadMore -- note renders, " +
      "NO Load-more button renders",
    () => {
      renderWithStore(
        <TableRenderer outputId="p" rawRows={[["1", "2"]]} headers={["a", "b"]} rowsTruncated />,
      );
      expect(screen.getByText(/loaded rows/)).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /load more/i })).not.toBeInTheDocument();
    },
  );

  it("renders the Load-more button when rowsTruncated is true AND onLoadMore is supplied", () => {
    renderWithStore(
      <TableRenderer
        outputId="p"
        paginationRows={[{ a: "1" }]}
        rowsTruncated
        onLoadMore={jest.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: /load more/i })).toBeInTheDocument();
  });

  // Task 4.5a REGRESSION GUARD (mutation-failable): reverting `truncated` to
  // the old `usingPagination && paginationHasMore` predicate would render an
  // unqualified count / the non-truncated empty state on this branch, even
  // though `rowsTruncated` says the set IS truncated.
  it(
    "4.5a REGRESSION GUARD: rawRows branch, rowsTruncated=true -- the loaded-scope note is present " +
      "(never the bare no-truncation silence the old usingPagination-based predicate would produce)",
    () => {
      renderWithStore(
        <TableRenderer outputId="p" rawRows={[["1", "2"]]} headers={["a", "b"]} rowsTruncated />,
      );
      expect(screen.getByText("Sort covers only the loaded rows.")).toBeInTheDocument();
    },
  );
});

// ── HEL-451 task 1/2/4: in-panel column filtering ───────────────────────
describe("TableRenderer — column filtering (HEL-451)", () => {
  // HEL-451 design D4d: both filter rows sit behind ONE toggle, collapsed
  // by default when no filter is already active. Expands it on first
  // access so every test below can keep addressing the inputs directly,
  // exactly as it did before the toggle existed.
  function expandFiltersIfCollapsed(): void {
    const toggle = screen.queryByRole("button", { name: /^Filters/ });
    if (toggle && toggle.getAttribute("aria-expanded") === "false") {
      fireEvent.click(toggle);
    }
  }

  function quickFilterInput(): HTMLElement {
    expandFiltersIfCollapsed();
    return screen.getByRole("textbox", { name: "Quick filter across all columns" });
  }

  function columnFilterInput(column: string): HTMLElement {
    expandFiltersIfCollapsed();
    return screen.getByRole("textbox", { name: `Filter column ${column}` });
  }

  it("typing in the quick filter narrows rows across all columns live", () => {
    renderWithStore(
      <TableRenderer
        outputId="p"
        paginationRows={[
          { a: "alice", b: "1" },
          { a: "bob", b: "2" },
        ]}
      />,
    );
    fireEvent.change(quickFilterInput(), { target: { value: "alice" } });
    expect(screen.getByText("alice")).toBeInTheDocument();
    expect(screen.queryByText("bob")).not.toBeInTheDocument();
  });

  it("clearing the quick filter restores all rows", () => {
    renderWithStore(
      <TableRenderer
        outputId="p"
        paginationRows={[
          { a: "alice", b: "1" },
          { a: "bob", b: "2" },
        ]}
      />,
    );
    fireEvent.change(quickFilterInput(), { target: { value: "alice" } });
    fireEvent.change(quickFilterInput(), { target: { value: "" } });
    expect(screen.getByText("alice")).toBeInTheDocument();
    expect(screen.getByText("bob")).toBeInTheDocument();
  });

  it("a per-column filter narrows on that column only", () => {
    renderWithStore(
      <TableRenderer
        outputId="p"
        paginationRows={[
          { a: "alice", b: "1" },
          { a: "bob", b: "1" },
        ]}
      />,
    );
    fireEvent.change(columnFilterInput("a"), { target: { value: "alice" } });
    expect(screen.getByText("alice")).toBeInTheDocument();
    expect(screen.queryByText("bob")).not.toBeInTheDocument();
  });

  it("multiple column filters AND together", () => {
    renderWithStore(
      <TableRenderer
        outputId="p"
        paginationRows={[
          { a: "alice", b: "1" },
          { a: "alice", b: "2" },
        ]}
      />,
    );
    fireEvent.change(columnFilterInput("a"), { target: { value: "alice" } });
    fireEvent.change(columnFilterInput("b"), { target: { value: "1" } });
    // Only one row satisfies BOTH terms.
    expect(screen.getAllByRole("row").filter((r) => r.closest("tbody"))).toHaveLength(1);
  });

  it("filtering composes with sort without either regressing", () => {
    renderWithStore(
      <TableRenderer
        outputId="p"
        paginationRows={[{ n: "3" }, { n: "1" }, { n: "20" }]}
        columnSort={{ key: "n", direction: "asc" }}
      />,
    );
    fireEvent.change(quickFilterInput(), { target: { value: "" } });
    const rows = screen.getAllByRole("row").filter((r) => r.closest("tbody"));
    expect(rows.map((r) => r.textContent)).toEqual(["1", "3", "20"]);

    fireEvent.change(columnFilterInput("n"), { target: { value: "2" } });
    const filteredRows = screen.getAllByRole("row").filter((r) => r.closest("tbody"));
    expect(filteredRows.map((r) => r.textContent)).toEqual(["20"]);
  });

  it("filtered empty state shows the shared empty pattern with a Clear-filters action", () => {
    renderWithStore(<TableRenderer outputId="p" paginationRows={[{ a: "alice" }]} />);
    fireEvent.change(quickFilterInput(), { target: { value: "nobody" } });
    expect(screen.getByText("No rows match your filter.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Clear filters" })).toBeInTheDocument();
  });

  it("Clear filters restores all rows", () => {
    renderWithStore(<TableRenderer outputId="p" paginationRows={[{ a: "alice" }]} />);
    fireEvent.change(quickFilterInput(), { target: { value: "nobody" } });
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(screen.getByText("alice")).toBeInTheDocument();
  });

  // Task 4.0a: the detail modal has no `onLoadMore` at all -- the sharpest
  // (truncated-empty) state renders the disclosure TEXT WITHOUT the
  // Load-more action, offering Clear filters alone. This state exists on
  // exactly ONE surface, which makes it the state nobody exercises by
  // accident -- REQUIRED direct test.
  it(
    "4.0a: truncated + filtered + empty with NO onLoadMore (the modal shape) offers Clear filters " +
      "alone, never an undefined-prop Load-more button",
    () => {
      renderWithStore(
        <TableRenderer outputId="p" paginationRows={[{ a: "alice" }]} rowsTruncated />,
      );
      fireEvent.change(quickFilterInput(), { target: { value: "nobody" } });
      expect(
        screen.getByText(/No rows match your filter in the 1 rows loaded so far/),
      ).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Clear filters" })).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /load more/i })).not.toBeInTheDocument();
    },
  );

  it("truncated + filtered + empty WITH onLoadMore offers BOTH Clear filters AND Load more", () => {
    renderWithStore(
      <TableRenderer
        outputId="p"
        paginationRows={[{ a: "alice" }]}
        rowsTruncated
        onLoadMore={jest.fn()}
      />,
    );
    fireEvent.change(quickFilterInput(), { target: { value: "nobody" } });
    expect(screen.getByRole("button", { name: "Clear filters" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /load more/i })).toBeInTheDocument();
  });

  // Task 4.2/4.1: a count is NEVER rendered bare when truncated.
  it("a truncated result count is always paired with its denominator (never a bare number)", () => {
    renderWithStore(
      <TableRenderer
        outputId="p"
        paginationRows={[{ a: "alice" }, { a: "bob" }]}
        rowsTruncated
        onLoadMore={jest.fn()}
      />,
    );
    fireEvent.change(quickFilterInput(), { target: { value: "alice" } });
    expect(screen.getByText("1 of 2 loaded rows match.")).toBeInTheDocument();
  });

  it("a non-truncated result count is unqualified -- a complete answer, no denominator", () => {
    renderWithStore(<TableRenderer outputId="p" paginationRows={[{ a: "alice" }, { a: "bob" }]} />);
    fireEvent.change(quickFilterInput(), { target: { value: "alice" } });
    expect(screen.getByText("1 result.")).toBeInTheDocument();
  });

  // Task 4.0f SUPERSESSION: with a filter active AND the set truncated,
  // exactly ONE loaded-scope message renders (the filter-scoped one, never
  // stacked with the plain sort note).
  it("4.0f SUPERSESSION: filtering + truncated renders exactly ONE loaded-scope message", () => {
    renderWithStore(
      <TableRenderer
        outputId="p"
        paginationRows={[{ a: "alice" }, { a: "bob" }]}
        rowsTruncated
        onLoadMore={jest.fn()}
      />,
    );
    fireEvent.change(quickFilterInput(), { target: { value: "alice" } });
    expect(screen.getByText("1 of 2 loaded rows match.")).toBeInTheDocument();
    expect(screen.queryByText("Sort covers only the loaded rows.")).not.toBeInTheDocument();
  });

  it("4.3: the disclosure disappears entirely when the set is not truncated and no filter is active", () => {
    renderWithStore(<TableRenderer outputId="p" paginationRows={[{ a: "alice" }]} />);
    expect(screen.queryByText(/loaded rows/)).not.toBeInTheDocument();
    expect(screen.queryByText(/rows? match/)).not.toBeInTheDocument();
  });

  // ── HEL-451 evaluation-1.md CR4 / task 2.3 — REOPENED: this exact
  // describe block previously had ZERO `rawRows` renders, even though 2.3
  // explicitly names the `rawRows` branch as where "BOTH of HEL-448's
  // ordering defects actually lived." Every assertion below renders
  // `rawRows`/`headers`, not `paginationRows`. ─────────────────────────────
  it("2.3 PROOF: on the rawRows branch, a filtered table stays sorted, and re-sorting does not restore filtered-out rows", () => {
    renderWithStore(
      <TableRenderer
        outputId="p"
        rawRows={[["3"], ["1"], ["20"]]}
        headers={["n"]}
        columnSort={{ key: "n", direction: "asc" }}
      />,
    );
    const rows = () => screen.getAllByRole("row").filter((r) => r.closest("tbody"));
    expect(rows().map((r) => r.textContent)).toEqual(["1", "3", "20"]);

    fireEvent.change(columnFilterInput("n"), { target: { value: "2" } });
    expect(rows().map((r) => r.textContent)).toEqual(["20"]);

    // Re-sort (toggle to descending) -- the filtered-out rows ("1", "3")
    // must NOT come back.
    const headerButton = screen
      .getAllByRole("columnheader")
      .filter((th) => !th.closest(".ui-data-grid__filter-row, .ui-data-grid__filter-toggle-row"))
      .map((th) => th.querySelector("button") as HTMLElement)[0];
    fireEvent.click(headerButton);
    expect(rows().map((r) => r.textContent)).toEqual(["20"]);
  });

  // ── HEL-451 evaluation-1.md CR4 / task 4.5 — REOPENED alongside 2.3: the
  // five-state disclosure matrix, on the `rawRows` branch. ─────────────────
  it("4.5 rawRows: not filtering + truncated -> the sort qualifier only", () => {
    renderWithStore(
      <TableRenderer outputId="p" rawRows={[["1"], ["2"]]} headers={["n"]} rowsTruncated />,
    );
    expect(screen.getByText("Sort covers only the loaded rows.")).toBeInTheDocument();
  });

  it("4.5 rawRows: filtering + not truncated + results -> an unqualified count", () => {
    renderWithStore(<TableRenderer outputId="p" rawRows={[["1"], ["2"]]} headers={["n"]} />);
    fireEvent.change(columnFilterInput("n"), { target: { value: "1" } });
    expect(screen.getByText("1 result.")).toBeInTheDocument();
  });

  it("4.5 rawRows: filtering + not truncated + empty -> the filtered-empty message + Clear filters", () => {
    renderWithStore(<TableRenderer outputId="p" rawRows={[["1"], ["2"]]} headers={["n"]} />);
    fireEvent.change(columnFilterInput("n"), { target: { value: "nope" } });
    expect(screen.getByText("No rows match your filter.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Clear filters" })).toBeInTheDocument();
  });

  it("4.5 rawRows: filtering + truncated + results -> a SCOPED count, never bare", () => {
    renderWithStore(
      <TableRenderer outputId="p" rawRows={[["1"], ["2"]]} headers={["n"]} rowsTruncated />,
    );
    fireEvent.change(columnFilterInput("n"), { target: { value: "1" } });
    expect(screen.getByText("1 of 2 loaded rows match.")).toBeInTheDocument();
  });

  it("4.5 rawRows: filtering + truncated + empty -> loaded-scope text + Clear filters (no onLoadMore on this branch -- see 4.0a)", () => {
    renderWithStore(
      <TableRenderer outputId="p" rawRows={[["1"], ["2"]]} headers={["n"]} rowsTruncated />,
    );
    fireEvent.change(columnFilterInput("n"), { target: { value: "nope" } });
    expect(
      screen.getByText(/No rows match your filter in the 2 rows loaded so far/),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Clear filters" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /load more/i })).not.toBeInTheDocument();
  });
});

// ── HEL-451 task 5: filter persistence (mirrors HEL-448's columnSort path) ─
describe("TableRenderer — filter persistence (HEL-451 design D6)", () => {
  const outputServiceModule = jest.requireMock<{
    updateOutput: jest.Mock;
  }>("../../../pipelines/services/outputService");

  beforeEach(() => {
    outputServiceModule.updateOutput.mockReset().mockResolvedValue(undefined);
  });

  afterEach(() => jest.useRealTimers());

  // Same collapsed-by-default expansion as the filtering describe block
  // above (HEL-451 design D4d).
  function quickFilterInput(): HTMLElement {
    const toggle = screen.queryByRole("button", { name: /^Filters/ });
    if (toggle && toggle.getAttribute("aria-expanded") === "false") {
      fireEvent.click(toggle);
    }
    return screen.getByRole("textbox", { name: "Quick filter across all columns" });
  }

  it("3.4-equivalent REGRESSION GUARD: the PATCH body carries only columnFilters (no config spread)", () => {
    jest.useFakeTimers();
    renderWithStore(
      <TableRenderer outputId="out-1" ownerId="me" paginationRows={[{ a: "alice" }]} />,
      { auth: { currentUser: { id: "me" } as never } },
    );
    fireEvent.change(quickFilterInput(), { target: { value: "alice" } });
    jest.advanceTimersByTime(500);
    expect(outputServiceModule.updateOutput).toHaveBeenCalledWith("out-1", {
      config: { columnFilters: { quick: "alice" } },
    });
  });

  it("REGRESSION GUARD: merely rendering never attempts a filter write, ever", () => {
    jest.useFakeTimers();
    renderWithStore(
      <TableRenderer outputId="out-1" ownerId="me" paginationRows={[{ a: "alice" }]} />,
      { auth: { currentUser: { id: "me" } as never } },
    );
    jest.advanceTimersByTime(5000);
    expect(outputServiceModule.updateOutput).not.toHaveBeenCalled();
  });

  it("no write is attempted when the caller cannot write the Output (!canWrite)", () => {
    jest.useFakeTimers();
    renderWithStore(
      <TableRenderer outputId="out-1" ownerId="owner-x" paginationRows={[{ a: "alice" }]} />,
      { auth: { currentUser: { id: "someone-else" } as never } },
    );
    fireEvent.change(quickFilterInput(), { target: { value: "alice" } });
    jest.advanceTimersByTime(5000);
    expect(outputServiceModule.updateOutput).not.toHaveBeenCalled();
    // The on-screen filter still applies, session-locally.
    expect(screen.getByText("alice")).toBeInTheDocument();
  });

  it("a filter changed then unmounted inside the debounce window still flushes the write", () => {
    jest.useFakeTimers();
    const { unmount } = renderWithStore(
      <TableRenderer outputId="out-1" ownerId="me" paginationRows={[{ a: "alice" }]} />,
      { auth: { currentUser: { id: "me" } as never } },
    );
    fireEvent.change(quickFilterInput(), { target: { value: "alice" } });
    unmount();
    expect(outputServiceModule.updateOutput).toHaveBeenCalledWith("out-1", {
      config: { columnFilters: { quick: "alice" } },
    });
  });

  it("a cleared filter persists as columnFilters: null, never as an empty-string term", () => {
    jest.useFakeTimers();
    renderWithStore(
      <TableRenderer outputId="out-1" ownerId="me" paginationRows={[{ a: "alice" }]} />,
      { auth: { currentUser: { id: "me" } as never } },
    );
    fireEvent.change(quickFilterInput(), { target: { value: "alice" } });
    jest.advanceTimersByTime(500);
    fireEvent.change(quickFilterInput(), { target: { value: "" } });
    jest.advanceTimersByTime(500);
    expect(outputServiceModule.updateOutput).toHaveBeenLastCalledWith("out-1", {
      config: { columnFilters: null },
    });
  });

  it("a columnFilters value accepted by readTableConfig seeds the initial filter (persistence-adjacent seeding)", () => {
    renderWithStore(
      <TableRenderer
        outputId="p"
        paginationRows={[{ a: "alice" }, { a: "bob" }]}
        columnFilters={{ quick: "alice" }}
      />,
    );
    expect(screen.getByText("alice")).toBeInTheDocument();
    expect(screen.queryByText("bob")).not.toBeInTheDocument();
  });
});

// ── HEL-469: per-column cell formatting ──────────────────────────────────
describe("TableRenderer — column formatting renders + sort/filter guards (HEL-469)", () => {
  // Design D4/task 4.1a — every assertion below over a formatted column's
  // RENDERED TEXT pins locale AND timezone explicitly (evaluation-1.md
  // change request 1). `TableRenderer`'s `formatIntl` prop is TEST-ONLY (see its
  // doc comment) — production (`PanelContent.tsx`) never sets it, so
  // production keeps `Intl`'s locale-aware runtime defaults; passing it
  // here anchors these assertions instead of letting them inherit the
  // host's locale, matching `columnFormatting.test.ts`'s own pin.
  const PINNED_INTL = { locale: "en-US", timeZone: "America/New_York" };

  function headerButtons(): HTMLElement[] {
    return screen
      .getAllByRole("columnheader")
      .filter((th) => !th.closest(".ui-data-grid__filter-row, .ui-data-grid__filter-toggle-row"))
      .map((th) => th.querySelector("button") as HTMLElement);
  }

  function cellTextByColumn(columnIndex: number): string[] {
    const rows = screen.getAllByRole("row").filter((row) => row.closest("tbody") != null);
    return rows.map((row) => {
      const cells = row.querySelectorAll("td");
      return cells[columnIndex]?.textContent ?? "";
    });
  }

  function expandFiltersIfCollapsed(): void {
    const toggle = screen.queryByRole("button", { name: /^Filters/ });
    if (toggle && toggle.getAttribute("aria-expanded") === "false") {
      fireEvent.click(toggle);
    }
  }

  function columnFilterInput(column: string): HTMLElement {
    expandFiltersIfCollapsed();
    return screen.getByRole("textbox", { name: `Filter column ${column}` });
  }

  it("task 2 AC: a column set to currency renders $1,234.56-style values", () => {
    renderWithStore(
      <TableRenderer
        outputId="p"
        paginationRows={[{ n: 1234.56 }]}
        columnFormats={{ n: { type: "currency", currency: "USD" } }}
        formatIntl={PINNED_INTL}
      />,
    );
    expect(screen.getByText("$1,234.56")).toBeInTheDocument();
  });

  it("an unformatted column renders exactly as before (no columnFormats entry)", () => {
    renderWithStore(<TableRenderer outputId="p" paginationRows={[{ n: 1234.56 }]} />);
    expect(cellTextByColumn(0)).toEqual(["1234.56"]);
  });

  // Task 3.2 — THE CENTRAL AC. A currency column whose formatted text sorts
  // LEXICALLY differently from its raw numeric order ("$1,234.56" < "$9.99"
  // lexically) must still order NUMERICALLY when sorted.
  //
  // MUTATION-FAILABLE at the CALL SITE (design D1b), verified by hand: with
  // `TableRenderer.tsx:243`'s `getValue: (row) => getSortValue(row[col.key])`
  // temporarily re-pointed at `formatColumnValue(columnFormats[col.key],
  // row[col.key])`, this assertion goes RED — the currency column's numbers
  // become the strings "$9.99"/"$1,234.56" and sort lexically, putting
  // "$1,234.56" ahead of "$9.99" (reported in files-modified.md). Restored
  // before commit; the call site under test remains untouched by this
  // ticket (task 3.1).
  it("3.2 PROOF/GUARD: a currency column sorts numerically (raw), not by its formatted text", () => {
    renderWithStore(
      <TableRenderer
        outputId="p"
        paginationRows={[{ n: 1234.56 }, { n: 9.99 }]}
        columnFormats={{ n: { type: "currency", currency: "USD" } }}
        formatIntl={PINNED_INTL}
      />,
    );
    fireEvent.click(headerButtons()[0]); // ascending
    expect(cellTextByColumn(0)).toEqual(["$9.99", "$1,234.56"]);
  });

  it("formatting a column does not change the row order of an already-sorted column", () => {
    const { rerender } = renderWithStore(
      <TableRenderer outputId="p" paginationRows={[{ n: 1234.56 }, { n: 9.99 }]} />,
    );
    fireEvent.click(headerButtons()[0]);
    expect(cellTextByColumn(0)).toEqual(["9.99", "1234.56"]);
    rerender(
      <TableRenderer
        outputId="p"
        paginationRows={[{ n: 1234.56 }, { n: 9.99 }]}
        columnFormats={{ n: { type: "currency", currency: "USD" } }}
        formatIntl={PINNED_INTL}
      />,
    );
    expect(cellTextByColumn(0)).toEqual(["$9.99", "$1,234.56"]);
  });

  // Task 3.2a — the object-branch contract, EXPLICITLY NOT independently
  // mutation-failable (design D1b's "honest limit"): D3's formatter
  // fallback for a value that fails the column's declared type IS
  // `formatCell`, so an object cell's sort key coincides with the
  // formatter's output regardless of the call-site mutation above. This
  // documents the intended contract (a stable JSON sort key) rather than
  // claiming it as protection the currency guard above does not already
  // provide.
  it(
    "3.2a CONTRACT (not independently mutation-failable): an object cell's sort key is " +
      "formatCell's JSON string, matching its rendered fallback text",
    () => {
      renderWithStore(
        <TableRenderer
          outputId="p"
          paginationRows={[{ n: { z: 1 } }, { n: { a: 1 } }]}
          columnFormats={{ n: { type: "number" } }}
        />,
      );
      fireEvent.click(headerButtons()[0]); // ascending
      // Neither object is numeric, so both fall back to formatCell's
      // JSON.stringify sort key -- the row set and rendered text are
      // unchanged from before formatting, whatever tie-break order the
      // comparator settles on for equal-ish keys.
      expect(cellTextByColumn(0).sort()).toEqual(
        [JSON.stringify({ z: 1 }), JSON.stringify({ a: 1 })].sort(),
      );
    },
  );

  // Task 3.5/3.5a (design D6a) — filtering resolves the SAME per-column
  // formatter the cell renders, so a match is always visible in the cell
  // that matched and no cell matches text that appears nowhere on screen.
  //
  // MUTATION-FAILABLE against the PRE-FIX predicate: with
  // `tableFilterPredicate.ts`'s `cellMatches` reverted to bare
  // `formatCell(value)` (ignoring the `format` parameter), the "1,234"
  // assertion below goes RED (a raw number `1234.56` -> `formatCell` ->
  // `"1234.56"`, which does not contain "1,234" the grouped way), and the
  // "1234.56" assertion goes GREEN when it should be red (the raw value
  // DOES contain "1234.56", which is invisible in the rendered "$1,234.56"
  // cell). Verified by hand; reported in files-modified.md.
  it("3.5 PROOF/GUARD: a currency-formatted column's filter matches the FORMATTED text, not the raw value", () => {
    renderWithStore(
      <TableRenderer
        outputId="p"
        paginationRows={[{ n: 1234.56 }]}
        columnFormats={{ n: { type: "currency", currency: "USD" } }}
        formatIntl={PINNED_INTL}
      />,
    );
    fireEvent.change(columnFilterInput("n"), { target: { value: "1,234" } });
    expect(screen.getByText("$1,234.56")).toBeInTheDocument();
  });

  it("3.5 PROOF/GUARD: the same column does NOT match a term visible only in its raw (unformatted) value", () => {
    renderWithStore(
      <TableRenderer
        outputId="p"
        paginationRows={[{ n: 1234.56 }]}
        columnFormats={{ n: { type: "currency", currency: "USD" } }}
        formatIntl={PINNED_INTL}
      />,
    );
    fireEvent.change(columnFilterInput("n"), { target: { value: "1234.56" } });
    expect(screen.queryByText("$1,234.56")).not.toBeInTheDocument();
  });

  it("an unformatted column's filtering is unchanged -- matches its bare formatCell text", () => {
    renderWithStore(<TableRenderer outputId="p" paginationRows={[{ n: 1234.56 }]} />);
    fireEvent.change(columnFilterInput("n"), { target: { value: "1234.56" } });
    expect(screen.getByText("1234.56")).toBeInTheDocument();
  });

  // Task 3.3 (design D3a, owner-ruled) — header AND cell align together.
  it("3.3: a currency-formatted column right-aligns BOTH its header and its cells", () => {
    const { container } = renderWithStore(
      <TableRenderer
        outputId="p"
        paginationRows={[{ n: 1234.56 }]}
        columnFormats={{ n: { type: "currency", currency: "USD" } }}
        formatIntl={PINNED_INTL}
      />,
    );
    const th = container.querySelector("thead tr.ui-data-grid__header-row th") as HTMLElement;
    const td = container.querySelector("tbody td") as HTMLElement;
    expect(th.style.textAlign).toBe("right");
    expect(td.style.textAlign).toBe("right");
  });

  it("a text-formatted column does NOT right-align", () => {
    const { container } = renderWithStore(
      <TableRenderer
        outputId="p"
        paginationRows={[{ n: "hello" }]}
        columnFormats={{ n: { type: "text" } }}
      />,
    );
    const td = container.querySelector("tbody td") as HTMLElement;
    expect(td.style.textAlign).not.toBe("right");
  });

  // Task 3 AC — never throws, falls back to the raw string.
  it("a number-formatted column with an unparseable value renders its raw text without error", () => {
    renderWithStore(
      <TableRenderer
        outputId="p"
        paginationRows={[{ n: "n/a" }]}
        columnFormats={{ n: { type: "number" } }}
      />,
    );
    expect(screen.getByText("n/a")).toBeInTheDocument();
  });

  it("a malformed/unrecognised columnFormats entry is ignored, rendering that column unformatted", () => {
    renderWithStore(
      <TableRenderer
        outputId="p"
        paginationRows={[{ n: 1234.56 }]}
        columnFormats={{ n: { type: "currency", currency: "USD" }, missing: { type: "number" } }}
        formatIntl={PINNED_INTL}
      />,
    );
    // `missing` names no real column and is simply never applied.
    expect(screen.getByText("$1,234.56")).toBeInTheDocument();
  });
});
