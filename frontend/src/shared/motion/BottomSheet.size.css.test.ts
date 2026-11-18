import fs from "fs";
import path from "path";

// HEL-1746 task 3.0. Jest maps `*.css` to a stub (jest.config.cjs), so no jsdom render can observe the phone sheet's width:
// a test that only reads class names would pass vacuously. This guard reads the CSS source instead, and the real width
// (the sheet fills the viewport at phone width) is asserted in a real browser by `e2e/hel1746-ask-ui.spec.ts`.
//
// The contract: `BottomSheet` passes a `size` to `Modal` (above 768px the dialog takes that size), and at or below 768px
// `.ui-modal.bottom-sheet` (two classes, specificity 0,2,0) sets width/max-width 100% and so beats every single-class
// `.ui-modal--*` size rule whatever the source order, with no `!important`.

const stripComments = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, "");
const sheetCss = stripComments(fs.readFileSync(path.join(__dirname, "BottomSheet.css"), "utf-8"));
const modalCss = stripComments(fs.readFileSync(path.join(__dirname, "../ui/Modal.css"), "utf-8"));

/** The body of the first `@media` block whose prelude contains `prelude`, brace-matched. */
function mediaBlock(source: string, prelude: string): string {
  const at = source.indexOf(`@media (${prelude})`);
  if (at === -1) throw new Error(`no @media (${prelude})`);
  const open = source.indexOf("{", at);
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}" && --depth === 0) return source.slice(open + 1, i);
  }
  throw new Error("unbalanced braces");
}

/** Every flat `selector { body }` rule of `source` (no nesting in these sheets' rules of interest). */
function rules(source: string): Array<{ selector: string; body: string }> {
  return [...source.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({
    selector: m[1].trim(),
    body: m[2],
  }));
}

describe("BottomSheet size contract (CSS source)", () => {
  it("at or below 768px, `.ui-modal.bottom-sheet` sets width and max-width to 100%", () => {
    const rule = rules(mediaBlock(sheetCss, "max-width: 768px")).find(
      (r) => r.selector === ".ui-modal.bottom-sheet",
    );
    expect(rule).toBeDefined();
    expect(rule?.body).toMatch(/(^|[;\s])width:\s*100%\s*;/);
    expect(rule?.body).toMatch(/max-width:\s*100%\s*;/);
  });

  it("every `.ui-modal--<size>` width rule in Modal.css is a single class, so the sheet's two-class rule always wins", () => {
    const sizeRules = rules(modalCss).filter((r) =>
      /\.ui-modal--(sm|md|lg|xl|full)\b/.test(r.selector),
    );
    expect(sizeRules.length).toBeGreaterThanOrEqual(5);
    for (const r of sizeRules) {
      expect(r.selector).toMatch(/^\.ui-modal--(sm|md|lg|xl|full)$/);
    }
  });

  it("no BottomSheet rule applies `!important` to the width (specificity, not force, does the work)", () => {
    expect(sheetCss).not.toMatch(/width:[^;]*!important/);
  });
});
