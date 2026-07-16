import fs from "fs";
import path from "path";

// Regression guard for the HEL-245 mobile touch-target fix (skeptic final-gate
// change request #2). jsdom implements no real layout or media-query
// evaluation, so no DOM-rendering Jest test can observe the rendered control
// height at a phone viewport. This test statically asserts the CSS source
// keeps the mobile-scoped ≥44px overrides for the panel-detail Content
// editor's tap targets: the mode toggle (Bind to field / Fixed text), the
// DataType list rows, the type-clear button, and the field select trigger.
//
// The panel detail modal is reachable on mobile by tapping a panel card
// (mobile-viewer-stack spec), so these controls — rendered by the shared
// BoundOrLiteralField / DataTypePicker — must meet the 44px tap-target
// convention (mobile-bottom-nav spec / BottomNav.css) at the mobile-shell
// breakpoint, without touching BoundOrLiteralField logic.

const CSS_PATH = path.join(__dirname, "PanelDetailModal.css");
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

describe("PanelDetailModal.css — mobile ≥44px tap targets (HEL-245)", () => {
  const mobileBlock = findMediaBlock(css, "max-width: 768px");

  it.each([
    [".panel-detail-modal__mode-toggle-btn", "min-height"],
    [".panel-detail-modal__type-option", "min-height"],
    [".panel-detail-modal .ui-select__trigger", "min-height"],
  ])("%s gets min-height: 44px at the mobile-shell breakpoint", (selector) => {
    const body = findRuleBody(mobileBlock, selector);
    expect(body).toMatch(/min-height:\s*44px\s*;/);
  });

  it("the type-clear button gets a 44x44 minimum tap target", () => {
    const body = findRuleBody(mobileBlock, ".panel-detail-modal__type-clear");
    expect(body).toMatch(/min-width:\s*44px\s*;/);
    expect(body).toMatch(/min-height:\s*44px\s*;/);
  });
});
