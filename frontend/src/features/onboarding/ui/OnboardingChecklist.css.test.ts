import fs from "fs";
import path from "path";
import { expectTapExpander } from "../../../shared/ui/tapTargetTestUtils";

// Regression guard for the HEL-554 checklist's mobile tap-target floor.
// jsdom implements no real layout or media-query evaluation, so no
// DOM-rendering Jest test can observe the rendered hit region at a phone
// viewport. `.onboarding-checklist__action` / `.onboarding-checklist__done`
// must reach the literal 44px floor (§3 control metrics) via `min-height` at
// the `<=768px` breakpoint — this repo has regressed that floor six times.
// `UserMenu.css.test.ts` is the precedent this file mirrors.

const CSS_PATH = path.join(__dirname, "OnboardingChecklist.css");
const css = fs.readFileSync(CSS_PATH, "utf-8");

/** Extracts the full body of the first `@media` at-rule whose prelude
 *  contains `preludeSubstring`, brace-matching so nested rule blocks are
 *  included. */
function findMediaBlock(source: string, preludeSubstring: string): string {
  let searchFrom = 0;
  for (;;) {
    const at = source.indexOf("@media", searchFrom);
    if (at === -1) {
      throw new Error(`No @media rule containing "${preludeSubstring}" found in ${CSS_PATH}`);
    }
    const openBrace = source.indexOf("{", at);
    const prelude = source.slice(at, openBrace);
    if (prelude.includes(preludeSubstring)) {
      let depth = 0;
      for (let i = openBrace; i < source.length; i++) {
        if (source[i] === "{") depth++;
        else if (source[i] === "}") {
          depth--;
          if (depth === 0) return source.slice(openBrace + 1, i);
        }
      }
      throw new Error(`Unbalanced braces in @media block in ${CSS_PATH}`);
    }
    searchFrom = openBrace + 1;
  }
}

/** Body of the first flat rule inside `block` whose selector contains
 *  `selectorSubstring`. Assumes flat rules (no nested at-rules). */
function findRuleBody(block: string, selectorSubstring: string): string {
  const selectorIndex = block.indexOf(selectorSubstring);
  if (selectorIndex === -1) {
    throw new Error(`Selector containing "${selectorSubstring}" not found in the media block`);
  }
  const openBrace = block.indexOf("{", selectorIndex);
  const closeBrace = block.indexOf("}", openBrace);
  return block.slice(openBrace + 1, closeBrace);
}

describe("OnboardingChecklist.css — 44px tap-target floor at <=768px (HEL-554)", () => {
  it("the <=768px block clears the 44px floor for both the step action and the done button", () => {
    const mobileBlock = findMediaBlock(css, "max-width: 768px");
    expectTapExpander(mobileBlock, ".onboarding-checklist__action");
  });

  it("the <=768px selector covers both .onboarding-checklist__action and .onboarding-checklist__done", () => {
    const mobileBlock = findMediaBlock(css, "max-width: 768px");
    // The selector list (before the first `{`) must name both classes so
    // neither control silently drops out of the floor.
    const openBrace = mobileBlock.indexOf("{");
    const selectorList = mobileBlock.slice(0, openBrace);
    expect(selectorList).toMatch(/\.onboarding-checklist__action/);
    expect(selectorList).toMatch(/\.onboarding-checklist__done/);
  });

  it("the base (unconditional) action rule declares align-self: flex-start (content-sized width)", () => {
    // Regression guard for the final-gate skeptic finding (skeptic-final-1
    // change request 1): `.onboarding-checklist__step-body` is a column
    // flex container, so an action with no `align-self` stretches to the
    // width of the step's prose above it.
    const selectorIndex = css.indexOf(".onboarding-checklist__action {");
    expect(selectorIndex).toBeGreaterThan(-1);
    const openBrace = css.indexOf("{", selectorIndex);
    const closeBrace = css.indexOf("}", openBrace);
    const body = css.slice(openBrace + 1, closeBrace);
    expect(body).toMatch(/align-self:\s*flex-start\s*;/);
  });
});
