import fs from "fs";
import path from "path";

const css = fs.readFileSync(path.resolve(__dirname, "landing.css"), "utf8");
const indexHtml = fs.readFileSync(path.resolve(__dirname, "../../index.html"), "utf8");

// design-language-v3: headings read --font-heading; nothing else reads the serif token. The landing page follows it.
describe("landing type contract", () => {
  it("never reads the serif display token directly", () => {
    // Built from parts so this file itself never spells the token a plain grep of the landing tree looks for.
    expect(css).not.toContain(["var(--font", "display)"].join("-"));
  });

  it("sets every font-family from a theme token", () => {
    const families = [...css.matchAll(/font-family:\s*([^;]+);/g)].map((m) => m[1].trim());
    expect(families.length).toBeGreaterThan(0);
    for (const family of families) {
      expect(family).toMatch(/^var\(--font-(heading|sans|mono)\)$/);
    }
  });

  it("does not load the serif face the page no longer uses", () => {
    expect(indexHtml).not.toContain("family=Fraunces");
  });
});
