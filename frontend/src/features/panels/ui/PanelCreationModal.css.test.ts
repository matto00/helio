import fs from "fs";
import path from "path";

// Regression guard for HEL-313: the chart-type Select popover portalled into
// this dialog was mispositioned ~283px on mobile because
// `.panel-creation-modal[open]`'s entrance animation ran with
// `animation-fill-mode: both`. jsdom implements no real layout or CSS
// animation evaluation, so no DOM-rendering Jest test can observe the
// dialog's computed `transform` at rest. This test statically asserts the
// CSS source keeps the `backwards` fill mode — a lingering `both`/`forwards`
// fill would keep the dialog as a `transform` containing block, re-anchoring
// any `position: fixed` popover (Select) portalled into it to the dialog's
// box instead of the viewport. Mirrors the shipped `Modal.css` fix
// (commit d7fb3816) and its `ActionsMenu.css.test.ts` static-assertion
// pattern.

const CSS_PATH = path.join(__dirname, "PanelCreationModal.css");
const css = fs.readFileSync(CSS_PATH, "utf-8");

/** Body of the first rule in `source` whose selector contains
 *  `selectorSubstring`, brace-matching so nested rule blocks (e.g. a
 *  `@keyframes` block's `from`/`to` steps) are included. */
function findRuleBody(source: string, selectorSubstring: string): string {
  const selectorIndex = source.indexOf(selectorSubstring);
  if (selectorIndex === -1) {
    throw new Error(`Selector containing "${selectorSubstring}" not found in ${CSS_PATH}`);
  }
  const openBrace = source.indexOf("{", selectorIndex);
  let depth = 0;
  for (let i = openBrace; i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}") {
      depth--;
      if (depth === 0) return source.slice(openBrace + 1, i);
    }
  }
  throw new Error(`Unbalanced braces for selector "${selectorSubstring}" in ${CSS_PATH}`);
}

describe("PanelCreationModal.css — dialog leaves no containing-block transform (HEL-313)", () => {
  it("the [open] entrance animation uses a `backwards` fill mode, not `both`/`forwards`", () => {
    const body = findRuleBody(css, ".panel-creation-modal[open]");
    const animationDeclaration = body.match(/animation:[^;]+;/)?.[0];
    expect(animationDeclaration).toBeDefined();
    expect(animationDeclaration).toMatch(/\bbackwards\b/);
    expect(animationDeclaration).not.toMatch(/\bboth\b/);
    expect(animationDeclaration).not.toMatch(/\bforwards\b/);
  });

  it("the animation's `to` keyframe resolves to `transform: none` (resting state is unchanged)", () => {
    const keyframesBody = findRuleBody(css, "@keyframes panel-creation-modal-in");
    const toBody = findRuleBody(keyframesBody, "to {");
    expect(toBody).toMatch(/transform:\s*none\s*;/);
  });
});
