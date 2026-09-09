import {
  isFiltering,
  normalizeColumnFiltersForWrite,
  rowMatchesFilters,
} from "./tableFilterPredicate";
import type { ColumnDef } from "../../../../shared/ui/index";

const columns: ColumnDef[] = [{ key: "region" }, { key: "amount" }];

describe("rowMatchesFilters — predicate (HEL-451 task 1.1-1.3)", () => {
  it("matches case-insensitively", () => {
    const row = { region: "EMEA", amount: 5 };
    expect(rowMatchesFilters(row, columns, { quick: "emea" })).toBe(true);
  });

  it("trims the quick term before matching", () => {
    const row = { region: "EMEA", amount: 5 };
    expect(rowMatchesFilters(row, columns, { quick: "  emea  " })).toBe(true);
  });

  it("quick term matches when ANY visible column matches", () => {
    const row = { region: "EMEA", amount: 5 };
    expect(rowMatchesFilters(row, columns, { quick: "5" })).toBe(true);
    expect(rowMatchesFilters(row, columns, { quick: "nope" })).toBe(false);
  });

  it("per-column term matches only its own column, not a sibling column's text", () => {
    const row = { region: "EMEA", amount: 5 };
    expect(rowMatchesFilters(row, columns, { columns: { region: "emea" } })).toBe(true);
    expect(rowMatchesFilters(row, columns, { columns: { amount: "emea" } })).toBe(false);
  });

  it("multiple per-column terms AND together", () => {
    const row = { region: "EMEA", amount: 5 };
    expect(rowMatchesFilters(row, columns, { columns: { region: "emea", amount: "5" } })).toBe(
      true,
    );
    expect(rowMatchesFilters(row, columns, { columns: { region: "emea", amount: "9" } })).toBe(
      false,
    );
  });

  it("the quick term ANDs with per-column terms", () => {
    const row = { region: "EMEA", amount: 5 };
    expect(rowMatchesFilters(row, columns, { quick: "5", columns: { region: "emea" } })).toBe(true);
    expect(rowMatchesFilters(row, columns, { quick: "9", columns: { region: "emea" } })).toBe(
      false,
    );
  });

  it("an empty/whitespace-only term is a no-op (matches everything)", () => {
    const row = { region: "EMEA", amount: 5 };
    expect(rowMatchesFilters(row, columns, { quick: "" })).toBe(true);
    expect(rowMatchesFilters(row, columns, { quick: "   " })).toBe(true);
    expect(rowMatchesFilters(row, columns, { columns: { region: "" } })).toBe(true);
  });

  it("undefined filters matches everything", () => {
    const row = { region: "EMEA", amount: 5 };
    expect(rowMatchesFilters(row, columns, undefined)).toBe(true);
  });

  // Design D2 — the match source IS the rendered (formatCell) text, which is
  // what makes a map-classified/object-valued column explainable rather than
  // arbitrary. This is the pagination branch, where objects survive as
  // objects (see design D2's "branch-dependent limitation" for why the
  // rawRows branch is different and NOT tested here — HEL-1033).
  it("matches an OBJECT-valued cell via its formatCell (JSON) text", () => {
    const row = { payload: { region: "EMEA" } };
    const objColumns: ColumnDef[] = [{ key: "payload" }];
    expect(rowMatchesFilters(row, objColumns, { quick: "region" })).toBe(true);
    expect(rowMatchesFilters(row, objColumns, { quick: "EMEA" })).toBe(true);
    expect(rowMatchesFilters(row, objColumns, { quick: "nope" })).toBe(false);
  });
});

describe("isFiltering", () => {
  it("is false for undefined filters", () => {
    expect(isFiltering(undefined)).toBe(false);
  });

  it("is false when quick and columns are all empty/whitespace", () => {
    expect(isFiltering({ quick: "  ", columns: { region: "" } })).toBe(false);
  });

  it("is true when quick has a real term", () => {
    expect(isFiltering({ quick: "emea" })).toBe(true);
  });

  it("is true when any column has a real term", () => {
    expect(isFiltering({ columns: { region: "west" } })).toBe(true);
  });
});

describe("normalizeColumnFiltersForWrite (task 5.1)", () => {
  it("strips an empty/whitespace-only quick term", () => {
    expect(normalizeColumnFiltersForWrite({ quick: "   " })).toBeNull();
  });

  it("strips empty/whitespace-only per-column terms, keeping non-empty ones", () => {
    expect(normalizeColumnFiltersForWrite({ columns: { region: "west", amount: "  " } })).toEqual({
      columns: { region: "west" },
    });
  });

  it("collapses to null when everything is empty (a cleared filter is no filter)", () => {
    expect(normalizeColumnFiltersForWrite({ quick: "", columns: { region: "" } })).toBeNull();
  });

  it("keeps a well-formed quick+columns value untouched", () => {
    expect(normalizeColumnFiltersForWrite({ quick: "emea", columns: { region: "west" } })).toEqual({
      quick: "emea",
      columns: { region: "west" },
    });
  });
});
