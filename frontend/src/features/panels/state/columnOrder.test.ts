import { fetchPanelPage, panelsReducer } from "./panelsSlice";
import { mergeColumns, orderColumns } from "./columnOrder";

// HEL-1705 H: the client mirror of the server's `RowColumnOrder`.
describe("orderColumns", () => {
  it("is the schema's names present, then every other name by code point", () => {
    expect(
      orderColumns(["alpha", "b", "10", "Z", "zeta"], ["zeta", "10", "alpha", "gone"]),
    ).toEqual(["zeta", "10", "alpha", "Z", "b"]);
  });
});

describe("mergeColumns", () => {
  const schema = ["zeta", "10", "alpha"];

  it("keeps the first page's list and adds what a later page brings in the server's order", () => {
    // Page 1 had no "alpha"; page 2 brings it (a schema name first seen late takes its schema place) and a new extra.
    expect(mergeColumns(["zeta", "10", "x"], ["zeta", "alpha", "a"], schema)).toEqual([
      "zeta",
      "10",
      "alpha",
      "a",
      "x",
    ]);
  });

  it("re-sorts the extras tail by code point", () => {
    expect(mergeColumns(["zeta", "q"], ["zeta", "b"], schema)).toEqual(["zeta", "b", "q"]);
  });

  it("falls back to the existing order plus new names when the Output's schema is unknown", () => {
    expect(mergeColumns(["b", "a"], ["a", "c"], undefined)).toEqual(["b", "a", "c"]);
    expect(mergeColumns(["b", "a"], ["a", "c"], [])).toEqual(["b", "a", "c"]);
  });

  it("is the incoming list when there is none yet, and the existing one when the page carries none", () => {
    expect(mergeColumns(undefined, ["b", "a"], schema)).toEqual(["b", "a"]);
    expect(mergeColumns(["b"], undefined, schema)).toEqual(["b"]);
    expect(mergeColumns(undefined, undefined, schema)).toBeUndefined();
  });
});

describe("the panels window's columns", () => {
  const arg = (page: number) => ({ panelId: "p", outputId: "o", page, pageSize: 2 });
  function run(
    page: number,
    columns: string[] | undefined,
    schemaNames: string[] | undefined,
    state = undefined as never,
  ) {
    const requestId = `r${page}`;
    let s = panelsReducer(
      state,
      fetchPanelPage.pending(requestId, arg(page), { capturedAt: 1 } as never),
    );
    s = panelsReducer(
      s,
      fetchPanelPage.fulfilled(
        {
          panelId: "p",
          page,
          rows: [{}],
          hasMore: page === 0,
          materialized: true,
          total: 4,
          columns,
          schemaNames,
        },
        requestId,
        arg(page),
      ),
    );
    return s;
  }

  it("takes page 0's columns, then merges a later page's under the Output's schema", () => {
    const schema = ["zeta", "10", "alpha"];
    const first = run(0, ["zeta", "10"], schema);
    expect(first.paginationState.p.columns).toEqual(["zeta", "10"]);
    const second = run(1, ["zeta", "alpha", "extra"], schema, first as never);
    expect(second.paginationState.p.columns).toEqual(["zeta", "10", "alpha", "extra"]);
  });

  it("leaves a window with no columns (an older server) without any", () => {
    expect(run(0, undefined, undefined).paginationState.p.columns).toBeUndefined();
  });

  it("a new page-0 request keeps the previous columns while it is pending, and page 0 replaces them", () => {
    const first = run(0, ["b", "a"], undefined);
    const pending = panelsReducer(
      first,
      fetchPanelPage.pending("again", arg(0), { capturedAt: 2 } as never),
    );
    expect(pending.paginationState.p.columns).toEqual(["b", "a"]);
    expect(run(0, ["c"], undefined, first as never).paginationState.p.columns).toEqual(["c"]);
  });
});
