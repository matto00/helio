import fs from "fs";
import path from "path";
import { expectTapExpander } from "../ui/tapTargetTestUtils";

// Regression guards for HEL-773's top-anchored sheet, plus the pre-existing
// HEL-303 mobile touch-target fix. jsdom implements no real layout or
// media-query evaluation, so no DOM-rendering Jest test can observe the
// rendered anchor position or row height at a phone viewport. These tests
// statically assert the CSS source, mirroring the read-file +
// findMediaBlock/findRuleBody scan used by `PanelDetailModal.css.test.ts`,
// `MobilePanelStack.css.test.ts`, and `BottomNav.css.test.ts` (the ordering-
// lock precedent this file follows for the new 44px selectors).

const CSS_PATH = path.join(__dirname, "MobileNavSheet.css");
const cssWithComments = fs.readFileSync(CSS_PATH, "utf-8");
// Comments routinely name the rejected alternative (e.g. "NOT --app-surface-
// strong") — exactly the substring a negative assertion below might trip on.
// Strip comments before matching so prose can't trigger a false failure.
const css = cssWithComments.replace(/\/\*[\s\S]*?\*\//g, "");

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

/** Body (brace-matched) of the first flat rule in `source` whose selector
 *  contains `selectorSubstring`. */
function findRuleBody(source: string, selectorSubstring: string): string {
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
  throw new Error(`Unbalanced braces reading rule "${selectorSubstring}" in ${CSS_PATH}`);
}

const mobileBlock = findMediaBlock(css, "max-width: 768px");

describe("MobileNavSheet.css — top anchor (HEL-773 design.md D1)", () => {
  it("the clip wrapper anchors to the top-chrome seam", () => {
    const wrapperBody = findRuleBody(css, ".mobile-nav-sheet__clip {");
    expect(wrapperBody).toMatch(/top:\s*var\(--app-top-chrome-height\)\s*;/);
  });

  it("the panel gets NO `top` of its own", () => {
    // Repeating the token on the panel would be a RELATIVE offset from an
    // already-correct in-flow position (the panel is `position: relative`
    // inside the wrapper), pushing the sheet a second seam-height down — the
    // exact bug an earlier draft shipped and round-4 review caught.
    // Negative lookbehind (not `\b`) so `border-top: none` doesn't
    // false-positive — `\b` matches the `-`/`t` boundary inside
    // "border-top" too.
    const panelBody = findRuleBody(css, ".mobile-nav-sheet__panel {");
    expect(panelBody).not.toMatch(/(?<![-\w])top:/);
  });

  it("every LAYOUT `top:` declaration in the file uses the same top-chrome-seam token — the wrapper (anchor, D1) and the backdrop (scrim start, D2), nothing else", () => {
    // The create action's tap expander (`::after`) also declares a `top`, but
    // it is a self-centring offset inside its own button, not a page anchor —
    // it cannot detach the sheet from the seam, which is the regression this
    // guards. Excluded by rule rather than by loosening the assertion, so a
    // stray `top` on any real layout element still fails.
    const layoutCss = css.replace(/[^{}]*::after\s*\{[^}]*\}/g, "");
    const topDeclarations = layoutCss.match(/(?<![-\w])top:\s*[^;]+;/g) ?? [];
    expect(topDeclarations).toHaveLength(2);
    for (const declaration of topDeclarations) {
      expect(declaration).toBe("top: var(--app-top-chrome-height);");
    }
  });

  it("the panel is position: relative inside the wrapper, not position: fixed", () => {
    const panelBody = findRuleBody(css, ".mobile-nav-sheet__panel {");
    expect(panelBody).toMatch(/position:\s*relative\s*;/);
    expect(panelBody).not.toMatch(/position:\s*fixed\s*;/);
  });

  it("no `env(safe-area-inset-top)` occurrence anywhere in the stylesheet", () => {
    expect(cssWithComments).not.toMatch(/env\(safe-area-inset-top/);
  });

  it("no bottom-nav token appears in the top anchor declaration specifically", () => {
    const wrapperBody = findRuleBody(css, ".mobile-nav-sheet__clip {");
    const topLine = wrapperBody.match(/top:\s*[^;]+;/)?.[0] ?? "";
    expect(topLine).not.toMatch(/--bottom-nav/);
  });

  it("the panel carries no lingering padding-bottom: env(safe-area-inset-bottom)", () => {
    expect(cssWithComments).not.toMatch(/padding-bottom:\s*env\(safe-area-inset-bottom\)/);
  });
});

describe("MobileNavSheet.css — clip wrapper stacking (HEL-773 design.md D3)", () => {
  it("the wrapper is position: fixed, spans full width, and clips only its top edge", () => {
    const wrapperBody = findRuleBody(css, ".mobile-nav-sheet__clip {");
    expect(wrapperBody).toMatch(/position:\s*fixed\s*;/);
    expect(wrapperBody).toMatch(/left:\s*0\s*;/);
    expect(wrapperBody).toMatch(/right:\s*0\s*;/);
    expect(wrapperBody).toMatch(/clip-path:\s*inset\(0\s+-100vmax\s+-100vmax\s+-100vmax\)\s*;/);
  });

  it("the wrapper sits at the shared --z-popover layer and lets pointer events pass through to the backdrop", () => {
    const wrapperBody = findRuleBody(css, ".mobile-nav-sheet__clip {");
    expect(wrapperBody).toMatch(/z-index:\s*var\(--z-popover\)\s*;/);
    expect(wrapperBody).toMatch(/pointer-events:\s*none\s*;/);
  });

  it("the panel re-enables pointer events so it stays interactive inside the pointer-events:none wrapper", () => {
    const panelBody = findRuleBody(css, ".mobile-nav-sheet__panel {");
    expect(panelBody).toMatch(/pointer-events:\s*auto\s*;/);
  });
});

describe("MobileNavSheet.css — scrim stops at the seam (HEL-773 design.md D2)", () => {
  it("the backdrop starts at the top-chrome seam, not inset: 0", () => {
    const backdropBody = findRuleBody(css, ".mobile-nav-sheet__backdrop {");
    expect(backdropBody).toMatch(/top:\s*var\(--app-top-chrome-height\)\s*;/);
    expect(backdropBody).not.toMatch(/inset:\s*0\s*;/);
    expect(backdropBody).toMatch(/left:\s*0\s*;/);
    expect(backdropBody).toMatch(/right:\s*0\s*;/);
    expect(backdropBody).toMatch(/bottom:\s*0\s*;/);
  });
});

describe("MobileNavSheet.css — entrance direction (HEL-773 design.md D1)", () => {
  it("the entrance keyframe originates above the resting position (translateY(-100%) -> 0)", () => {
    const keyframeStart = css.indexOf("@keyframes mobile-nav-sheet-in");
    expect(keyframeStart).toBeGreaterThan(-1);
    const keyframeBody = findRuleBody(css.slice(keyframeStart), "mobile-nav-sheet-in");
    expect(keyframeBody).toMatch(/from\s*\{\s*transform:\s*translateY\(-100%\)\s*;\s*\}/);
    expect(keyframeBody).toMatch(/to\s*\{\s*transform:\s*translateY\(0\)\s*;\s*\}/);
  });
});

describe("MobileNavSheet.css — height clears the floating bottom nav (HEL-773 design.md D5)", () => {
  it("max-height consumes the aggregate --bottom-nav-height token, not its three inputs re-inlined", () => {
    const panelBody = findRuleBody(css, ".mobile-nav-sheet__panel {");
    expect(panelBody).toMatch(
      /max-height:\s*calc\(\s*100dvh\s*-\s*var\(--app-top-chrome-height\)\s*-\s*var\(--bottom-nav-height\)\s*-\s*var\(--space-3\)\s*\)\s*;/,
    );
    expect(panelBody).not.toMatch(/--bottom-nav-capsule-height/);
    expect(panelBody).not.toMatch(/--bottom-nav-inset/);
    expect(panelBody).not.toMatch(/env\(safe-area-inset-bottom\)/);
  });
});

describe("MobileNavSheet.css — reduced motion (HEL-773 design.md D12)", () => {
  it("the reduced-motion block covers the panel, backdrop, and clip wrapper", () => {
    const body = findMediaBlock(css, "prefers-reduced-motion: reduce");
    expect(body).toMatch(/\.mobile-nav-sheet__panel/);
    expect(body).toMatch(/\.mobile-nav-sheet__backdrop/);
    expect(body).toMatch(/\.mobile-nav-sheet__clip/);
    expect(body).toMatch(/animation:\s*none\s*;/);
  });

  it("the reduced-motion override is positioned AFTER the base panel animation rule (source order, equal specificity)", () => {
    const baseIndex = css.indexOf(".mobile-nav-sheet__panel {");
    const reducedMotionIndex = css.indexOf("prefers-reduced-motion: reduce");
    expect(reducedMotionIndex).toBeGreaterThan(baseIndex);
  });
});

describe("MobileNavSheet.css — drag strip at the bottom free edge (HEL-773 design.md D4)", () => {
  it("the drag strip gets a literal 44px min-height, unconditionally", () => {
    const body = findRuleBody(css, ".mobile-nav-sheet__drag-strip {");
    expect(body).toMatch(/min-height:\s*44px\s*;/);
    expect(body).toMatch(/touch-action:\s*none\s*;/);

    // Declared exactly once — a later equal-specificity rule (e.g. inside a
    // later @media block) could otherwise silently shadow it (the HEL-535
    // defect class BottomNav.css.test.ts guards the same way).
    const occurrences = css.split(".mobile-nav-sheet__drag-strip {").length - 1;
    expect(occurrences).toBe(1);
  });
});

describe("MobileNavSheet.css — mobile ≥44px sheet rows and create action (HEL-303/HEL-773)", () => {
  it("the sheet-row rule gets min-height: 44px at the mobile-shell breakpoint, declared exactly once inside that block", () => {
    const body = findRuleBody(mobileBlock, ".mobile-nav-sheet__item");
    expect(body).toMatch(/min-height:\s*44px\s*;/);

    // Scoped to the mobile block specifically (not the whole file): the
    // BASE rule outside this @media legitimately shares the same selector
    // (min-height: var(--control-lg), the unscoped default it overrides) —
    // the HEL-535 risk this guards is a SECOND, later-declared 44px rule at
    // equal specificity silently winning over this one.
    const occurrences = mobileBlock.split(".mobile-nav-sheet__item {").length - 1;
    expect(occurrences).toBe(1);
  });

  it("the header create action clears the 44px floor, declared exactly once inside that block", () => {
    expectTapExpander(mobileBlock, ".mobile-nav-sheet__create-action");

    const occurrences = mobileBlock.split(".mobile-nav-sheet__create-action {").length - 1;
    expect(occurrences).toBe(1);
  });

  // The action is a full-width section action, not a centred pill: the row
  // must stretch it AND the button must be block-level to fill that width —
  // an `inline-flex` child ignores `align-items: stretch` on its parent, so
  // both halves are load-bearing and each is guarded here.
  it("the header create action spans the sheet's full width", () => {
    const rowBody = findRuleBody(css, ".mobile-nav-sheet__header-action-row");
    expect(rowBody).toMatch(/align-items:\s*stretch\s*;/);

    const btnBody = findRuleBody(css, ".mobile-nav-sheet__create-action");
    expect(btnBody).toMatch(/display:\s*flex\s*;/);
    expect(btnBody).toMatch(/width:\s*100%\s*;/);
  });
});
