import fs from "fs";
import path from "path";

// HEL-774 — static source guards for the liquid-glass bottom nav's material
// recipe. jsdom implements no real layout, `backdrop-filter` compositing, or
// media-query evaluation, so none of this is observable via a DOM-rendering
// Jest test; these assert directly against the CSS source, mirroring the
// established `shared/{ui,chrome}/*.css.test.ts` convention (see
// `toast.css.test.ts`, `MobileNavSheet.css.test.ts`). The actual rendered
// contrast/geometry claims (capsule insets, semicircular ends, sampled pixel
// contrast) are verified separately in the browser-based checks — this file
// only pins the source-level contract that a rendering test can't reach:
// which token backs which declaration, and declaration/rule ordering.

const CSS_PATH = path.join(__dirname, "BottomNav.css");
const cssWithComments = fs.readFileSync(CSS_PATH, "utf-8");
// Comments explain *why* a token was chosen and routinely name the rejected
// alternative (e.g. "NOT --app-surface-strong") — exactly the substring a
// negative assertion below is checking is absent from the actual
// declarations. Strip comments before matching so prose doesn't trip a
// `.not.toMatch()` on itself.
const css = cssWithComments.replace(/\/\*[\s\S]*?\*\//g, "");

/** Body of the first flat rule in `source` whose selector contains
 *  `selectorSubstring`, brace-matched (not just first `}`) so nested rules
 *  inside a `@media` block are handled correctly by callers that pre-slice
 *  to a media body. */
function findRuleBody(source: string, selectorSubstring: string): string {
  const selectorIndex = source.indexOf(selectorSubstring);
  if (selectorIndex === -1) {
    throw new Error(`Selector containing "${selectorSubstring}" not found in ${CSS_PATH}`);
  }
  const openBrace = source.indexOf("{", selectorIndex);
  let depth = 0;
  for (let i = openBrace; i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}") {
      depth--;
      if (depth === 0) return source.slice(openBrace + 1, i);
    }
  }
  throw new Error(`Unbalanced braces reading rule "${selectorSubstring}" in ${CSS_PATH}`);
}

/** Full body (brace-matched) of the first `@media` at-rule whose prelude
 *  contains `preludeSubstring`, and the source index of its own `@media`
 *  keyword so callers can compare ordering against another rule's position.
 *  Mirrors `toast.css.test.ts`'s `findMediaBlockFor` scan-forward shape. */
function findMediaBlock(source: string, preludeSubstring: string): { body: string; start: number } {
  let searchFrom = 0;
  for (;;) {
    const at = source.indexOf("@media", searchFrom);
    if (at === -1) {
      throw new Error(`No @media rule containing "${preludeSubstring}" found in ${CSS_PATH}`);
    }
    const openBrace = source.indexOf("{", at);
    const prelude = source.slice(at, openBrace);
    if (!prelude.includes(preludeSubstring)) {
      searchFrom = openBrace + 1;
      continue;
    }
    let depth = 0;
    for (let i = openBrace; i < source.length; i++) {
      if (source[i] === "{") depth++;
      else if (source[i] === "}") {
        depth--;
        if (depth === 0) return { body: source.slice(openBrace + 1, i), start: at };
      }
    }
    throw new Error(`Unbalanced braces in @media block in ${CSS_PATH}`);
  }
}

const phoneMedia = findMediaBlock(css, "max-width: 768px");

describe("BottomNav.css — capsule geometry (HEL-774)", () => {
  it(".bottom-nav is inset from all three edges via the shared token family, not a flush strip", () => {
    const body = findRuleBody(phoneMedia.body, ".bottom-nav {");
    expect(body).toMatch(/left:\s*var\(--bottom-nav-inset\)\s*;/);
    expect(body).toMatch(/right:\s*var\(--bottom-nav-inset\)\s*;/);
    expect(body).toMatch(
      /bottom:\s*calc\(var\(--bottom-nav-inset\)\s*\+\s*env\(safe-area-inset-bottom\)\)\s*;/,
    );
    expect(body).toMatch(/height:\s*var\(--bottom-nav-capsule-height\)\s*;/);
  });

  it(".bottom-nav has fully-rounded ends via the pill radius token", () => {
    const body = findRuleBody(phoneMedia.body, ".bottom-nav {");
    expect(body).toMatch(/border-radius:\s*var\(--app-radius-pill\)\s*;/);
  });

  it("no `padding-bottom: env(...)` remains on .bottom-nav — the offset carries the home-indicator inset instead", () => {
    const body = findRuleBody(phoneMedia.body, ".bottom-nav {");
    expect(body).not.toMatch(/padding-bottom/);
  });
});

describe("BottomNav.css — capsule edge uses the load-bearing strong hairline (HEL-774)", () => {
  it(".bottom-nav's border is --app-border-strong, not --app-border-subtle", () => {
    const body = findRuleBody(phoneMedia.body, ".bottom-nav {");
    expect(body).toMatch(/border:\s*1px solid var\(--app-border-strong\)\s*;/);
    expect(body).not.toMatch(/--app-border-subtle/);
  });

  it(".bottom-nav carries a soft layered shadow", () => {
    const body = findRuleBody(phoneMedia.body, ".bottom-nav {");
    expect(body).toMatch(/box-shadow:\s*var\(--app-shadow-soft\)\s*;/);
  });
});

describe("BottomNav.css — translucent material (HEL-774)", () => {
  it("backdrop-filter blur is declared both prefixed and unprefixed, at the same 12px radius", () => {
    const body = findRuleBody(phoneMedia.body, ".bottom-nav {");
    expect(body).toMatch(/(?<!-webkit-)backdrop-filter:\s*blur\(12px\)\s*;/);
    expect(body).toMatch(/-webkit-backdrop-filter:\s*blur\(12px\)\s*;/);
  });

  it("the tint layer is a distinct ::before, not a translucent background on .bottom-nav itself", () => {
    const bottomNavBody = findRuleBody(phoneMedia.body, ".bottom-nav {");
    expect(bottomNavBody).not.toMatch(/^\s*background:/m);

    const beforeBody = findRuleBody(phoneMedia.body, ".bottom-nav::before {");
    expect(beforeBody).toMatch(
      /background:\s*color-mix\(in srgb,\s*var\(--app-surface\)\s*55%,\s*transparent\)\s*;/,
    );
    // NOT --app-surface-strong — silently invalidates the D2 contrast table.
    expect(beforeBody).not.toMatch(/--app-surface-strong/);
  });

  it("the tint layer paints behind the tabs within .bottom-nav's own stacking context", () => {
    const beforeBody = findRuleBody(phoneMedia.body, ".bottom-nav::before {");
    expect(beforeBody).toMatch(/z-index:\s*-1\s*;/);
  });

  it("no @supports fallback is written — the tint is unconditional", () => {
    expect(css).not.toMatch(/@supports/);
  });
});

describe("BottomNav.css — inactive ink is full-contrast (HEL-774)", () => {
  it(".bottom-nav__tab uses --app-text, not --app-text-muted", () => {
    const body = findRuleBody(css, ".bottom-nav__tab {");
    expect(body).toMatch(/color:\s*var\(--app-text\)\s*;/);
    expect(body).not.toMatch(/--app-text-muted/);
  });
});

describe("BottomNav.css — active lozenge (HEL-774 D6)", () => {
  it("every tab's lozenge carries a 1px transparent border always, so the icon never shifts on activation", () => {
    const body = findRuleBody(css, ".bottom-nav__lozenge {");
    expect(body).toMatch(/border:\s*1px solid transparent\s*;/);
    expect(body).toMatch(/padding:\s*var\(--space-1\)\s*var\(--space-3\)\s*;/);
    expect(body).toMatch(/border-radius:\s*var\(--app-radius-pill\)\s*;/);
  });

  it("the active lozenge's border is full-strength var(--app-text), never a color-mix", () => {
    const body = findRuleBody(css, ".bottom-nav__tab--active .bottom-nav__lozenge {");
    expect(body).toMatch(/border-color:\s*var\(--app-text\)\s*;/);
    expect(body).not.toMatch(/color-mix\([^)]*--app-text[^)]*\)/);
  });

  it("the active lozenge's fill is --app-surface at alpha 0.95, not --app-surface-strong", () => {
    const body = findRuleBody(css, ".bottom-nav__tab--active .bottom-nav__lozenge {");
    expect(body).toMatch(
      /background:\s*color-mix\(in srgb,\s*var\(--app-surface\)\s*95%,\s*transparent\)\s*;/,
    );
    expect(body).not.toMatch(/--app-surface-strong/);
  });

  it("no background-clip is declared anywhere — dead CSS with an opaque border (D6)", () => {
    expect(css).not.toMatch(/background-clip/);
  });

  it("the lozenge styling never targets an svg/icon element directly", () => {
    expect(css).not.toMatch(/\.bottom-nav__icon\s*\{[^}]*(?:padding|border)[^}]*\}/);
  });
});

describe("BottomNav.css — reduced motion disables the lozenge transition outright (HEL-774 D8)", () => {
  it(".bottom-nav__lozenge declares a transition on background/border-color only", () => {
    const body = findRuleBody(css, ".bottom-nav__lozenge {");
    expect(body).toMatch(/transition:/);
    expect(body).toMatch(/background/);
    expect(body).toMatch(/border-color/);
  });

  it("reduced motion clears it with `transition: none`, not a shortened duration", () => {
    const { body } = findMediaBlock(css, "prefers-reduced-motion: reduce");
    const lozengeBody = findRuleBody(body, ".bottom-nav__lozenge {");
    expect(lozengeBody).toMatch(/transition:\s*none\s*;/);
  });

  it("the reduced-motion override is positioned AFTER the base .bottom-nav__lozenge rule (source order, equal specificity)", () => {
    const baseIndex = css.indexOf(".bottom-nav__lozenge {");
    const { start: reducedMotionIndex } = findMediaBlock(css, "prefers-reduced-motion: reduce");
    expect(reducedMotionIndex).toBeGreaterThan(baseIndex);
  });
});

describe("BottomNav.css — 44px tap-target floor cannot be made inert by ordering (HEL-774 D7)", () => {
  it(".bottom-nav__tab's min-height/min-width: 44px is declared once, unconditionally (not shadowed by a later equal-specificity @media rule)", () => {
    const body = findRuleBody(css, ".bottom-nav__tab {");
    expect(body).toMatch(/min-height:\s*44px\s*;/);
    expect(body).toMatch(/min-width:\s*44px\s*;/);

    // The only other appearance of `.bottom-nav__tab {` in the whole file
    // must be this same base rule — a second declaration (e.g. inside a
    // later @media block) at equal specificity would silently win and could
    // reintroduce HEL-535's inert-44px defect.
    const occurrences = css.split(".bottom-nav__tab {").length - 1;
    expect(occurrences).toBe(1);
  });
});

describe("BottomNav.css — focus ring follows the capsule's curve (HEL-774 D12)", () => {
  it(".bottom-nav__tab is itself pill-radiused so its outline can follow the curve", () => {
    const body = findRuleBody(css, ".bottom-nav__tab {");
    expect(body).toMatch(/border-radius:\s*var\(--app-radius-pill\)\s*;/);
  });

  it(":focus-visible uses a deepened -3px offset, not the app-wide -2px flush-list-item recipe", () => {
    const body = findRuleBody(css, ".bottom-nav__tab:focus-visible {");
    expect(body).toMatch(/outline-offset:\s*-3px\s*;/);
    expect(body).not.toMatch(/-2px/);
  });
});
