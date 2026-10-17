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

describe("BottomNav.css — lozenge geometry is state-independent (HEL-774 D6, replaced by HEL-1583 D9)", () => {
  // HEL-774's "every lozenge carries identical geometry" cannot hold once the active lozenge grows with its label. It
  // is REPLACED, not dropped: block padding and radius are identical in every state, the lozenge never gains a border
  // or margin on activation, and growth is along the inline axis only.
  it("the base lozenge carries the block padding, the --space-2 inline padding and the pill radius", () => {
    const body = findRuleBody(css, ".bottom-nav__lozenge {");
    expect(body).toMatch(/padding:\s*var\(--space-1\)\s*var\(--space-2\)\s*;/);
    expect(body).toMatch(/border-radius:\s*var\(--app-radius-pill\)\s*;/);
    expect(body).not.toMatch(/border:/);
  });

  it("the active lozenge changes the INLINE padding only (--space-3), never the block padding, radius, border or margin", () => {
    const body = findRuleBody(css, ".bottom-nav__tab--active .bottom-nav__lozenge {");
    expect(body).toMatch(/padding-inline:\s*var\(--space-3\)\s*;/);
    expect(body).not.toMatch(/(?<!-)padding\s*:/);
    expect(body).not.toMatch(/padding-block/);
    expect(body).not.toMatch(/border-radius/);
    expect(body).not.toMatch(/(?<!-)border\s*:/);
    expect(body).not.toMatch(/margin/);
  });

  it("the lozenge is bounded to its own tab (min-width: 0; max-width: 100%) so it truncates instead of spilling at 320px", () => {
    const body = findRuleBody(css, ".bottom-nav__lozenge {");
    expect(body).toMatch(/min-width:\s*0\s*;/);
    expect(body).toMatch(/max-width:\s*100%\s*;/);
  });

  it("the lozenge styling never targets an svg/icon element directly", () => {
    expect(css).not.toMatch(/\.bottom-nav__icon\s*\{[^}]*(?:padding|border)[^}]*\}/);
  });

  it("no background-clip is declared anywhere", () => {
    expect(css).not.toMatch(/background-clip/);
  });
});

describe("BottomNav.css — the active pill is opaque with a text-ink ring (HEL-1583 D10, owner answer opaque-pill-text-ring)", () => {
  it("the active lozenge is an opaque --app-surface-strong fill with a 1px --app-text ring (inset shadow: no geometry)", () => {
    const body = findRuleBody(css, ".bottom-nav__tab--active .bottom-nav__lozenge {");
    expect(body).toMatch(/background:\s*var\(--app-surface-strong\)\s*;/);
    expect(body).toMatch(/box-shadow:\s*inset 0 0 0 1px var\(--app-text\)\s*;/);
    // Not the accent wash it replaced.
    expect(body).not.toMatch(/color-mix/);
    expect(body).not.toMatch(/--app-accent/);
  });

  it("only the ACTIVE lozenge has a fill or a ring: the base lozenge declares neither", () => {
    const body = findRuleBody(css, ".bottom-nav__lozenge {");
    expect(body).not.toMatch(/background/);
    expect(body).not.toMatch(/box-shadow/);
  });

  it("the capsule's glass is unchanged: tint at 55% of --app-surface, blur 12px, --app-border-strong hairline", () => {
    const beforeBody = findRuleBody(phoneMedia.body, ".bottom-nav::before {");
    expect(beforeBody).toMatch(/color-mix\(in srgb,\s*var\(--app-surface\)\s*55%,\s*transparent\)/);
    const body = findRuleBody(phoneMedia.body, ".bottom-nav {");
    expect(body).toMatch(/blur\(12px\)/);
    expect(body).toMatch(/border:\s*1px solid var\(--app-border-strong\)\s*;/);
  });

  it("the accent stays on the active ICON alone: the tab's colour is --app-accent-text, the label is --app-text", () => {
    expect(findRuleBody(css, ".bottom-nav__tab--active {")).toMatch(
      /color:\s*var\(--app-accent-text\)\s*;/,
    );
    expect(findRuleBody(css, ".bottom-nav__label {")).toMatch(/color:\s*var\(--app-text\)\s*;/);
    expect(css.match(/--app-accent(?![-\w])/g)).toBeNull();
  });
});

describe("BottomNav.css — expanding label (HEL-1583 D9)", () => {
  it("every tab is content-sized (flex: 0 1 auto) and the bar spreads them with space-evenly", () => {
    expect(findRuleBody(css, ".bottom-nav__tab {")).toMatch(/flex:\s*0 1 auto\s*;/);
    expect(findRuleBody(phoneMedia.body, ".bottom-nav {")).toMatch(
      /justify-content:\s*space-evenly\s*;/,
    );
    // No state ever changes flex-basis / flex-grow on activation.
    expect(findRuleBody(css, ".bottom-nav__tab--active {")).not.toMatch(/flex/);
    expect(findRuleBody(css, ".bottom-nav__tab--active .bottom-nav__lozenge {")).not.toMatch(
      /flex/,
    );
  });

  it("the label is collapsed by default and expands only on the active tab, to a token-sized cap", () => {
    const base = findRuleBody(css, ".bottom-nav__label {");
    expect(base).toMatch(/max-width:\s*0\s*;/);
    expect(base).toMatch(/opacity:\s*0\s*;/);
    expect(base).toMatch(/min-width:\s*0\s*;/);
    expect(base).toMatch(/overflow:\s*hidden\s*;/);
    expect(base).toMatch(/white-space:\s*nowrap\s*;/);
    expect(base).toMatch(/text-overflow:\s*ellipsis\s*;/);
    const active = findRuleBody(css, ".bottom-nav__tab--active .bottom-nav__label {");
    expect(active).toMatch(/max-width:\s*calc\(var\(--space-6\)\s*\*\s*4\)\s*;/);
    expect(active).toMatch(/opacity:\s*1\s*;/);
  });

  it("the label is --text-xs / --weight-semibold sans in full --app-text ink (4.5:1 normal-text floor)", () => {
    const base = findRuleBody(css, ".bottom-nav__label {");
    expect(base).toMatch(/font-family:\s*var\(--font-sans\)\s*;/);
    expect(base).toMatch(/font-size:\s*var\(--text-xs\)\s*;/);
    expect(base).toMatch(/font-weight:\s*var\(--weight-semibold\)\s*;/);
    expect(base).toMatch(/color:\s*var\(--app-text\)\s*;/);
    expect(base).not.toMatch(/--app-text-muted/);
  });

  it("transitions only the label's max-width and opacity, and the lozenge's inline padding, on the standard motion tokens", () => {
    const label = findRuleBody(css, ".bottom-nav__label {");
    const labelTransition = /transition:\s*([^;]+);/.exec(label)?.[1] ?? "";
    expect(labelTransition.replace(/\s+/g, " ").trim()).toBe(
      "max-width var(--motion-duration-standard) var(--motion-ease-out), opacity var(--motion-duration-standard) var(--motion-ease-out)",
    );
    const lozenge = findRuleBody(css, ".bottom-nav__lozenge {");
    expect(lozenge).toMatch(
      /transition:\s*padding-inline var\(--motion-duration-standard\) var\(--motion-ease-out\)\s*;/,
    );
    // Nothing else in the file animates width, flex or padding.
    expect(css).not.toMatch(
      /transition:[^;]*(?<![-\w])(width|flex|flex-basis|flex-grow|min-width)(?![-\w])/,
    );
  });
});

describe("BottomNav.css — reduced motion removes the label and lozenge transitions outright (HEL-774 D8, HEL-1572, HEL-1583)", () => {
  it("under prefers-reduced-motion (no explicit data-motion) both clear to `transition: none`", () => {
    const { body } = findMediaBlock(css, "prefers-reduced-motion: reduce");
    const rule = findRuleBody(body, ":root:not([data-motion]) .bottom-nav__label {");
    expect(body).toMatch(/:root:not\(\[data-motion\]\) \.bottom-nav__lozenge/);
    expect(rule).toMatch(/transition:\s*none\s*;/);
  });

  it('an explicit data-motion="off" clears both too', () => {
    const rule = findRuleBody(css, ':root[data-motion="off"] .bottom-nav__label {');
    expect(rule).toMatch(/transition:\s*none\s*;/);
    expect(css).toMatch(/:root\[data-motion="off"\] \.bottom-nav__lozenge/);
  });

  it("the overrides are positioned AFTER the base lozenge and label rules (source order, equal specificity)", () => {
    const { start: reducedMotionIndex } = findMediaBlock(css, "prefers-reduced-motion: reduce");
    expect(reducedMotionIndex).toBeGreaterThan(css.indexOf(".bottom-nav__lozenge {"));
    expect(reducedMotionIndex).toBeGreaterThan(css.indexOf(".bottom-nav__label {"));
    expect(css.indexOf(':root[data-motion="off"]')).toBeGreaterThan(reducedMotionIndex);
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
