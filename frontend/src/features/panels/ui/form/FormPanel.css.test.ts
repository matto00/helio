import fs from "fs";
import path from "path";

// GUARD (not behavioural proof; jsdom has no layout): HEL-1819's real proof is e2e/hel1819-form-live-region-gap.
// This only keeps the CSS source shape: an EMPTY alert/status region of the multi-field form leaves flex flow via
// `position: absolute` and is never hidden from the accessibility tree.

const css = fs.readFileSync(path.join(__dirname, "FormPanel.css"), "utf-8");

function ruleBody(selectorSubstring: string): string {
  const at = css.indexOf(selectorSubstring);
  if (at === -1) throw new Error(`Selector "${selectorSubstring}" not found`);
  const open = css.indexOf("{", at);
  return css.slice(open + 1, css.indexOf("}", open));
}

describe("FormPanel.css - HEL-1819 empty live regions (guard)", () => {
  const selector =
    ".form-panel-view__fields > :is(.form-panel-view__alert, .form-panel-view__status):empty";

  it("takes an empty region out of flex flow, scoped to the field stack's direct children", () => {
    expect(ruleBody(selector)).toMatch(/position:\s*absolute\s*;/);
  });

  it("never hides the region from the accessibility tree", () => {
    const body = ruleBody(selector);
    expect(body).not.toMatch(/display\s*:/);
    expect(body).not.toMatch(/visibility\s*:/);
  });

  it("makes the field stack the containing block", () => {
    expect(ruleBody(".form-panel-view__fields {")).toMatch(/position:\s*relative\s*;/);
  });
});
