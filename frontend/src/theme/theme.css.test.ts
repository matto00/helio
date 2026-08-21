import fs from "fs";
import path from "path";

// Regression guard for the HEL-772 top-chrome seam. jsdom implements no real
// layout or media-query evaluation, so no DOM-rendering Jest test can observe
// the resolved value of a CSS custom property at a phone viewport. This
// statically asserts the CSS source keeps the seam tokens and, critically,
// that the mobile override of `--app-command-bar-height` still targets
// `:root` -- overriding it anywhere below `:root` would not recompute
// `--app-top-chrome-height`, which is substituted at computed-value time on
// the element that declares it (design.md Decision 4, probed twice). Mirrors
// the read-file + findMediaBlock/findRuleBody scan used by App.css.test.ts /
// IconButton.css.test.ts.

const CSS_PATH = path.join(__dirname, "theme.css");
const css = fs.readFileSync(CSS_PATH, "utf-8");

/** Extracts the full body of the first `@media` at-rule whose prelude contains
 *  `preludeSubstring`, brace-matching so nested rule blocks are included. */
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

describe("theme.css — top-chrome seam tokens (HEL-772)", () => {
  // The FIRST `:root {` in the file is the base token block (preceding the
  // `:root[data-theme="..."]` variants further down, which also contain the
  // substring ":root" but declare no seam tokens).
  const rootBody = findRuleBody(css, ":root {");

  it("declares --app-safe-top from env(safe-area-inset-top, 0px)", () => {
    expect(rootBody).toMatch(/--app-safe-top:\s*env\(safe-area-inset-top,\s*0px\)\s*;/);
  });

  it("declares --app-command-bar-height from var(--space-9) (48px desktop)", () => {
    expect(rootBody).toMatch(/--app-command-bar-height:\s*var\(--space-9\)\s*;/);
  });

  it("declares --app-top-chrome-height as command-bar-height plus the safe-top inset", () => {
    expect(rootBody).toMatch(
      /--app-top-chrome-height:\s*calc\(var\(--app-command-bar-height\)\s*\+\s*var\(--app-safe-top\)\)\s*;/,
    );
  });

  it("overrides --app-command-bar-height to 56px at the mobile-shell breakpoint, targeting :root", () => {
    const mobileBlock = findMediaBlock(css, "max-width: 768px");
    const mobileRootBody = findRuleBody(mobileBlock, ":root");
    expect(mobileRootBody).toMatch(
      /--app-command-bar-height:\s*calc\(var\(--control-lg\)\s*\+\s*var\(--space-4\)\)\s*;/,
    );
  });

  it("does NOT override --app-command-bar-height on .app-command-bar itself (must stay on :root)", () => {
    const mobileBlock = findMediaBlock(css, "max-width: 768px");
    expect(mobileBlock).not.toMatch(/\.app-command-bar\s*{[^}]*--app-command-bar-height/);
  });
});

describe("theme.css — ancestor sizing chain matches the dynamic viewport (HEL-772)", () => {
  it("html, body, #root take min-height: 100vh then min-height: 100dvh (no percentage)", () => {
    const body = findRuleBody(css, "html,\nbody,\n#root {");
    expect(body).toMatch(/min-height:\s*100vh\s*;/);
    expect(body).toMatch(/min-height:\s*100dvh\s*;/);
    expect(body).not.toMatch(/min-height:\s*100%\s*;/);
  });

  it("body no longer declares its own redundant min-height: 100vh", () => {
    const bodyRuleBody = findRuleBody(css, "body {");
    expect(bodyRuleBody).not.toMatch(/min-height/);
  });
});
