import fs from "fs";
import path from "path";

const CSS_PATH = path.join(__dirname, "App.css");
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

/** Body of the first rule in `source` (outside any @media block scan) whose
 *  selector contains `selectorSubstring`. Stops at the first top-level match,
 *  which is the default (non-media) rule since it's declared before the
 *  media-scoped override in App.css. */
function findRuleBodyInSource(source: string, selectorSubstring: string): string {
  const selectorIndex = source.indexOf(selectorSubstring);
  if (selectorIndex === -1) {
    throw new Error(`Selector containing "${selectorSubstring}" not found in ${CSS_PATH}`);
  }
  const openBrace = source.indexOf("{", selectorIndex);
  const closeBrace = source.indexOf("}", openBrace);
  return source.slice(openBrace + 1, closeBrace);
}

// Regression guard for the HEL-746 phone-only "New chat" affordance. jsdom
// implements no real layout or media-query evaluation, so no DOM-rendering
// Jest test can observe the rendered visibility of
// `.app-command-bar__mobile-new-chat` at a phone viewport — `CommandBar.
// test.tsx` covers the React-conditional half (`pickerId === "chat"`
// gating + the dispatch); this covers the CSS half, mirroring the read-file
// + findMediaBlock/findRuleBody(InSource) scan used by
// `Modal.css.test.ts`/`MobileNavSheet.css.test.ts`.
describe("App.css — phone-only 'New chat' affordance visibility (HEL-746)", () => {
  it("is hidden by default (desktop)", () => {
    const body = findRuleBodyInSource(css, ".app-command-bar__mobile-new-chat");
    expect(body).toMatch(/display:\s*none\s*;/);
  });

  it("is shown at the mobile-shell breakpoint, mirroring .app-command-bar__mobile-title", () => {
    const mobileBlock = findMediaBlock(css, "max-width: 768px");
    const body = findRuleBody(mobileBlock, ".app-command-bar__mobile-new-chat");
    expect(body).toMatch(/display:\s*inline-flex\s*;/);
  });
});

// Regression guard for the HEL-772 top-chrome seam / anchored command bar.
// jsdom implements no real layout or media-query evaluation, so no
// DOM-rendering Jest test can observe the rendered command-bar geometry at a
// phone viewport. HEL-745's `height: var(--space-10)` mobile override is
// superseded by the seam (theme.css.test.ts locks the token side); these
// tests lock the App.css side -- the seam and its derivation, longhand-only
// padding, and the inert-cascade ordering guard (HEL-535 cycle-1: a mobile
// `@media` block placed ABOVE the base rule made an equal-specificity floor
// silently inert).
describe("App.css — command bar takes its height/inset from the top-chrome seam (HEL-772)", () => {
  const baseBody = findRuleBodyInSource(css, ".app-command-bar {");

  it("the base rule derives height from --app-top-chrome-height", () => {
    expect(baseBody).toMatch(/height:\s*var\(--app-top-chrome-height\)\s*;/);
  });

  it("the base rule claims the top safe-area inset as padding-top", () => {
    expect(baseBody).toMatch(/padding-top:\s*var\(--app-safe-top\)\s*;/);
  });

  it("neither the base nor the mobile .app-command-bar rule declares a padding shorthand", () => {
    const mobileBlock = findMediaBlock(css, "max-width: 768px");
    const mobileBody = findRuleBody(mobileBlock, ".app-command-bar");
    // A shorthand `padding:` declaration -- longhands (`padding-top:`,
    // `padding-right:`, etc.) must not trip this.
    expect(baseBody).not.toMatch(/padding:\s*[^-]/);
    expect(mobileBody).not.toMatch(/padding:\s*[^-]/);
  });

  it("the mobile block declares NO height for .app-command-bar (derives from the token alone)", () => {
    const mobileBlock = findMediaBlock(css, "max-width: 768px");
    const mobileBody = findRuleBody(mobileBlock, ".app-command-bar");
    // Declaration-aware: must not false-negative on `min-height:` (a real,
    // intentional declaration elsewhere in this same media block) and must
    // only inspect the isolated rule body, not prose in a preceding comment.
    expect(mobileBody).not.toMatch(/(?<!min-)height\s*:/);
  });

  it("the mobile @media block appears after the base .app-command-bar rule (inert-cascade guard)", () => {
    const baseIndex = css.indexOf(".app-command-bar {");
    const mediaIndex = css.indexOf("@media (max-width: 768px)");
    expect(baseIndex).toBeGreaterThanOrEqual(0);
    expect(mediaIndex).toBeGreaterThan(baseIndex);
  });

  it(".app-shell resolves to a dvh height (falls back from 100vh)", () => {
    const shellBody = findRuleBodyInSource(css, ".app-shell {");
    expect(shellBody).toMatch(/height:\s*100vh\s*;/);
    expect(shellBody).toMatch(/height:\s*100dvh\s*;/);
  });
});

describe("App.css — mobile tap targets: 28px painted box, 44px hit area (HEL-772)", () => {
  const mobileBlock = findMediaBlock(css, "max-width: 768px");

  it("unpainted controls (.app-command-bar__mobile-title, .app-command-bar__logo) get min-height: 44px", () => {
    const titleBody = findRuleBody(mobileBlock, ".app-command-bar__mobile-title");
    expect(titleBody).toMatch(/min-height:\s*44px\s*;/);
    const logoBody = findRuleBody(mobileBlock, ".app-command-bar__logo");
    expect(logoBody).toMatch(/min-height:\s*44px\s*;/);
  });

  it("scopes .ui-icon-btn back to var(--control-sm) inside .app-command-bar, not IconButton.css's 44px floor", () => {
    const body = findRuleBody(mobileBlock, ".app-command-bar .ui-icon-btn");
    expect(body).toMatch(/min-width:\s*var\(--control-sm\)\s*;/);
    expect(body).toMatch(/min-height:\s*var\(--control-sm\)\s*;/);
  });

  it("declares a sized 44x44px ::after hit expander for .app-command-bar .ui-icon-btn", () => {
    const body = findRuleBody(mobileBlock, ".app-command-bar .ui-icon-btn::after");
    expect(body).toMatch(/width:\s*44px\s*;/);
    expect(body).toMatch(/height:\s*44px\s*;/);
  });

  it("widens .app-command-bar__right's gap to var(--space-4) so hit regions abut instead of overlapping", () => {
    const body = findRuleBody(mobileBlock, ".app-command-bar__right");
    expect(body).toMatch(/gap:\s*var\(--space-4\)\s*;/);
  });
});
