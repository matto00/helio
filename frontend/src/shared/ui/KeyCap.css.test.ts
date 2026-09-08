import fs from "fs";
import path from "path";

// HEL-510 tasks.md 4.2 — token check for the new `KeyCap` primitive: no hardcoded color or px
// spacing literal. NECESSARY BUT NOT SUFFICIENT for visual cohesion — task 5.2's real-browser
// screenshot comparison is what establishes that; this test only guards against a literal
// creeping back in (e.g. a hand-copied `padding: 2px 7px`, the HEL-680 pile this primitive exists
// to avoid joining).

const css = fs.readFileSync(path.join(__dirname, "KeyCap.css"), "utf-8");

describe("KeyCap.css", () => {
  it("has no hardcoded hex/rgb color literal", () => {
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(css).not.toMatch(/rgba?\(/);
  });

  it("has no hardcoded px spacing literal (margin/padding/gap)", () => {
    expect(css).not.toMatch(/(margin|padding|gap)(-[a-z]+)?:\s*[0-9.]+px/);
  });

  it("draws padding from --space-* tokens, not a literal", () => {
    expect(css).toMatch(/padding:\s*var\(--space-\d+\)\s+var\(--space-\d+\)/);
  });
});
