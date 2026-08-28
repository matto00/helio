/**
 * Shared assertions for the mobile tap-target expander documented in
 * `shared/ui/tapTarget.css`.
 *
 * These guards previously asserted `min-height: 44px` on each control. That
 * pinned the OLD implementation (inflate the painted box) rather than the
 * PROPERTY that actually matters (the control clears a 44px touch target), so
 * every stylesheet that moved to the expander broke a test that was, by then,
 * asserting the wrong thing. Asserting the pattern here keeps the floor
 * guarded while leaving the mechanism free to change in one place.
 *
 * `position: relative` on the control is checked as rigorously as the
 * expander's size: without it the pseudo-element resolves against the nearest
 * positioned ancestor and the enlarged hit region lands somewhere else on the
 * page — a failure mode no screenshot or render test would catch.
 */

/**
 * Extracts the body of the first rule whose selector LIST contains `selector`.
 *
 * Matches the selector only where it is followed by `,` or `{` — i.e. as a
 * complete entry in a selector list. A plain `indexOf` would miss the common
 * grouped form (`.a,\n  .b {`), where `".a {"` never appears literally, and
 * would also match `.a` inside `.a::after` or `.a-suffix`.
 */
export function findRuleBody(block: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`${escaped}\\s*(?:,[^{]*)?\\{`).exec(block);
  if (match === null) {
    throw new Error(`Selector containing "${selector}" not found`);
  }
  const openBrace = block.indexOf("{", match.index);
  const closeBrace = block.indexOf("}", openBrace);
  return block.slice(openBrace + 1, closeBrace);
}

/** Extracts the body of the first `@media (<condition>)` block. */
export function findMediaBlock(css: string, condition: string): string {
  const start = css.indexOf(`@media (${condition})`);
  if (start === -1) {
    throw new Error(`Media block "${condition}" not found`);
  }
  const openBrace = css.indexOf("{", start);
  let depth = 0;
  for (let i = openBrace; i < css.length; i += 1) {
    if (css[i] === "{") depth += 1;
    if (css[i] === "}") {
      depth -= 1;
      if (depth === 0) return css.slice(openBrace + 1, i);
    }
  }
  throw new Error(`Unbalanced braces in media block "${condition}"`);
}

/**
 * Asserts `selector` clears the 44px floor via the expander pattern.
 *
 * `shape: "strip"` (default) is the full-width form for labeled buttons — the
 * horizontal target tracks the label, so only `height` is pinned.
 * `shape: "square"` is the centered 44x44 form for icon-only controls, where
 * both axes must be pinned because there is no label to widen the box.
 */
export function expectTapExpander(
  mobileBlock: string,
  selector: string,
  shape: "strip" | "square" = "strip",
): void {
  expect(findRuleBody(mobileBlock, selector)).toMatch(/position:\s*relative\s*;/);

  const expander = findRuleBody(mobileBlock, `${selector}::after`);
  expect(expander).toMatch(/content:\s*""\s*;/);
  expect(expander).toMatch(/position:\s*absolute\s*;/);
  expect(expander).toMatch(/height:\s*44px\s*;/);
  if (shape === "square") {
    expect(expander).toMatch(/width:\s*44px\s*;/);
  }
}
