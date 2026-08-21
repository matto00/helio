import fs from "fs";
import path from "path";

// Regression guard for the HEL-772 cycle-2 defect: the `<=430px` full-screen
// header's top-inset treatment must be ADDITIVE, not a bare substitution.
// `--app-safe-top` falls back to `0px` where the browser reports no top
// inset (every Android device, every desktop-width browser, an iPhone with
// no top inset today) -- a bare `padding-top: var(--app-safe-top)` silently
// overrides Modal.css:116's `padding: var(--space-4) var(--space-5)` and
// drops the header's 16px top padding to 0 in exactly those cases. jsdom
// implements no real layout or media-query evaluation, so no DOM-rendering
// Jest test can observe the rendered header padding at a phone viewport --
// this statically locks the source declaration instead, mirroring
// App.css.test.ts / theme.css.test.ts's read-file + regex pattern.

const CSS_PATH = path.join(__dirname, "PanelDetailModal.mobile.css");
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

describe("PanelDetailModal.mobile.css — the <=430px header inset is additive (HEL-772 cycle 2)", () => {
  const mobileBlock = findMediaBlock(css, "max-width: 430px");

  it("claims --app-safe-top ADDED to Modal.css's own --space-4 top padding, not a bare substitution", () => {
    const body = findRuleBody(mobileBlock, ".ui-modal.panel-detail-modal .ui-modal__header");
    expect(body).toMatch(
      /padding-top:\s*calc\(var\(--app-safe-top\)\s*\+\s*var\(--space-4\)\)\s*;/,
    );
    // The regression this guards against: a bare substitution that would
    // silently zero the header's base padding wherever the browser reports
    // no top inset.
    expect(body).not.toMatch(/padding-top:\s*var\(--app-safe-top\)\s*;/);
  });
});
