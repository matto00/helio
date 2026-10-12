import { readFileSync } from "node:fs";
import { join } from "node:path";

// HEL-1490 item 2 -- the metric unit and label are currentColor-relative secondary text. The default-theme
// mix measured 4.40:1 in light. This guard recomputes contrast from the token values in theme.css
// (--app-text over --app-surface at the declared mix) and pins that BOTH selectors use the token, so they
// stay one shade. The running-app computed-style measurement is the authoritative evidence.
const strip = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, "");
const themeCss = strip(readFileSync(join(__dirname, "../../../theme/theme.css"), "utf8"));
const panelCss = strip(readFileSync(join(__dirname, "PanelContent.css"), "utf8"));

function block(theme: "light" | "dark"): string {
  const re = new RegExp(`:root\\[data-theme="${theme}"\\]\\s*\\{([\\s\\S]*?)\\n\\}`);
  return re.exec(themeCss)?.[1] ?? "";
}
const token = (b: string, name: string) => new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})`).exec(b)?.[1];
const mixOf = (b: string): number | undefined => {
  const m = /--panel-secondary-text-mix:\s*(\d+)%/.exec(b);
  return m ? Number(m[1]) : undefined;
};

const chan = (hex: string, i: number) => parseInt(hex.slice(1 + 2 * i, 3 + 2 * i), 16);
const lin = (v: number) => {
  const c = v / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};
const lum = (rgb: number[]) => 0.2126 * lin(rgb[0]) + 0.7152 * lin(rgb[1]) + 0.0722 * lin(rgb[2]);
function contrast(fg: string, bg: string, pct: number): number {
  const f = [0, 1, 2].map((i) => chan(fg, i));
  const b = [0, 1, 2].map((i) => chan(bg, i));
  const mixed = f.map((v, i) => Math.round((v * pct) / 100 + b[i] * (1 - pct / 100)));
  const [hi, lo] = [lum(mixed), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

describe("metric unit and label secondary-text contrast", () => {
  it.each(["light", "dark"] as const)(
    "%s mix clears 4.5:1 on the default panel surface",
    (theme) => {
      const b = block(theme);
      const pct = mixOf(b);
      expect(pct).toBeDefined();
      const ratio = contrast(
        token(b, "--app-text") ?? "",
        token(b, "--app-surface") ?? "",
        pct ?? 0,
      );
      expect(ratio).toBeGreaterThanOrEqual(4.5);
    },
  );

  it.each([".panel-content__metric-unit", ".panel-content__metric-label"])(
    "%s uses the shared mix token, still relative to currentColor",
    (selector) => {
      const rule = new RegExp(`${selector.replace(".", "\\.")} \\{([^}]*)\\}`).exec(panelCss)?.[1];
      expect(rule).toMatch(
        /color: color-mix\(in srgb, currentColor var\(--panel-secondary-text-mix\), transparent\);/,
      );
    },
  );
});
