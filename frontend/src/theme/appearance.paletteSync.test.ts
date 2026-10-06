import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { getPanelTextEditorFallback } from "./appearance";

// appearance.ts keeps a JS copy of theme.css's --app-text per theme; the chart text colour rule
// compares against it. If the two drift, the "no flip needed" check silently stops matching.
const css = readFileSync(resolve(__dirname, "theme.css"), "utf8");

function appTextIn(selector: RegExp): string {
  const block = selector.exec(css);
  const match = block ? /--app-text:\s*(#[0-9a-fA-F]{6})/.exec(css.slice(block.index)) : null;
  if (!match) throw new Error(`--app-text not found after ${selector}`);
  return match[1].toLowerCase();
}

describe("palette defaultText matches theme.css --app-text", () => {
  it("dark", () => {
    expect(getPanelTextEditorFallback("dark")).toBe(appTextIn(/:root\[data-theme="dark"\]\s*\{/));
  });
  it("light", () => {
    expect(getPanelTextEditorFallback("light")).toBe(appTextIn(/:root\[data-theme="light"\]\s*\{/));
  });
});
