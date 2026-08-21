import fs from "fs";
import path from "path";

// Regression guard for the HEL-772 mobile command-bar hit-target expander on
// the user-menu avatar trigger. jsdom implements no real layout or
// media-query evaluation, so no DOM-rendering Jest test can observe the
// rendered hit region at a phone viewport. `.user-menu__trigger` is a
// PAINTED control (border + circular background) that must stay at its
// --control-sm (28px) box per the product owner's explicit decision
// (design.md Decision 8) and reach the 44px floor only through a sized
// ::after, never `min-width`/`min-height` (which would grow the box).
//
// This file ALREADY has an existing `<=768px` block (the `.user-menu__item`
// 44px floor, HEL-319) -- a first-match `findMediaBlock`/`findRuleBody` helper
// reads the same (only) media block correctly here, but the assertions below
// must target `.user-menu__trigger` specifically, not accidentally match
// `.user-menu__item`.

const CSS_PATH = path.join(__dirname, "UserMenu.css");
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

/** Body of the first rule in `source` (outside any @media block) whose
 *  selector contains `selectorSubstring`. */
function findRuleBodyInSource(source: string, selectorSubstring: string): string {
  const selectorIndex = source.indexOf(selectorSubstring);
  if (selectorIndex === -1) {
    throw new Error(`Selector containing "${selectorSubstring}" not found in ${CSS_PATH}`);
  }
  const openBrace = source.indexOf("{", selectorIndex);
  const closeBrace = source.indexOf("}", openBrace);
  return source.slice(openBrace + 1, closeBrace);
}

describe("UserMenu.css — trigger stays --control-sm, reaches 44px via a sized ::after (HEL-772)", () => {
  it("the base (unconditional) trigger rule declares position: relative", () => {
    const body = findRuleBodyInSource(css, ".user-menu__trigger {");
    expect(body).toMatch(/position:\s*relative\s*;/);
  });

  it("the base trigger rule keeps a var(--control-sm) painted box, not 44px", () => {
    const body = findRuleBodyInSource(css, ".user-menu__trigger {");
    expect(body).toMatch(/width:\s*var\(--control-sm\)\s*;/);
    expect(body).toMatch(/height:\s*var\(--control-sm\)\s*;/);
  });

  it("the <=768px block declares a 44x44px ::after hit expander for .user-menu__trigger", () => {
    const mobileBlock = findMediaBlock(css, "max-width: 768px");
    const body = findRuleBody(mobileBlock, ".user-menu__trigger::after");
    expect(body).toMatch(/width:\s*44px\s*;/);
    expect(body).toMatch(/height:\s*44px\s*;/);
  });

  it("the <=768px block still keeps .user-menu__item's own 44px min-height floor (HEL-319)", () => {
    const mobileBlock = findMediaBlock(css, "max-width: 768px");
    const body = findRuleBody(mobileBlock, ".user-menu__item {");
    expect(body).toMatch(/min-height:\s*44px\s*;/);
  });
});
