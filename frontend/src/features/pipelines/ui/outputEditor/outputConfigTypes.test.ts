import { readTableConfig } from "./outputConfigTypes";

// HEL-448 CR1 (evaluation-1.md): task 3.6 requires real coverage of
// `readTableConfig`'s tolerant `columnSort` parse, not just a component test
// that hands `columnSort` to `TableRenderer` as a prop directly (which never
// exercises this parse at all). These tests call `readTableConfig` itself.
describe("readTableConfig — columnSort (HEL-448 design D5, task 3.6)", () => {
  it("round-trips a well-formed columnSort", () => {
    const cfg = readTableConfig({ columnSort: { key: "amount", direction: "desc" } });
    expect(cfg.columnSort).toEqual({ key: "amount", direction: "desc" });
  });

  it("round-trips the other direction too", () => {
    const cfg = readTableConfig({ columnSort: { key: "id", direction: "asc" } });
    expect(cfg.columnSort).toEqual({ key: "id", direction: "asc" });
  });

  it("is undefined (unsorted default) when columnSort is absent entirely", () => {
    const cfg = readTableConfig({});
    expect(cfg.columnSort).toBeUndefined();
  });

  it(
    "ignores an unknown-column key at parse time -- it still parses, rendering source order " +
      "is TableRenderer's job (useSortedRows' no-match passthrough), not readTableConfig's",
    () => {
      const cfg = readTableConfig({ columnSort: { key: "no_such_column", direction: "asc" } });
      expect(cfg.columnSort).toEqual({ key: "no_such_column", direction: "asc" });
    },
  );

  it("falls back to undefined (never throws) when key is missing", () => {
    const cfg = readTableConfig({ columnSort: { direction: "asc" } });
    expect(cfg.columnSort).toBeUndefined();
  });

  it("falls back to undefined when key is not a string", () => {
    const cfg = readTableConfig({ columnSort: { key: 42, direction: "asc" } });
    expect(cfg.columnSort).toBeUndefined();
  });

  it("falls back to undefined when direction is neither 'asc' nor 'desc'", () => {
    const cfg = readTableConfig({ columnSort: { key: "amount", direction: "sideways" } });
    expect(cfg.columnSort).toBeUndefined();
  });

  it("falls back to undefined when direction is missing entirely", () => {
    const cfg = readTableConfig({ columnSort: { key: "amount" } });
    expect(cfg.columnSort).toBeUndefined();
  });

  it("falls back to undefined when columnSort is not an object (a bare string)", () => {
    const cfg = readTableConfig({ columnSort: "amount:asc" });
    expect(cfg.columnSort).toBeUndefined();
  });

  it("falls back to undefined when columnSort is a number", () => {
    const cfg = readTableConfig({ columnSort: 1 });
    expect(cfg.columnSort).toBeUndefined();
  });

  it("falls back to undefined when columnSort is explicitly null", () => {
    const cfg = readTableConfig({ columnSort: null });
    expect(cfg.columnSort).toBeUndefined();
  });

  it("falls back to undefined when columnSort is an array", () => {
    const cfg = readTableConfig({ columnSort: ["amount", "asc"] });
    expect(cfg.columnSort).toBeUndefined();
  });

  it("never throws on a malformed columnSort -- degrades to the unsorted default", () => {
    expect(() => readTableConfig({ columnSort: { key: {}, direction: [] } })).not.toThrow();
    expect(readTableConfig({ columnSort: { key: {}, direction: [] } }).columnSort).toBeUndefined();
  });

  it(
    "columnSort parsing is independent of fieldMapping/columnOrder -- both still read correctly " +
      "alongside a well-formed columnSort",
    () => {
      const cfg = readTableConfig({
        fieldMapping: { value: "amount" },
        columnOrder: ["amount", "id"],
        columnSort: { key: "amount", direction: "desc" },
      });
      expect(cfg.fieldMapping).toEqual({ value: "amount" });
      expect(cfg.columnOrder).toEqual(["amount", "id"]);
      expect(cfg.columnSort).toEqual({ key: "amount", direction: "desc" });
    },
  );
});

// HEL-451 design D1/task 5.6 — tolerant `columnFilters` parse, mirroring the
// `columnSort` coverage above.
describe("readTableConfig — columnFilters (HEL-451 design D1)", () => {
  it("round-trips a well-formed columnFilters with both quick and columns", () => {
    const cfg = readTableConfig({
      columnFilters: { quick: "emea", columns: { region: "west" } },
    });
    expect(cfg.columnFilters).toEqual({ quick: "emea", columns: { region: "west" } });
  });

  it("is undefined when columnFilters is absent entirely", () => {
    expect(readTableConfig({}).columnFilters).toBeUndefined();
  });

  it("falls back to undefined when columnFilters is explicitly null", () => {
    expect(readTableConfig({ columnFilters: null }).columnFilters).toBeUndefined();
  });

  it("falls back to undefined when columnFilters is not an object (a bare string)", () => {
    expect(readTableConfig({ columnFilters: "emea" }).columnFilters).toBeUndefined();
  });

  it("drops a non-string quick value, keeping columns", () => {
    const cfg = readTableConfig({ columnFilters: { quick: 42, columns: { region: "west" } } });
    expect(cfg.columnFilters).toEqual({ columns: { region: "west" } });
  });

  it("keeps only string-valued string keys in columns, dropping the rest", () => {
    const cfg = readTableConfig({
      columnFilters: { columns: { region: "west", amount: 5, flagged: true } },
    });
    expect(cfg.columnFilters).toEqual({ columns: { region: "west" } });
  });

  it("tolerates a non-object columns value by dropping it entirely", () => {
    const cfg = readTableConfig({ columnFilters: { quick: "emea", columns: "region" } });
    expect(cfg.columnFilters).toEqual({ quick: "emea" });
  });

  it("never throws on a malformed columnFilters -- degrades to an empty object", () => {
    expect(() => readTableConfig({ columnFilters: { quick: {}, columns: "nope" } })).not.toThrow();
    expect(
      readTableConfig({ columnFilters: { quick: {}, columns: "nope" } }).columnFilters,
    ).toEqual({});
  });

  it(
    "columnFilters parsing is independent of columnSort/columnOrder -- all three read " +
      "correctly alongside each other",
    () => {
      const cfg = readTableConfig({
        columnOrder: ["amount", "id"],
        columnSort: { key: "amount", direction: "desc" },
        columnFilters: { quick: "emea" },
      });
      expect(cfg.columnOrder).toEqual(["amount", "id"]);
      expect(cfg.columnSort).toEqual({ key: "amount", direction: "desc" });
      expect(cfg.columnFilters).toEqual({ quick: "emea" });
    },
  );
});
