import fs from "fs";
import path from "path";

// Regression guard for the HEL-245 mobile touch-target fix (skeptic final-gate
// change request #2). jsdom implements no real layout or media-query
// evaluation, so no DOM-rendering Jest test can observe the rendered control
// height at a phone viewport. This test statically asserts the CSS source
// keeps the mobile-scoped ≥44px overrides for the panel-detail Content
// editor's tap targets: the mode toggle (Bind to field / Fixed text), the
// DataType list rows, the type-clear button, and the field select trigger.
//
// The panel detail modal is reachable on mobile by tapping a panel card
// (mobile-viewer-stack spec), so these controls — rendered by the shared
// BoundOrLiteralField / DataTypePicker — must meet the 44px tap-target
// convention (mobile-bottom-nav spec / BottomNav.css) at the mobile-shell
// breakpoint, without touching BoundOrLiteralField logic.

const CSS_PATH = path.join(__dirname, "PanelDetailModal.css");
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

describe("PanelDetailModal.css — mobile ≥44px tap targets (HEL-245)", () => {
  const mobileBlock = findMediaBlock(css, "max-width: 768px");

  it.each([
    [".panel-detail-modal__mode-toggle-btn", "min-height"],
    [".panel-detail-modal__type-option", "min-height"],
    [".panel-detail-modal .ui-select__trigger", "min-height"],
  ])("%s gets min-height: 44px at the mobile-shell breakpoint", (selector) => {
    const body = findRuleBody(mobileBlock, selector);
    expect(body).toMatch(/min-height:\s*44px\s*;/);
  });

  it("the type-clear button gets a 44x44 minimum tap target", () => {
    const body = findRuleBody(mobileBlock, ".panel-detail-modal__type-clear");
    expect(body).toMatch(/min-width:\s*44px\s*;/);
    expect(body).toMatch(/min-height:\s*44px\s*;/);
  });
});

// HEL-303: the modal's own header Edit/Close controls and the footer Save/Cancel
// actions are the entry and exit points of the edit flow reachable by tapping a
// stack panel on phone, so they must also carry the mobile-scoped ≥44px override
// (they sit at --control-sm/--control-md by default, both under 44px).
describe("PanelDetailModal.css — mobile ≥44px tap targets (HEL-303 header/footer)", () => {
  const mobileBlock = findMediaBlock(css, "max-width: 768px");

  it.each([
    [".panel-detail-modal__edit-btn", "min-height"],
    [".panel-detail-modal__btn", "min-height"],
  ])("%s gets min-height: 44px at the mobile-shell breakpoint", (selector) => {
    const body = findRuleBody(mobileBlock, selector);
    expect(body).toMatch(/min-height:\s*44px\s*;/);
  });

  it("the close button gets a 44x44 minimum tap target", () => {
    const body = findRuleBody(mobileBlock, ".panel-detail-modal__close");
    expect(body).toMatch(/min-width:\s*44px\s*;/);
    expect(body).toMatch(/min-height:\s*44px\s*;/);
  });
});

// HEL-255: the Table display controls (density dropdown reuses the shared
// Select — covered above by `.ui-select__trigger`; here we lock the Columns
// visibility rows, the up/down reorder buttons, and the Reset column widths
// action) are also reachable in the panel-detail edit pane on mobile, so they
// must keep the same mobile-scoped ≥44px overrides.
describe("PanelDetailModal.css — mobile ≥44px tap targets (HEL-255 table display)", () => {
  const mobileBlock = findMediaBlock(css, "max-width: 768px");

  it.each([
    [".panel-detail-modal__column-row", "min-height"],
    [".panel-detail-modal__column-visibility", "min-height"],
    [".panel-detail-modal__reset-widths-btn", "min-height"],
  ])("%s gets min-height: 44px at the mobile-shell breakpoint", (selector) => {
    const body = findRuleBody(mobileBlock, selector);
    expect(body).toMatch(/min-height:\s*44px\s*;/);
  });

  it("the column reorder buttons get a 44x44 minimum tap target", () => {
    const body = findRuleBody(mobileBlock, ".panel-detail-modal__column-move-btn");
    expect(body).toMatch(/min-width:\s*44px\s*;/);
    expect(body).toMatch(/min-height:\s*44px\s*;/);
  });
});

// HEL-248: the Chart Display controls (per-type boolean toggle rows and the
// group-spacing / donut-hole sliders) are reachable in the panel-detail edit
// pane on mobile, so they must keep the same mobile-scoped ≥44px overrides.
// The orientation/stacking dropdowns reuse the shared Select — already covered
// above by `.ui-select__trigger`.
describe("PanelDetailModal.css — mobile ≥44px tap targets (HEL-248 chart display)", () => {
  const mobileBlock = findMediaBlock(css, "max-width: 768px");

  it.each([
    [".panel-detail-modal__toggle-row", "min-height"],
    ['.panel-detail-modal__slider input[type="range"]', "min-height"],
  ])("%s gets min-height: 44px at the mobile-shell breakpoint", (selector) => {
    const body = findRuleBody(mobileBlock, selector);
    expect(body).toMatch(/min-height:\s*44px\s*;/);
  });
});

// HEL-303 (cycle 2): the Chart Display checkbox rows (`.panel-detail-modal__chart-label`
// — Show legend / Enable tooltip / Show X/Y-axis label) rendered ~19px tall and
// the Series-color swatches (`input[type="color"]`) 32×28px — both reachable in
// every chart panel's edit flow and both under the 44px minimum. HEL-248's
// toggle-row/slider rules did not cover them; these locks guard the new rules.
describe("PanelDetailModal.css — mobile ≥44px tap targets (HEL-303 chart display gaps)", () => {
  const mobileBlock = findMediaBlock(css, "max-width: 768px");

  it("the chart-label checkbox rows get min-height: 44px at the mobile-shell breakpoint", () => {
    const body = findRuleBody(mobileBlock, ".panel-detail-modal__chart-label");
    expect(body).toMatch(/min-height:\s*44px\s*;/);
  });

  it("the series-color swatches get a 44x44 minimum tap target", () => {
    const body = findRuleBody(
      mobileBlock,
      '.panel-detail-modal__color-swatches input[type="color"]',
    );
    expect(body).toMatch(/min-width:\s*44px\s*;/);
    expect(body).toMatch(/min-height:\s*44px\s*;/);
  });
});

// HEL-247: the Collection editor's grid/list layout segmented buttons are
// reachable in the panel-detail edit pane on mobile, so they must keep the
// same mobile-scoped ≥44px override. The base-type Select and the value/label/
// unit Selects reuse the shared Select (covered by `.ui-select__trigger`), and
// the label/unit mode toggles reuse `.panel-detail-modal__mode-toggle-btn`.
describe("PanelDetailModal.css — mobile ≥44px tap targets (HEL-247 collection editor)", () => {
  const mobileBlock = findMediaBlock(css, "max-width: 768px");

  it("the layout segmented buttons get min-height: 44px at the mobile-shell breakpoint", () => {
    const body = findRuleBody(mobileBlock, ".panel-detail-modal__segmented-btn");
    expect(body).toMatch(/min-height:\s*44px\s*;/);
  });
});
