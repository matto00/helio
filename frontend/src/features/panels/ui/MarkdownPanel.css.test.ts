import fs from "fs";
import path from "path";

// Regression guard for F-038: `.markdown-panel` scrolls internally
// (`overflow: auto`) with zero visual hint that more content exists below —
// jsdom implements no real layout, so no DOM-rendering Jest test can observe
// scrollHeight vs. clientHeight or an actual painted gradient. This
// statically asserts the CSS source keeps the shared scroll-affordance
// recipe (see the comment on `.panel-content--collection` in
// `renderers/CollectionRenderer.css` for the full rationale): a themed thin
// scrollbar plus the position-aware "scroll shadow" background layers.

const CSS_PATH = path.join(__dirname, "MarkdownPanel.css");
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

describe("MarkdownPanel.css — F-038 scroll affordance", () => {
  it("styles a themed thin scrollbar on the scrolling element", () => {
    const body = findRuleBody(css, ".markdown-panel {");
    expect(body).toMatch(/scrollbar-width:\s*thin\s*;/);
  });

  it("layers a position-aware scroll-shadow background (local covers over fixed shadows)", () => {
    const body = findRuleBody(css, ".markdown-panel {");
    expect(body).toMatch(/background-attachment:\s*local,\s*local,\s*scroll,\s*scroll\s*;/);
  });
});
