import fs from "fs";
import path from "path";

// Regression guard for HEL-528's reduced-motion requirement. jsdom evaluates no media
// queries, so no DOM-rendering Jest test can observe the rendered animation state under
// `prefers-reduced-motion: reduce`. This test statically asserts the CSS source disables
// the shimmer outright (the `animation` shorthand, or `animation-name`, set to `none` — NOT
// merely `animation-duration`/`-iteration-count`, which theme.css's global rule already sets
// with `!important` and would silently no-op a duration-based mitigation here) and falls back
// to a flat, non-gradient background, plus that no literal colour/duration leaked into the
// stylesheet. See `EmptyState.css.test.ts` for the `findMediaBlock` precedent this reuses.

const CSS_PATH = path.join(__dirname, "Skeleton.css");
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

describe("Skeleton.css — reduced motion (HEL-528)", () => {
  const reducedMotionBlock = findMediaBlock(css, "prefers-reduced-motion: reduce");

  it("disables the animation outright via the shorthand or animation-name (not duration/iteration-count alone)", () => {
    const body = findRuleBody(reducedMotionBlock, ".ui-skeleton");
    expect(body).toMatch(/animation(-name)?:\s*none\s*;/);
    expect(body).not.toMatch(/animation-duration/);
    expect(body).not.toMatch(/animation-iteration-count/);
  });

  it("falls back to a flat, non-gradient background", () => {
    const body = findRuleBody(reducedMotionBlock, ".ui-skeleton");
    expect(body).toMatch(/background:\s*var\(--app-surface-soft\)\s*;/);
    expect(body).not.toMatch(/gradient/);
  });
});

describe("Skeleton.css — token-only styling (DESIGN.md §3)", () => {
  // Strip comments before scanning for literals — this file's comments legitimately
  // discuss theme.css's `0.01ms` global mitigation by name; that prose isn't a
  // declaration and shouldn't trip the literal-duration guard below.
  const declarationsOnly = css.replace(/\/\*[\s\S]*?\*\//g, "");

  it("contains no hardcoded hex/rgb colour", () => {
    expect(declarationsOnly).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(declarationsOnly).not.toMatch(/rgba?\(\s*\d/);
  });

  it("contains no literal animation duration outside a custom property", () => {
    // Every duration used by the shimmer animation must come from `--app-skeleton-shimmer`,
    // not a literal like `1.6s`.
    expect(declarationsOnly).toMatch(
      /animation:\s*ui-skeleton-shimmer\s+var\(--app-skeleton-shimmer\)/,
    );
    expect(declarationsOnly).not.toMatch(/\d+(\.\d+)?m?s\b(?!\s*[),])/);
  });

  it("the shimmer background references only neutral surface tokens, never accent", () => {
    expect(declarationsOnly).not.toMatch(/--app-accent/);
    expect(declarationsOnly).toMatch(/--app-surface-soft/);
    expect(declarationsOnly).toMatch(/--app-surface-raised/);
  });
});
