import fs from "fs";
import path from "path";

// HEL-1207 — CSS-lock for the shared-popover-touch-targets floor: the popover's own controls get
// min-height 44px under the touch gate, and the badge gets a 44px hit expander (not an inflated box).
function read(file: string): string {
  return fs.readFileSync(path.join(__dirname, file), "utf8");
}

describe("provenance touch targets", () => {
  it("popover buttons/links keep min-height 44px inside the touch media block", () => {
    const css = read("ProvenancePopover.css");
    const block = css.slice(css.indexOf("@media (max-width: 768px), (pointer: coarse)"));
    expect(block).toMatch(
      /\.provenance-popover__close,\s*\.provenance-popover__link\s*\{[^}]*min-height: 44px/,
    );
  });

  it("the badge gets a 44px hit expander under the same gate", () => {
    const css = read("ProvenanceTrigger.css");
    const block = css.slice(css.indexOf("@media (max-width: 768px), (pointer: coarse)"));
    expect(block).toMatch(/\.provenance-trigger__badge::after\s*\{[^}]*height: 44px/);
  });
});
