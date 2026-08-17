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
  it("lays the 8 presets out as a deterministic 4-column grid, not a wrapping flex row", () => {
    const body = findRuleBody(css, ".accent-picker");
    expect(body).toMatch(/display:\s*grid\s*;/);
    expect(body).toMatch(/grid-template-columns:\s*repeat\(4,\s*20px\)\s*;/);
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
