import fs from "fs";
import path from "path";
import { buildAccentTokens } from "./appearance";
import { ACCENT_PRESETS, type Theme } from "./theme";

// Contrast guard for HEL-533 (design.md D1-D4, D6, D9-D10).
//
// PROVES: every text-capable foreground token in theme.css clears WCAG AA
// (4.5:1) against every backdrop it is confirmed to render on as normal-size
// text — the five neutral surfaces per theme, plus each intent token's own
// `--app-*-surface` tint resolved as a `color-mix` composite over every
// neutral parent (D9's backdrop boundary). Also asserts a 4.5:1 floor on
// `--app-accent-ink` across all 8 `ACCENT_PRESETS` in both themes (D6).
//
// CANNOT PROVE: that a pair actually paints in the running app — this guard
// parses `theme.css` source (C2: the intent tokens and --app-text/-muted are
// static per-theme hexes, never runtime-rewritten, so the declared value IS
// the rendered value here). The rendered confirmation that a pair belongs in
// this guard's asserted set at all was performed separately against the
// running app (docs/contrast-audit.md, "Rendered confirmation" section) —
// this file re-derives the NUMBERS from source on every run, not the
// render-or-not classification, which is a one-time judgement recorded in
// the table.
//
// Cross-intent cells (e.g. --app-error on --app-warning-surface) are
// DELIBERATELY EXCLUDED from the asserted matrix per D10: the rendered walk
// found no instance of one intent token painted on a different intent's
// tint, so there is no obligation to hold them to any threshold. They are
// still computed and recorded (see the "cross-intent cells are recorded,
// not asserted" describe block below) so the table (D7) can cite the same
// numbers this guard would otherwise silently omit.
const THEME_CSS_PATH = path.join(__dirname, "theme.css");
const TEXT_TARGET = 4.5;
const INK_TARGET = 4.5;

type ThemeName = "dark" | "light";

function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "));
}

function extractThemeBlock(css: string, theme: ThemeName): string {
  const re = new RegExp(`:root\\[data-theme=["']${theme}["']\\]\\s*\\{([\\s\\S]*?)\\n\\}`, "m");
  const match = re.exec(css);
  if (match === null) {
    throw new Error(`could not find :root[data-theme="${theme}"] block in theme.css`);
  }
  return match[1];
}

interface RgbColor {
  r: number;
  g: number;
  b: number;
}

function hexToRgb(hex: string): RgbColor {
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

function relativeLuminance(c: RgbColor): number {
  const channels = [c.r, c.g, c.b].map((channel) => {
    const n = channel / 255;
    return n <= 0.03928 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrastRatio(a: RgbColor, b: RgbColor): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const hi = Math.max(la, lb);
  const lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}

/** Alpha-free `color-mix(in srgb, var(tint) N%, transparent)` composited
 * over an opaque neutral parent — D2's "resolve the tint, don't transcribe
 * it" requirement. */
function compositeMix(base: RgbColor, tint: RgbColor, percent: number): RgbColor {
  const p = percent / 100;
  return {
    r: tint.r * p + base.r * (1 - p),
    g: tint.g * p + base.g * (1 - p),
    b: tint.b * p + base.b * (1 - p),
  };
}

// The five neutral surface tokens, in the order they're declared.
const SURFACE_NAMES = [
  "--app-bg",
  "--app-surface",
  "--app-surface-soft",
  "--app-surface-raised",
  "--app-surface-strong",
] as const;

// Text-capable foreground tokens whose declared value IS their rendered
// value (C2) — accent-derived tokens are structurally excluded (C1, D9).
const FOREGROUND_NAMES = [
  "--app-text",
  "--app-text-muted",
  "--app-success",
  "--app-warning",
  "--app-error",
] as const;

// Each intent tint's `color-mix` base token — D9's boundary (neutrals + the
// three intent tints, nothing further).
const TINT_TO_BASE: Record<string, (typeof FOREGROUND_NAMES)[number]> = {
  "--app-success-surface": "--app-success",
  "--app-warning-surface": "--app-warning",
  "--app-error-surface": "--app-error",
};
const TINT_NAMES = Object.keys(TINT_TO_BASE);

interface ParsedTheme {
  surfaces: Record<string, string>;
  foregrounds: Record<string, string>;
  tints: Record<string, { percent: number; baseVar: string }>;
}

function parseHexDecl(block: string, name: string): string {
  const re = new RegExp(`${name}\\s*:\\s*(#[0-9a-fA-F]{6})\\s*;`);
  const m = re.exec(block);
  if (m === null) {
    throw new Error(`could not parse ${name} as a literal hex from theme.css`);
  }
  return m[1].toLowerCase();
}

function parseTintMix(block: string, name: string): { percent: number; baseVar: string } {
  const re = new RegExp(
    `${name}\\s*:\\s*color-mix\\(in srgb,\\s*var\\((--app-[\\w-]+)\\)\\s*(\\d+)%,\\s*transparent\\)`,
  );
  const m = re.exec(block);
  if (m === null) {
    throw new Error(`could not parse ${name} as a color-mix(...) tint from theme.css`);
  }
  return { baseVar: m[1], percent: Number.parseInt(m[2], 10) };
}

function parseTheme(css: string, theme: ThemeName): ParsedTheme {
  const block = extractThemeBlock(css, theme);
  const surfaces = Object.fromEntries(SURFACE_NAMES.map((n) => [n, parseHexDecl(block, n)]));
  const foregrounds = Object.fromEntries(FOREGROUND_NAMES.map((n) => [n, parseHexDecl(block, n)]));
  const tints = Object.fromEntries(TINT_NAMES.map((n) => [n, parseTintMix(block, n)]));
  return { surfaces, foregrounds, tints };
}

function readThemeCss(): { dark: ParsedTheme; light: ParsedTheme } {
  const raw = fs.readFileSync(THEME_CSS_PATH, "utf-8");
  const css = stripComments(raw);
  return { dark: parseTheme(css, "dark"), light: parseTheme(css, "light") };
}

/** Every intent-tint composite over every neutral surface, keyed by
 * `${tintName}::${surfaceName}`. */
function tintComposites(theme: ParsedTheme): Record<string, RgbColor> {
  const out: Record<string, RgbColor> = {};
  for (const tintName of TINT_NAMES) {
    const { percent, baseVar } = theme.tints[tintName];
    const baseHex = theme.foregrounds[baseVar as (typeof FOREGROUND_NAMES)[number]];
    for (const surfaceName of SURFACE_NAMES) {
      const key = `${tintName}::${surfaceName}`;
      out[key] = compositeMix(hexToRgb(theme.surfaces[surfaceName]), hexToRgb(baseHex), percent);
    }
  }
  return out;
}

interface Failure {
  pair: string;
  ratio: number;
  target: number;
}

/** The guard's asserted matrix (D4/D9/D10): every foreground x neutral
 * surface, every intent token x its OWN tint composite, and
 * `--app-text-muted` x every tint composite. Cross-intent cells are
 * deliberately NOT included here — see the module comment and D10. */
function assertedMatrix(theme: ParsedTheme): { pair: string; ratio: number }[] {
  const composites = tintComposites(theme);
  const results: { pair: string; ratio: number }[] = [];

  for (const fg of FOREGROUND_NAMES) {
    const fgRgb = hexToRgb(theme.foregrounds[fg]);
    for (const surface of SURFACE_NAMES) {
      const r = contrastRatio(fgRgb, hexToRgb(theme.surfaces[surface]));
      results.push({ pair: `${fg} on ${surface}`, ratio: r });
    }
  }

  for (const tintName of TINT_NAMES) {
    const baseVar = TINT_TO_BASE[tintName];
    const baseRgb = hexToRgb(theme.foregrounds[baseVar]);
    for (const surface of SURFACE_NAMES) {
      const composite = composites[`${tintName}::${surface}`];
      const r = contrastRatio(baseRgb, composite);
      results.push({ pair: `${baseVar} on ${tintName} over ${surface}`, ratio: r });
    }
  }

  const mutedRgb = hexToRgb(theme.foregrounds["--app-text-muted"]);
  for (const tintName of TINT_NAMES) {
    for (const surface of SURFACE_NAMES) {
      const composite = composites[`${tintName}::${surface}`];
      const r = contrastRatio(mutedRgb, composite);
      results.push({ pair: `--app-text-muted on ${tintName} over ${surface}`, ratio: r });
    }
  }

  return results;
}

function checkMatrix(theme: ParsedTheme, target: number): Failure[] {
  return assertedMatrix(theme)
    .filter(({ ratio }) => ratio < target)
    .map(({ pair, ratio }) => ({ pair, ratio, target }));
}

describe("token contrast guard (HEL-533)", () => {
  it("parses a non-empty, correctly-sized surface/foreground/tint set in both themes (vacuity refusal, D3)", () => {
    const { dark, light } = readThemeCss();
    for (const theme of [dark, light]) {
      expect(Object.keys(theme.surfaces)).toHaveLength(5);
      expect(Object.keys(theme.foregrounds)).toHaveLength(5);
      expect(Object.keys(theme.tints)).toHaveLength(3);
      // Every parsed mix percentage must be a real, positive number — a
      // regex that silently failed to capture a percent group would
      // otherwise compute composites against a wrongly-defaulted base.
      for (const { percent } of Object.values(theme.tints)) {
        expect(percent).toBeGreaterThan(0);
      }
    }
  });

  it("re-derives the light-theme composite figures design.md recorded before this change's remediation", () => {
    // Sanity pin against design.md's own measured baseline (pre-edit
    // values), re-derived from the ORIGINAL hexes rather than transcribed,
    // so this test documents the "before" state the table's "after"
    // column is compared to. Uses local hexes, not the live theme.css
    // values (which are now the corrected ones).
    const before = {
      success: hexToRgb("#1a7f4e"),
      warning: hexToRgb("#99621e"),
      error: hexToRgb("#c73a2a"),
    };
    const surfaceSoft = hexToRgb("#efece6");
    const successTint = compositeMix(surfaceSoft, before.success, 11);
    const warningTint = compositeMix(surfaceSoft, before.warning, 11);
    const errorTint = compositeMix(surfaceSoft, before.error, 10);
    expect(contrastRatio(before.success, successTint)).toBeCloseTo(3.71, 1);
    expect(contrastRatio(before.warning, warningTint)).toBeCloseTo(3.79, 1);
    expect(contrastRatio(before.error, errorTint)).toBeCloseTo(3.81, 1);
  });

  it("every asserted pair clears 4.5:1 in light theme (post-remediation)", () => {
    const { light } = readThemeCss();
    const failures = checkMatrix(light, TEXT_TARGET);
    if (failures.length > 0) {
      throw new Error(
        `Found ${failures.length} sub-AA light-theme pair(s):\n` +
          failures.map((f) => `${f.pair}: ${f.ratio.toFixed(3)} < ${f.target}`).join("\n"),
      );
    }
    expect(failures).toEqual([]);
  });

  it("every asserted pair clears 4.5:1 in dark theme", () => {
    const { dark } = readThemeCss();
    const failures = checkMatrix(dark, TEXT_TARGET);
    if (failures.length > 0) {
      throw new Error(
        `Found ${failures.length} sub-AA dark-theme pair(s):\n` +
          failures.map((f) => `${f.pair}: ${f.ratio.toFixed(3)} < ${f.target}`).join("\n"),
      );
    }
    expect(failures).toEqual([]);
  });

  it("the full asserted matrix covers >= 55 pairs per theme (sanity: not scoped to only today's failures, D4/4.2)", () => {
    // 5 fg x 5 surfaces + 3 intents x 5 tint-surface pairs + 1 muted x 3
    // tints x 5 surfaces = 25 + 15 + 15 = 55.
    const { dark, light } = readThemeCss();
    expect(assertedMatrix(dark).length).toBeGreaterThanOrEqual(55);
    expect(assertedMatrix(light).length).toBeGreaterThanOrEqual(55);
  });

  // D4 mutation arm — a regression must be catchable, not merely a
  // theoretical claim. This is a REAL mutation of a parsed ParsedTheme
  // structure run through the same `checkMatrix` the live tests use, not a
  // hand-computed number.
  it("mutation arm: reverting --app-success to its pre-remediation light hex fails the guard", () => {
    const { light } = readThemeCss();
    const mutated: ParsedTheme = {
      ...light,
      foregrounds: { ...light.foregrounds, "--app-success": "#1a7f4e" },
    };
    const failures = checkMatrix(mutated, TEXT_TARGET);
    expect(failures.length).toBeGreaterThan(0);
    expect(failures.some((f) => f.pair.includes("--app-success"))).toBe(true);
  });

  // Negative control — the same mutation arm's harness, run WITHOUT the
  // mutation, must stay green (proves the arm's redness above is caused by
  // the injected value, not by a bug in checkMatrix itself).
  it("negative control: the unmutated light theme passes the same harness", () => {
    const { light } = readThemeCss();
    expect(checkMatrix(light, TEXT_TARGET)).toEqual([]);
  });
});

// D10 — cross-intent cells (e.g. --app-error on --app-warning-surface) are
// measured so the table can cite them, but carry NO pass/fail assertion:
// the rendered walk found no instance of this composition anywhere in the
// app, so there is no threshold to hold them to. This describe block exists
// so the underlying numbers are re-derived from source (not transcribed
// into docs/contrast-audit.md by hand) without smuggling them into the
// asserted matrix above.
describe("cross-intent cells are recorded, not asserted (D10)", () => {
  function crossIntentCells(theme: ParsedTheme): { pair: string; ratio: number }[] {
    const composites = tintComposites(theme);
    const results: { pair: string; ratio: number }[] = [];
    for (const tintName of TINT_NAMES) {
      const tintBaseVar = TINT_TO_BASE[tintName];
      for (const fg of ["--app-success", "--app-warning", "--app-error"] as const) {
        if (fg === tintBaseVar) continue;
        const fgRgb = hexToRgb(theme.foregrounds[fg]);
        for (const surface of SURFACE_NAMES) {
          const composite = composites[`${tintName}::${surface}`];
          results.push({
            pair: `${fg} on ${tintName} over ${surface}`,
            ratio: contrastRatio(fgRgb, composite),
          });
        }
      }
    }
    return results;
  }

  // Evaluator CR4 (cycle 2): the original version of this test asserted
  // `cells.some((c) => c.ratio < TEXT_TARGET)`, which pins a sub-AA cell
  // into existence — a future change that lifts every cross-intent cell
  // above 4.5 would turn this guard RED, punishing an improvement. A guard
  // must fail when the code gets WORSE, never when it gets better. Fixed
  // to a coverage assertion instead: pin the expected cell COUNT (2 fg x 3
  // tints x 5 surfaces = 30 per theme), which stays green under any
  // ratio improvement and still fails if the cross-intent set is
  // mis-derived (e.g. a fg incorrectly excluded/included).
  it("re-derives exactly 30 dark-theme cross-intent cells (coverage, not a pinned failure)", () => {
    const { dark } = readThemeCss();
    const cells = crossIntentCells(dark);
    expect(cells.length).toBe(30);
  });
});

// D6 — --app-accent-ink contrast floor across all 8 ACCENT_PRESETS, both
// themes. `buildAccentTokens` picks ink by max(contrast(dark), contrast(light))
// with no floor; this asserts THE REAL FUNCTION'S OUTPUT actually clears AA.
//
// Evaluator CR3 (cycle 2): the original version of this block redeclared
// `READABLE_LIGHT`/`READABLE_DARK` and reimplemented the max-pick locally
// (`pickInk`), on the stated (and false) premise that `appearance.ts` "has
// no CSS parse step of its own" and so couldn't be imported —
// `accentTextSourceSyncGuard.css.test.ts:7` already imports
// `buildAccentTokens` from this same module in this same directory. A
// reimplementation lets `appearance.ts`'s actual ink selection drift out
// from under this guard silently (editing the tie-break at
// `buildAccentTokens`'s `ink` computation would leave the old version
// green) — exactly the transcription drift D2 forbids. Fixed to import and
// assert the real function's output.
describe("--app-accent-ink contrast floor (HEL-533 D6)", () => {
  function inkRatioFor(accentHex: string, theme: Theme): number {
    const tokens = buildAccentTokens(accentHex, theme);
    return contrastRatio(hexToRgb(tokens["--app-accent-ink"]), hexToRgb(accentHex));
  }

  it("covers all 8 shipped presets (sanity: not vacuous)", () => {
    expect(ACCENT_PRESETS.length).toBe(8);
  });

  it("every preset's buildAccentTokens-selected accent-ink clears 4.5:1 against its accent, in both themes", () => {
    const failures: string[] = [];
    for (const { label, hex } of ACCENT_PRESETS) {
      for (const theme of ["light", "dark"] as const) {
        const ratio = inkRatioFor(hex, theme);
        if (ratio < INK_TARGET) {
          failures.push(`${label} (${hex}, ${theme}): ${ratio.toFixed(3)} < ${INK_TARGET}`);
        }
      }
    }
    expect(failures).toEqual([]);
  });

  // Mutation arm — a preset hex picked to sit in the "neither candidate
  // clears 4.5" gap must fail this guard. #7a7a7a is the mid-luminance
  // gray (searched over all 256 gray levels) whose BETTER candidate still
  // scores lowest against both readable inks (4.24), proving the
  // assertion is failable rather than vacuously true for any accent. Run
  // through the real `buildAccentTokens`, not a reimplementation.
  it("mutation arm: a mid-gray accent (clears neither candidate) fails the floor", () => {
    const ratio = inkRatioFor("#7a7a7a", "dark");
    expect(ratio).toBeLessThan(INK_TARGET);
  });
});
