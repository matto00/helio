import fs from "fs";
import path from "path";

// Per-theme token coverage guard (HEL-444).
//
// Rule (design.md D1/D2/D9.2/D9.3): every `--app-*` custom property DECLARED
// inside `:root[data-theme="dark"]` in `frontend/src/theme/theme.css` must
// also be declared inside `:root[data-theme="light"]`, and vice versa. A
// token present in exactly one theme block silently resolves to an empty
// string wherever the OTHER theme is active -- the two selectors are
// siblings, neither inherits from the other, so there is no fallback chain
// that would otherwise mask the gap.
//
// This guard is deliberately NOT a duplicate of three neighbours it could
// be mistaken for:
//
//   1. `check-tokens.mjs` (HEL-1037) validates that a `var(--*)` REFERENCE
//      resolves ANYWHERE in the scanned CSS set. A token declared only in
//      the dark block still resolves there, so a dark-only token passes
//      check-tokens cleanly -- that guard has no notion of "declared in
//      both theme blocks", which is the only thing this guard checks.
//   2. `state-surface-contrast-guard.spec.ts` (HEL-866, `e2e/`) walks the
//      RUNNING app and asserts rendered contrast ratios. It is a dynamic,
//      browser-driven measurement with no static parse of `theme.css` at
//      all, so it is structurally blind to a token defined in one theme
//      block and absent from the other -- such a token still renders
//      *something* (the empty string, or whatever the shorthand's initial
//      value is), it just isn't a light/dark PARITY property that guard has
//      any way to see.
//   3. `focusRingTokenGuard.css.test.ts` / `accentTextSourceSyncGuard.css.test.ts`
//      each pin a SINGLE token's value against its derivation function --
//      single-token correctness, not cross-theme coverage of the whole
//      `--app-*` namespace.
//
// Runtime-set tokens (`--app-accent`, `--app-accent-ink`,
// `--app-focus-ring-color`, `--app-accent-text`, `--app-selection-bg`) are
// written inline on `<html>` by `applyAccentTokens`/`deriveAccentTextColor`
// (`appearance.ts`), which outranks every `:root[data-theme=...]` block.
// `--app-accent`/`--app-accent-ink` still carry a STATIC per-theme fallback
// declared in BOTH blocks (kept parseable, never rendered once the effect
// has run) and are covered by the ordinary parity check below like any
// other token. `--app-focus-ring-color`/`--app-accent-text`/
// `--app-selection-bg` are, by design (theme.css's own D9.1/D14 comments),
// declared in NEITHER theme block -- their only static fallback is a
// single theme-independent `:root` value pinned elsewhere by
// `accentTextSourceSyncGuard.css.test.ts` / `focusRingTokenGuard.css.test.ts`.
// "Declared in neither block" must be a NON-violation here (there is
// nothing asymmetric about a token both blocks agree not to declare) without
// that same leniency accidentally swallowing "declared in exactly one" --
// the two are structurally different (a set-difference of two EQUAL empty
// memberships is empty; a set-difference of one populated and one empty
// membership is not), and a dedicated test below exercises both shapes
// directly so this distinction can't silently erode as theme.css evolves.

const THEME_CSS_PATH = path.join(__dirname, "theme.css");

/** Strips /* ... *\/ comments, preserving newlines so line numbers survive. */
export function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "));
}

// Matches the two theme blocks by brace-depth, not a fixed line range, so
// theme.css is free to grow between them without this guard mis-scoping.
// Deliberately narrow: only `:root[data-theme="X"]`, never bare `:root`
// (the theme-invariant `--app-focus-ring-color`/`--app-accent-text`/
// `--app-selection-bg` trio living in the bare `:root` block above is
// INTENTIONALLY excluded from this per-theme walk -- see header comment).
export function extractThemeBlock(text: string, theme: "dark" | "light"): string | null {
  const marker = `:root[data-theme="${theme}"]`;
  const start = text.indexOf(marker);
  if (start === -1) return null;

  const openBrace = text.indexOf("{", start);
  if (openBrace === -1) return null;

  let depth = 0;
  let i = openBrace;
  for (; i < text.length; i++) {
    if (text[i] === "{") depth++;
    else if (text[i] === "}") {
      depth--;
      if (depth === 0) break;
    }
  }
  return text.slice(openBrace + 1, i);
}

// Same declaration-position anchor as check-tokens.mjs's DECLARATION_RE: a
// `--x:` must start a line or follow `{`/`;`, so a selector fragment can
// never be mistaken for a token declaration.
const DECLARATION_RE = /(^|[{;])[ \t\r\n]*(--app-[a-zA-Z0-9-]+)[ \t\r\n]*:/gm;

export function extractAppTokenDeclarations(blockText: string): Set<string> {
  const defs = new Set<string>();
  let m: RegExpExecArray | null;
  DECLARATION_RE.lastIndex = 0;
  while ((m = DECLARATION_RE.exec(blockText))) {
    defs.add(m[2]);
  }
  return defs;
}

// Exceptions are pinned to the EXACT token name and must carry a reason
// naming why the asymmetry is intentional (HEL-442's construction: pinned,
// never a pattern, demonstrably able to expire). Empty today -- AC1's
// measured state is zero live violations (29/29 --app-* tokens, symmetric in
// both directions) -- so this is pure headroom, not a working escape hatch.
export const EXCEPTIONS: Record<string, string> = {};

export interface ParityResult {
  errors: string[];
  darkOnly: Set<string>;
  lightOnly: Set<string>;
  darkCount: number;
  lightCount: number;
  staleExceptions: string[];
}

export function checkThemeParity(
  text: string,
  exceptions: Record<string, string> = EXCEPTIONS,
): ParityResult {
  const stripped = stripComments(text);
  const darkBlock = extractThemeBlock(stripped, "dark");
  const lightBlock = extractThemeBlock(stripped, "light");

  if (darkBlock === null || lightBlock === null) {
    return {
      errors: [
        'themeParityGuard: could not locate both :root[data-theme="dark"] and ' +
          ':root[data-theme="light"] blocks -- refusing to report a vacuous pass.',
      ],
      darkOnly: new Set(),
      lightOnly: new Set(),
      darkCount: 0,
      lightCount: 0,
      staleExceptions: [],
    };
  }

  const darkTokens = extractAppTokenDeclarations(darkBlock);
  const lightTokens = extractAppTokenDeclarations(lightBlock);

  // Non-vacuity floor (design D9.3 / task 8.7 CR3): a block that IS found
  // but yields zero declarations (regex drift, a refactor into
  // `@media`/`@layer`, a selector rewrite that drops the leading `:root`)
  // must not be reported as a clean pass just because the set difference of
  // two empty sets is empty.
  if (darkTokens.size === 0 || lightTokens.size === 0) {
    return {
      errors: [
        `themeParityGuard: located both theme blocks but extracted zero --app-* ` +
          `declarations from ${darkTokens.size === 0 ? '":root[data-theme=\\"dark\\"]"' : '":root[data-theme=\\"light\\"]"'} ` +
          `-- refusing to report a vacuous pass (this would otherwise silently pass ` +
          `if the declaration syntax or selector shape drifted).`,
      ],
      darkOnly: new Set(),
      lightOnly: new Set(),
      darkCount: darkTokens.size,
      lightCount: lightTokens.size,
      staleExceptions: [],
    };
  }

  const darkOnly = new Set([...darkTokens].filter((t) => !lightTokens.has(t)));
  const lightOnly = new Set([...lightTokens].filter((t) => !darkTokens.has(t)));

  const errors: string[] = [];
  const staleExceptions: string[] = [];

  for (const token of darkOnly) {
    if (Object.prototype.hasOwnProperty.call(exceptions, token)) continue;
    errors.push(`${token} is declared in the dark theme block but not the light one`);
  }
  for (const token of lightOnly) {
    if (Object.prototype.hasOwnProperty.call(exceptions, token)) continue;
    errors.push(`${token} is declared in the light theme block but not the dark one`);
  }

  // An exception naming a token that is no longer actually asymmetric is
  // stale and must be removed -- this is what makes the exception list
  // demonstrably able to EXPIRE (HEL-442's construction) rather than
  // silently accumulate dead entries.
  for (const token of Object.keys(exceptions)) {
    if (!darkOnly.has(token) && !lightOnly.has(token)) {
      staleExceptions.push(token);
      errors.push(
        `stale exception: "${token}" is pinned in EXCEPTIONS but is not actually ` +
          `single-theme-only anymore -- remove the entry`,
      );
    }
  }

  return {
    errors,
    darkOnly,
    lightOnly,
    darkCount: darkTokens.size,
    lightCount: lightTokens.size,
    staleExceptions,
  };
}

describe("theme parity guard (HEL-444)", () => {
  const rawText = fs.readFileSync(THEME_CSS_PATH, "utf-8");

  it("theme.css has zero live per-theme --app-* coverage violations (29/29, symmetric)", () => {
    const result = checkThemeParity(rawText);
    if (result.errors.length > 0) {
      throw new Error(`Found ${result.errors.length} violation(s):\n${result.errors.join("\n")}`);
    }
    expect(result.darkOnly.size).toBe(0);
    expect(result.lightOnly.size).toBe(0);
    // Pinned to the measured count so a silent count drift (a token added to
    // one block without the guard noticing a symmetric add elsewhere) is
    // visible in a failing assertion diff, not just a passing boolean.
    expect(result.darkCount).toBe(29);
    expect(result.lightCount).toBe(29);
  });

  it("has zero pinned exceptions today (AC1's measured baseline has no live asymmetry)", () => {
    expect(Object.keys(EXCEPTIONS)).toEqual([]);
  });

  it("treats a token declared in NEITHER block as a non-violation (runtime-set tokens)", () => {
    // Mirrors theme.css's real shape: --app-focus-ring-color / --app-accent-text
    // / --app-selection-bg are declared in a bare `:root` block, absent from
    // both per-theme blocks, by design.
    const fixture = `
      :root[data-theme="dark"] {
        --app-bg: #121110;
      }
      :root[data-theme="light"] {
        --app-bg: #f4f2ed;
      }
      :root {
        --app-focus-ring-color: #db6513;
      }
    `;
    const result = checkThemeParity(fixture, {});
    expect(result.errors).toEqual([]);
    expect(result.darkOnly.size).toBe(0);
    expect(result.lightOnly.size).toBe(0);
  });

  it("MUTATION ARM 1: a token in the dark block only goes RED", () => {
    const stripped = stripComments(rawText);
    const darkBlock = extractThemeBlock(stripped, "dark");
    expect(darkBlock).not.toBeNull();
    const mutated = rawText.replace(
      "--app-bg: #121110;",
      "--app-bg: #121110;\n  --app-hel444-mutation-probe: red;",
    );
    expect(mutated).not.toBe(rawText);
    const result = checkThemeParity(mutated, {});
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.darkOnly.has("--app-hel444-mutation-probe")).toBe(true);
  });

  it("MUTATION ARM 2: a stale exception naming a token that is NOT actually asymmetric goes RED", () => {
    const result = checkThemeParity(rawText, {
      "--app-hel444-nonexistent-stale-exception": "this token doesn't exist at all",
    });
    expect(result.staleExceptions).toContain("--app-hel444-nonexistent-stale-exception");
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it("MUTATION ARM 3 (CR3): a zero-declaration theme block goes RED, not a vacuous pass", () => {
    // A block that IS matched by the brace-depth walk but contains no
    // --app-* declarations at all (e.g. a refactor that moved every
    // declaration behind a nested @media, or renamed the custom-property
    // prefix) must not silently report darkOnly/lightOnly as both-empty and
    // therefore "OK".
    const fixture = `
      :root[data-theme="dark"] {
        /* declarations moved elsewhere */
      }
      :root[data-theme="light"] {
        --app-bg: #f4f2ed;
      }
    `;
    const result = checkThemeParity(fixture, {});
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toMatch(/zero --app-\* declarations/);
  });

  it("refuses a vacuous pass when a theme block is entirely absent", () => {
    const fixture = `:root[data-theme="dark"] { --app-bg: #121110; }`;
    const result = checkThemeParity(fixture, {});
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toMatch(/could not locate both/);
  });
});
