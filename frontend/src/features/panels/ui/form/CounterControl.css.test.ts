import fs from "fs";
import path from "path";

// GUARD (not behavioural proof; jsdom has no layout): HEL-1804's real proof is e2e/hel1791-compact-counter-stack-height.
// This only keeps the CSS source shape: an EMPTY alert/status region leaves flex flow via `position: absolute` and is
// never hidden from the accessibility tree.

const css = fs.readFileSync(path.join(__dirname, "CounterControl.css"), "utf-8");

function ruleBody(selectorSubstring: string): string {
  const at = css.indexOf(selectorSubstring);
  if (at === -1) throw new Error(`Selector "${selectorSubstring}" not found`);
  const open = css.indexOf("{", at);
  return css.slice(open + 1, css.indexOf("}", open));
}

describe("CounterControl.css - HEL-1804 empty live regions (guard)", () => {
  const selector =
    ".form-panel-view__compact-counter > :is(.form-panel-view__alert, .form-panel-view__status):empty";

  it("takes an empty region out of flex flow, scoped to the compact layout", () => {
    expect(ruleBody(selector)).toMatch(/position:\s*absolute\s*;/);
  });

  it("never hides the region from the accessibility tree", () => {
    const body = ruleBody(selector);
    expect(body).not.toMatch(/display\s*:/);
    expect(body).not.toMatch(/visibility\s*:/);
  });

  it("makes the compact layout the containing block", () => {
    expect(ruleBody(".form-panel-view__compact-counter {")).toMatch(/position:\s*relative\s*;/);
  });
});
