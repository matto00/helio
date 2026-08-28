import fs from "fs";
import path from "path";
import { expectTapExpander } from "../../../../shared/ui/tapTargetTestUtils";

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

describe("PanelDetailModal.css — mobile ≥44px tap targets (HEL-245)", () => {
  const mobileBlock = findMediaBlock(css, "max-width: 768px");

  // A picker ROW and a select trigger legitimately grow to 44px — the phone
  // idiom for a list row, and legibility for a text-bearing control. Only the
  // compact painted buttons moved to the expander (`shared/ui/tapTarget.css`).
  it.each([
    [".panel-detail-modal__type-option", "min-height"],
    [".panel-detail-modal .ui-select__trigger", "min-height"],
  ])("%s gets min-height: 44px at the mobile-shell breakpoint", (selector) => {
    const body = findRuleBody(mobileBlock, selector);
    expect(body).toMatch(/min-height:\s*44px\s*;/);
  });

  it("the mode-toggle button clears the 44px floor", () => {
    expectTapExpander(mobileBlock, ".panel-detail-modal__mode-toggle-btn");
  });

  it("the type-clear button clears a 44x44 tap target", () => {
    expectTapExpander(mobileBlock, ".panel-detail-modal__type-clear", "square");
  });
});

// HEL-303: the modal's own header Edit control and the footer Save/Cancel
// actions are the entry and exit points of the edit flow reachable by tapping a
// stack panel on phone, so they must also carry the mobile-scoped ≥44px override
// (they sit at --control-sm/--control-md by default, both under 44px).
//
// HEL-716: the header close button is no longer PanelDetailModal's own markup
// — it's Modal's generic close control. HEL-718: that control now uses the
// shared `IconButton` primitive, so its mobile 44x44 tap-target lock lives in
// `shared/ui/IconButton.css` and is guarded by `shared/ui/IconButton.css.test.ts`
// instead of here.
describe("PanelDetailModal.css — mobile ≥44px tap targets (HEL-303 header/footer)", () => {
  const mobileBlock = findMediaBlock(css, "max-width: 768px");

  // The footer actions still grow to 44px — they are the primary controls on
  // a full-bleed footer, where the size reads as deliberate.
  it(".panel-detail-modal__btn clears the 44px floor at the mobile-shell breakpoint", () => {
    expectTapExpander(mobileBlock, ".panel-detail-modal__btn");
  });

  // The header Edit control does NOT: growing it made a secondary action the
  // tallest thing in the header. It reaches the same floor through a hit
  // expander instead (the `.user-menu__trigger::after` pattern, HEL-772).
  it(".panel-detail-modal__edit-btn reaches the 44px floor via a hit expander, not a taller box", () => {
    const body = findRuleBody(mobileBlock, ".panel-detail-modal__edit-btn::after");
    expect(body).toMatch(/height:\s*44px\s*;/);
    expect(body).toMatch(/position:\s*absolute\s*;/);
    expect(findRuleBody(mobileBlock, ".panel-detail-modal__edit-btn {")).toMatch(
      /position:\s*relative\s*;/,
    );
  });

  // Modal.css's base `align-items: flex-start` exists for stacked
  // title+description headers; this header has a single-line title, so it
  // left the title floating above its taller sibling controls.
  // In the 430px full-screen block, NOT the tap-target block: above this
  // width the modal is a centred card whose header keeps the shared
  // `align-items: flex-start` alignment.
  it("the full-screen header centers its items so the title aligns with its controls", () => {
    const phoneBlock = findMediaBlock(css, "max-width: 430px");
    const body = findRuleBody(phoneBlock, ".ui-modal.panel-detail-modal .ui-modal__header,");
    expect(body).toMatch(/align-items:\s*center\s*;/);
  });
});

// HEL-255: the Table display controls (density dropdown reuses the shared
// Select — covered above by `.ui-select__trigger`; here we lock the Columns
// visibility rows, the up/down reorder buttons, and the Reset column widths
// action) are also reachable in the panel-detail edit pane on mobile, so they
// must keep the same mobile-scoped ≥44px overrides.
describe("PanelDetailModal.css — mobile ≥44px tap targets (HEL-255 table display)", () => {
  const mobileBlock = findMediaBlock(css, "max-width: 768px");

  // Rows stay at a real 44px (see the note above); the buttons expand.
  it.each([
    [".panel-detail-modal__column-row", "min-height"],
    [".panel-detail-modal__column-visibility", "min-height"],
  ])("%s gets min-height: 44px at the mobile-shell breakpoint", (selector) => {
    const body = findRuleBody(mobileBlock, selector);
    expect(body).toMatch(/min-height:\s*44px\s*;/);
  });

  it("the reset-widths button clears the 44px floor", () => {
    expectTapExpander(mobileBlock, ".panel-detail-modal__reset-widths-btn");
  });

  it("the column reorder buttons clear a 44x44 tap target", () => {
    expectTapExpander(mobileBlock, ".panel-detail-modal__column-move-btn", "square");
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

  it("the layout segmented buttons clear the 44px floor", () => {
    expectTapExpander(mobileBlock, ".panel-detail-modal__segmented-btn");
  });
});
