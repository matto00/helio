import fs from "fs";
import path from "path";
import { expectTapExpander } from "./tapTargetTestUtils";

// Regression guard for the HEL-319 mobile touch-target fix. jsdom implements no
// real layout or media-query evaluation, so no DOM-rendering Jest test can
// observe the rendered control height at a phone viewport. This test
// statically asserts the CSS source keeps the mobile-scoped ≥44px override
// for the shared Modal footer buttons (`.ui-modal-btn`).
//
// The shared Modal is used app-wide, reachable on phone via the bottom-nav
// create/empty-state routes, so its footer buttons must meet the 44px
// tap-target convention (MobileNavSheet.css / PanelDetailModal.css's mobile
// block) at the mobile-shell breakpoint, without touching Modal.tsx logic or
// desktop density (the rule lives inside a `max-width: 768px` media block).
// See `inputs.css.test.ts` for the precedent this reuses. HEL-718: the close
// button's own mobile floor moved with it onto the shared IconButton
// primitive — see `IconButton.css.test.ts`.

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

  it("the footer buttons clear the 44px floor at the mobile-shell breakpoint", () => {
    expectTapExpander(mobileBlock, ".ui-modal-btn");
  });
});

// Regression guard for HEL-746: at 390×844, live-verified via Playwright that
// tapping "Open assistant" (QuickLauncherOverlay) or "Review proposal"
// (the pipeline/dashboard/patch-set review Modals) with content taller than
// the dialog's `max-height: 90vh` rendered a blank area with just a
// horizontal line. Root cause: `.ui-modal` never declares an explicit
// `height`, only `max-height`; per CSS, a percentage `height` on a child
// (`.ui-modal__inner`'s prior `height: 100%`, from HEL-716) only resolves
// against an ancestor with a *definite* height, and `max-height` alone
// doesn't establish one for a `display: block` ancestor — so it silently
// fell back to content-driven `auto`. Once content overflowed 90vh, the
// inner flex column grew past the dialog's real box, the header/footer lost
// their fixed pinning, and the dialog itself (native `overflow: auto`)
// became the scroll container for the whole header+body+footer stack. A
// consumer with auto-scroll-to-latest behavior (the assistant panel's
// `scrollIntoView({block: "end"})`) then scrolled that oversized column to
// an arbitrary position, landing on a mostly-blank slice.
//
// The fix makes `.ui-modal[open]` the flex container and `.ui-modal__inner`
// a `flex: 1 1 auto; min-height: 0` item instead — flex layout resolves a
// definite size for its item directly from the container's own box
// (`max-height` included), sidestepping the percentage-resolution rule
// entirely. jsdom has no real layout engine (no `max-height`/flex box-model
// resolution), so this is a static source assertion, mirroring this file's
// existing HEL-313/HEL-319 guards above.
describe("Modal.css — .ui-modal__inner is a bounded flex item, not a height:100% block child (HEL-746)", () => {
  it(".ui-modal[open] establishes the flex container .ui-modal__inner sizes against", () => {
    const body = findRuleBodyInSource(css, ".ui-modal[open]");
    expect(body).toMatch(/display:\s*flex\s*;/);
    expect(body).toMatch(/flex-direction:\s*column\s*;/);
  });

  it(".ui-modal__inner is a flex item with min-height: 0, not a height: 100% block child", () => {
    const body = findRuleBodyInSource(css, ".ui-modal__inner {");
    expect(body).toMatch(/flex:\s*1 1 auto\s*;/);
    expect(body).toMatch(/min-height:\s*0\s*;/);
    // The exact bug this regresses to: a plain percentage height silently
    // resolves to `auto` against `.ui-modal`'s `max-height`-only box.
    expect(body).not.toMatch(/height:\s*100%\s*;/);
  });
});
