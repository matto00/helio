import fs from "node:fs";
import path from "node:path";

const css = fs.readFileSync(path.join(__dirname, "FirstRunDropZone.css"), "utf-8");

/** The declaration block of the rule whose selector starts a line. Plain string search, so no
 *  selector text is ever interpreted as a pattern. */
function ruleBody(selector: string): string {
  const start = css.split("\n").findIndex((line) => line.startsWith(`${selector} {`));
  if (start === -1) throw new Error(`no rule for ${selector}`);
  const rest = css.split("\n").slice(start + 1);
  const end = rest.findIndex((line) => line.startsWith("}"));
  return rest.slice(0, end).join("\n");
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
