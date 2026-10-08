import { render } from "@testing-library/react";

import { CollectionRenderer } from "./CollectionRenderer";

// GUARD (HEL-1182, not a red-first test): CollectionRenderer maps each `fieldMapping` SLOT to its
// own column, so it is order-independent today. This pins that against a future positional pick.
// D1: `rank` is numeric and differs from `amount`.
const HEADERS = ["region", "amount", "rank"];
const ROWS = [
  ["North", "100", "7"],
  ["South", "200", "8"],
];

const MAPPINGS: Array<[string, Record<string, string>]> = [
  ["value-first (baseline control)", { value: "amount", label: "region", unit: "rank" }],
  ["label-first", { label: "region", value: "amount" }],
  ["unit-first", { unit: "rank", value: "amount" }],
  ["unit+label-first", { unit: "rank", label: "region", value: "amount" }],
];

describe.each(MAPPINGS)("GUARD: CollectionRenderer with a %s fieldMapping", (_name, mapping) => {
  it("renders each item's value element from the value column", () => {
    const { container } = render(
      <CollectionRenderer fieldMapping={mapping} layout="grid" rawRows={ROWS} headers={HEADERS} />,
    );
    const values = Array.from(container.querySelectorAll(".panel-content__metric-value")).map(
      (el) => el.firstChild?.textContent,
    );
    expect(values).toEqual(["100", "200"]);
  });
});
