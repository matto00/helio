import fs from "fs";
import path from "path";

const read = (relative: string) => fs.readFileSync(path.join(__dirname, relative), "utf-8");

const appCss = read("../App.css");
const shellCss = ["AppRail.css", "ContextList.css", "AssistantContextList.css"].map((file) => ({
  file,
  css: read(file),
}));

/** Body of the first `@media` rule whose prelude contains `prelude`, brace-matched. */
function mediaBlock(source: string, prelude: string): string {
  const at = source.indexOf(`@media (${prelude}`);
  if (at === -1) throw new Error(`no @media (${prelude}`);
  const open = source.indexOf("{", at);
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}" && --depth === 0) return source.slice(open + 1, i);
  }
  throw new Error("unbalanced");
}

describe("shell stylesheet contract (HEL-1574, DESIGN.md §4 and §9)", () => {
  it("makes the rail grid the DEFAULT layout of .app-shell", () => {
    const rule = /\.app-shell\s*\{([^}]*)\}/.exec(appCss)?.[1] ?? "";
    expect(rule).toMatch(/display:\s*grid/);
    expect(rule).toMatch(/--rail-width:\s*56px/);
    expect(rule).toMatch(/var\(--context-list-width,\s*248px\)/);
  });

  it("returns to the phone column only under the existing (max-width: 768px) query", () => {
    const phone = mediaBlock(appCss, "max-width: 768px");
    expect(phone).toMatch(/\.app-shell,\s*\.app-shell--no-list\s*\{[^}]*display:\s*flex/s);
    expect(phone).toMatch(/flex-direction:\s*column/);
  });

  it("introduces no new breakpoint value: no 769px / 767px media query in any shell stylesheet", () => {
    for (const { file, css } of [{ file: "App.css", css: appCss }, ...shellCss]) {
      expect({ file, hits: css.match(/@media[^{]*(769|767)px/g) }).toEqual({ file, hits: null });
    }
  });

  it("paints the rail with --app-bg and the list with --app-surface-soft, never --app-surface", () => {
    expect(/\.app-rail\s*\{([^}]*)\}/.exec(read("AppRail.css"))?.[1]).toMatch(
      /background:\s*var\(--app-bg\)/,
    );
    expect(/\.context-list\s*\{([^}]*)\}/.exec(read("ContextList.css"))?.[1]).toMatch(
      /background:\s*var\(--app-surface-soft\)/,
    );
  });

  it("uses the accent only for the active rail item and the open list row (selection)", () => {
    for (const { file, css } of shellCss) {
      const accentRules = css
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .split("}")
        .filter((rule) =>
          /var\(--app-accent(-dim|-text)?\)/.test(rule.replace(/\/\*[\s\S]*?\*\//g, "")),
        );
      const selectors = accentRules.map((rule) => rule.split("{")[0]?.trim());
      if (file === "AppRail.css") {
        expect(
          selectors.every(
            (s) => s?.includes("app-rail__item--active") || s?.includes("app-rail__indicator"),
          ),
        ).toBe(true);
      } else if (file === "AssistantContextList.css") {
        // The one pre-existing text link of the locked notice (HEL-1048's accent-as-text token).
        expect(selectors).toEqual([".assistant-context-list__locked-link"]);
      } else {
        // The open list row is a selection, which the accent may mark (DESIGN.md §0.3).
        expect(selectors.every((s) => s?.includes('.context-list__row[aria-current="page"]'))).toBe(
          true,
        );
      }
    }
  });

  it("hardcodes no colour, font family or duration in the new shell stylesheets", () => {
    for (const { file, css } of shellCss) {
      const code = css.replace(/\/\*[\s\S]*?\*\//g, "");
      expect({ file, hex: code.match(/#[0-9a-fA-F]{3,8}\b/g) }).toEqual({ file, hex: null });
      expect({ file, rgb: code.match(/\brgba?\(/g) }).toEqual({ file, rgb: null });
      const families = [...code.matchAll(/font-family:\s*([^;]+);/g)].map((m) => m[1]?.trim());
      expect({ file, literal: families.filter((f) => !f?.startsWith("var(")) }).toEqual({
        file,
        literal: [],
      });
      expect({ file, time: code.match(/\b\d+(\.\d+)?m?s\b/g) }).toEqual({ file, time: null });
    }
  });

  it("keeps --app-surface at #1a1816 (owner ruling)", () => {
    expect(read("../../theme/theme.css")).toMatch(/--app-surface:\s*#1a1816;/);
  });

  it("gives the separator a hit area wider than its 1px hairline", () => {
    const rule = /\.context-list__separator\s*\{([^}]*)\}/.exec(read("ContextList.css"))?.[1] ?? "";
    expect(rule).toMatch(/width:\s*var\(--space-2\)/);
    expect(read("ContextList.css")).toMatch(
      /\.context-list__separator::after\s*\{[^}]*width:\s*1px/s,
    );
  });
});
