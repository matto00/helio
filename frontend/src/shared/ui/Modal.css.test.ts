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

/** Body of the first rule in `source` whose selector contains
 *  `selectorSubstring`, brace-matching so nested rule blocks (e.g. a
 *  `@keyframes` block's `from`/`to` steps) are included. */
function findRuleBodyInSource(source: string, selectorSubstring: string): string {
  const selectorIndex = source.indexOf(selectorSubstring);
  if (selectorIndex === -1) {
    throw new Error(`Selector containing "${selectorSubstring}" not found in ${CSS_PATH}`);
  }
  const openBrace = source.indexOf("{", selectorIndex);
  let depth = 0;
  for (let i = openBrace; i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}") {
      depth--;
      if (depth === 0) return source.slice(openBrace + 1, i);
    }
  }
  throw new Error(`Unbalanced braces for selector "${selectorSubstring}" in ${CSS_PATH}`);
}

// Regression guard for HEL-313: a popover (Select) portalled into an open
// dialog was mispositioned when the dialog's `[open]` entrance animation ran
// with `animation-fill-mode: both`/`forwards` — a lingering fill keeps the
// dialog as a `transform` containing block, re-anchoring any
// `position: fixed` popover to the dialog's box instead of the viewport.
// jsdom implements no real CSS animation evaluation, so this is a static
// source assertion (see the shipped fix, commit d7fb3816). HEL-716: this
// guard previously lived in `PanelCreationModal.css.test.ts` for that
// modal's own now-deleted `[open]` animation; `PanelCreationModal` (and
// `PanelDetailModal`) now both animate in via this shared `.ui-modal[open]`
// rule, so the regression coverage moved here with them.
describe("Modal.css — [open] entrance animation leaves no containing-block transform (HEL-313)", () => {
  it("the [open] entrance animation uses a `backwards` fill mode, not `both`/`forwards`", () => {
    const body = findRuleBodyInSource(css, ".ui-modal[open]");
    const animationDeclaration = body.match(/animation:[^;]+;/)?.[0];
    expect(animationDeclaration).toBeDefined();
    expect(animationDeclaration).toMatch(/\bbackwards\b/);
    expect(animationDeclaration).not.toMatch(/\bboth\b/);
    expect(animationDeclaration).not.toMatch(/\bforwards\b/);
  });

  it("the animation's `to` keyframe resolves to `transform: none` (resting state is unchanged)", () => {
    const keyframesBody = findRuleBodyInSource(css, "@keyframes ui-modal-in");
    const toBody = findRuleBodyInSource(keyframesBody, "to {");
    expect(toBody).toMatch(/transform:\s*none\s*;/);
  });
});

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
