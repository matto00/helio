import fs from "fs";
import path from "path";
import { deriveFocusRingColor } from "./appearance";
import { ACCENT_PRESETS, DefaultAccentColorByTheme } from "./theme";

// Focus-ring contrast guard for HEL-1046 (design.md D1/D4).
//
// PROVES: `--app-focus-ring-color` — for the static `:root` value and for
// every derivation of all 8 `ACCENT_PRESETS` hexes — clears a 3:1 contrast
// ratio against EVERY surface declared in EITHER `:root[data-theme=...]`
// block of theme.css, at the moment this test runs.
//
// CANNOT PROVE: that the ring is actually PAINTED with that computed style
// on a genuinely focused element in a real browser. jsdom does not compute
// style (HEL-1005); that is task 5's real-browser evidence, recorded in
// `.concertino/runs/HEL-1046/evidence/`, not this file.
//
// D1/D4 — the binding surfaces are an OUTPUT of this guard, not an
// assumption: it RE-READS every `--app-bg`/`--app-surface*` literal-hex
// declaration from theme.css itself on every run (not a hardcoded
// `#efece6`/`#262320` pair, and not the palette extremes `#ffffff`/
// `#121110` — see design.md D1 on why the round-1 defect was exactly a
// hardcoded, wrong binding pair). If theme.css's surface set changes (e.g.
// HEL-866), this guard re-derives the new minimum and fails if the current
// token no longer clears it — it does not assert a value pinned at write
// time.
const THEME_CSS_PATH = path.join(__dirname, "theme.css");
const FOCUS_RING_TARGET = 3.0;

function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "));
}

/** Extracts a `:root[data-theme="X"] { ... }` block's raw body text. */
function extractThemeBlock(css: string, theme: "dark" | "light"): string {
  const re = new RegExp(`:root\\[data-theme=["']${theme}["']\\]\\s*\\{([\\s\\S]*?)\\n\\}`, "m");
  const match = re.exec(css);
  if (match === null) {
    throw new Error(`could not find :root[data-theme="${theme}"] block in theme.css`);
  }
  return match[1];
}

/**
 * Every literal `--app-bg*`/`--app-surface*` hex declared in a theme block —
 * i.e. every plain, non-accent-tinted surface a focused element can render
 * on top of. Deliberately excludes `--app-bg-accent`/`--app-bg-secondary`:
 * those are `color-mix(... var(--app-accent) ...)` outputs, so including
 * them would make "the surfaces the ring is scored against" depend on the
 * very accent the ring is derived from.
 */
function extractLiteralSurfaces(blockText: string): string[] {
  const hexRe = /--app-(?:bg|surface(?:-\w+)?)\s*:\s*(#[0-9a-fA-F]{6})\s*;/g;
  const hexes: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = hexRe.exec(blockText))) {
    hexes.push(m[1].toLowerCase());
  }
  return hexes;
}

function readAllSurfaces(): string[] {
  const raw = fs.readFileSync(THEME_CSS_PATH, "utf-8");
  const css = stripComments(raw);
  const dark = extractLiteralSurfaces(extractThemeBlock(css, "dark"));
  const light = extractLiteralSurfaces(extractThemeBlock(css, "light"));
  return [...dark, ...light];
}

function readStaticFocusRingColor(): string {
  const raw = fs.readFileSync(THEME_CSS_PATH, "utf-8");
  const css = stripComments(raw);
  const m = /--app-focus-ring-color\s*:\s*(#[0-9a-fA-F]{6})\s*;/.exec(css);
  if (m === null) {
    throw new Error("--app-focus-ring-color is not declared in theme.css");
  }
  return m[1].toLowerCase();
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

function minContrastAgainstAllSurfaces(ringHex: string, surfaces: string[]): number {
  return Math.min(...surfaces.map((surface) => contrastRatio(ringHex, surface)));
}

describe("focus-ring contrast guard (HEL-1046)", () => {
  it("re-derives at least 9 literal surfaces from theme.css (sanity: the walk isn't vacuous)", () => {
    const surfaces = readAllSurfaces();
    // 5 per theme (--app-bg, --app-surface, --app-surface-soft,
    // --app-surface-raised, --app-surface-strong) x 2 themes = 10, though
    // light's -raised/-strong happen to collide on #ffffff today. Asserting
    // >= 9 (not an exact literal count) keeps this from being the kind of
    // brittle pin that goes stale for an unrelated reason.
    expect(surfaces.length).toBeGreaterThanOrEqual(9);
  });

  it("includes --app-surface-soft (light) and --app-surface-strong (dark) — the D1 binding pair", () => {
    // Not asserting these are the MINIMUM (that would re-hardcode the
    // binding pair this guard exists to avoid assuming) — only that they are
    // present in the re-derived set, so a future edit that accidentally
    // drops one of them from theme.css is caught here too.
    const surfaces = readAllSurfaces();
    expect(surfaces).toContain("#efece6");
    expect(surfaces).toContain("#262320");
  });

  it("the static :root --app-focus-ring-color clears 3:1 against every re-derived surface", () => {
    const surfaces = readAllSurfaces();
    const ring = readStaticFocusRingColor();
    const min = minContrastAgainstAllSurfaces(ring, surfaces);
    expect(min).toBeGreaterThanOrEqual(FOCUS_RING_TARGET);
  });

  it("the static value equals deriveFocusRingColor(DefaultAccentColorByTheme.dark) — no drift", () => {
    const ring = readStaticFocusRingColor();
    expect(ring).toBe(deriveFocusRingColor(DefaultAccentColorByTheme.dark)?.toLowerCase());
  });

  it("every one of the 8 accent presets' derived ring color clears 3:1 against every re-derived surface", () => {
    const surfaces = readAllSurfaces();
    const failures: string[] = [];
    for (const { label, hex } of ACCENT_PRESETS) {
      const derived = deriveFocusRingColor(hex);
      if (derived === null) {
        failures.push(`${label} (${hex}): deriveFocusRingColor returned null`);
        continue;
      }
      const min = minContrastAgainstAllSurfaces(derived, surfaces);
      if (min < FOCUS_RING_TARGET) {
        failures.push(`${label} (${hex} → ${derived}): min contrast ${min.toFixed(3)} < 3.0`);
      }
    }
    expect(failures).toEqual([]);
  });

  // D4 mutation arm 1 — reverting the ring to the raw (undarkened, or
  // accent-bound) value must go RED. This is the guard's own required
  // negative control: run manually, not in CI, since it asserts the
  // OPPOSITE of the shipped state. See the comment below for how to
  // reproduce it by hand rather than baking a self-defeating branch into
  // this file.
  //
  // Manual repro (confirmed during implementation, not committed as code):
  //   1. Temporarily set `--app-focus-ring: 2px solid var(--app-accent);` in
  //      theme.css (theme.css's dead per-theme --app-accent lines make the
  //      rendered accent Orange #f97316 either way).
  //   2. Re-run this file's third test with the ring hardcoded to `#f97316`
  //      instead of `readStaticFocusRingColor()`.
  //   3. min contrast against #efece6 is 2.87 (< 3.0) — RED, confirming the
  //      guard is failable by mutation, not vacuously green.
  it("documents the confirmed mutation-red result for the guard-cannot-fail check (D4)", () => {
    // #f97316 (Orange, undarkened) against theme.css's own re-derived
    // surfaces — this is the literal mutation from the comment above,
    // executed here so the guard carries its own falsifiability evidence
    // instead of relying on a prose claim never re-run.
    const surfaces = readAllSurfaces();
    const undarkenedOrange = "#f97316";
    const min = minContrastAgainstAllSurfaces(undarkenedOrange, surfaces);
    expect(min).toBeLessThan(FOCUS_RING_TARGET);
  });
});

// Focus-ring TOKEN-ADOPTION guard (HEL-1046 CR2, cycle 2).
//
// PROVES: every `outline: <value>;` colour declaration under
// `frontend/src/**/*.css` is either `var(--app-focus-ring)` (BY NAME — the
// same discipline as the elevation guard's D0, never "contains any var()"),
// `none`, or an explicitly pinned exception naming its file, exact
// declaration text, and reason. In particular this catches a component
// stylesheet hand-copying `var(--app-accent)` (or any other literal/colour)
// straight into an `outline` — exactly the cycle-1 gap: `check:tokens` only
// proves a `var(--*)` reference RESOLVES, not which token a component
// chose, and the contrast guard above reads `theme.css` only, so neither
// could see the 17 component-stylesheet sites (15 `:focus-visible`, 1 bare
// `:focus`, 1 state class — see DESIGN.md §8) that were still painting the
// raw, undarkened accent.
//
// CANNOT PROVE (two known, deliberate gaps, not silently overstated):
// 1. That a pinned exception is itself accessibility-safe — that is a
//    human/design judgement (see the `App.css:43` skip-link pin below,
//    which is a deliberate `--app-text` ring, HEL-772) recorded once here,
//    not re-derived by this guard.
// 2. **This guard matches the `outline` SHORTHAND only.** A longhand
//    `outline-color: var(--app-accent);` (or any other colour) sitting
//    alongside a compliant `outline: var(--app-focus-ring);` would not be
//    caught — CSS applies the longhand's colour on top of the shorthand's,
//    so that pairing would silently repaint the ring. Confirmed as a real
//    (if currently unexercised) gap by a live mutation during cycle 3
//    review: adding `outline-color: var(--app-accent);` next to a
//    compliant `outline: var(--app-focus-ring);` rule left this guard
//    green. Zero longhand `outline-color` declarations exist anywhere in
//    `frontend/src` at the time of writing (verified:
//    `grep -rn "outline-color\s*:" frontend/src --include=*.css` — zero
//    hits) — not widened to cover it, since a check added for a case that
//    cannot currently occur would be unfalsifiable by a real mutation. If
//    a longhand `outline-color` declaration is ever introduced, THIS
//    guard will not catch it; broadening `OUTLINE_DECL_RE` to also match
//    `outline-color` declarations is the fix at that point.
//
// Parsing is comment-stripped and multi-declaration-aware but treats each
// `outline: ...;` occurrence independently (not multi-line-aware like the
// elevation guard) — no live `outline` declaration in this tree wraps
// across lines at the time of writing; if one ever does, this regex would
// under-match it and this comment's claim would need re-checking.
interface OutlinePin {
  file: string;
  declaration: string;
  count: number;
  note: string;
}

const OUTLINE_EXCEPTIONS: OutlinePin[] = [
  {
    file: "app/App.css",
    declaration: "outline: 2px solid var(--app-text);",
    count: 1,
    note: "HEL-772 — deliberate high-contrast skip-link ring, not the accent-derived ring: a position:fixed, viewport-top-anchored surface that must read clearly regardless of the chosen accent.",
  },
];

const OUTLINE_DECL_RE = /(?<!-)\boutline\s*:\s*([^;]+);/g;

function isAllowedOutline(decl: string): boolean {
  return /var\(--app-focus-ring\)/.test(decl) || /:\s*none\s*;?$/.test(decl);
}

function allCssFilesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...allCssFilesUnder(full));
    } else if (entry.isFile() && entry.name.endsWith(".css")) {
      out.push(full);
    }
  }
  return out;
}

function normalizeDecl(decl: string): string {
  return decl.replace(/\s+/g, " ").trim();
}

function scanOutlines(files: string[], usedPins: Map<OutlinePin, number>) {
  const hits: { file: string; declaration: string }[] = [];
  for (const abs of files) {
    const rel = path.relative(path.join(__dirname, ".."), abs);
    const text = stripComments(fs.readFileSync(abs, "utf-8"));
    let m: RegExpExecArray | null;
    while ((m = OUTLINE_DECL_RE.exec(text))) {
      const decl = normalizeDecl(m[0]);
      if (isAllowedOutline(decl)) continue;

      const pin = OUTLINE_EXCEPTIONS.find(
        (p) => p.file === rel && normalizeDecl(p.declaration) === decl,
      );
      if (pin) {
        usedPins.set(pin, (usedPins.get(pin) ?? 0) + 1);
        continue;
      }
      hits.push({ file: rel, declaration: decl });
    }
  }
  return hits;
}

describe("focus-ring token adoption guard (HEL-1046 CR2)", () => {
  const SRC_ROOT = path.join(__dirname, "..");
  const files = allCssFilesUnder(SRC_ROOT);

  it("finds more than one CSS file carrying a literal outline declaration (sanity: not vacuous)", () => {
    const withOutline = files.filter((f) =>
      OUTLINE_DECL_RE.test(stripComments(fs.readFileSync(f, "utf-8"))),
    );
    // OUTLINE_DECL_RE.test mutates lastIndex on a global regex — reset it
    // between calls so this count isn't silently order-dependent.
    OUTLINE_DECL_RE.lastIndex = 0;
    expect(withOutline.length).toBeGreaterThan(1);
  });

  it("every outline declaration is var(--app-focus-ring), none, or a pinned exception", () => {
    const usedPins = new Map<OutlinePin, number>();
    const hits = scanOutlines(files, usedPins);
    if (hits.length > 0) {
      const report = hits.map((h) => `${h.file}: \`${h.declaration}\``).join("\n");
      throw new Error(`Found ${hits.length} unguarded outline declaration(s):\n${report}`);
    }
    expect(hits).toEqual([]);
  });

  it("every pinned outline exception still matches its exact pinned count (no stale exceptions)", () => {
    const usedPins = new Map<OutlinePin, number>();
    scanOutlines(files, usedPins);
    for (const pin of OUTLINE_EXCEPTIONS) {
      expect([`${pin.file}:${pin.declaration}`, usedPins.get(pin) ?? 0]).toEqual([
        `${pin.file}:${pin.declaration}`,
        pin.count,
      ]);
    }
  });
});
