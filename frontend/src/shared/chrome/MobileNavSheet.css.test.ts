import fs from "fs";
import path from "path";

// Regression guard for the HEL-303 mobile touch-target fix. jsdom implements
// no real layout or media-query evaluation, so no DOM-rendering Jest test can
// observe the rendered row height at a phone viewport. This test statically
// asserts the CSS source keeps the mobile-scoped ≥44px minimum on the bottom-
// sheet rows (`.mobile-nav-sheet__item`) — the primary tap target on phone for
// both the dashboard switcher and section-item nav (mobile-dashboard-sheet
// spec). Mirrors the read-file + findMediaBlock/findRuleBody scan used by
// `PanelDetailModal.css.test.ts` and `MobilePanelStack.css.test.ts`.

const CSS_PATH = path.join(__dirname, "MobileNavSheet.css");
const css = fs.readFileSync(CSS_PATH, "utf-8");

/** Extracts the full body of the first `@media` at-rule whose prelude contains
 *  `preludeSubstring`, brace-matching so nested rule blocks are included. */
function findMediaBlock(source: string, preludeSubstring: string): string {
  let searchFrom = 0;
  for (;;) {
    const at = source.indexOf("@media", searchFrom);
    if (at === -1) {
      throw new Error(`No @media rule containing "${preludeSubstring}" found in ${CSS_PATH}`);
    }
    const openBrace = source.indexOf("{", at);
    const prelude = source.slice(at, openBrace);
    if (prelude.includes(preludeSubstring)) {
      let depth = 0;
      for (let i = openBrace; i < source.length; i++) {
        if (source[i] === "{") depth++;
        else if (source[i] === "}") {
          depth--;
          if (depth === 0) return source.slice(openBrace + 1, i);
        }
      }
      throw new Error(`Unbalanced braces in @media block in ${CSS_PATH}`);
    }
    searchFrom = openBrace + 1;
  }
}

/** Body of the first flat rule inside `block` whose selector contains
 *  `selectorSubstring`. Assumes flat rules (no nested at-rules). */
function findRuleBody(block: string, selectorSubstring: string): string {
  const selectorIndex = block.indexOf(selectorSubstring);
  if (selectorIndex === -1) {
    throw new Error(`Selector containing "${selectorSubstring}" not found in the media block`);
  }
  const openBrace = block.indexOf("{", selectorIndex);
  const closeBrace = block.indexOf("}", openBrace);
  return block.slice(openBrace + 1, closeBrace);
}

describe("MobileNavSheet.css — mobile ≥44px sheet rows (HEL-303)", () => {
  it("the sheet-row rule gets min-height: 44px at the mobile-shell breakpoint", () => {
    const mobileBlock = findMediaBlock(css, "max-width: 768px");
    const body = findRuleBody(mobileBlock, ".mobile-nav-sheet__item");
    expect(body).toMatch(/min-height:\s*44px\s*;/);
  });
});
