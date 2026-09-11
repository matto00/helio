import fs from "fs";
import path from "path";

// Elevation guard for HEL-442 (box-shadow / border-radius token system).
//
// Rule (design.md D0/D1/D2/D4): a `box-shadow` declaration must reference
// one of the two elevation tokens BY NAME (`--app-shadow-card`,
// `--app-shadow-soft`), be `none`, or sit on a pinned exception. A
// `border-radius` declaration must be one of the four `--app-radius-*`
// tokens, `50%` (the circle idiom — an ALLOWED value, not an exception:
// see D1), `0`/`none`/`inherit`, or sit on a pinned exception.
//
// D0 is explicit that the shadow check must NEVER loosen to "contains any
// `var(`" — the original audit's mistake was exactly that: it scored a
// declaration clean because its COLOUR was tokenised while its GEOMETRY
// (offsets/blur/spread) was fully literal. That loosening would also make
// this file's own required RED mutation (task 2.4, arm 1) pass green.
//
// Every exception below is pinned to an EXACT file + exact declaration text
// + exact count, re-measured directly against this tree at implementation
// time (not transcribed from planning artifacts) — never a per-file or
// pattern-shaped allowance, which could never expire. See D4's fourth
// mutation arm: a per-file allowance is the one shape the first three
// mutation directions cannot catch.
//
// Parsing is multi-line-aware — several of these declarations wrap across
// lines (e.g. the two-shadow scroll-fade combined form) — a line-oriented
// grep truncates these and reports garbage (ticket.md's own audit note).
// Comments are stripped before scanning so a literal mentioned only in
// prose is never mistaken for a live declaration.

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

function normalize(decl: string): string {
  return decl.replace(/\s+/g, " ").trim();
}

interface Pin {
  file: string;
  declaration: string;
  count: number;
  note: string;
}

// D0 / task 2.1b — the 9 zero-blur spread rings ("focus ring" family). None
// carries a y-offset with a blur (the shape of an elevation shadow), which
// is the positive evidence no elevation token applies to any of them.
// `--app-focus-ring` (theme.css) is an OUTLINE token, a different mechanism
// (`outline:`, not `box-shadow:`) — converging these onto it is HEL-1022's
// remit, not this guard's.
const BOX_SHADOW_EXCEPTIONS: Pin[] = [
  {
    file: "features/auth/ui/auth.css",
    declaration: "box-shadow: 0 0 0 3px var(--app-accent-dim);",
    count: 1,
    note: "zero-blur focus ring (D0) — HEL-1022 owns converging these onto --app-focus-ring",
  },
  {
    file: "features/dashboards/ui/DashboardList.css",
    declaration: "box-shadow: 0 0 0 3px var(--app-accent-dim);",
    count: 4,
    note: "zero-blur focus ring (D0) — HEL-1022",
  },
  {
    file: "shared/ui/inputs.css",
    declaration: "box-shadow: 0 0 0 3px var(--app-accent-dim);",
    count: 1,
    note: "zero-blur focus ring (D0) — HEL-1022",
  },
  {
    file: "shared/ui/inputs.css",
    declaration: "box-shadow: 0 0 0 3px var(--app-error-surface);",
    count: 1,
    note: "zero-blur error focus ring (D0) — HEL-1022",
  },
  {
    file: "shared/chrome/AccentPicker.css",
    declaration: "box-shadow: 0 0 0 2px var(--app-surface-strong), 0 0 0 4px var(--app-accent);",
    count: 1,
    note: "double-ring zero-blur selection indicator (D0) — HEL-1022. Was count 2 (shared with :focus-visible) until HEL-1050 D5/3.8 gave :focus-visible its own conforming ring colour (--app-focus-ring-color) instead of the raw accent, and a third shadow layer so the focused-but-not-selected state is visually distinct from --selected (design.md D5/3.8 — the two states previously declared a byte-identical box-shadow).",
  },
  {
    file: "shared/chrome/AccentPicker.css",
    declaration:
      "box-shadow: 0 0 0 2px var(--app-surface-strong), 0 0 0 4px var(--app-focus-ring-color), 0 0 0 6px var(--app-border-strong);",
    count: 1,
    note: "triple-ring zero-blur focus indicator (D0), HEL-1050 D5/3.8 — recolours the ring to the contrast-derived focus-ring token and adds a third, neutral-and-therefore-backdrop-independent layer so :focus-visible stays visually distinct from --selected above even for the zero-darkening accent presets (evaluator cycle-2 correction: a --app-surface-strong 3rd layer is invisible in this picker's one real render context and, for those presets, left the two states pixel-identical).",
  },
  // D0 / task 2.1b — the 13 scroll-fade insets, in FOUR distinct values
  // (not byte-identical). Reported as a spinoff candidate for the scroll-
  // fade duplication itself, not absorbed here.
  {
    file: "features/connectors/ui/ConnectorsPage.css",
    declaration:
      "box-shadow: inset 12px 0 12px -12px color-mix(in srgb, var(--app-text) 35%, transparent);",
    count: 1,
    note: "scroll-fade inset, left edge (D0)",
  },
  {
    file: "features/connectors/ui/ConnectorsPage.css",
    declaration:
      "box-shadow: inset -12px 0 12px -12px color-mix(in srgb, var(--app-text) 35%, transparent);",
    count: 1,
    note: "scroll-fade inset, right edge (D0)",
  },
  {
    file: "features/connectors/ui/ConnectorsPage.css",
    declaration:
      "box-shadow: inset 12px 0 12px -12px color-mix(in srgb, var(--app-text) 35%, transparent), inset -12px 0 12px -12px color-mix(in srgb, var(--app-text) 35%, transparent);",
    count: 1,
    note: "scroll-fade inset, combined form (D0)",
  },
  {
    file: "features/connectors/ui/ConnectorsPage.css",
    declaration:
      "box-shadow: inset 8px 0 8px -8px color-mix(in srgb, var(--app-text) 35%, transparent);",
    count: 1,
    note: "scroll-fade inset, ConnectorsPage's own 8px variant (D0) — the fourth distinct value",
  },
  {
    file: "features/pipelines/ui/PipelineListTable.css",
    declaration:
      "box-shadow: inset 12px 0 12px -12px color-mix(in srgb, var(--app-text) 35%, transparent);",
    count: 1,
    note: "scroll-fade inset, left edge (D0)",
  },
  {
    file: "features/pipelines/ui/PipelineListTable.css",
    declaration:
      "box-shadow: inset -12px 0 12px -12px color-mix(in srgb, var(--app-text) 35%, transparent);",
    count: 1,
    note: "scroll-fade inset, right edge (D0)",
  },
  {
    file: "features/pipelines/ui/PipelineListTable.css",
    declaration:
      "box-shadow: inset 12px 0 12px -12px color-mix(in srgb, var(--app-text) 35%, transparent), inset -12px 0 12px -12px color-mix(in srgb, var(--app-text) 35%, transparent);",
    count: 1,
    note: "scroll-fade inset, combined form (D0)",
  },
  {
    file: "features/sources/ui/SourceListTable.css",
    declaration:
      "box-shadow: inset 12px 0 12px -12px color-mix(in srgb, var(--app-text) 35%, transparent);",
    count: 1,
    note: "scroll-fade inset, left edge (D0)",
  },
  {
    file: "features/sources/ui/SourceListTable.css",
    declaration:
      "box-shadow: inset -12px 0 12px -12px color-mix(in srgb, var(--app-text) 35%, transparent);",
    count: 1,
    note: "scroll-fade inset, right edge (D0)",
  },
  {
    file: "features/sources/ui/SourceListTable.css",
    declaration:
      "box-shadow: inset 12px 0 12px -12px color-mix(in srgb, var(--app-text) 35%, transparent), inset -12px 0 12px -12px color-mix(in srgb, var(--app-text) 35%, transparent);",
    count: 1,
    note: "scroll-fade inset, combined form (D0)",
  },
  {
    file: "shared/ui/DataGrid.css",
    declaration:
      "box-shadow: inset 12px 0 12px -12px color-mix(in srgb, var(--app-text) 35%, transparent);",
    count: 1,
    note: "scroll-fade inset, left edge (D0)",
  },
  {
    file: "shared/ui/DataGrid.css",
    declaration:
      "box-shadow: inset -12px 0 12px -12px color-mix(in srgb, var(--app-text) 35%, transparent);",
    count: 1,
    note: "scroll-fade inset, right edge (D0)",
  },
  {
    file: "shared/ui/DataGrid.css",
    declaration:
      "box-shadow: inset 12px 0 12px -12px color-mix(in srgb, var(--app-text) 35%, transparent), inset -12px 0 12px -12px color-mix(in srgb, var(--app-text) 35%, transparent);",
    count: 1,
    note: "scroll-fade inset, combined form (D0)",
  },
];

// D2 — the five sub-scale radii, all below the 6px floor. Default is LEAVE
// (task 3.1): snapping any of these to the nearest token is a visible 2-5px
// increase on decorative detail, the exact HEL-441 trap ("locally tidier,
// globally worse"). Each is pinned individually so a future literal radius
// added anywhere else still fails the guard.
//
// HEL-1037 INTERACTION, resolved: this list originally also pinned
// PipelineDetailPage.css's two `border-radius: var(--radius-sm)` declarations
// — an undefined custom property (HEL-1037's defect in that file), excepted
// rather than silently fixed here. HEL-1037 merged (#601) and removed them, so
// the pin matched nothing and this guard's staleness check went RED on rebase
// exactly as designed. The pin is deleted rather than loosened: an exception
// that cannot expire is a permanent hole, and this one expired on schedule.
const BORDER_RADIUS_EXCEPTIONS: Pin[] = [
  {
    file: "features/panels/ui/DividerPanel.css",
    declaration: "border-radius: 1px;",
    count: 1,
    note: "sub-scale, below the 6px floor — D2 default LEAVE, decided 2026-09-08",
  },
  {
    file: "features/panels/ui/MarkdownPanel.css",
    declaration: "border-radius: 3px;",
    count: 1,
    note: "sub-scale — D2 default LEAVE",
  },
  {
    file: "features/panels/ui/MarkdownPanel.css",
    declaration: "border-radius: 4px;",
    count: 1,
    note: "sub-scale — D2 default LEAVE",
  },
  {
    file: "features/pipelines/ui/PipelineDetailPage.css",
    declaration: "border-radius: 1px;",
    count: 1,
    note: "sub-scale — D2 default LEAVE",
  },
  {
    file: "features/pipelines/ui/PipelineDetailPage.css",
    declaration: "border-radius: 4px;",
    count: 1,
    note: "sub-scale — D2 default LEAVE",
  },
];

interface Hit {
  file: string;
  line: number;
  declarationSnippet: string;
}

// Tracks which pins were actually matched by a real declaration in the
// tree, per property. A pin matching nothing is STALE — the declaration it
// was pinned to was edited or removed elsewhere — and must fail the guard
// rather than sit as a permanent, unexercised hole (D4's third mutation
// direction, required for BOTH families).
const usedShadowPinCounts = new Map<Pin, number>();
const usedRadiusPinCounts = new Map<Pin, number>();

function findHits(
  rel: string,
  text: string,
  declRe: RegExp,
  isAllowed: (decl: string) => boolean,
  pins: Pin[],
  usedCounts: Map<Pin, number>,
): Hit[] {
  const hits: Hit[] = [];
  let m: RegExpExecArray | null;
  while ((m = declRe.exec(text))) {
    const decl = normalize(m[0]);
    if (isAllowed(decl)) continue;

    const pin = pins.find((p) => p.file === rel && normalize(p.declaration) === decl);
    if (pin) {
      usedCounts.set(pin, (usedCounts.get(pin) ?? 0) + 1);
      continue;
    }

    hits.push({
      file: rel,
      line: lineAt(text, m.index),
      declarationSnippet: decl.slice(0, 160),
    });
  }
  return hits;
}

const BOX_SHADOW_RE = /(?<!-)\bbox-shadow\s*:\s*([\s\S]+?);/g;
const BORDER_RADIUS_RE = /(?<!-)\bborder-radius\s*:\s*([\s\S]+?);/g;

function isAllowedShadow(decl: string): boolean {
  // D0 — BY NAME, never "contains var(". A "contains any var()" rule would
  // score a declaration clean whose colour is tokenised while its geometry
  // is fully literal — exactly the original audit's mistake, and exactly
  // what would make task 2.4 arm 1's mutation pass green.
  return /var\(--app-shadow-(card|soft)\)/.test(decl) || /:\s*none\s*;?$/.test(decl);
}

function isAllowedRadius(decl: string): boolean {
  // D1 — 50% is an ALLOWED VALUE (the circle idiom), not a pinned
  // exception: pinning it would invite a future ticket to "resolve" it and
  // break the 12 live circles that depend on it.
  return (
    /var\(--app-radius-(sm|md|lg|pill)\)/.test(decl) ||
    /:\s*50%\s*;?$/.test(decl) ||
    /:\s*(0|none|inherit)\s*;?$/.test(decl)
  );
}

function scanAll(files: string[]) {
  const shadowHits: Hit[] = [];
  const radiusHits: Hit[] = [];
  for (const abs of files) {
    const rel = path.relative(SRC_ROOT, abs);
    const text = stripComments(fs.readFileSync(abs, "utf-8"));
    shadowHits.push(
      ...findHits(
        rel,
        text,
        BOX_SHADOW_RE,
        isAllowedShadow,
        BOX_SHADOW_EXCEPTIONS,
        usedShadowPinCounts,
      ),
    );
    radiusHits.push(
      ...findHits(
        rel,
        text,
        BORDER_RADIUS_RE,
        isAllowedRadius,
        BORDER_RADIUS_EXCEPTIONS,
        usedRadiusPinCounts,
      ),
    );
  }
  return { shadowHits, radiusHits };
}

describe("elevation token guard (HEL-442)", () => {
  const files = allCssFiles(SRC_ROOT);

  it("walks every CSS file in frontend/src (currently 111)", () => {
    expect(files.length).toBe(111);
  });

  it("has zero hits in a file with no box-shadow/border-radius declarations at all", () => {
    // Proves the walk doesn't pass vacuously by never actually running its
    // regexes against real text — a file genuinely lacking both properties
    // must produce zero hits and zero pin matches.
    const emptyFile = files.find((f) => {
      const text = stripComments(fs.readFileSync(f, "utf-8"));
      return !/(?<!-)\bbox-shadow\s*:/.test(text) && !/(?<!-)\bborder-radius\s*:/.test(text);
    });
    expect(emptyFile).toBeDefined();
    if (emptyFile) {
      const rel = path.relative(SRC_ROOT, emptyFile);
      const text = stripComments(fs.readFileSync(emptyFile, "utf-8"));
      usedShadowPinCounts.clear();
      usedRadiusPinCounts.clear();
      const shadowHits = findHits(
        rel,
        text,
        BOX_SHADOW_RE,
        isAllowedShadow,
        BOX_SHADOW_EXCEPTIONS,
        usedShadowPinCounts,
      );
      const radiusHits = findHits(
        rel,
        text,
        BORDER_RADIUS_RE,
        isAllowedRadius,
        BORDER_RADIUS_EXCEPTIONS,
        usedRadiusPinCounts,
      );
      expect(shadowHits).toEqual([]);
      expect(radiusHits).toEqual([]);
    }
  });

  it("no CSS file carries a literal box-shadow or off-scale border-radius outside the pinned exceptions", () => {
    usedShadowPinCounts.clear();
    usedRadiusPinCounts.clear();
    const { shadowHits, radiusHits } = scanAll(files);
    const allHits = [...shadowHits, ...radiusHits];
    if (allHits.length > 0) {
      const report = allHits
        .map((h) => `${h.file}:${h.line} \`${h.declarationSnippet}\``)
        .join("\n");
      throw new Error(`Found ${allHits.length} unguarded declaration(s):\n${report}`);
    }
    expect(allHits).toEqual([]);
  });

  it("every pinned box-shadow exception still matches its exact pinned count (no stale shadow exceptions)", () => {
    usedShadowPinCounts.clear();
    usedRadiusPinCounts.clear();
    scanAll(files);
    for (const pin of BOX_SHADOW_EXCEPTIONS) {
      expect([`${pin.file}:${pin.declaration}`, usedShadowPinCounts.get(pin) ?? 0]).toEqual([
        `${pin.file}:${pin.declaration}`,
        pin.count,
      ]);
    }
  });

  it("every pinned border-radius exception still matches its exact pinned count (no stale radius exceptions)", () => {
    usedShadowPinCounts.clear();
    usedRadiusPinCounts.clear();
    scanAll(files);
    for (const pin of BORDER_RADIUS_EXCEPTIONS) {
      expect([`${pin.file}:${pin.declaration}`, usedRadiusPinCounts.get(pin) ?? 0]).toEqual([
        `${pin.file}:${pin.declaration}`,
        pin.count,
      ]);
    }
  });
});
