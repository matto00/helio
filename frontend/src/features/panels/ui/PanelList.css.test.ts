import fs from "fs";
import path from "path";

// HEL-1583 — static guards (jsdom evaluates no media queries) for the phone-shell rules; rendered pixels are
// measured by e2e/hel1583-mobile-dashboard.spec.ts.
const css = fs.readFileSync(path.join(__dirname, "PanelList.css"), "utf-8");

function blocksFor(query: string): string[] {
  const blocks: string[] = [];
  let from = 0;
  for (;;) {
    const at = css.indexOf(query, from);
    if (at === -1) return blocks;
    let depth = 0;
    let end = css.indexOf("{", at);
    const start = end;
    for (; end < css.length; end += 1) {
      if (css[end] === "{") depth += 1;
      if (css[end] === "}") {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    blocks.push(css.slice(start + 1, end));
    from = end;
  }
}

describe("PanelList.css — phone shell", () => {
  const phone = blocksFor("@media (max-width: 768px) {");

  it(".panel-list owns a 12px (--space-3) inline edge inset on the phone shell", () => {
    expect(
      phone.some((b) =>
        /\.panel-list\s*\{[^}]*padding:\s*var\(--space-5\)\s+var\(--space-3\)\s*;/.test(b),
      ),
    ).toBe(true);
  });

  it("hides the zoom widget across the whole phone shell, not only below 430px", () => {
    expect(
      phone.some((b) => /\.panel-list__zoom-widget\s*\{[^}]*display:\s*none\s*;/.test(b)),
    ).toBe(true);
    expect(css).not.toMatch(/max-width:\s*430px/);
  });

  it("no longer positions the widget over the glass nav (nothing but the nav floats over content)", () => {
    expect(css).not.toMatch(/bottom:\s*calc\(var\(--bottom-nav-height\)/);
  });
});
