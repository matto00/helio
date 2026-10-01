import fs from "node:fs";
import path from "node:path";

const css = fs.readFileSync(path.join(__dirname, "FirstRunDropZone.css"), "utf-8");

function ruleBody(selector: string): string {
  const escaped = selector.replace(/[.>]/g, "\\$&");
  const match = new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`).exec(css);
  if (!match) throw new Error(`no rule for ${selector}`);
  return match[1];
}

describe("FirstRunDropZone.css", () => {
  // `align-self: flex-start` on the shared button rule beat the drop target's `align-items: center`
  // and left-aligned the primary "Choose a file" button under its centered text.
  it("does not left-align every button: the shared button rule sets no align-self", () => {
    expect(ruleBody(".first-run-drop__button")).not.toMatch(/align-self/);
  });

  it("left-aligns only the direct-child (ghost) button of the card", () => {
    expect(ruleBody(".first-run-drop > .first-run-drop__button")).toMatch(
      /align-self:\s*flex-start/,
    );
  });
});
