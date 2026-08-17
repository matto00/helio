import fs from "fs";
import path from "path";

// Regression guard for F-175: `.panel-content__load-more-btn` had no CSS at
// all (bare UA-default `<button>`, measured 22px tall on the phone stack —
// under the app's 44px tap-target convention). jsdom implements no real
// layout/media-query evaluation, so no DOM-rendering Jest test can observe
// the button's actual height at a given viewport; this statically asserts
// the CSS source keeps (a) the base control-height token and (b) the 430px
// mobile floor. See `CollectionRenderer.css.test.ts` for the precedent this
// reuses.

const CSS_PATH = path.join(__dirname, "TableRenderer.css");
const css = fs.readFileSync(CSS_PATH, "utf-8");

/** Body of the first flat rule whose selector contains `selectorSubstring`,
 *  searching from `fromIndex` (so a selector that also appears nested inside
 *  a `@media` block can be found on either side of it). */
function findRuleBody(source: string, selectorSubstring: string, fromIndex = 0): string {
  const selectorIndex = source.indexOf(selectorSubstring, fromIndex);
  if (selectorIndex === -1) {
    throw new Error(`Selector containing "${selectorSubstring}" not found in ${CSS_PATH}`);
  }
  const openBrace = source.indexOf("{", selectorIndex);
  const closeBrace = source.indexOf("}", openBrace);
  return source.slice(openBrace + 1, closeBrace);
}

describe("TableRenderer.css — load-more button sizing", () => {
  it("has a real button recipe at the desktop control-height token", () => {
    const body = findRuleBody(css, ".panel-content__load-more-btn {");
    expect(body).toMatch(/height:\s*var\(--control-sm\)\s*;/);
  });

  it("floors to the 44px phone tap-target convention at the 430px breakpoint", () => {
    const mediaIndex = css.indexOf("@media (max-width: 430px)");
    expect(mediaIndex).toBeGreaterThan(-1);
    const body = findRuleBody(css, ".panel-content__load-more-btn {", mediaIndex);
    expect(body).toMatch(/min-height:\s*44px\s*;/);
  });
});
