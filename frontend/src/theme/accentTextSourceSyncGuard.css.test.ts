import fs from "fs";
import path from "path";
import {
  ACCENT_TEXT_INLINE_TINT_STRENGTHS,
  ACCENT_TEXT_NEUTRAL_SURFACES,
  ACCENT_TEXT_TOKEN_TINT_STRENGTHS,
  buildAccentTokens,
  deriveAccentTextColor,
} from "./appearance";
import { ACCENT_PRESETS, DefaultAccentColorByTheme } from "./theme";

// HEL-1048 CR-2 (evaluation-1.md) — `appearance.ts`'s D2 background-set
// constants are runtime literals (this is browser code; it cannot read CSS
// files at runtime) and so CAN drift from `theme.css`/`BottomNav.css`/
// `AddSourceModal.css` silently. This guard is the thing that makes that
// drift NOT silent: every value used to score `deriveAccentTextColor`
// below is PARSED from source here, independently of `appearance.ts`'s
// constants, and then cross-checked against them. A `theme.css` edit that
// isn't mirrored in `appearance.ts` fails this file, not just a hand-copied
// test.

const THEME_CSS_PATH = path.join(__dirname, "theme.css");
const BOTTOM_NAV_CSS_PATH = path.join(__dirname, "../shared/chrome/BottomNav.css");
const ADD_SOURCE_MODAL_CSS_PATH = path.join(__dirname, "../features/sources/ui/AddSourceModal.css");

function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "));
}

function extractThemeBlock(css: string, theme: "dark" | "light"): string {
  const re = new RegExp(`:root\\[data-theme=["']${theme}["']\\]\\s*\\{([\\s\\S]*?)\\n\\}`, "m");
  const match = re.exec(css);
  if (match === null) {
    throw new Error(`could not find :root[data-theme="${theme}"] block in theme.css`);
  }
  return match[1];
}

/** Parses the five `--app-bg`/`--app-surface*` literal hexes, IN DECLARATION
 * ORDER, out of a theme block. */
function parseNeutralSurfaces(blockText: string): string[] {
  const hexRe = /--app-(?:bg|surface(?:-\w+)?)\s*:\s*(#[0-9a-fA-F]{6})\s*;/g;
  const hexes: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = hexRe.exec(blockText))) {
    hexes.push(m[1].toLowerCase());
  }
  return hexes;
}

/** Parses `--app-accent-surface`/`--app-accent-dim`'s color-mix percentages
 * (as fractions) out of a theme block, in that order. */
function parseTokenTintStrengths(blockText: string): number[] {
  const surfaceM = /--app-accent-surface\s*:\s*color-mix\(in srgb, var\(--app-accent\) (\d+)%/.exec(
    blockText,
  );
  const dimM = /--app-accent-dim\s*:\s*color-mix\(in srgb, var\(--app-accent\) (\d+)%/.exec(
    blockText,
  );
  if (surfaceM === null || dimM === null) {
    throw new Error("could not parse --app-accent-surface/--app-accent-dim from theme.css");
  }
  return [Number(surfaceM[1]) / 100, Number(dimM[1]) / 100];
}

/** Parses the FIRST `color-mix(in srgb, var(--app-accent) N%, ...)` used as
 * a `background` declaration out of an arbitrary stylesheet. */
function parseFirstAccentBackgroundTint(css: string): number {
  const m = /background(?:-color)?\s*:\s*color-mix\(in srgb, var\(--app-accent\) (\d+)%/.exec(
    stripComments(css),
  );
  if (m === null) {
    throw new Error("could not parse an accent background tint from the given stylesheet");
  }
  return Number(m[1]) / 100;
}

function readParsed() {
  const themeCss = stripComments(fs.readFileSync(THEME_CSS_PATH, "utf-8"));
  const darkBlock = extractThemeBlock(themeCss, "dark");
  const lightBlock = extractThemeBlock(themeCss, "light");

  const bottomNavCss = fs.readFileSync(BOTTOM_NAV_CSS_PATH, "utf-8");
  const addSourceModalCss = fs.readFileSync(ADD_SOURCE_MODAL_CSS_PATH, "utf-8");

  return {
    neutralSurfaces: {
      dark: parseNeutralSurfaces(darkBlock),
      light: parseNeutralSurfaces(lightBlock),
    },
    tokenTintStrengths: {
      dark: parseTokenTintStrengths(darkBlock),
      light: parseTokenTintStrengths(lightBlock),
    },
    // Order matches ACCENT_TEXT_INLINE_TINT_STRENGTHS: BottomNav's lozenge
    // (heavier, 22%) first, then AddSourceModal's selected-pill fill (20%).
    inlineTintStrengths: [
      parseFirstAccentBackgroundTint(bottomNavCss),
      parseFirstAccentBackgroundTint(addSourceModalCss),
    ],
  };
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const match = /^#([0-9a-f]{6})$/i.exec(hex);
  if (match === null) {
    throw new Error(`not a hex color: ${hex}`);
  }
  const [, h] = match;
  return {
    r: Number.parseInt(h.slice(0, 2), 16),
    g: Number.parseInt(h.slice(2, 4), 16),
    b: Number.parseInt(h.slice(4, 6), 16),
  };
}

function relativeLuminance(c: { r: number; g: number; b: number }): number {
  const channels = [c.r, c.g, c.b].map((channel) => {
    const n = channel / 255;
    return n <= 0.03928 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrastRatio(hexA: string, hexB: string): number {
  const la = relativeLuminance(hexToRgb(hexA));
  const lb = relativeLuminance(hexToRgb(hexB));
  const hi = Math.max(la, lb);
  const lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}

function blendHex(baseHex: string, tintHex: string, strength: number): string {
  const base = hexToRgb(baseHex);
  const tint = hexToRgb(tintHex);
  const blended = {
    r: Math.round(base.r * (1 - strength) + tint.r * strength),
    g: Math.round(base.g * (1 - strength) + tint.g * strength),
    b: Math.round(base.b * (1 - strength) + tint.b * strength),
  };
  return `#${[blended.r, blended.g, blended.b].map((c) => c.toString(16).padStart(2, "0")).join("")}`;
}

function backgroundsFromParsed(
  parsed: ReturnType<typeof readParsed>,
  theme: "light" | "dark",
  accentHex: string,
): string[] {
  const backgrounds: string[] = [];
  for (const surface of parsed.neutralSurfaces[theme]) {
    backgrounds.push(surface);
    for (const strength of parsed.tokenTintStrengths[theme]) {
      backgrounds.push(blendHex(surface, accentHex, strength));
    }
    for (const strength of parsed.inlineTintStrengths) {
      backgrounds.push(blendHex(surface, accentHex, strength));
    }
  }
  return backgrounds;
}

describe("accent-text source sync guard (HEL-1048 CR-2)", () => {
  it("parses a non-trivial, well-formed background set from source (sanity)", () => {
    const parsed = readParsed();
    expect(parsed.neutralSurfaces.dark.length).toBeGreaterThanOrEqual(5);
    expect(parsed.neutralSurfaces.light.length).toBeGreaterThanOrEqual(5);
    expect(parsed.tokenTintStrengths.dark).toHaveLength(2);
    expect(parsed.inlineTintStrengths).toHaveLength(2);
  });

  it("appearance.ts's D2 constants match what is actually declared in source (drift detection)", () => {
    const parsed = readParsed();
    expect(parsed.neutralSurfaces.dark.slice(0, 5)).toEqual([...ACCENT_TEXT_NEUTRAL_SURFACES.dark]);
    expect(parsed.neutralSurfaces.light.slice(0, 5)).toEqual([
      ...ACCENT_TEXT_NEUTRAL_SURFACES.light,
    ]);
    expect(parsed.tokenTintStrengths.dark).toEqual([...ACCENT_TEXT_TOKEN_TINT_STRENGTHS.dark]);
    expect(parsed.tokenTintStrengths.light).toEqual([...ACCENT_TEXT_TOKEN_TINT_STRENGTHS.light]);
    expect(parsed.inlineTintStrengths).toEqual([...ACCENT_TEXT_INLINE_TINT_STRENGTHS]);
  });

  it("clears 4.5:1 against the SOURCE-PARSED D2 set (not a hardcoded copy), all 8 presets x 2 themes", () => {
    const parsed = readParsed();
    for (const { hex } of ACCENT_PRESETS) {
      for (const theme of ["light", "dark"] as const) {
        const derived = deriveAccentTextColor(hex, theme);
        expect(derived).not.toBeNull();
        if (derived === null) continue;
        for (const bg of backgroundsFromParsed(parsed, theme, hex)) {
          expect(contrastRatio(derived, bg)).toBeGreaterThanOrEqual(4.5);
        }
      }
    }
  });
});

// HEL-1048 D14 static-fallback anti-drift pin (cycle 3, evaluation-2.md
// CR-3). The cycle-2 version of this pin compared the derivation against a
// LITERAL in this test file — nothing read theme.css, so the evaluator's
// garbage-value probe (setting all four theme.css values to `#ff0000`
// etc.) left the whole suite green, proving that version pinned nothing.
// Fixed two ways, per the evaluator's ruling:
//   1. theme.css now declares --app-accent-text/--app-selection-bg only
//      ONCE, in the theme-independent `:root` block (the two per-theme
//      `:root[data-theme=...]` dead-default pairs were REMOVED — a value
//      that never renders is a drift surface only a test can catch, which
//      is exactly how the wrong-accent-hex bug survived cycle 2).
//   2. This pin now PARSES that one `:root` block out of theme.css with
//      `fs.readFileSync`, not a literal, and compares the parsed value to
//      the live derivation.

/** Parses `--app-accent-text`/`--app-selection-bg` out of theme.css's
 * theme-INDEPENDENT `:root { ... }` block specifically (the one right
 * after `--app-focus-ring-color`, NOT either `:root[data-theme=...]`
 * block, which no longer declare these two properties at all post-cycle-3). */
function parseRootAccentTextFallbacks(themeCssText: string): {
  accentText: string;
  selectionBg: string;
} {
  const stripped = stripComments(themeCssText);
  // theme.css has THREE bare `:root {` blocks (a breakpoint block, a
  // nested media-query one, and the token-fallback one this pin needs) —
  // find all of them and pick the one declaring `--app-focus-ring-color`,
  // which only the target block does, rather than "the first/last bare
  // :root", which would be fragile to reordering.
  const rootBlockRe = /(?<!\])\s*:root\s*\{([\s\S]*?)\n\}/g;
  let rootMatch: RegExpExecArray | null;
  let targetBody: string | null = null;
  while ((rootMatch = rootBlockRe.exec(stripped))) {
    if (rootMatch[1].includes("--app-focus-ring-color")) {
      targetBody = rootMatch[1];
      break;
    }
  }
  if (targetBody === null) {
    throw new Error(
      "could not find the :root { ... } block containing --app-focus-ring-color in theme.css",
    );
  }
  const accentTextM = /--app-accent-text\s*:\s*(#[0-9a-fA-F]{6})\s*;/.exec(targetBody);
  const selectionBgM = /--app-selection-bg\s*:\s*(#[0-9a-fA-F]{6})\s*;/.exec(targetBody);
  if (accentTextM === null || selectionBgM === null) {
    throw new Error(
      "could not parse --app-accent-text/--app-selection-bg out of theme.css's bare :root block",
    );
  }
  return { accentText: accentTextM[1].toLowerCase(), selectionBg: selectionBgM[1].toLowerCase() };
}

describe("D14 static fallback anti-drift pin (HEL-1048, parses theme.css)", () => {
  it("theme.css's :root --app-accent-text equals the live derivation for DefaultAccentColorByTheme.dark", () => {
    const themeCss = fs.readFileSync(THEME_CSS_PATH, "utf-8");
    const parsed = parseRootAccentTextFallbacks(themeCss);
    expect(parsed.accentText).toBe(deriveAccentTextColor(DefaultAccentColorByTheme.dark, "dark"));
  });

  it("theme.css's :root --app-selection-bg equals the live derivation for DefaultAccentColorByTheme.dark", () => {
    const themeCss = fs.readFileSync(THEME_CSS_PATH, "utf-8");
    const parsed = parseRootAccentTextFallbacks(themeCss);
    expect(parsed.selectionBg).toBe(
      buildAccentTokens(DefaultAccentColorByTheme.dark, "dark")["--app-selection-bg"],
    );
  });

  // Self-test (the evaluator's own garbage-value method, run against a
  // temp copy so it can't touch the real file): proves the pin above
  // actually reads theme.css and would go red on the exact bug it exists
  // to catch, rather than passing regardless of what theme.css says.
  it("garbage-value self-test: corrupting the :root fallback in a temp copy of theme.css is caught by the parser+comparison", () => {
    const realThemeCss = fs.readFileSync(THEME_CSS_PATH, "utf-8");
    const corrupted = realThemeCss.replace(
      /(:root\s*\{[\s\S]*?--app-accent-text\s*:\s*)#[0-9a-fA-F]{6}(\s*;[\s\S]*?--app-selection-bg\s*:\s*)#[0-9a-fA-F]{6}(\s*;)/,
      "$1#ff0000$2#0000ff$3",
    );
    expect(corrupted).not.toBe(realThemeCss); // sanity: the replace actually matched
    const parsed = parseRootAccentTextFallbacks(corrupted);
    expect(parsed.accentText).toBe("#ff0000");
    expect(parsed.selectionBg).toBe("#0000ff");
    // The real assertions above compare THIS parsed shape against the live
    // derivation — with garbage values, that comparison is false the same
    // way it would be in the real file, proving the check is sensitive to
    // theme.css's actual content rather than vacuously true.
    expect(parsed.accentText).not.toBe(
      deriveAccentTextColor(DefaultAccentColorByTheme.dark, "dark"),
    );
    expect(parsed.selectionBg).not.toBe(
      buildAccentTokens(DefaultAccentColorByTheme.dark, "dark")["--app-selection-bg"],
    );
  });
});
