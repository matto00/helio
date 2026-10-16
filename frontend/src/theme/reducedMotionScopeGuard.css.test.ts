import fs from "fs";
import path from "path";

// HEL-1572 D5 guard: every `prefers-reduced-motion` media block under frontend/src must scope each selector with
// `:root:not([data-motion])` (so an explicit saved Full/Subtle beats the OS) and have an unconditional
// `:root[data-motion="off"]` twin in the same file. A new unscoped block fails here.
//
// frontend/src/landing/ is excluded on purpose: the landing page is served from index.html, never carries
// `data-motion` (no signed-in preferences exist there), so the OS setting is its only signal and the unscoped rule is
// already correct.
const SRC = path.join(__dirname, "..");
const MEDIA = "@media (prefers-reduced-motion: reduce)";

function cssFiles(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || full === path.join(SRC, "landing")) continue;
      cssFiles(full, out);
    } else if (entry.name.endsWith(".css")) {
      out.push(full);
    }
  }
  return out;
}

/** Strips comments so a selector mentioned in prose cannot satisfy or trip the check. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "");
}

/** The inner text of every `@media (prefers-reduced-motion: reduce) { ... }` block (brace-matched). */
export function reducedMotionBlocks(source: string): string[] {
  const blocks: string[] = [];
  let from = 0;
  for (;;) {
    const start = source.indexOf(MEDIA, from);
    if (start === -1) return blocks;
    let depth = 0;
    let i = source.indexOf("{", start);
    const open = i;
    for (; i < source.length; i++) {
      if (source[i] === "{") depth++;
      if (source[i] === "}" && --depth === 0) break;
    }
    blocks.push(source.slice(open + 1, i));
    from = i;
  }
}

/** Every selector in a block's rules that is NOT scoped by `:root:not([data-motion])`. */
export function unscopedSelectors(block: string): string[] {
  const bad: string[] = [];
  for (const match of block.matchAll(/([^{}]+)\{[^{}]*\}/g)) {
    for (const selector of match[1].split(",").map((s) => s.trim())) {
      if (selector && !selector.startsWith(":root:not([data-motion])")) bad.push(selector);
    }
  }
  return bad;
}

const SCOPE = ":root:not([data-motion])";
const OFF = ':root[data-motion="off"]';

/** Every scoped reduced-motion selector that has no identical `:root[data-motion="off"]` twin selector anywhere in
 *  the file's rules (per selector, not per file). Selectors are compared whitespace-normalised. */
export function missingOffTwins(source: string): string[] {
  const norm = (s: string) => s.replace(/\s+/g, " ").trim();
  const offSelectors = new Set<string>();
  for (const match of source.matchAll(/([^{}]+)\{[^{}]*\}/g)) {
    for (const selector of match[1].split(",").map(norm)) {
      if (selector.startsWith(OFF)) offSelectors.add(selector);
    }
  }
  const missing: string[] = [];
  for (const block of reducedMotionBlocks(source)) {
    for (const match of block.matchAll(/([^{}]+)\{[^{}]*\}/g)) {
      for (const selector of match[1].split(",").map(norm)) {
        if (!selector.startsWith(SCOPE)) continue;
        if (!offSelectors.has(OFF + selector.slice(SCOPE.length))) missing.push(selector);
      }
    }
  }
  return missing;
}

describe("reduced-motion scope guard (HEL-1572 D5)", () => {
  const files = cssFiles(SRC);
  const withBlocks = files
    .map((file) => ({ file, source: stripComments(fs.readFileSync(file, "utf-8")) }))
    .filter(({ source }) => source.includes(MEDIA));

  it("finds the known consumers (non-vacuity)", () => {
    expect(withBlocks.length).toBeGreaterThanOrEqual(7);
  });

  it.each(withBlocks.map(({ file, source }) => [path.relative(SRC, file), source] as const))(
    "%s scopes every reduced-motion selector and has an Off twin",
    (_name, source) => {
      for (const block of reducedMotionBlocks(source)) {
        expect(unscopedSelectors(block)).toEqual([]);
      }
      expect(missingOffTwins(source)).toEqual([]);
    },
  );

  it("fails (mutation) for an unscoped block", () => {
    const mutated = `${MEDIA} {\n  .x {\n    animation: none;\n  }\n}\n`;
    const blocks = reducedMotionBlocks(mutated);
    expect(blocks).toHaveLength(1);
    expect(unscopedSelectors(blocks[0])).toEqual([".x"]);
  });

  it("fails (mutation) when one selector of a scoped block lacks its Off twin", () => {
    const source = `${MEDIA} {
  :root:not([data-motion]) .a,
  :root:not([data-motion]) .b {
    animation: none;
  }
}
:root[data-motion="off"] .a {
  animation: none;
}
`;
    // .a has a twin, .b does not: a per-file "some Off rule exists" check would pass this fixture.
    expect(missingOffTwins(source)).toEqual([":root:not([data-motion]) .b"]);
    const fixed = source.replace(
      ':root[data-motion="off"] .a',
      ':root[data-motion="off"] .a,\n:root[data-motion="off"] .b',
    );
    expect(missingOffTwins(fixed)).toEqual([]);
  });
});
