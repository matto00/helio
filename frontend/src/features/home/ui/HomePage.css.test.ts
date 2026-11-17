import fs from "fs";
import path from "path";

import {
  expectTapExpander,
  findMediaBlock,
  findRuleBody,
} from "../../../shared/ui/tapTargetTestUtils";

// HEL-1665 guard. jsdom lays nothing out, so the rendered-geometry proof is `e2e/hel1665-home-phone-stability.spec.ts`;
// this pins the stylesheet shapes that proof depends on, so a revert fails here first (and fast).

const css = fs.readFileSync(path.join(__dirname, "HomePage.css"), "utf-8");
/** The standalone `.home-opening__ghost { ... }` rule (the first match of the name is the shared typography list). */
const ghostRule = /\}\n\n\.home-opening__ghost\s*\{([^}]*)\}/.exec(css)?.[1] ?? "";
const touch = findMediaBlock(css, "max-width: 768px), (pointer: coarse");

describe("HomePage.css — load stability (HEL-1665)", () => {
  it("gives the section-head links their 44px floor through the sized expander, not a grown box", () => {
    expectTapExpander(touch, ".home-section__link", "square");
    expect(findRuleBody(touch, ".home-section__link")).not.toMatch(/min-height/);
    expect(findRuleBody(touch, ".home-section__link")).not.toMatch(/display:\s*inline-flex/);
  });

  it("keeps grow-the-box for the full-width Up next row", () => {
    const row = findRuleBody(touch, ".home-upnext__row");
    expect(row).toMatch(/min-height:\s*44px\s*;/);
  });

  it("builds the opening placeholder from the hidden default sentence with the bar laid over it, no per-width heights", () => {
    expect(findRuleBody(css, ".home-opening__loading")).toMatch(/position:\s*relative\s*;/);
    expect(ghostRule).toMatch(/visibility:\s*hidden\s*;/);
    expect(findRuleBody(css, ".home-opening__loading .home-opening__skeleton-line")).toMatch(
      /position:\s*absolute\s*;/,
    );
    expect(css).not.toMatch(/home-opening__skeleton-line\s*\{[^}]*calc\(/);
  });

  it("caps the real sentence and the placeholder with one font-independent em measure per type style (HEL-1737)", () => {
    const real = findRuleBody(css, ".home-opening__sentence");
    // Not `ch`: the digit advance follows the rendered face, so the cap would change when the web font replaces the fallback.
    expect(real).toMatch(/max-width:\s*var\(--home-sentence-measure\)\s*;/);
    expect(real).not.toMatch(/\bch\b/);
    // Shared typography: the real sentence and the placeholder render in the same face and size.
    expect(css).toMatch(
      /\.home-opening__sentence,\s*\.home-opening__ghost\s*\{[^}]*font-family:\s*var\(--font-heading\)/,
    );
    expect(ghostRule).toMatch(/max-width:\s*var\(--home-sentence-measure\)\s*;/);
    // The base placeholder rule wraps like the real sentence in every type style; no nowrap.
    expect(ghostRule).not.toMatch(/white-space/);
    // DESIGN.md: a type style is a token override in theme.css, never a component branch.
    expect(css).not.toMatch(/data-type-style/);
  });

  it("sets the per-style measure and the Sans-only nowrap switch as theme.css tokens (HEL-1737)", () => {
    const theme = fs.readFileSync(path.join(__dirname, "../../../theme/theme.css"), "utf-8");
    expect(theme).toMatch(
      /:root \{[^}]*--home-sentence-measure:\s*25em\s*;[^}]*--home-ghost-white-space:\s*nowrap\s*;/,
    );
    for (const [style, em] of [
      ["serif", "26.6667"],
      ["mono", "23.3333"],
    ]) {
      const body = [
        ...theme.matchAll(new RegExp(`:root\\[data-type-style="${style}"\\] \\{([^}]*)\\}`, "g")),
      ]
        .map((m) => m[1])
        .join("\n");
      expect(body).toMatch(new RegExp(`--home-sentence-measure:\\s*${em}em\\s*;`));
      expect(body).toMatch(/--home-ghost-white-space:\s*normal\s*;/);
    }
  });

  it("holds only the Sans placeholder to one line from the web font's wrap point (605px at 16px) up (HEL-1737)", () => {
    const band = findMediaBlock(css, "min-width: 37.8125em");
    const rule = findRuleBody(band, ".home-opening__ghost");
    expect(rule).toMatch(/white-space:\s*var\(--home-ghost-white-space\)\s*;/);
    expect(rule).toMatch(/overflow:\s*hidden\s*;/);
    // The real sentence is never nowrap: the loaded rendering is unchanged.
    expect(findRuleBody(css, ".home-opening__sentence")).not.toMatch(/white-space/);
  });

  it("hides the shelf's reserved link slot without removing its line", () => {
    const slot = findRuleBody(css, ".home-section__link-slot");
    expect(slot).toMatch(/visibility:\s*hidden\s*;/);
    expect(slot).toMatch(/font-size:\s*var\(--text-sm\)\s*;/);
    expect(slot).not.toMatch(/display:\s*none/);
  });

  it("lays the skeleton name's bar over a hidden text line so a skeleton card is as tall as a loaded one", () => {
    expect(findRuleBody(css, ".home-card__name--skeleton")).toMatch(/position:\s*relative\s*;/);
    expect(findRuleBody(css, ".home-card__name--skeleton .ui-skeleton")).toMatch(
      /position:\s*absolute\s*;/,
    );
  });
});
