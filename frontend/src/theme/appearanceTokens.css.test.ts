import fs from "fs";
import path from "path";

import { COMPACT_GRID_GUTTER_PX, GRID_GUTTER_PX } from "../features/panels/ui/grid/panelGridConfig";

// HEL-1572. jsdom loads no theme.css, so these are static assertions on the source: the density / type-style /
// motion token sets the root attributes switch between, and the TS <-> CSS sync of the grid gutters.
const css = fs.readFileSync(path.join(__dirname, "theme.css"), "utf-8");

/** The declaration body of the first rule whose selector (list) is exactly `selector`. */
function rule(selector: string, from = 0): string {
  const start = css.indexOf(`${selector} {`, from);
  if (start === -1) throw new Error(`rule not found: ${selector}`);
  return css.slice(css.indexOf("{", start) + 1, css.indexOf("}", start));
}

/** Escapes every regex metacharacter (and `-`, `/`) so a property name is matched literally. */
function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\/-]/g, "\\$&");
}

function decl(body: string, prop: string): string {
  const match = new RegExp(`${escapeRegExp(prop)}:\\s*([^;]+);`).exec(body);
  if (!match) throw new Error(`declaration not found: ${prop}`);
  return match[1].trim();
}

/** `18px`, `1.125rem` or `var(--space-N)` to px. */
function px(value: string): number {
  if (value.endsWith("px")) return parseFloat(value);
  if (value.endsWith("rem")) return parseFloat(value) * 16;
  const space = /^var\(--(space-\d+)\)$/.exec(value);
  if (space) return px(decl(rule(":root"), `--${space[1]}`));
  throw new Error(`cannot resolve ${value}`);
}

describe("density tokens", () => {
  const comfortable = rule(":root");
  const compact = rule(':root[data-density="compact"]');

  it("sync guard: Comfortable --density-grid-gap equals GRID_GUTTER_PX", () => {
    expect(px(decl(comfortable, "--density-grid-gap"))).toBe(GRID_GUTTER_PX);
  });

  it("sync guard: Compact --density-grid-gap equals COMPACT_GRID_GUTTER_PX", () => {
    expect(px(decl(compact, "--density-grid-gap"))).toBe(COMPACT_GRID_GUTTER_PX);
  });

  it("Comfortable row padding is today's --space-2; Compact is strictly tighter in each token", () => {
    expect(decl(comfortable, "--density-row-pad-y")).toBe("var(--space-2)");
    expect(decl(compact, "--density-row-pad-y")).toBe("var(--space-1)");
    expect(px(decl(compact, "--density-grid-gap"))).toBeLessThan(
      px(decl(comfortable, "--density-grid-gap")),
    );
    expect(px(decl(compact, "--density-row-pad-y"))).toBeLessThan(
      px(decl(comfortable, "--density-row-pad-y")),
    );
  });
});

describe("type-style tokens (font tokens only)", () => {
  it("Sans + mono is the default: no override, headings follow --font-sans", () => {
    const root = rule(":root");
    expect(decl(root, "--font-heading")).toBe("var(--font-sans)");
    expect(decl(root, "--font-sans")).toBe("var(--font-face-sans)");
    expect(css).not.toMatch(/:root\[data-type-style="sans"\]/);
  });

  it("Serif swaps only the heading face", () => {
    const body = rule(':root[data-type-style="serif"]');
    expect(body.trim()).toBe("--font-heading: var(--font-display);");
  });

  it("Mono rebinds the sans face to mono for the whole UI, and nothing else", () => {
    const body = rule(':root[data-type-style="mono"]');
    expect(body.trim()).toBe("--font-sans: var(--font-mono);");
  });

  it("raw face tokens are declared once and are never rebound by a style", () => {
    for (const name of ["--font-face-sans", "--font-face-mono", "--font-face-serif"]) {
      expect(css.match(new RegExp(`${name}:`, "g"))).toHaveLength(1);
    }
  });
});

describe("motion tokens (D5)", () => {
  const OFF_TOKENS: Record<string, string> = {
    "--motion-duration-quick": "0.01ms",
    "--motion-duration-standard": "0.01ms",
    "--motion-duration-emphasized": "0.01ms",
    "--motion-duration-highlight": "0.01ms",
    "--motion-stagger": "0ms",
    "--app-transition": "0.01ms ease",
    "--transition-slow": "0.01ms cubic-bezier(0.3, 0.9, 0.4, 1)",
  };

  it('data-motion="off" pins the exact near-zero values (never 0s, so end events still fire)', () => {
    const body = rule(':root[data-motion="off"]');
    for (const [token, value] of Object.entries(OFF_TOKENS)) expect(decl(body, token)).toBe(value);
    expect(body).not.toMatch(/:\s*0s\b/);
  });

  it("the OS-reduced no-preference case gets the same values, scoped to :root:not([data-motion])", () => {
    const media = css.indexOf(
      "@media (prefers-reduced-motion: reduce) {\n  :root:not([data-motion]) {",
    );
    expect(media).toBeGreaterThan(-1);
    const body = rule("  :root:not([data-motion])", media);
    for (const [token, value] of Object.entries(OFF_TOKENS)) expect(decl(body, token)).toBe(value);
  });

  it("Subtle only drops the overshoot curve", () => {
    expect(rule(':root[data-motion="subtle"]').trim()).toBe(
      "--motion-ease-overshoot: var(--motion-ease-out);",
    );
  });

  it("the global reduced-motion rule is scoped to no-saved-choice and has an Off twin", () => {
    expect(css).toMatch(/:root:not\(\[data-motion\]\) \*,/);
    expect(css).toMatch(/:root\[data-motion="off"\] \*,/);
    expect(css).not.toMatch(/@media \(prefers-reduced-motion: reduce\) \{\s*\*,/);
  });
});

// Recorded enumeration (HEL-1572 D4): the section overview list tables (the SortableTable consumers: pipelines,
// sources, connectors) and the shell ContextList rows read --density-row-pad-y for their vertical padding.
describe("density consumers", () => {
  const consumers: Array<[string, RegExp]> = [
    [
      "features/pipelines/ui/PipelinesPage.css",
      /\.pipeline-list-table__td\s*\{[^}]*padding:\s*var\(--density-row-pad-y\)/,
    ],
    [
      "features/sources/ui/SourceListTable.css",
      /\.source-list-table td\s*\{[^}]*padding:\s*var\(--density-row-pad-y\)/,
    ],
    [
      "features/connectors/ui/ConnectorsPage.css",
      /\.connectors-page__td\s*\{[^}]*padding:\s*var\(--density-row-pad-y\)/,
    ],
    [
      "app/shell/ContextList.css",
      /\.context-list__row\s*\{[^}]*padding:\s*var\(--density-row-pad-y\)/,
    ],
  ];

  it.each(consumers)("%s reads the density row-padding token", (file, pattern) => {
    const source = fs.readFileSync(path.join(__dirname, "..", file), "utf-8");
    expect(source).toMatch(pattern);
  });
});
