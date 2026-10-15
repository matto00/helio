import fs from "fs";
import path from "path";

import {
  expectTapExpander,
  findMediaBlock,
  findRuleBody,
} from "../../../../shared/ui/tapTargetTestUtils";

// jsdom evaluates no media queries or layout, so the touch floor and the focus ring offset are guarded on the
// stylesheet source, as `PanelDetailModal.css.test.ts` does.
const css = fs.readFileSync(path.join(__dirname, "DashboardTabBar.css"), "utf-8");

const themeCss = fs.readFileSync(path.join(__dirname, "../../../../theme/theme.css"), "utf-8");

/** A length written as `Npx`, `Nrem` or `var(--token)`, resolved against the first `--token: Npx;` in theme.css. */
function px(value: string): number {
  const literal = /^(\d+(?:\.\d+)?)px$/.exec(value.trim());
  if (literal) return Number(literal[1]);
  const rem = /^(\d+(?:\.\d+)?)rem$/.exec(value.trim());
  if (rem) return Number(rem[1]) * 16;
  const token = /^var\((--[\w-]+)\)$/.exec(value.trim());
  if (!token) throw new Error(`cannot resolve ${value}`);
  const decl = new RegExp(`${token[1]}:\\s*([^;]+);`).exec(themeCss);
  if (!decl) throw new Error(`token ${token[1]} not found`);
  return px(decl[1]);
}

function declared(body: string, property: string): string | undefined {
  return new RegExp(`(?:^|[\\s;])${property}:\\s*([^;]+);`).exec(body)?.[1];
}

describe("DashboardTabBar.css (HEL-1575)", () => {
  it("under coarse pointers the 44px expander never reaches past the close's right margin into the next tab", () => {
    // Tabs abut, so the expander (centred, 44px) must not extend further right than the margin that separates
    // the close from its own tab's edge: (44 - size) / 2 <= margin-right. `expectTapExpander` cannot see this.
    const coarse = findRuleBody(findMediaBlock(css, "pointer: coarse"), ".dashboard-tab__close");
    const base = findRuleBody(css, ".dashboard-tab__close");
    const size = px(declared(coarse, "width") ?? declared(base, "width")!);
    const margin = px(declared(coarse, "margin-right") ?? declared(base, "margin-right")!);
    expect((44 - size) / 2).toBeLessThanOrEqual(margin);
  });

  it("the close control is the 24px dense-row icon button and clears 44px through the expander under coarse pointers", () => {
    const base = findRuleBody(css, ".dashboard-tab__close");
    expect(base).toMatch(/width:\s*24px\s*;/);
    expect(base).toMatch(/height:\s*24px\s*;/);
    expectTapExpander(findMediaBlock(css, "pointer: coarse"), ".dashboard-tab__close", "square");
  });

  it("the tab focus ring is drawn inside the clipping strip", () => {
    expect(findRuleBody(css, ".dashboard-tab__button:focus-visible")).toMatch(
      /outline-offset:\s*-2px\s*;/,
    );
  });

  it("hover washes follow the HEL-866 rung table: strong on the bar, and on the active tab strong in dark, soft in light", () => {
    // The state-surface guard (e2e/state-surface-contrast-guard.spec.ts) is the arbiter; this pins the rungs.
    expect(css).toMatch(
      /\.dashboard-tab__button:hover,\s*\.dashboard-tab__close:hover\s*\{[^}]*background:\s*var\(--app-surface-strong\)/,
    );
    expect(css).toMatch(
      /\.dashboard-tab--active \.dashboard-tab__button:hover,\s*\.dashboard-tab--active \.dashboard-tab__close:hover\s*\{[^}]*background:\s*var\(--app-surface-soft\)/,
    );
    expect(css).toMatch(
      /:root\[data-theme="dark"\] \.dashboard-tab--active \.dashboard-tab__button:hover,[^{]*\{[^}]*background:\s*var\(--app-surface-strong\)/,
    );
    expect(css).toMatch(
      /\.dashboard-tab-bar \.dashboard-tab-bar__add:hover:not\(:disabled\)\s*\{[^}]*background:\s*var\(--app-surface-strong\)/,
    );
  });

  it("the changed dot is a neutral foreground, never the accent or an intent colour", () => {
    const dot = findRuleBody(css, ".dashboard-tab__dot");
    expect(dot).toMatch(/background:\s*var\(--app-text\)\s*;/);
  });
});
