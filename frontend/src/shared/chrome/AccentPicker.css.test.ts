import fs from "fs";
import path from "path";

// Regression guard for F-169. jsdom implements no real layout/paint, so no
// DOM-rendering Jest test can observe the swatch row's actual wrap behavior
// or whether a box-shadow ring visually disappears against its surface —
// this statically asserts the CSS source keeps the fixed 4-column grid and
// the ring color matched to the popover surface it always renders inside.

const CSS_PATH = path.join(__dirname, "AccentPicker.css");
const css = fs.readFileSync(CSS_PATH, "utf-8");

function findRuleBody(source: string, selector: string): string {
  const selectorIndex = source.indexOf(`${selector} {`);
  if (selectorIndex === -1) {
    throw new Error(`Selector "${selector}" not found in ${CSS_PATH}`);
  }
  const openBrace = source.indexOf("{", selectorIndex);
  const closeBrace = source.indexOf("}", openBrace);
  return source.slice(openBrace + 1, closeBrace);
}

describe("AccentPicker.css — F-169", () => {
  it("lays the 8 presets out as a deterministic grid (one row of 8 above 768px, 4 columns at 768px and below), not a wrapping flex row", () => {
    const body = findRuleBody(css, ".accent-picker");
    expect(body).toMatch(/display:\s*grid\s*;/);
    expect(body).toMatch(/grid-template-columns:\s*repeat\(8,\s*28px\)\s*;/);
  });

  it("uses a --space-* token for the swatch-row gap, not a literal px value", () => {
    const body = findRuleBody(css, ".accent-picker");
    expect(body).toMatch(/gap:\s*var\(--space-\d+\)\s*;/);
    expect(body).not.toMatch(/gap:\s*\d+px/);
  });

  it("rings the surface the picker actually renders inside (UserMenu's popover), not the page background", () => {
    const focusBody = findRuleBody(css, ".accent-picker__swatch:focus-visible");
    const selectedBody = findRuleBody(css, ".accent-picker__swatch--selected");
    for (const body of [focusBody, selectedBody]) {
      expect(body).toMatch(/0 0 0 2px var\(--app-surface-strong\)/);
      expect(body).not.toMatch(/var\(--app-bg\)/);
    }
  });
});

// HEL-1572: the swatches are 28px painted circles whose 44x44 hit expanders never overlap and never scale.
describe("AccentPicker.css — HEL-1572 tap floor", () => {
  const {
    expectTapExpander,
    findMediaBlock,
    findRuleBody: ruleBody,
  } = jest.requireActual<typeof import("../ui/tapTargetTestUtils")>("../ui/tapTargetTestUtils");

  it("sizes the expander 44x44 on BOTH axes, on touch layouts", () => {
    expectTapExpander(
      findMediaBlock(css, "max-width: 768px), (pointer: coarse"),
      ".accent-picker__swatch",
      "square",
    );
  });

  it("keeps adjacent expanders from overlapping: swatch + gap is at least the 44px expander", () => {
    const grid = ruleBody(css, ".accent-picker");
    const swatch = Number(/repeat\(8,\s*(\d+)px\)/.exec(grid)![1]);
    expect(swatch).toBe(28);
    expect(grid).toMatch(/gap:\s*var\(--space-4\)/); // 16px: 28 + 16 = 44px pitch
  });

  it("scales the inner painted dot on hover, never the swatch (a swatch transform would scale the expander)", () => {
    expect(css).toMatch(
      /\.accent-picker__swatch:hover \.accent-picker__dot\s*\{\s*transform:\s*scale/,
    );
    expect(css).not.toMatch(/\.accent-picker__swatch:hover\s*\{[^}]*transform/);
  });

  it("drops to 4 columns at 768px and below, with the same 28px swatch and gap", () => {
    const media = findMediaBlock(css, "max-width: 768px");
    expect(ruleBody(media, ".accent-picker")).toMatch(
      /grid-template-columns:\s*repeat\(4,\s*28px\)/,
    );
  });
});
