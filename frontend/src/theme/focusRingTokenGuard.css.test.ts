import fs from "fs";
import os from "os";
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

// ===========================================================================
// Border/box-shadow focus-indicator guard (HEL-1050, design.md D5/D5a).
//
// PROVES: for every selector BASE (a selector with trailing pseudo-classes
// stripped) that declares `outline: none` ANYWHERE in its group of rules
// (across the whole file tree, not just the same CSS rule — D4's remedy puts
// the suppression on a base rule and the indicator in a sibling
// `:focus-visible` rule), some rule in that group whose selector carries
// `:focus-visible` declares a conforming indicator (part 1), and no
// indicator declaration in a genuine focus rule references the bare, raw
// `var(--app-accent)` (part 2). It also proves `--app-accent-strong` is not
// a conforming focus colour for at least one accent preset (Yellow), by
// PARSING its mix percentage/base colour out of theme.css rather than
// trusting a hardcoded ratio (D5a).
//
// CANNOT PROVE:
// 1. That a colour composed at RUNTIME (inline style, JS-computed) is
//    conforming — this guard reasons about CSS text only.
// 2. That a token whose VALUE is conforming while its NAME is not would be
//    caught — it matches token references by name
//    (`var(--app-focus-ring-color)` / `var(--app-focus-ring)`), so renaming
//    a token without updating this guard defeats it.
// 3. Arbitrary runtime composition. It CAN evaluate one specific, simple
//    two-colour sRGB mix that it has PARSED directly from theme.css's
//    `--app-accent-strong` declaration (D5a) — that is not the same claim as
//    "cannot evaluate `color-mix`" (round 1's wording, which this guard's
//    4.3 check would make false).
// ===========================================================================

const INDICATOR_PROPERTIES = new Set([
  "outline",
  "outline-color",
  "border-color",
  "border-top-color",
  "border-right-color",
  "border-bottom-color",
  "border-left-color",
  "box-shadow",
]);

interface Declaration {
  property: string;
  value: string;
  selector: string; // the single (comma-split) selector this declaration's rule carries
}

interface BorderPin {
  file: string;
  selector: string;
  count: number;
  reason: string;
  owner: string;
}

// D5/4.1b — the one required pin. `.add-source-modal__cell-input,
// .add-source-modal__cell-select` declares `outline: none` on its base rule
// with only a bare `:focus` sibling (no `:focus-visible` anywhere in the
// group), so it fails the check below. D9 forbids editing it: it is
// orphaned CSS (zero markup references — see design.md D9). HEL-1052 is
// expected to DELETE this pin, whichever way that ticket resolves — it is a
// temporary owned exception, not a permanent hole.
// NOTE: task 4.1a's own instruction ("split comma-separated selector lists
// BEFORE normalising") means `.add-source-modal__cell-input,
// .add-source-modal__cell-select` becomes TWO independent base groups, not
// one joined base — splitting is what makes `inputs.css:36-38`'s
// three-selector list (three UNRELATED component classes) attribute
// correctly, and the same splitting is what turns this pair into two
// groups. Pinning both, rather than a single joined-text pin, is the direct
// mechanical consequence of that same splitting requirement — not a
// deviation from D9's reasoning, which names the whole comma-list rule, not
// a specific one of its two selectors.
const BORDER_INDICATOR_PINS: BorderPin[] = [
  {
    file: "features/sources/ui/AddSourceModal.css",
    selector: ".add-source-modal__cell-input",
    count: 1,
    reason: "orphaned CSS, zero markup references (D9)",
    owner: "HEL-1052",
  },
  {
    file: "features/sources/ui/AddSourceModal.css",
    selector: ".add-source-modal__cell-select",
    count: 1,
    reason: "orphaned CSS, zero markup references (D9)",
    owner: "HEL-1052",
  },
];

/** Splits a rule's raw selector list on top-level commas (none of the
 * selectors touched by this guard use commas inside `:not(...)`, so a plain
 * split is sufficient — `inputs.css:36-38`'s three-selector list is exactly
 * the shape this exists for). */
function splitSelectorList(raw: string): string[] {
  return raw
    .split(",")
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter((s) => s.length > 0);
}

/** Strips every `:not(...)` construct's CONTENTS (matched non-greedily, no
 * nested parens per D5/4.1a) before testing for `:focus`/`:focus-visible` —
 * NOT the base-normalised selector (that would make every rule vacuously
 * non-focus) and NOT a naive substring test on the raw selector (that would
 * admit `:hover:not(:disabled):not(:focus)`, which literally contains the
 * substring `:focus` inside a negation). */
function isFocusRule(rawSelector: string): boolean {
  const withoutNegations = rawSelector.replace(/:not\([^()]*\)/g, "");
  return /:focus(-visible)?(?![\w-])/.test(withoutNegations);
}

/** True if the selector carries `:focus-visible` directly (used for part 1,
 * which quantifies over `:focus-visible` rules specifically, not all focus
 * rules). */
function isFocusVisibleRule(rawSelector: string): boolean {
  return /:focus-visible(?![\w-])/.test(rawSelector);
}

/** Normalises a selector to its BASE by repeatedly stripping trailing
 * pseudo-classes (`:focus`, `:focus-visible`, `:hover`, `:disabled`,
 * `:not(...)`) — selector-base granularity per D5, so a base-rule
 * `outline: none` and its sibling `:focus-visible` indicator rule land in
 * the same group even though they are different CSS rules. */
function selectorBase(selector: string): string {
  let s = selector.trim();
  const trailingRe = /(:hover|:focus-visible|:focus|:disabled|:not\([^()]*\))\s*$/;
  let changed = true;
  while (changed) {
    changed = false;
    const m = trailingRe.exec(s);
    if (m) {
      s = s.slice(0, m.index).trim();
      changed = true;
    }
  }
  return s;
}

/** Extracts `{selector, declarations}` rule bodies from CSS text. Regex-based
 * (matches the existing guard's style, D0's "re-derive, don't hardcode"
 * discipline) — a rule with no nested braces in its selector or body is
 * matched directly; a rule nested inside `@media { ... }` is still matched
 * on its own (the `@media` wrapper itself never satisfies the no-nested-
 * brace body constraint, so it is simply never a match target itself). */
function extractRules(css: string): { selector: string; body: string }[] {
  const rules: { selector: string; body: string }[] = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(css))) {
    const selectorText = m[1].trim();
    if (selectorText.startsWith("@")) continue; // e.g. a flattened @media prelude fragment
    rules.push({ selector: selectorText, body: m[2] });
  }
  return rules;
}

function parseDeclarations(body: string, selector: string): Declaration[] {
  const decls: Declaration[] = [];
  for (const raw of body.split(";")) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    const idx = trimmed.indexOf(":");
    if (idx === -1) continue;
    const property = trimmed.slice(0, idx).trim().toLowerCase();
    const value = trimmed.slice(idx + 1).trim();
    decls.push({ property, value, selector });
  }
  return decls;
}

/** Collects every declaration in the tree, expanded per comma-split selector
 * (D5/4.1a — a declaration in a three-selector rule is attributed to EVERY
 * resulting base). */
function collectAllDeclarations(files: string[]): Map<string, Declaration[]> {
  // Keyed by `${relFile}::${base}`.
  const groups = new Map<string, Declaration[]>();
  for (const abs of files) {
    const rel = path.relative(path.join(__dirname, ".."), abs);
    const css = stripComments(fs.readFileSync(abs, "utf-8"));
    for (const { selector: rawSelectorList, body } of extractRules(css)) {
      for (const selector of splitSelectorList(rawSelectorList)) {
        const decls = parseDeclarations(body, selector);
        const base = selectorBase(selector);
        const key = `${rel}::${base}`;
        const existing = groups.get(key) ?? [];
        existing.push(...decls);
        groups.set(key, existing);
      }
    }
  }
  return groups;
}

function declarationIsBareAccent(value: string): boolean {
  return /var\(--app-accent\)/.test(value);
}

function declarationIsConformingRing(value: string): boolean {
  return /var\(--app-focus-ring-color\)/.test(value) || /var\(--app-focus-ring\)/.test(value);
}

function groupDeclaresOutlineNone(decls: Declaration[]): boolean {
  return decls.some((d) => d.property === "outline" && /^none$/.test(d.value.trim()));
}

interface BorderGroupFailure {
  key: string;
  reason: string;
}

function checkBorderIndicatorGuard(groups: Map<string, Declaration[]>): {
  failures: BorderGroupFailure[];
  pinUsage: Map<string, number>;
} {
  const failures: BorderGroupFailure[] = [];
  const pinUsage = new Map<string, number>();

  for (const [key, decls] of groups) {
    if (!groupDeclaresOutlineNone(decls)) continue;

    const [file, base] = key.split("::");

    const pin = BORDER_INDICATOR_PINS.find((p) => p.file === file && p.selector === base);

    // Part 1: some indicator declaration in a :focus-visible rule of the
    // group references the conforming ring token.
    const part1 = decls.some(
      (d) =>
        INDICATOR_PROPERTIES.has(d.property) &&
        isFocusVisibleRule(d.selector) &&
        declarationIsConformingRing(d.value),
    );

    // Part 2: no indicator declaration in a genuine focus rule (raw
    // selector, :not(...) contents stripped, THEN tested) references the
    // bare raw accent. Scoped to focus rules only — evaluating this
    // group-wide would reject PanelGrid's untouched hover rule, which this
    // change deliberately does not touch (design.md D5).
    const part2Violations = decls.filter(
      (d) =>
        INDICATOR_PROPERTIES.has(d.property) &&
        isFocusRule(d.selector) &&
        declarationIsBareAccent(d.value),
    );
    const part2 = part2Violations.length === 0;

    if (part1 && part2) continue;

    if (pin) {
      pinUsage.set(key, (pinUsage.get(key) ?? 0) + 1);
      continue;
    }

    const reasons: string[] = [];
    if (!part1) {
      reasons.push("no :focus-visible rule in the group declares a conforming indicator (part 1)");
    }
    if (!part2) {
      reasons.push(
        `focus rule(s) reference the bare raw accent: ${part2Violations
          .map((d) => `${d.selector} { ${d.property}: ${d.value} }`)
          .join("; ")} (part 2)`,
      );
    }
    failures.push({ key, reason: reasons.join("; ") });
  }

  return { failures, pinUsage };
}

describe("border/box-shadow focus-indicator guard (HEL-1050)", () => {
  const SRC_ROOT = path.join(__dirname, "..");
  const files = allCssFilesUnder(SRC_ROOT);

  it("finds more than one base-rule outline:none group (sanity: not vacuous)", () => {
    const groups = collectAllDeclarations(files);
    const withOutlineNone = [...groups.values()].filter(groupDeclaresOutlineNone);
    expect(withOutlineNone.length).toBeGreaterThan(1);
  });

  it("every base declaring outline:none has a conforming :focus-visible indicator, or a pinned exception", () => {
    const groups = collectAllDeclarations(files);
    const { failures } = checkBorderIndicatorGuard(groups);
    if (failures.length > 0) {
      const report = failures.map((f) => `${f.key}: ${f.reason}`).join("\n");
      throw new Error(
        `Found ${failures.length} unguarded border/box-shadow focus site(s):\n${report}`,
      );
    }
    expect(failures).toEqual([]);
  });

  it("every pinned border-indicator exception still matches its exact pinned count", () => {
    const groups = collectAllDeclarations(files);
    const { pinUsage } = checkBorderIndicatorGuard(groups);
    for (const pin of BORDER_INDICATOR_PINS) {
      const key = `${pin.file}::${pin.selector}`;
      expect([key, pinUsage.get(key) ?? 0]).toEqual([key, pin.count]);
    }
  });

  // Task 4.2 mutation arms — each must go RED for the STATED reason, not
  // merely red.
  //
  // Evaluator CR3 (cycle 2): the ORIGINAL version of arms (a)-(d) ran only
  // against hand-built `Map<string, Declaration[]>` fixtures, which exercise
  // `checkBorderIndicatorGuard` but bypass the entire collection pipeline
  // (`extractRules` -> `splitSelectorList` -> `parseDeclarations` ->
  // `selectorBase`) — exactly where a mutation could silently fail to land
  // (a regex not matching the injected CSS text, a selector not splitting
  // the way the comment assumes, etc). The prose comments asserted a
  // real-tree run the committed test never performed. Fixed per CR3 option
  // (b), the stronger fix: arms (a) and (c) below are additionally driven
  // through `collectAllDeclarations` over a REAL temporary `.css` fixture
  // file on disk, so the full pipeline is in the loop, not just the
  // predicate. The synthetic `Map`-based versions are KEPT alongside them
  // (they isolate the predicate's own behaviour precisely, without the
  // pipeline's file-system/regex noise) but their comments no longer claim
  // a real-tree run — that claim now lives only on the fixture-driven arms,
  // where it is true.
  //
  // Arm (a), PIPELINE-DRIVEN — add a bare `var(--app-accent)` declaration
  // ALONGSIDE the retained ring declaration in a real `.css` fixture file's
  // `:focus-visible` rule, run through the real `extractRules` ->
  // `splitSelectorList` -> `parseDeclarations` -> `selectorBase` pipeline
  // (must fail part 2 ALONE, proving part 2's token matching is not
  // silently matching nothing).
  it("mutation arm (a), pipeline-driven: a real fixture file with a bare accent declaration alongside the ring fails part 2 alone", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hel1050-arm-a-"));
    const fixturePath = path.join(dir, "ArmAFixture.css");
    try {
      fs.writeFileSync(
        fixturePath,
        `.arm-a-input:focus-visible {\n` +
          `  outline: none;\n` +
          `  border-color: var(--app-focus-ring-color);\n` +
          `  border-top-color: var(--app-accent);\n` +
          `}\n`,
      );
      const groups = collectAllDeclarations([fixturePath]);
      const { failures } = checkBorderIndicatorGuard(groups);
      expect(failures).toHaveLength(1);
      expect(failures[0].reason).toContain("part 2");
      expect(failures[0].reason).not.toContain("part 1");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  // Arm (c), PIPELINE-DRIVEN — a real fixture file whose ONLY rule declares
  // `outline: none` with no sibling `:focus-visible` rule anywhere in the
  // file, run through the same real pipeline. Must fail the selector-base
  // check (no rule in the file can satisfy part 1).
  it("mutation arm (c), pipeline-driven: a real fixture file with an unguarded outline:none fails part 1", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hel1050-arm-c-"));
    const fixturePath = path.join(dir, "ArmCFixture.css");
    try {
      fs.writeFileSync(fixturePath, `.arm-c-input {\n  outline: none;\n}\n`);
      const groups = collectAllDeclarations([fixturePath]);
      const { failures } = checkBorderIndicatorGuard(groups);
      expect(failures).toHaveLength(1);
      expect(failures[0].reason).toContain("part 1");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  // Arm (a), SYNTHETIC — isolates `checkBorderIndicatorGuard`'s own
  // predicate against a hand-built `Declaration[]` group, bypassing
  // `extractRules`/`splitSelectorList`/`parseDeclarations`/`selectorBase`
  // entirely (those are covered by the pipeline-driven arm above). Kept
  // because it pins the predicate's behaviour precisely, without needing to
  // reason about CSS-text regex matching at the same time.
  it("mutation arm (a), synthetic: a hand-built group with a bare accent declaration alongside the ring fails part 2 alone", () => {
    const groups = new Map<string, Declaration[]>();
    const key = "shared/ui/inputs.css::.ui-input";
    groups.set(key, [
      { property: "outline", value: "none", selector: ".ui-input:focus-visible" },
      {
        property: "border-color",
        value: "var(--app-focus-ring-color)",
        selector: ".ui-input:focus-visible",
      },
      // The injected mutation: a bare accent reference ALONGSIDE the ring.
      {
        property: "border-top-color",
        value: "var(--app-accent)",
        selector: ".ui-input:focus-visible",
      },
    ]);
    const { failures } = checkBorderIndicatorGuard(groups);
    expect(failures).toHaveLength(1);
    expect(failures[0].reason).toContain("part 2");
    expect(failures[0].reason).not.toContain("part 1");
  });

  // Arm (b), SYNTHETIC — delete the ring-token declaration from the
  // focus-visible rule, leaving only the (differently-named)
  // `--app-accent-dim` halo. This is the vacuity check: without part 1, ANY
  // box-shadow at all would satisfy the guard. Must fail part 1. Isolates
  // the predicate only (see the arm (a)/(c) comment above for why the
  // pipeline is exercised separately, and CONTRIBUTING.md's file-size
  // guidance is why not every arm gets a fixture-file twin here).
  it("mutation arm (b), synthetic: a hand-built group with the ring declaration deleted fails part 1 (vacuity)", () => {
    const groups = new Map<string, Declaration[]>();
    const key = "shared/ui/inputs.css::.ui-input";
    groups.set(key, [
      { property: "outline", value: "none", selector: ".ui-input:focus-visible" },
      // Ring declaration deleted — only the halo remains.
      {
        property: "box-shadow",
        value: "0 0 0 3px var(--app-accent-dim)",
        selector: ".ui-input:focus-visible",
      },
    ]);
    const { failures } = checkBorderIndicatorGuard(groups);
    expect(failures).toHaveLength(1);
    expect(failures[0].reason).toContain("part 1");
    expect(failures[0].reason).not.toContain("part 2");
  });

  // Arm (c), SYNTHETIC — a hand-built base rule declares `outline: none`
  // with no sibling `:focus-visible` rule at all. Must fail the
  // selector-base check (no rule anywhere in the group can satisfy part 1).
  // See the pipeline-driven arm (c) above for the same case run through the
  // real file-collection pipeline.
  it("mutation arm (c), synthetic: a hand-built group with an unguarded outline:none fails part 1", () => {
    const groups = new Map<string, Declaration[]>();
    const key = "some/File.css::.some-input";
    groups.set(key, [{ property: "outline", value: "none", selector: ".some-input" }]);
    const { failures } = checkBorderIndicatorGuard(groups);
    expect(failures).toHaveLength(1);
    expect(failures[0].reason).toContain("part 1");
  });

  // Arm (d), SYNTHETIC — a GREEN assertion, not a red one. With task 3.5
  // correctly applied, the guard must be green while PanelGrid.css's
  // untouched hover rule
  // `.ui-input.panel-grid-card__title-input:hover:not(:disabled):not(:focus)`
  // (declaring `border-bottom-color: var(--app-accent)`) is present in the
  // SAME group as the fixed base + :focus-visible rules. The group here is
  // hand-built (mirroring the REAL `PanelGrid.css` shape, verified against
  // the live guard run over the real tree via the "every base declaring
  // outline:none…" test above, which passes against this exact file). The
  // inline `isFocusRuleNaiveSubstring` swap below, run against this same
  // hand-built group, is what actually demonstrates the `:not(...)`
  // handling is load-bearing — it turns RED under the naive substring
  // implementation, so this arm is not vacuous.
  it("mutation arm (d), synthetic: a hand-built group mirroring PanelGrid.css's shape stays green with the untouched hover rule present", () => {
    const groups = new Map<string, Declaration[]>();
    const key = "features/panels/ui/grid/PanelGrid.css::.ui-input.panel-grid-card__title-input";
    groups.set(key, [
      { property: "border", value: "none", selector: ".ui-input.panel-grid-card__title-input" },
      {
        property: "border-bottom",
        value: "1px solid var(--app-accent)",
        selector: ".ui-input.panel-grid-card__title-input",
      },
      // The untouched hover rule this ticket deliberately does not edit.
      {
        property: "border-color",
        value: "transparent",
        selector: ".ui-input.panel-grid-card__title-input:hover:not(:disabled):not(:focus)",
      },
      {
        property: "border-bottom-color",
        value: "var(--app-accent)",
        selector: ".ui-input.panel-grid-card__title-input:hover:not(:disabled):not(:focus)",
      },
      {
        property: "outline",
        value: "none",
        selector: ".ui-input.panel-grid-card__title-input:focus-visible",
      },
      {
        property: "box-shadow",
        value: "none",
        selector: ".ui-input.panel-grid-card__title-input:focus-visible",
      },
      {
        property: "border-bottom-color",
        value: "var(--app-focus-ring-color)",
        selector: ".ui-input.panel-grid-card__title-input:focus-visible",
      },
    ]);
    const { failures } = checkBorderIndicatorGuard(groups);
    expect(failures).toEqual([]);

    // Confirm this arm is not vacuous: swap in a naive substring
    // implementation of isFocusRule (`selector.includes(":focus")`, which
    // admits the hover rule's `:not(:focus)` and turns part 2 red on the
    // untouched hover declaration) and verify it DOES flip red.
    function isFocusRuleNaiveSubstring(selector: string): boolean {
      return selector.includes(":focus");
    }
    function checkWithNaiveIsFocusRule(decls: Declaration[]): boolean {
      const part2Violations = decls.filter(
        (d) =>
          INDICATOR_PROPERTIES.has(d.property) &&
          isFocusRuleNaiveSubstring(d.selector) &&
          declarationIsBareAccent(d.value),
      );
      return part2Violations.length === 0;
    }
    const groupDecls = groups.get(key)!;
    expect(checkWithNaiveIsFocusRule(groupDecls)).toBe(false);
  });
});

describe("--app-accent-strong is not a conforming focus colour (HEL-1050 D5a)", () => {
  /** Parses `--app-accent-strong: color-mix(in srgb, var(--app-accent) N%,
   * (white|black));` out of a theme block's raw text — the mix percentage
   * and base colour are read from theme.css itself, not hardcoded, so this
   * assertion tracks a future change to the mix rather than silently
   * drifting (D5a). */
  function parseAccentStrongMix(blockText: string): { percent: number; base: "white" | "black" } {
    const re =
      /--app-accent-strong\s*:\s*color-mix\(in srgb,\s*var\(--app-accent\)\s*(\d+)%\s*,\s*(white|black)\)/;
    const m = re.exec(blockText);
    if (m === null) {
      throw new Error("could not parse --app-accent-strong color-mix declaration from theme.css");
    }
    return { percent: Number.parseInt(m[1], 10), base: m[2] as "white" | "black" };
  }

  function mixWith(
    accent: { r: number; g: number; b: number },
    percent: number,
    base: "white" | "black",
  ) {
    const baseRgb = base === "white" ? { r: 255, g: 255, b: 255 } : { r: 0, g: 0, b: 0 };
    const p = percent / 100;
    return {
      r: accent.r * p + baseRgb.r * (1 - p),
      g: accent.g * p + baseRgb.g * (1 - p),
      b: accent.b * p + baseRgb.b * (1 - p),
    };
  }

  it("re-parses both theme blocks' --app-accent-strong mix (sanity: not vacuous)", () => {
    const raw = fs.readFileSync(THEME_CSS_PATH, "utf-8");
    const css = stripComments(raw);
    const dark = parseAccentStrongMix(extractThemeBlock(css, "dark"));
    const light = parseAccentStrongMix(extractThemeBlock(css, "light"));
    expect(dark.percent).toBeGreaterThan(0);
    expect(light.percent).toBeGreaterThan(0);
  });

  it("at least one accent preset fails 3:1 for --app-accent-strong in at least one theme, and Yellow is among the failures", () => {
    const raw = fs.readFileSync(THEME_CSS_PATH, "utf-8");
    const css = stripComments(raw);
    const darkMix = parseAccentStrongMix(extractThemeBlock(css, "dark"));
    const lightMix = parseAccentStrongMix(extractThemeBlock(css, "light"));
    const darkSurfaces = extractLiteralSurfaces(extractThemeBlock(css, "dark"));
    const lightSurfaces = extractLiteralSurfaces(extractThemeBlock(css, "light"));

    const failingPresets: string[] = [];
    for (const { label, hex } of ACCENT_PRESETS) {
      const rgb = hexToRgb(hex);

      const darkStrong = mixWith(rgb, darkMix.percent, darkMix.base);
      const darkHex = toHex(darkStrong);
      const darkMin = Math.min(...darkSurfaces.map((s) => contrastRatio(darkHex, s)));

      const lightStrong = mixWith(rgb, lightMix.percent, lightMix.base);
      const lightHex = toHex(lightStrong);
      const lightMin = Math.min(...lightSurfaces.map((s) => contrastRatio(lightHex, s)));

      if (darkMin < FOCUS_RING_TARGET || lightMin < FOCUS_RING_TARGET) {
        failingPresets.push(label);
      }
    }

    // Not vacuous: assert at least one preset actually fails, so this
    // cannot pass merely because the parse returned nothing meaningful.
    expect(failingPresets.length).toBeGreaterThan(0);
    expect(failingPresets).toContain("Yellow");
  });

  function toHex(c: { r: number; g: number; b: number }): string {
    const clamp = (n: number) => Math.max(0, Math.min(255, Math.round(n)));
    const h = (n: number) => clamp(n).toString(16).padStart(2, "0");
    return `#${h(c.r)}${h(c.g)}${h(c.b)}`;
  }
});
