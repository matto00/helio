import fs from "fs";
import path from "path";

// Motion guard for HEL-441 (motion/transition token system).
//
// Rule (design.md D5): no `transition:` or `animation:` declaration may
// carry a literal duration EXCEPT:
//   (a) inside a `prefers-reduced-motion: reduce` media block,
//   (b) a pinned, commented allowlist of single-use loop keyframes
//       (name AND exact duration — a name-only allowlist would license the
//       keyframe to silently become any duration at all), or
//   (c) `PanelGrid.css`'s three `180ms` transition literals, pinned to
//       their exact declarations and annotated with HEL-1032 (the ticket
//       that removes them). D4-REVISED deliberately leaves these in place;
//       without this exception the guard is RED on day one.
//
// Parsing is multi-line-aware (declarations routinely wrap across several
// lines, e.g. `PanelGrid.css`'s `transition:\n  transform 180ms ease,\n...`)
// — a line-oriented grep truncates these and reports garbage (ticket.md's
// own audit note). Comments are stripped before scanning so a literal
// mentioned only in prose (this file's own header, or a code comment
// explaining a value) is never mistaken for a live declaration.

const SRC_ROOT = path.join(__dirname, "..");

function allCssFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...allCssFiles(full));
    } else if (entry.isFile() && entry.name.endsWith(".css")) {
      out.push(full);
    }
  }
  return out;
}

/** Strips /* ... *\/ comments, preserving newlines so line numbers survive. */
function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "));
}

function lineAt(text: string, index: number): number {
  return text.slice(0, index).split("\n").length;
}

/** Byte ranges (start,end] covered by a `prefers-reduced-motion: reduce`
 *  media block, tracked by brace-depth so nested rules inside the block
 *  don't prematurely close it. */
function reducedMotionRanges(text: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  const openRe = /@media\s*\([^)]*prefers-reduced-motion[^)]*\)\s*{/g;
  let m: RegExpExecArray | null;
  while ((m = openRe.exec(text))) {
    let depth = 1;
    let i = m.index + m[0].length;
    while (i < text.length && depth > 0) {
      if (text[i] === "{") depth++;
      else if (text[i] === "}") depth--;
      i++;
    }
    ranges.push([m.index, i]);
  }
  return ranges;
}

function isWithin(ranges: Array<[number, number]>, index: number): boolean {
  return ranges.some(([s, e]) => index >= s && index < e);
}

// (b) — pinned by keyframe name AND exact duration. A name-only entry would
// let the keyframe silently become any duration at all.
const LOOP_ALLOWLIST: Array<{ name: string; duration: string }> = [
  { name: "streaming-text-blink", duration: "1s" },
  { name: "pipeline-run-pulse", duration: "1.2s" },
];

// (c) — PanelGrid.css's pinned transition literals (D4-REVISED / HEL-1032).
// Pinned to file + exact literal text, not just a keyframe name, because
// this exception guards a `transition:` shorthand, not a keyframe — a
// keyframe-only staleness check would let this exception survive forever
// after HEL-1032 removes these literals.
const PANEL_GRID_EXCEPTION = {
  file: "features/panels/ui/grid/PanelGrid.css",
  literals: ["180ms", "180ms", "180ms"],
};

interface Hit {
  file: string;
  line: number;
  literal: string;
  declarationSnippet: string;
}

const TIME_LITERAL_RE = /\b\d*\.?\d+m?s\b/g;

// Tracks which exceptions were actually matched by a real declaration
// somewhere in the tree. An exception entry that matches nothing is STALE
// — the declaration it was pinned to was edited or removed — and must fail
// the guard rather than sit as a permanent, unused hole. Populated by
// `findHits` as a side effect of the walk in the main guard test.
const usedLoopAllowlistEntries = new Set<string>();
let panelGridExceptionUsedCount = 0;

function findHits(absPath: string, relPath: string, rawText: string): Hit[] {
  const text = stripComments(rawText);
  const reduced = reducedMotionRanges(text);
  const hits: Hit[] = [];

  // Negative lookbehind excludes custom-property definitions like
  // `--app-transition: 0.16s ease;` — "transition" there is immediately
  // preceded by a hyphen (part of the property name), never by whitespace/
  // `{`/`;` the way a real `transition:`/`animation:` declaration is.
  const declRe = /(?<!-)\b(transition|animation)\s*:\s*([\s\S]+?);/g;
  let m: RegExpExecArray | null;
  while ((m = declRe.exec(text))) {
    const declStart = m.index;
    const declText = m[0];
    if (isWithin(reduced, declStart)) continue; // exception (a)

    // Determine whether this declaration references an allowlisted loop
    // keyframe (exception b): `animation: <name> <duration> ...`.
    let allowedLoop = false;
    if (m[1] === "animation") {
      for (const entry of LOOP_ALLOWLIST) {
        const re = new RegExp(
          `\\b${entry.name.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&")}\\s+${entry.duration.replace(".", "\\.")}\\b`,
        );
        if (re.test(declText)) {
          allowedLoop = true;
          usedLoopAllowlistEntries.add(`${entry.name}:${entry.duration}`);
        }
      }
    }

    const isPanelGrid = relPath === PANEL_GRID_EXCEPTION.file;

    const literalMatches = declText.match(TIME_LITERAL_RE) ?? [];
    for (const literal of literalMatches) {
      // cubic-bezier control points never carry an `s`/`ms` suffix, so this
      // regex cannot false-positive on them; guard anyway against a bare
      // "0" that could appear as an iteration-count-like token (defensive).
      if (allowedLoop) continue;
      if (isPanelGrid && literal === "180ms") {
        panelGridExceptionUsedCount++;
        continue; // exception (c)
      }
      hits.push({
        file: relPath,
        line: lineAt(text, declStart),
        literal,
        declarationSnippet: declText.replace(/\s+/g, " ").trim().slice(0, 120),
      });
    }
  }
  return hits;
}

describe("motion token guard (HEL-441)", () => {
  const files = allCssFiles(SRC_ROOT);

  it("walks every CSS file in frontend/src (currently 110)", () => {
    expect(files.length).toBe(110);
  });

  it("has zero declarations in a file with no motion declarations at all", () => {
    // A file with zero transition/animation declarations must produce zero
    // hits and zero allowlist matches — proving the walk doesn't pass
    // vacuously by never actually running its regexes against real text.
    const noMotionFile = files.find((f) => {
      const text = stripComments(fs.readFileSync(f, "utf-8"));
      return !/(?<!-)\b(transition|animation)\s*:/.test(text);
    });
    expect(noMotionFile).toBeDefined();
    if (noMotionFile) {
      const text = fs.readFileSync(noMotionFile, "utf-8");
      const rel = path.relative(SRC_ROOT, noMotionFile);
      expect(findHits(noMotionFile, rel, text)).toEqual([]);
    }
  });

  it("PanelGrid.css's pinned 180ms exception still matches exactly three literals", () => {
    // Confirms exception (c) is scoped to what actually exists, not a
    // blanket file-level pass — if HEL-1032 removes these literals this
    // count must be revisited (see the stale-exception mutation test).
    const abs = path.join(SRC_ROOT, PANEL_GRID_EXCEPTION.file);
    const text = stripComments(fs.readFileSync(abs, "utf-8"));
    const declRe = /\btransition\s*:\s*([\s\S]+?);/;
    const m = declRe.exec(text);
    expect(m).toBeTruthy();
    const literalCount = (m![0].match(/180ms/g) ?? []).length;
    expect(literalCount).toBe(3);
  });

  it("no CSS file carries a literal transition/animation duration outside the pinned exceptions", () => {
    const allHits: Hit[] = [];
    usedLoopAllowlistEntries.clear();
    panelGridExceptionUsedCount = 0;
    for (const abs of files) {
      const rel = path.relative(SRC_ROOT, abs);
      const text = fs.readFileSync(abs, "utf-8");
      allHits.push(...findHits(abs, rel, text));
    }
    if (allHits.length > 0) {
      const report = allHits
        .map((h) => `${h.file}:${h.line} literal="${h.literal}" in \`${h.declarationSnippet}\``)
        .join("\n");
      throw new Error(
        `Found ${allHits.length} literal motion duration(s) not covered by an exception:\n${report}`,
      );
    }
    expect(allHits).toEqual([]);
  });

  it("every pinned exception entry still matches a real declaration (no stale exceptions)", () => {
    // Runs the same full walk so usage counters are populated fresh, then
    // asserts every exception was actually consumed. A STALE entry — a
    // keyframe name+duration or the PanelGrid shorthand pin matching
    // NOTHING in the tree — must fail here, not sit as a permanent,
    // unexercised hole (design.md D5's third mutation direction). This
    // covers both shapes: a keyframe allowlist entry AND a `transition:`
    // shorthand pin, since a keyframe-only staleness check would let the
    // PanelGrid exception survive forever once HEL-1032 removes those
    // literals.
    usedLoopAllowlistEntries.clear();
    panelGridExceptionUsedCount = 0;
    for (const abs of files) {
      const rel = path.relative(SRC_ROOT, abs);
      const text = fs.readFileSync(abs, "utf-8");
      findHits(abs, rel, text);
    }
    for (const entry of LOOP_ALLOWLIST) {
      expect(usedLoopAllowlistEntries.has(`${entry.name}:${entry.duration}`)).toBe(true);
    }
    expect(panelGridExceptionUsedCount).toBe(PANEL_GRID_EXCEPTION.literals.length);
  });
});
