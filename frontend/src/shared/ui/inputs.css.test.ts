import fs from "fs";
import path from "path";

// Regression guard for the HEL-308 mobile touch-target fix. jsdom implements no
// real layout or media-query evaluation, so no DOM-rendering Jest test can
// observe the rendered option-row height at a phone viewport. This test
// statically asserts the CSS source keeps the mobile-scoped ≥44px override for
// the shared Select popover option rows (`.ui-select__option`).
//
// The shared Select is used widely (field pickers, dropdowns across the app),
// all reachable on phone, so its option rows must meet the 44px tap-target
// convention (MobileNavSheet.css / PanelDetailModal.css's mobile block) at the
// mobile-shell breakpoint, without touching Select.tsx logic or desktop
// density (the rule lives inside a `max-width: 768px` media block).

const CSS_PATH = path.join(__dirname, "inputs.css");
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

describe("inputs.css — mobile ≥44px tap targets (HEL-308)", () => {
  const mobileBlock = findMediaBlock(css, "max-width: 768px");

  it("the Select option rows get min-height: 44px at the mobile-shell breakpoint", () => {
    const body = findRuleBody(mobileBlock, ".ui-select__option");
    expect(body).toMatch(/min-height:\s*44px\s*;/);
  });

  it("the Select option rows switch to flex centering so the label stays vertically centered", () => {
    const body = findRuleBody(mobileBlock, ".ui-select__option");
    expect(body).toMatch(/display:\s*flex\s*;/);
    expect(body).toMatch(/align-items:\s*center\s*;/);
  });
});
