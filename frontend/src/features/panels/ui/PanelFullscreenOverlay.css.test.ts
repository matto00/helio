import fs from "fs";
import path from "path";

// HEL-584 design.md Decision 1a / tasks.md 1.3 — Jest's `styleMock.js`
// mocks every `.css` import to an empty object, so a render +
// `getComputedStyle` assertion can never observe this rule; jsdom also
// implements no real layout to measure against even if it could (see
// `PanelDetailModal.css.test.ts`'s and `MarkdownPanel.css.test.ts`'s
// identical rationale). Statically parses the CSS source instead — this
// repo's established convention for a rule real layout can't verify.

const CSS_PATH = path.join(__dirname, "PanelFullscreenOverlay.css");
const css = fs.readFileSync(CSS_PATH, "utf-8");

function findRuleBody(source: string, selectorSubstring: string): string {
  const selectorIndex = source.indexOf(selectorSubstring);
  if (selectorIndex === -1) {
    throw new Error(`Selector containing "${selectorSubstring}" not found in ${CSS_PATH}`);
  }
  const openBrace = source.indexOf("{", selectorIndex);
  const closeBrace = source.indexOf("}", openBrace);
  return source.slice(openBrace + 1, closeBrace);
}

describe("PanelFullscreenOverlay.css — HEL-584 design.md Decision 1a definite height", () => {
  it("gives .panel-fullscreen-overlay a definite height instead of Modal's shrink-to-fit default", () => {
    const body = findRuleBody(css, ".panel-fullscreen-overlay {");
    expect(body).toMatch(/height:\s*min\(90vh,\s*1000px\)\s*;/);
  });

  it("clips content to the dialog's rounded corners at that fixed height", () => {
    const body = findRuleBody(css, ".panel-fullscreen-overlay {");
    expect(body).toMatch(/overflow:\s*hidden\s*;/);
  });

  it("gives the body wrapper a definite height so PanelContent's own flex:1 has a real flex parent", () => {
    const body = findRuleBody(css, ".panel-fullscreen-overlay__body {");
    expect(body).toMatch(/display:\s*flex\s*;/);
    expect(body).toMatch(/height:\s*100%\s*;/);
  });
});
