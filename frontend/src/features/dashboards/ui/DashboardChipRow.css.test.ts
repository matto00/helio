import fs from "fs";
import path from "path";

// HEL-1583 D3/D4 — static guards for the chip row geometry (rendered pixels: e2e/hel1583-mobile-dashboard.spec.ts).
const css = fs.readFileSync(path.join(__dirname, "DashboardChipRow.css"), "utf-8");

function ruleBody(selector: string): string {
  const at = css.indexOf(`${selector} {`);
  if (at === -1) throw new Error(`rule ${selector} not found`);
  return css.slice(css.indexOf("{", at) + 1, css.indexOf("}", at));
}

describe("DashboardChipRow.css", () => {
  it("is a horizontally scrolling flow row that bleeds to the screen edges and starts chips 12px in", () => {
    const row = ruleBody(".dashboard-chip-row");
    expect(row).toMatch(/overflow-x:\s*auto\s*;/);
    expect(row).toMatch(/margin-inline:\s*calc\(-1 \* var\(--space-3\)\)\s*;/);
    expect(row).toMatch(/padding-inline:\s*var\(--space-3\)\s*;/);
    expect(row).toMatch(/scroll-padding-inline:\s*var\(--space-3\)\s*;/);
    expect(row).not.toMatch(/position:\s*(sticky|fixed|absolute)/);
  });

  it("paints a 32px pill and expands the hit area to 44px with the tapTarget ::after pattern", () => {
    expect(ruleBody(".dashboard-chip")).toMatch(/height:\s*var\(--control-md\)\s*;/);
    expect(ruleBody(".dashboard-chip")).toMatch(/position:\s*relative\s*;/);
    const after = ruleBody(".dashboard-chip::after");
    expect(after).toMatch(/height:\s*44px\s*;/);
    expect(after).toMatch(/left:\s*0\s*;/);
    expect(after).toMatch(/right:\s*0\s*;/);
    // The 44px expander must fit the row's own box or the scroller would clip it.
    expect(ruleBody(".dashboard-chip-row")).toMatch(/min-height:\s*44px\s*;/);
  });

  it("floors every chip at 44px wide so a short name still meets the touch-target floor", () => {
    expect(ruleBody(".dashboard-chip")).toMatch(/min-width:\s*44px\s*;/);
  });

  it("takes its transition from the motion scale, not --app-transition", () => {
    const chip = ruleBody(".dashboard-chip");
    expect(chip).toMatch(/var\(--motion-duration-quick\)\s+var\(--motion-ease-standard\)/);
    expect(css).not.toMatch(/--app-transition/);
  });

  it("fills the active chip with inverted ink, never the accent", () => {
    const active = ruleBody(".dashboard-chip--active");
    expect(active).toMatch(/background:\s*var\(--app-text\)\s*;/);
    expect(active).toMatch(/color:\s*var\(--app-surface\)\s*;/);
    expect(css).not.toMatch(/--app-accent/);
  });
});
