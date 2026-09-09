import { act, renderHook } from "@testing-library/react";

import { useOutputColumnFormats } from "./useOutputColumnFormats";

describe("useOutputColumnFormats", () => {
  it("seeds selections from the type of each persisted spec", () => {
    const { result } = renderHook(() =>
      useOutputColumnFormats({
        amount: { type: "currency", currency: "EUR" },
        seen_at: { type: "date" },
      }),
    );
    expect(result.current.selections).toEqual({ amount: "currency", seen_at: "date" });
  });

  it("a column with no persisted spec has no entry in selections", () => {
    const { result } = renderHook(() => useOutputColumnFormats(undefined));
    expect(result.current.selections).toEqual({});
  });

  it("setFormat('none') removes a column's entry entirely", () => {
    const { result } = renderHook(() => useOutputColumnFormats({ amount: { type: "currency" } }));
    act(() => result.current.setFormat("amount", "none"));
    expect(result.current.columnFormats).toEqual({});
    expect(result.current.selections).toEqual({});
  });

  it("setFormat(type) on a column with no prior spec writes exactly { type }", () => {
    const { result } = renderHook(() => useOutputColumnFormats(undefined));
    act(() => result.current.setFormat("amount", "currency"));
    expect(result.current.columnFormats).toEqual({ amount: { type: "currency" } });
  });

  it("setFormat(type) does NOT invent a default for an absent sub-option", () => {
    const { result } = renderHook(() => useOutputColumnFormats(undefined));
    act(() => result.current.setFormat("amount", "currency"));
    // No `currency` code written -- absent means "formatter default", never
    // a claim ("USD") the user never made.
    expect(result.current.columnFormats.amount).not.toHaveProperty("currency");
  });

  // evaluation-2.md non-blocking finding — REGRESSION GUARD, mutation-failable.
  // A prior version of this hook rebuilt every entry as `{ type }` ONLY,
  // discarding a spec's other fields on ANY unrelated Save. Verified red by
  // hand against that rebuild AT THE DERIVATION SITE (replacing the
  // `columnFormats: specs` return with a loop rebuilding each entry as
  // `{ type: sp.type }` only): this exact assertion failed (`currency` was
  // missing after the untouched column round-tripped through an edit to a
  // DIFFERENT column). Note this guard is NOT sensitive to `setFormat`'s own
  // carry-forward line (`existing ? { ...existing, type } : { type }`) —
  // that mutation only breaks the SAME-column case below, since the
  // cross-column property is carried by the `specs` state itself, not by
  // `setFormat`. Restored before commit.
  it(
    "MUTATION-FAILABLE GUARD: editing ONE column's format does not discard ANOTHER " +
      "column's already-persisted sub-options (decimals/currency/datePattern)",
    () => {
      const { result } = renderHook(() =>
        useOutputColumnFormats({
          amount: { type: "currency", currency: "EUR", decimals: 2 },
          seen_at: { type: "date", datePattern: "long" },
          category: { type: "text" },
        }),
      );
      // Edit a DIFFERENT column ("category") -- "amount"/"seen_at" are
      // never touched by this call.
      act(() => result.current.setFormat("category", "number"));
      expect(result.current.columnFormats.amount).toEqual({
        type: "currency",
        currency: "EUR",
        decimals: 2,
      });
      expect(result.current.columnFormats.seen_at).toEqual({
        type: "date",
        datePattern: "long",
      });
      expect(result.current.columnFormats.category).toEqual({ type: "number" });
    },
  );

  it("MUTATION-FAILABLE GUARD (setFormat carry-forward): editing a column's own type preserves that SAME column's other sub-options", () => {
    const { result } = renderHook(() =>
      useOutputColumnFormats({ amount: { type: "currency", currency: "EUR" } }),
    );
    act(() => result.current.setFormat("amount", "number"));
    // `currency` is meaningless for `number`, but the formatter simply
    // ignores a field its type doesn't use (columnFormatting.ts) -- this
    // hook never has to know that, it just never destroys data.
    expect(result.current.columnFormats.amount).toEqual({ type: "number", currency: "EUR" });
  });

  it("columnFormats is always the full map, including {} when every column is none", () => {
    const { result } = renderHook(() => useOutputColumnFormats(undefined));
    expect(result.current.columnFormats).toEqual({});
    expect("columnFormats" in result.current).toBe(true);
  });
});
