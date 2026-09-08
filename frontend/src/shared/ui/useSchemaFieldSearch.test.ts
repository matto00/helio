import { act, renderHook } from "@testing-library/react";

import { useSchemaFieldSearch } from "./useSchemaFieldSearch";

interface Field {
  name: string;
}

function field(name: string): Field {
  return { name };
}

const getName = (f: Field) => f.name;

describe("useSchemaFieldSearch", () => {
  it("reports isSmall and a null groups/flat split at or below the threshold, no cap applied", () => {
    const fields = Array.from({ length: 5 }, (_, i) => field(`f${i}`));
    const { result } = renderHook(() =>
      useSchemaFieldSearch(fields, getName, { smallThreshold: 12 }),
    );
    expect(result.current.isSmall).toBe(true);
    expect(result.current.totalCount).toBe(5);
    // Small case still returns a flat list -- the CALLER (SchemaFieldViewer)
    // is responsible for skipping chrome when `isSmall`, not this hook.
    expect(result.current.flat?.visibleFields).toHaveLength(5);
    expect(result.current.groups).toBeNull();
  });

  it("groups when there's more than one namespace and the list isn't small", () => {
    const fields = [
      ...Array.from({ length: 20 }, (_, i) => field(`a.f${i}`)),
      ...Array.from({ length: 20 }, (_, i) => field(`b.f${i}`)),
    ];
    const { result } = renderHook(() =>
      useSchemaFieldSearch(fields, getName, { smallThreshold: 12, groupCap: 20 }),
    );
    expect(result.current.isSmall).toBe(false);
    expect(result.current.groups).not.toBeNull();
    expect(result.current.groups?.map((g) => g.key)).toEqual(["a", "b"]);
    expect(result.current.flat).toBeNull();
  });

  it("falls back to a flat capped list when there is only one real namespace (grouping wouldn't help)", () => {
    const fields = Array.from({ length: 40 }, (_, i) => field(`only.f${i}`));
    const { result } = renderHook(() =>
      useSchemaFieldSearch(fields, getName, { smallThreshold: 12, groupCap: 20 }),
    );
    expect(result.current.groups).toBeNull();
    expect(result.current.flat).not.toBeNull();
    expect(result.current.flat?.visibleFields).toHaveLength(20);
    expect(result.current.flat?.hasMore).toBe(true);
  });

  it("groups start collapsed with zero visible fields, and toggle() expands them", () => {
    const fields = [
      ...Array.from({ length: 5 }, (_, i) => field(`a.f${i}`)),
      ...Array.from({ length: 5 }, (_, i) => field(`b.f${i}`)),
    ];
    const { result } = renderHook(() =>
      useSchemaFieldSearch(fields, getName, { smallThreshold: 2, groupCap: 20 }),
    );
    const groupA = result.current.groups?.find((g) => g.key === "a");
    expect(groupA?.isExpanded).toBe(false);
    expect(groupA?.visibleFields).toHaveLength(0);

    act(() => groupA?.toggle());
    const groupAAfter = result.current.groups?.find((g) => g.key === "a");
    expect(groupAAfter?.isExpanded).toBe(true);
    expect(groupAAfter?.visibleFields).toHaveLength(5);
  });

  it("caps an expanded group's visible fields until showAll() is called", () => {
    const fields = [
      ...Array.from({ length: 30 }, (_, i) => field(`a.f${i}`)),
      ...Array.from({ length: 5 }, (_, i) => field(`b.f${i}`)),
    ];
    const { result } = renderHook(() =>
      useSchemaFieldSearch(fields, getName, { smallThreshold: 2, groupCap: 20 }),
    );
    let groupA = result.current.groups?.find((g) => g.key === "a");
    act(() => groupA?.toggle());
    groupA = result.current.groups?.find((g) => g.key === "a");
    expect(groupA?.visibleFields).toHaveLength(20);
    expect(groupA?.hasMore).toBe(true);

    act(() => groupA?.showAll());
    groupA = result.current.groups?.find((g) => g.key === "a");
    expect(groupA?.visibleFields).toHaveLength(30);
    expect(groupA?.isShowingAll).toBe(true);
  });

  it("while filtering, matches are shown flat across every namespace (not still boxed per group)", () => {
    const fields = [
      ...Array.from({ length: 5 }, (_, i) => field(`a.matchme${i}`)),
      ...Array.from({ length: 5 }, (_, i) => field(`b.matchme${i}`)),
      ...Array.from({ length: 5 }, (_, i) => field(`c.other${i}`)),
    ];
    const { result } = renderHook(() =>
      useSchemaFieldSearch(fields, getName, { smallThreshold: 2, groupCap: 20 }),
    );
    act(() => result.current.setQuery("matchme"));
    expect(result.current.isFiltering).toBe(true);
    expect(result.current.groups).toBeNull();
    expect(result.current.flat?.fields).toHaveLength(10);
    expect(result.current.flat?.fields.every((f) => getName(f).includes("matchme"))).toBe(true);
  });

  it("filter match is case-insensitive", () => {
    const fields = [field("Player.Name"), field("player.age")];
    const { result } = renderHook(() =>
      useSchemaFieldSearch(fields, getName, { smallThreshold: 0, groupCap: 20 }),
    );
    act(() => result.current.setQuery("NAME"));
    expect(result.current.flat?.fields.map(getName)).toEqual(["Player.Name"]);
  });
});
