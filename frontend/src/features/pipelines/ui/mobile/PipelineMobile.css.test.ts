import fs from "fs";
import path from "path";

import { expectTapExpander, findRuleBody } from "../../../../shared/ui/tapTargetTestUtils";

// HEL-1582: static guard for the phone pipeline page's 44px touch floor, using the repo's tap-expander utilities
// (`shared/ui/tapTargetTestUtils`). jsdom has no layout, so the rendered floor is proven live by
// `e2e/hel1582-mobile-pipeline.spec.ts` (hit-extent bisection); this keeps the CSS pattern from regressing between
// e2e runs: every compact painted control declares `position: relative` plus an explicit 44px `::after` expander
// (above later siblings, `z-index`), and every full-width list control is painted at least 44px.

const read = (file: string) => fs.readFileSync(path.join(__dirname, file), "utf-8");
const css = read("PipelineMobile.css");

/** The bodies of every `@media (max-width: 768px), (pointer: coarse)` block, concatenated (the file has several). */
function touchBlocks(source: string): string {
  const out: string[] = [];
  let from = 0;
  for (;;) {
    const at = source.indexOf("@media (max-width: 768px), (pointer: coarse)", from);
    if (at === -1) return out.join("\n");
    const open = source.indexOf("{", at);
    let depth = 0;
    for (let i = open; i < source.length; i++) {
      if (source[i] === "{") depth += 1;
      if (source[i] === "}") {
        depth -= 1;
        if (depth === 0) {
          out.push(source.slice(open + 1, i));
          from = i + 1;
          break;
        }
      }
    }
  }
}

// Prettier wraps long selectors; collapse the line breaks so a selector reads as one string.
const flat = (text: string) => text.replace(/\s*\n\s*/g, " ");
const touch = flat(touchBlocks(css));

describe("PipelineMobile.css touch floor", () => {
  it.each([
    ".mobile-btn",
    ".mobile-pill",
    ".mobile-header__status .spine-header__chip",
    ".pipeline-spine--phone .spine-card__name-btn",
    ".pipeline-spine--phone .spine-ghost-btn",
  ])("%s keeps its painted size and takes a 44px hit expander", (selector) => {
    expectTapExpander(touch, selector);
    expect(findRuleBody(touch, `${selector}::after`)).toMatch(/z-index:\s*1\s*;/);
  });

  it("the step editors' buttons take the same expander, centred and at least 44px wide (icon-only included)", () => {
    const selector =
      ".mobile-step-sheet__content button:not(.ui-icon-btn, .popover__trigger, .ui-select__trigger)";
    expect(findRuleBody(touch, selector)).toMatch(/position:\s*relative\s*;/);
    const expander = findRuleBody(touch, `${selector}::after`);
    expect(expander).toMatch(/height:\s*44px\s*;/);
    expect(expander).toMatch(/width:\s*max\(100%,\s*44px\)\s*;/);
    expect(expander).toMatch(/z-index:\s*1\s*;/);
  });

  it("the back link is painted at the control token and reaches 44px by a centred ::after expander, not an inflated box", () => {
    const body = findRuleBody(css, ".mobile-header__back");
    expect(body).toMatch(/width:\s*var\(--control-md\)\s*;/);
    expect(body).toMatch(/height:\s*var\(--control-md\)\s*;/);
    expect(findRuleBody(touch, ".mobile-header__back")).toMatch(/position:\s*relative\s*;/);
    const expander = findRuleBody(touch, ".mobile-header__back::after");
    expect(expander).toMatch(/width:\s*44px\s*;/);
    expect(expander).toMatch(/height:\s*44px\s*;/);
    expect(expander).toMatch(/z-index:\s*1\s*;/);
  });

  it("the status line clears the expanders above it, and the rename field is painted at the floor", () => {
    expect(findRuleBody(touch, ".mobile-header__status")).toMatch(
      /margin-top:\s*var\(--space-1\)\s*;/,
    );
    expect(findRuleBody(touch, ".mobile-header .mobile-header__name-input")).toMatch(
      /min-height:\s*44px\s*;/,
    );
  });

  it("the segmented choices keep clear of their neighbours' expanders, labels are at least 44 wide, and the body contains the hidden headings", () => {
    expect(
      findRuleBody(touch, ".mobile-step-sheet__content .pipeline-detail-page__filter-combinator"),
    ).toMatch(/margin-block:\s*var\(--space-3\)\s*;/);
    expect(touch).toMatch(/label:has\([^{]*\{[^}]*min-width:\s*44px;/);
    expect(findRuleBody(css, ".mobile-body")).toMatch(/position:\s*relative\s*;/);
  });

  it("the step preview's disclosure trigger takes a 44px expander inside the clip, and the schema filter is a 44px field", () => {
    const preview = fs.readFileSync(path.join(__dirname, "../spine/StepPreviewTable.css"), "utf-8");
    const previewTouch = touchBlocks(preview);
    expect(
      findRuleBody(previewTouch, ".step-preview__header:has(.output-schema-disclosure__trigger)"),
    ).toMatch(/padding-block:\s*var\(--space-4\)\s*;/);
    expectTapExpander(previewTouch, ".step-preview__header .output-schema-disclosure__trigger");
    const viewer = fs.readFileSync(
      path.join(__dirname, "../../../../shared/ui/SchemaFieldViewer.css"),
      "utf-8",
    );
    expect(findRuleBody(touchBlocks(viewer), ".schema-field-viewer__filter")).toMatch(
      /min-height:\s*44px\s*;/,
    );
  });

  it("text fields and checkbox/radio labels in the editors are painted 44px tall", () => {
    expect(touch).toMatch(/:is\(input, select, textarea\)[^{]*\{\s*min-height:\s*44px;/);
    expect(touch).toMatch(/label:has\([^{]*\{[^}]*min-height:\s*44px;/);
  });

  it("full-width list controls are painted at their floor: tabs 44px, rows 60px, the add row 44px", () => {
    expect(findRuleBody(css, ".mobile-tabs__tab")).toMatch(/height:\s*44px;/);
    expect(findRuleBody(css, ".spine-row--phone .spine-row__select")).toMatch(
      /min-height:\s*60px;/,
    );
    expect(findRuleBody(css, ".spine-add-row")).toMatch(/min-height:\s*44px;/);
  });

  it("neighbouring expanders do not overlap: the sheet header and the add / segmented controls are spaced", () => {
    expect(touch).toMatch(/\.mobile-step-sheet \.ui-modal__header\s*\{\s*gap:\s*var\(--space-4\)/);
    expect(touch).toMatch(/\[class\*="-add-btn"\]\s*\{\s*margin-top:\s*var\(--space-4\)/);
    expect(touch).toMatch(/filter-combinator\s*\{[^}]*row-gap:\s*var\(--space-5\)/);
  });
});

describe("RunHistoryModal.css touch floor (the Runs tab's Show log toggle)", () => {
  it("the compact toggle takes a 44px hit expander on touch", () => {
    const runCss = read("../RunHistoryModal.css");
    const block = flat(touchBlocks(runCss));
    expectTapExpander(block, ".run-history-modal__row-toggle");
    expect(findRuleBody(block, ".run-history-modal__row-toggle::after")).toMatch(
      /z-index:\s*1\s*;/,
    );
  });
});
