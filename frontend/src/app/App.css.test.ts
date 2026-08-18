import fs from "fs";
import path from "path";

// Regression guard for the HEL-746 phone-only "New chat" affordance. jsdom
// implements no real layout or media-query evaluation, so no DOM-rendering
// Jest test can observe the rendered visibility of
// `.app-command-bar__mobile-new-chat` at a phone viewport — `CommandBar.
// test.tsx` covers the React-conditional half (`pickerId === "chat"`
// gating + the dispatch); this covers the CSS half, mirroring the read-file
// + findMediaBlock/findRuleBody(InSource) scan used by
// `Modal.css.test.ts`/`MobileNavSheet.css.test.ts`.

const CSS_PATH = path.join(__dirname, "App.css");
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

/** Body of the first rule in `source` (outside any @media block scan) whose
 *  selector contains `selectorSubstring`. Stops at the first top-level match,
 *  which is the default (non-media) rule since it's declared before the
 *  media-scoped override in App.css. */
function findRuleBodyInSource(source: string, selectorSubstring: string): string {
  const selectorIndex = source.indexOf(selectorSubstring);
  if (selectorIndex === -1) {
    throw new Error(`Selector containing "${selectorSubstring}" not found in ${CSS_PATH}`);
  }
  const openBrace = source.indexOf("{", selectorIndex);
  const closeBrace = source.indexOf("}", openBrace);
  return source.slice(openBrace + 1, closeBrace);
}

describe("App.css — phone-only 'New chat' affordance visibility (HEL-746)", () => {
  it("is hidden by default (desktop)", () => {
    const body = findRuleBodyInSource(css, ".app-command-bar__mobile-new-chat");
    expect(body).toMatch(/display:\s*none\s*;/);
  });

  it("is shown at the mobile-shell breakpoint, mirroring .app-command-bar__mobile-title", () => {
    const mobileBlock = findMediaBlock(css, "max-width: 768px");
    const body = findRuleBody(mobileBlock, ".app-command-bar__mobile-new-chat");
    expect(body).toMatch(/display:\s*inline-flex\s*;/);
  });
});
