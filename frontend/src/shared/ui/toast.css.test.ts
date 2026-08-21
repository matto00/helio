import fs from "fs";
import path from "path";

// HEL-535 D4 — static source guards for the toast surface's token/motion/
// mobile contract. jsdom implements no real layout, animation, or
// media-query evaluation, so none of this is observable via a DOM-rendering
// Jest test; these assert directly against the CSS source, mirroring the
// established `shared/ui/*.css.test.ts` convention (see `Modal.css.test.ts`,
// `IconButton.css.test.ts`). Note: `.toast-viewport`'s `width: 340px` is an
// expected, allowed literal (no spacing token maps to it) — not something
// these guards flag.

const CSS_PATH = path.join(__dirname, "toast.css");
const css = fs.readFileSync(CSS_PATH, "utf-8");

/** Body of the first rule in `source` whose selector contains
 *  `selectorSubstring`. Assumes flat rules. */
function findRuleBodyInSource(source: string, selectorSubstring: string): string {
  const selectorIndex = source.indexOf(selectorSubstring);
  if (selectorIndex === -1) {
    throw new Error(`Selector containing "${selectorSubstring}" not found in ${CSS_PATH}`);
  }
  const openBrace = source.indexOf("{", selectorIndex);
  const closeBrace = source.indexOf("}", openBrace);
  return source.slice(openBrace + 1, closeBrace);
}

/** Finds the first `@media` at-rule whose prelude contains `preludeSubstring`
 *  AND whose body contains `bodySelector` — scans every `@media` block with
 *  a matching prelude (not just the first), which `toast.css` needs: it has
 *  TWO separate `@media (max-width: 768px)` blocks (one for
 *  `.toast-viewport`, one for `.toast__close`), deliberately not merged —
 *  see the CR1 comment in toast.css. Returns the block's body and the
 *  source index of its own `@media` keyword, so a caller can compare that
 *  position against another rule's (evaluation-1.md CR2). */
function findMediaBlockFor(
  source: string,
  preludeSubstring: string,
  bodySelector: string,
): { body: string; start: number } {
  let searchFrom = 0;
  for (;;) {
    const at = source.indexOf("@media", searchFrom);
    if (at === -1) {
      throw new Error(
        `No @media rule containing "${preludeSubstring}" with a "${bodySelector}" rule found in ${CSS_PATH}`,
      );
    }
    const openBrace = source.indexOf("{", at);
    const prelude = source.slice(at, openBrace);
    if (!prelude.includes(preludeSubstring)) {
      searchFrom = openBrace + 1;
      continue;
    }
    let depth = 0;
    let blockEnd = -1;
    for (let i = openBrace; i < source.length; i++) {
      if (source[i] === "{") depth++;
      else if (source[i] === "}") {
        depth--;
        if (depth === 0) {
          blockEnd = i;
          break;
        }
      }
    }
    if (blockEnd === -1) {
      throw new Error(`Unbalanced braces in @media block in ${CSS_PATH}`);
    }
    const body = source.slice(openBrace + 1, blockEnd);
    if (body.includes(bodySelector)) {
      return { body, start: at };
    }
    searchFrom = blockEnd + 1;
  }
}

describe("toast.css — entrance uses the §3 entrance token, not the hover token", () => {
  it(".toast's entrance animation uses --transition-slow", () => {
    const body = findRuleBodyInSource(css, ".toast {");
    const animationDeclaration = body.match(/animation:[^;]+;/)?.[0];
    expect(animationDeclaration).toBeDefined();
    expect(animationDeclaration).toMatch(/--transition-slow/);
    expect(animationDeclaration).not.toMatch(/--app-transition\b/);
  });

  it(".toast--exiting's duration is a named custom property, not a bare literal", () => {
    const body = findRuleBodyInSource(css, ".toast--exiting {");
    const animationDeclaration = body.match(/animation:[^;]+;/)?.[0];
    expect(animationDeclaration).toBeDefined();
    expect(animationDeclaration).toMatch(/--toast-exit-duration/);
    expect(animationDeclaration).not.toMatch(/\b0\.2s\b/);
  });
});

describe("toast.css — reduced motion disables animation outright (not just shortens it)", () => {
  it("both .toast and .toast--exiting get animation: none", () => {
    const { body } = findMediaBlockFor(css, "prefers-reduced-motion: reduce", ".toast");
    expect(body).toMatch(/\.toast\s*,\s*\n?\s*\.toast--exiting\s*\{/);
    expect(body).toMatch(/animation:\s*none\s*;/);
  });
});

describe("toast.css — mobile (≤768px) clears BottomNav", () => {
  it(".toast-viewport is offset above --bottom-nav-height at the mobile-shell breakpoint", () => {
    const { body } = findMediaBlockFor(css, "max-width: 768px", ".toast-viewport");
    expect(body).toMatch(/bottom:\s*calc\(var\(--bottom-nav-height\)/);
  });
});

// evaluation-1.md CR1/CR2 — the 44px floor was previously declared in a
// `@media` block placed BEFORE the base `.toast__close` rule. Both selectors
// have equal specificity (0,1,0), so the cascade resolves by source order
// regardless of whether the query matches — the override was dead code, and
// the old version of this test (asserting only the override's TEXT
// contained `44px`) passed anyway, so it could not have caught the
// regression. This guard is order-aware: it fails unless the override's
// `@media` block is source-ordered AFTER the base rule.
describe("toast.css — .toast__close's 44px mobile floor is source-ordered after its base rule (evaluation-1.md CR1/CR2 regression guard)", () => {
  it("the base .toast__close rule precedes the 44px mobile override in source order", () => {
    const baseRuleIndex = css.indexOf(".toast__close {");
    expect(baseRuleIndex).toBeGreaterThan(-1);
    const { start: mediaBlockStart } = findMediaBlockFor(css, "max-width: 768px", ".toast__close");
    expect(mediaBlockStart).toBeGreaterThan(baseRuleIndex);
  });

  it("the mobile override sets the 44px floor", () => {
    const { body } = findMediaBlockFor(css, "max-width: 768px", ".toast__close");
    expect(body).toMatch(/width:\s*44px\s*;/);
    expect(body).toMatch(/height:\s*44px\s*;/);
  });

  // skeptic-final-1.md CR3 — DESIGN.md §3 Spacing caps literal optical
  // tweaks at 4px; -12px is 3x that, so it must resolve through --space-3
  // (12px) rather than a bare literal. The 44px width/height above are
  // exempt (DESIGN.md:130 explicitly blesses that literal).
  it("the margin is expressed via --space-3, not a bare -12px literal", () => {
    const { body } = findMediaBlockFor(css, "max-width: 768px", ".toast__close");
    const marginDeclaration = body.match(/margin:[^;]+;/)?.[0];
    expect(marginDeclaration).toBeDefined();
    expect(marginDeclaration).toMatch(/calc\(var\(--space-3\)\s*\*\s*-1\)/);
    expect(marginDeclaration).not.toMatch(/-12px/);
  });
});

describe("toast.css — .toast__close stays 20px above the mobile breakpoint (DESIGN.md §5)", () => {
  it("the base (non-media-query) rule keeps the 20px sub-24px hand-rolled size", () => {
    // `.toast__close {` first appears as the base rule itself (the mobile
    // override's block is source-ordered after it — see the guard above),
    // so the plain first-match lookup is correct here.
    const body = findRuleBodyInSource(css, ".toast__close {");
    expect(body).toMatch(/width:\s*20px\s*;/);
    expect(body).toMatch(/height:\s*20px\s*;/);
  });
});
