import fs from "fs";
import path from "path";

// Regression guard for the HEL-319 mobile touch-target convention, carried
// forward onto the shared IconButton primitive (HEL-718). jsdom implements
// no real layout or media-query evaluation, so no DOM-rendering Jest test can
// observe the rendered control size at a phone viewport. This test statically
// asserts the CSS source keeps the mobile-scoped ≥44px floor for `.ui-icon-btn`
// — previously locked per-recipe in `Modal.css.test.ts` (`.ui-modal__close`)
// before that recipe consolidated here. See `EmptyState.css.test.ts` /
// `inputs.css.test.ts` for the precedent this reuses.

const CSS_PATH = path.join(__dirname, "IconButton.css");
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

describe("IconButton.css — mobile ≥44px tap targets (HEL-319/718)", () => {
  const mobileBlock = findMediaBlock(css, "max-width: 768px");

  // The floor is met by a 44x44 ::after hit expander, NOT by inflating the
  // painted box (which made every icon-only control read as oversized chrome
  // on phones). Same pattern as `.user-menu__trigger::after` (HEL-772).
  it("the icon button reaches the 44px floor via a hit expander, not by growing the painted box", () => {
    const body = findRuleBody(mobileBlock, ".ui-icon-btn::after");
    expect(body).toMatch(/width:\s*44px\s*;/);
    expect(body).toMatch(/height:\s*44px\s*;/);
    expect(body).toMatch(/position:\s*absolute\s*;/);
    expect(findRuleBody(mobileBlock, ".ui-icon-btn {")).toMatch(/position:\s*relative\s*;/);
  });

  // Without this the expander resolves against the nearest positioned
  // ancestor and the enlarged target lands somewhere else entirely.
  it("the expander's containing block is the button itself", () => {
    expect(findRuleBody(mobileBlock, ".ui-icon-btn {")).toMatch(/position:\s*relative\s*;/);
  });

  // Queried against the whole file, not `mobileBlock`: this rule lives in its
  // own width-gated block (phone chrome, not a touch affordance), while the
  // block above is touch-gated. Both preludes start `@media (max-width:
  // 768px)`, so a first-match media lookup would return the wrong one.
  it("the bordered variants go borderless on phones", () => {
    const body = findRuleBody(css, ".ui-icon-btn--secondary,");
    expect(body).toMatch(/border-color:\s*transparent\s*;/);
  });

  // The borderless rule must NOT pick up the touch gate — an iPad has room
  // for the desktop treatment and should keep its hairlines.
  it("the borderless rule is width-gated, while the tap-target rule is touch-gated", () => {
    expect(css).toMatch(/@media \(max-width: 768px\), \(pointer: coarse\) \{/);
    const borderlessIndex = css.indexOf(".ui-icon-btn--secondary,");
    const gateBefore = css.lastIndexOf("@media", borderlessIndex);
    expect(css.slice(gateBefore, borderlessIndex)).not.toMatch(/pointer: coarse/);
  });
});
