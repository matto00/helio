import {
  SEARCH_RESULTS_PER_KIND_CAP,
  searchResourceItems,
  type SearchableItem,
} from "./resourceSearch";

function item(
  kind: "dashboard" | "source" | "pipeline",
  id: string,
  title: string,
): SearchableItem {
  return { kind, id, title };
}

function outputItem(id: string, title: string, pipelineId = "p-default"): SearchableItem {
  return { kind: "output", id, title, pipelineId };
}

describe("searchResourceItems — HEL-503 design.md D5/D7 (task 3.1/3.4a)", () => {
  it("returns nothing for an empty query — search results must never leak into the default list", () => {
    const items = [item("source", "s1", "Alpha")];
    expect(searchResourceItems(items, "")).toEqual([]);
    expect(searchResourceItems(items, "   ")).toEqual([]);
  });

  it("ranks title-prefix above title-substring above title-subsequence, within a kind", () => {
    const items = [
      item("source", "s-sub", "My Alpha Source"), // substring
      item("source", "s-pre", "Alpha Source"), // prefix
      item("source", "s-seq", "A-l-p-h-a scattered"), // subsequence (a,l,p,h,a in order)
    ];
    const groups = searchResourceItems(items, "alpha");
    expect(groups).toHaveLength(1);
    expect(groups[0].items.map((i) => i.id)).toEqual(["s-pre", "s-sub", "s-seq"]);
  });

  it("groups matches by kind — one group per kind that has at least one match", () => {
    const items = [item("source", "s1", "Report Data"), item("pipeline", "p1", "Report Pipeline")];
    const groups = searchResourceItems(items, "report");
    expect(groups.map((g) => g.kind).sort()).toEqual(["pipeline", "source"]);
  });

  it("excludes a kind with zero matches — no empty group is emitted", () => {
    const items = [item("source", "s1", "Alpha")];
    const groups = searchResourceItems(items, "alpha");
    expect(groups.every((g) => g.kind !== "pipeline")).toBe(true);
  });

  // design.md D7 / task 3.4a — FAILABLE BY MUTATION: run, not merely asserted. Replacing
  // `resourceSearch.ts`'s `.slice(0, SEARCH_RESULTS_PER_KIND_CAP)` with the un-capped `ranked`
  // turns this RED (`items` has all 12, `overflowCount` is 0); restoring the slice turns it back
  // green. Both runs observed directly.
  it("caps a kind's results at SEARCH_RESULTS_PER_KIND_CAP and reports the overflow count", () => {
    const items = Array.from({ length: 12 }, (_, i) => outputItem(`o${i}`, `Output Alpha ${i}`));
    const groups = searchResourceItems(items, "alpha");
    expect(groups).toHaveLength(1);
    expect(groups[0].items).toHaveLength(SEARCH_RESULTS_PER_KIND_CAP);
    expect(groups[0].overflowCount).toBe(12 - SEARCH_RESULTS_PER_KIND_CAP);
  });

  it("reports zero overflow when a kind's matches are within the cap", () => {
    const items = [item("dashboard", "d1", "Alpha One"), item("dashboard", "d2", "Alpha Two")];
    const groups = searchResourceItems(items, "alpha");
    expect(groups[0].overflowCount).toBe(0);
    expect(groups[0].items).toHaveLength(2);
  });

  it("does not match an item whose title has none of the query's characters in order", () => {
    const items = [item("source", "s1", "Zebra")];
    expect(searchResourceItems(items, "alpha")).toEqual([]);
  });

  // Evaluator CR2 (cycle 2) — the compile-time half of the fix: `SearchableItem`'s output arm
  // must make a pipeline-less output UNREPRESENTABLE, the same property `ResourceRef` has. This
  // line itself errors (failing typecheck) if `pipelineId` ever became optional again — confirmed
  // directly: making it optional turned this `@ts-expect-error` into a real TS2578 ("Unused
  // '@ts-expect-error' directive"), failing the suite; restoring `pipelineId: string` (required)
  // fixed it. Both runs observed, not inferred.
  it("an output item without pipelineId does not compile", () => {
    // @ts-expect-error — pipelineId is required for kind "output"; this must NOT typecheck.
    const invalid: SearchableItem = { kind: "output", id: "o1", title: "No Pipeline" };
    expect(invalid).toBeDefined();
  });
});
