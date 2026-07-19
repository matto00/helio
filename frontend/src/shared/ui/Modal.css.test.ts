import fs from "fs";
import path from "path";

// Regression guard for the HEL-319 mobile touch-target fix. jsdom implements no
// real layout or media-query evaluation, so no DOM-rendering Jest test can
// observe the rendered control height at a phone viewport. This test
// statically asserts the CSS source keeps the mobile-scoped ≥44px overrides
// for the shared Modal chrome (`.ui-modal__close`, `.ui-modal-btn`).
//
// The shared Modal is used app-wide, reachable on phone via the bottom-nav
// create/empty-state routes, so its close button and footer buttons must meet
// the 44px tap-target convention (MobileNavSheet.css / PanelDetailModal.css's
// mobile block) at the mobile-shell breakpoint, without touching Modal.tsx
// logic or desktop density (the rules live inside a `max-width: 768px` media
// block). See `inputs.css.test.ts` for the precedent this reuses.

const CSS_PATH = path.join(__dirname, "Modal.css");
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

describe("Modal.css — mobile ≥44px tap targets (HEL-319)", () => {
  const mobileBlock = findMediaBlock(css, "max-width: 768px");

  it("the close button gets min-width and min-height: 44px at the mobile-shell breakpoint", () => {
    const body = findRuleBody(mobileBlock, ".ui-modal__close");
    expect(body).toMatch(/min-width:\s*44px\s*;/);
    expect(body).toMatch(/min-height:\s*44px\s*;/);
  });

  it("the footer buttons get min-height: 44px at the mobile-shell breakpoint", () => {
    const body = findRuleBody(mobileBlock, ".ui-modal-btn");
    expect(body).toMatch(/min-height:\s*44px\s*;/);
  });
});
