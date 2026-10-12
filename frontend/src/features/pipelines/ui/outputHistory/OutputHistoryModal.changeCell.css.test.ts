import { readFileSync } from "node:fs";
import { join } from "node:path";

// HEL-1490 D4 -- jest maps CSS to a stub, so the "Change cell keeps the accent wash on a ruled row" contract is
// pinned by reading the stylesheet source and comparing specificity.
const css = readFileSync(join(__dirname, "OutputHistoryModal.css"), "utf8").replace(
  /\/\*[\s\S]*?\*\//g,
  "",
);

/** (ids, classes+attrs+pseudo-classes, elements) of a selector with no :where/:not. */
function specificity(selector: string): [number, number, number] {
  const classes = (selector.match(/\.[\w-]+|\[[^\]]+\]|:(?!:)[\w-]+/g) ?? []).length;
  const stripped = selector.replace(/\.[\w-]+|\[[^\]]+\]|:{1,2}[\w-]+/g, " ");
  const elements = (stripped.match(/[a-zA-Z][\w-]*/g) ?? []).length;
  return [0, classes, elements];
}

function atLeast(a: [number, number, number], b: [number, number, number]) {
  return a[1] > b[1] || (a[1] === b[1] && a[2] >= b[2]);
}

describe("History Change cell keeps its accent wash over rule washes", () => {
  const match = /([^{}]*output-history__change-cell[^{}]*)\{([^}]*)\}/.exec(css);

  it("declares an accent-surface rule for the Change cell", () => {
    expect(match).not.toBeNull();
    expect(match?.[2]).toMatch(/background:\s*var\(--app-accent-surface\)/);
  });

  it("out-ranks the cell tone rule (0,2,3) and survives a pinned cell tone (0,3,3)", () => {
    const selector = (match?.[1] ?? "").replace(/\s+/g, " ").trim();
    expect(atLeast(specificity(selector), [0, 3, 3])).toBe(true);
  });
});
