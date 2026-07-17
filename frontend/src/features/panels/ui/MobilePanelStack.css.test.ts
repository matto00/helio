import fs from "fs";
import path from "path";

// Regression guard for the container-type: size collapse (HEL-301 cycle-2
// evaluator fix). jsdom does not implement CSS containment or real layout,
// so no DOM-rendering Jest test can observe the collapse itself — the box
// always reports its jsdom-stubbed dimensions regardless of `container-type`.
// This test instead statically asserts the CSS source never regresses back
// to a state that would reproduce the bug: the intrinsic-height stack item
// classes (table/markdown/text/image) must not carry `container-type: size`
// without an accompanying explicit height source, because `.panel-grid-card`
// (PanelGrid.css) sets `height: 100%` against an auto-height flex parent —
// which resolves to `auto`, and `container-type: size` collapses any box
// with `height: auto` to ~0 content height regardless of its content.
//
// See MobilePanelStack.css's own comment on the
// `.mobile-panel-stack__item--table, ...--markdown, ...--text, ...--image`
// rule for the full explanation.

const CSS_PATH = path.join(__dirname, "MobilePanelStack.css");
const css = fs.readFileSync(CSS_PATH, "utf-8");

/** Extracts the declaration block body for the first rule whose selector
 *  list contains `selectorSubstring` (plain-CSS scan — this file has no
 *  nested at-rules, so brace matching is a simple substring search). */
function findRuleBody(source: string, selectorSubstring: string): string {
  const selectorIndex = source.indexOf(selectorSubstring);
  if (selectorIndex === -1) {
    throw new Error(`Selector containing "${selectorSubstring}" not found in ${CSS_PATH}`);
  }
  const openBrace = source.indexOf("{", selectorIndex);
  const closeBrace = source.indexOf("}", openBrace);
  return source.slice(openBrace + 1, closeBrace);
}

describe("MobilePanelStack.css — intrinsic-height items vs. container-type: size", () => {
  // HEL-303: `collection` is intrinsic (mobilePanelHeights returns height:null,
  // so no `--mobile-panel-height`), so — like table/markdown/text/image — it
  // must override `.panel-grid-card`'s `container-type: size` or it collapses
  // to ~0 content height in the stack.
  const intrinsicKinds = ["table", "markdown", "text", "image", "collection"] as const;

  it.each(intrinsicKinds)("the --%s stack-item rule does not set container-type: size", (kind) => {
    const body = findRuleBody(css, `.mobile-panel-stack__item--${kind}`);
    // The rule must exist and must not declare `container-type: size` —
    // the collapse-triggering value for a box with no explicit height.
    expect(body).not.toMatch(/container-type:\s*size\b/);
  });

  it.each(intrinsicKinds)(
    "the --%s stack-item rule explicitly restores inline-size containment",
    (kind) => {
      // This is the actual guard: the shared `.panel-grid-card` class
      // (PanelGrid.css) sets `container-type: size` unconditionally, so these
      // intrinsic-height stack-item classes must override it, not merely omit
      // `size`. (All five share one selector list, so this asserts the shared
      // rule carries both declarations.)
      const body = findRuleBody(css, `.mobile-panel-stack__item--${kind}`);
      expect(body).toMatch(/container-type:\s*inline-size\s*;/);
      expect(body).toMatch(/height:\s*auto\s*;/);
    },
  );

  it("collection restores intrinsic sizing on its content body (no nested scroller)", () => {
    // CollectionRenderer.css sets `overflow-y: auto` for desktop's fixed-height
    // card; the stack must restore intrinsic height + visible overflow so
    // collection has no internal scroller (mobile-panel-sizing spec).
    const body = findRuleBody(
      css,
      ".mobile-panel-stack__item--collection .panel-content--collection",
    );
    expect(body).toMatch(/height:\s*auto\s*;/);
    expect(body).toMatch(/overflow:\s*visible\s*;/);
  });

  it("metric/chart (which DO get an explicit --mobile-panel-height) are unaffected", () => {
    const body = findRuleBody(css, ".mobile-panel-stack__item--metric");
    expect(body).toMatch(/height:\s*var\(--mobile-panel-height\)\s*;/);
    // No container-type override needed here — these kinds have a real,
    // explicit height source, so container-type: size (inherited from
    // .panel-grid-card) is safe.
    expect(body).not.toMatch(/container-type/);
  });
});
