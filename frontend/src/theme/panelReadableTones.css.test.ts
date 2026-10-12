import fs from "fs";
import path from "path";
import { PANEL_TONE_TOKEN_MIRROR } from "./panelReadableTones";

// Guard: the TS mirror of theme.css tone tokens, washes, muted text and the secondary-text mix must not drift.
const css = fs.readFileSync(path.resolve(__dirname, "theme.css"), "utf8");

function block(theme: "dark" | "light"): string {
  const start = css.indexOf(`:root[data-theme="${theme}"] {`);
  if (start < 0) throw new Error(`no ${theme} block`);
  const end = css.indexOf("\n}", start);
  return css.slice(start, end);
}

function decl(b: string, name: string): string {
  const m = new RegExp(`${name}:\\s*([^;]+);`).exec(b);
  if (m === null) throw new Error(`${name} missing`);
  return m[1].trim();
}

describe.each(["dark", "light"] as const)(
  "PANEL_TONE_TOKEN_MIRROR matches theme.css (%s)",
  (theme) => {
    const b = block(theme);
    const mirror = PANEL_TONE_TOKEN_MIRROR[theme];
    it("tone hexes and muted text", () => {
      expect(mirror.tones.success).toBe(decl(b, "--app-success"));
      expect(mirror.tones.warning).toBe(decl(b, "--app-warning"));
      expect(mirror.tones.error).toBe(decl(b, "--app-error"));
      expect(mirror.muted).toBe(decl(b, "--app-text-muted"));
    });
    it("wash shares", () => {
      for (const tone of ["success", "warning", "error"] as const) {
        const v = decl(b, `--app-${tone}-surface`);
        expect(v).toBe(
          `color-mix(in srgb, var(--app-${tone}) ${Math.round(mirror.wash[tone] * 100)}%, transparent)`,
        );
      }
    });
    it("secondary text mix default", () => {
      expect(`${mirror.secondaryMixDefault}%`).toBe(decl(b, "--panel-secondary-text-mix"));
    });
  },
);
