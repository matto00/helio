import fs from "fs";
import path from "path";

// Regression guard for the F-006 mobile-footer fix. jsdom implements no real
// layout or media-query evaluation, so no DOM-rendering Jest test can
// observe the rendered geometry at a 430px viewport (verified live instead —
// see the audit's fix screenshots). This test statically asserts the CSS
// source keeps the 430px footer-wrap treatment and the 44px tap-target
// convention (BottomNav.css / PanelDetailModal.mobile.css) for the footer's
// action buttons and the step-card header's icon buttons.
//
// Mirrors the brace-matching helpers in
// `../../panels/ui/PanelDetailModal.css.test.ts`.

const CSS_PATH = path.join(__dirname, "PipelineDetailPage.css");
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

describe("PipelineDetailPage.css — phone footer wrap + reachability (F-006)", () => {
  const phoneBlock = findMediaBlock(css, "max-width: 430px");
  // F-131 consolidated the footer buttons' 44px tap-target floor into the
  // existing `@media (max-width: 768px)` block (DESIGN.md's floor applies
  // at *both* 430 and 768, matching Modal.css/inputs.css's convention of one
  // 768px rule rather than a duplicate 430px-scoped copy) — the min-height
  // assertions below moved from `phoneBlock` to `tabletBlock` accordingly.
  // The 430px block still owns the *layout* rules (stacking, wrap, run-btn
  // full-width) that only apply below 768px.
  const tabletBlock = findMediaBlock(css, "max-width: 768px");

  it("the footer stacks vertically instead of clipping sideways", () => {
    const body = findRuleBody(phoneBlock, ".pipeline-detail-page__footer {");
    expect(body).toMatch(/flex-direction:\s*column\s*;/);
  });

  it("the action-button row wraps instead of overflowing past the viewport edge", () => {
    const body = findRuleBody(phoneBlock, ".pipeline-detail-page__footer-right");
    expect(body).toMatch(/flex-wrap:\s*wrap\s*;/);
  });

  it("Run pipeline is full-width on phone and meets the 44px tap minimum (via the 768px floor)", () => {
    const phoneBody = findRuleBody(phoneBlock, ".pipeline-detail-page__run-btn");
    expect(phoneBody).toMatch(/width:\s*100%\s*;/);
    const tabletBody = findRuleBody(tabletBlock, ".pipeline-detail-page__run-btn");
    expect(tabletBody).toMatch(/min-height:\s*44px\s*;/);
  });

  // design.md D8 (scope amendment): `__history-btn`/`__preview-btn` dropped
  // from this list — D7 replaced those buttons with `ActionsMenu` menuitems,
  // which no longer carry these class names at all (removed from
  // PipelineDetailPage.css entirely). `ActionsMenu.css.test.ts` already
  // covers the 44px floor for `.actions-menu__trigger`/`.actions-menu__item`
  // independently. `__dry-run-btn` remains a real, always-visible button
  // under D7 and must keep passing this exact assertion unchanged.
  it.each([".pipeline-detail-page__dry-run-btn"])(
    "%s meets the 44px tap minimum at both the 768px and 430px breakpoints",
    (selector) => {
      const body = findRuleBody(tabletBlock, selector);
      expect(body).toMatch(/min-height:\s*44px\s*;/);
    },
  );

  it.each([
    ".pipeline-detail-page__step-card-drag-handle",
    ".pipeline-detail-page__step-card-move-btn",
    ".pipeline-detail-page__step-card-toggle-enabled-btn",
    ".pipeline-detail-page__step-card-duplicate-btn",
  ])("%s (step-card header icon button) gets a 44x44 tap target on phone", (selector) => {
    const body = findRuleBody(phoneBlock, selector);
    expect(body).toMatch(/width:\s*44px\s*;/);
    expect(body).toMatch(/height:\s*44px\s*;/);
  });
});
