import fs from "fs";
import path from "path";
import { getPanelCardStyle } from "./PanelCard";

const base = { background: "transparent", color: "inherit", transparency: 0 };
const asVars = (s: object) => s as Record<string, string>;

describe("getPanelCardStyle readable variants (HEL-1490)", () => {
  it("emits no --panel-tone-* on a default panel", () => {
    const keys = Object.keys(getPanelCardStyle(base, "light"));
    expect(
      keys.filter((k) => k.startsWith("--panel-tone") || k === "--panel-secondary-text-mix"),
    ).toEqual([]);
  });

  it("emits tone variants on a saturated custom background", () => {
    const s = asVars(getPanelCardStyle({ ...base, background: "#ff0000" }, "light"));
    expect(s["--panel-tone-error"]).toMatch(/^#[0-9a-f]{6}$/);
    expect(s["--panel-surface-override"]).toBeDefined();
  });
});

describe("consumers read the per-panel variant with the theme token as fallback", () => {
  const root = path.resolve(__dirname);
  const panelContent = fs.readFileSync(path.join(root, "PanelContent.css"), "utf8");
  const table = fs.readFileSync(path.join(root, "renderers/TableRenderer.css"), "utf8");
  it.each(["success", "warning", "error"])("metric figure %s", (t) => {
    expect(panelContent).toMatch(
      new RegExp(`tone-${t} \\{[^}]*color: var\\(--panel-tone-${t}, var\\(--app-${t}\\)\\)`),
    );
  });
  it("delta up/down/flat", () => {
    expect(panelContent).toMatch(
      /metric-trend--up \{\s*color: var\(--panel-tone-success, var\(--app-success\)\)/,
    );
    expect(panelContent).toMatch(
      /metric-trend--down \{\s*color: var\(--panel-tone-error, var\(--app-error\)\)/,
    );
    expect(panelContent).toMatch(
      /metric-trend--flat \{\s*color: var\(--panel-tone-muted, var\(--app-text-muted\)\)/,
    );
  });
  it.each(["success", "warning", "error"])("table cell text and mark %s", (t) => {
    expect(table).toMatch(
      new RegExp(`cell--tone-${t} \\{\\s*color: var\\(--panel-tone-${t}, var\\(--app-${t}\\)\\)`),
    );
    expect(table).toMatch(
      new RegExp(`tone-mark--${t} \\{\\s*color: var\\(--panel-tone-${t}, var\\(--app-${t}\\)\\)`),
    );
  });
});
