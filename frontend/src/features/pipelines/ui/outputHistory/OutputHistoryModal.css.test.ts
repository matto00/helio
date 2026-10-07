import { readFileSync } from "node:fs";
import { join } from "node:path";

// HEL-1277 -- DESIGN.md §3: touch floor on the scrubber range; control-height token on the card's
// History button.
const css = (f: string) => readFileSync(join(__dirname, f), "utf8");

describe("History view CSS guards", () => {
  it("gives the scrubber range a 44px floor under the touch gate", () => {
    const text = css("OutputHistoryModal.css");
    expect(text).toMatch(
      /@media \(max-width: 768px\), \(pointer: coarse\) \{\s*\.output-history__range \{\s*min-height: 44px;/,
    );
  });

  it("sizes the card History button with a control-height token", () => {
    const text = readFileSync(join(__dirname, "../OutputGalleryCard.css"), "utf8");
    expect(text).toMatch(/\.output-gallery-card__history \{[^}]*height: var\(--control-sm\);/);
  });

  it("styles the History button as DESIGN.md §5 Ghost (radius-sm, medium weight after font shorthand, raised hover)", () => {
    const text = readFileSync(join(__dirname, "../OutputGalleryCard.css"), "utf8");
    const rule = /\.output-gallery-card__history \{([^}]*)\}/.exec(text)?.[1] ?? "";
    expect(rule).toMatch(/border-radius: var\(--app-radius-sm\);/);
    expect(rule).toMatch(/font-weight: var\(--weight-medium\);/);
    expect(rule.indexOf("font-weight:")).toBeGreaterThan(rule.indexOf("font: inherit;"));
    expect(text).toMatch(
      /\.output-gallery-card__history:hover \{[^}]*background: var\(--app-surface-raised\);/,
    );
  });

  it("sizes the rows table to its content, capped at 360px", () => {
    const rule =
      /\.output-history__table \{([^}]*)\}/.exec(css("OutputHistoryModal.css"))?.[1] ?? "";
    expect(rule).toMatch(/max-height: 360px;/);
    expect(rule).not.toMatch(/(^|[^-])height: 360px/);
  });
});
