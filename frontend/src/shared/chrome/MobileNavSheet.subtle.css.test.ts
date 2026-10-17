import fs from "fs";
import path from "path";

// HEL-1573: under Motion = Subtle the sheet and the refinement drawer fade in place instead of translating. Static
// CSS assertions, as jsdom evaluates no animations.
const strip = (file: string) =>
  fs.readFileSync(path.join(__dirname, file), "utf-8").replace(/\/\*[\s\S]*?\*\//g, "");

function keyframes(css: string, name: string): string {
  const start = css.indexOf(`@keyframes ${name}`);
  expect(start).toBeGreaterThan(-1);
  return css.slice(start, css.indexOf("\n}\n", start) + 3);
}

describe("Subtle opacity-only entrances (HEL-1573)", () => {
  it("the mobile nav sheet panel swaps to an opacity keyframe with no transform", () => {
    const css = strip("MobileNavSheet.css");
    expect(css).toMatch(
      /:root\[data-motion="subtle"\] \.mobile-nav-sheet__panel\s*\{\s*animation-name:\s*mobile-nav-sheet-fade-in;/,
    );
    expect(keyframes(css, "mobile-nav-sheet-fade-in")).not.toMatch(/transform/);
  });

  it("the refinement chat drawer swaps to the backdrop's opacity keyframe, which carries no transform", () => {
    const css = strip("../../features/dashboards/ui/RefinementChatDrawer.css");
    expect(css).toMatch(
      /:root\[data-motion="subtle"\] \.refinement-drawer\s*\{\s*animation-name:\s*refinement-drawer-backdrop-in;/,
    );
    expect(keyframes(css, "refinement-drawer-backdrop-in")).not.toMatch(/transform/);
  });
});
