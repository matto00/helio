import fs from "fs";
import path from "path";

// Regression guard for the collection-tile value-overflow fix. jsdom implements
// no real layout, so no DOM-rendering Jest test can observe a nowrap metric
// value overflowing its grid track and overlapping neighboring tiles. This test
// statically asserts the CSS source keeps the collection-scoped overrides that
// (a) let each tile's metric shrink with its track (`min-width: 0`) and (b)
// re-enable wrapping over the standalone metric's `white-space: nowrap`
// (PanelContent.css W4.4, sized for one-line numeric values only). See
// `EmptyState.css.test.ts` for the static-CSS-assertion precedent this reuses.

const CSS_PATH = path.join(__dirname, "CollectionRenderer.css");
const css = fs.readFileSync(CSS_PATH, "utf-8");

/** Body of the first flat rule whose selector contains `selectorSubstring`. */
function findRuleBody(source: string, selectorSubstring: string): string {
  const selectorIndex = source.indexOf(selectorSubstring);
  if (selectorIndex === -1) {
    throw new Error(`Selector containing "${selectorSubstring}" not found in ${CSS_PATH}`);
  }
  const openBrace = source.indexOf("{", selectorIndex);
  const closeBrace = source.indexOf("}", openBrace);
  return source.slice(openBrace + 1, closeBrace);
}

describe("CollectionRenderer.css — tile values wrap instead of overlapping neighbors", () => {
  it("the tile metric can shrink with its grid track", () => {
    const body = findRuleBody(css, ".panel-content__collection-item .panel-content--metric");
    expect(body).toMatch(/min-width:\s*0\s*;/);
  });

  it("the tile value overrides the standalone metric's nowrap and wraps long tokens", () => {
    const body = findRuleBody(css, ".panel-content__collection-item .panel-content__metric-value");
    expect(body).toMatch(/white-space:\s*normal\s*;/);
    expect(body).toMatch(/overflow-wrap:\s*anywhere\s*;/);
  });
});
