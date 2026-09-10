import fs from "fs";
import path from "path";

// Regression guard for HEL-439 (token audit: color/spacing/type-scale sweep).
//
// This test covers exactly the files touched by HEL-439's exact-value
// `margin`/`padding`/`gap` -> `--space-*` substitutions (see
// `openspec/changes/token-audit-design-sweep/files-modified.md`). It follows
// the `Modal.css.test.ts` / `inputs.css.test.ts` precedent of statically
// reading CSS source, since jsdom cannot render real layout.
//
// Mechanism, per category, mirroring design.md's five widened grep
// patterns (spacing/font-size include em/%, not just px/rem):
//   - spacing:     (margin|padding|gap)(-[a-z]+)?:\s*[0-9.]+(px|rem|em|%)
//   - color:       #[0-9a-fA-F]{3,8}\b|rgba?\(
//   - font-size:   font-size:\s*[0-9.]+(px|rem|em|%)
//   - font-weight: font-weight:\s*[0-9]+
//   - font-family: font-family: ... not var(--font-sans|--font-display|--font-mono)
//                  and not inherit/initial/unset
//
// For each category, every surviving hit in a swept file MUST appear in
// that category's pinned BASELINE (file+line enumeration of the legitimate
// residual: off-scale/no-token values, the <=4px optical-tweak allowance,
// or documented data/functional exceptions). Because each BASELINE only
// lists residual locations, not fixed ones, this single check does double
// duty per category:
//   (a) no *new* disallowed literal is introduced beyond the pinned
//       baseline, and
//   (b) every literal HEL-439 fixed (currently: spacing only — color,
//       font-size, font-weight, and font-family have zero fixes because
//       they have zero exact-token-matching violations in the swept
//       files) stays fixed — if a fixed line's `var(--space-N)` were
//       reverted back to a literal, that exact file+line is NOT in the
//       spacing BASELINE, so it surfaces as an unexpected hit and the
//       test fails.
//
// The color/font-size/font-weight/font-family BASELINEs are currently
// empty: a full re-scan of all 15 swept files found zero live hits in any
// of those four categories — the checks exist as regression guards
// (matching design.md's "keep the check as a regression guard, not
// because violations are expected" rationale for font-size/font-weight
// repo-wide), not because a residual is expected here. The documented
// non-token color/font exceptions elsewhere in the tree
// (MfaEnrollModal.tsx/.css QR colors, PreferencesEditor.tsx appearance
// defaults, DividerEditor.tsx's #cccccc sentinel) all live outside these
// 15 swept files, so no baseline entries are needed for them.
//
// See `enumeration.md` in this change dir for the full repo-wide
// enumeration (by-category counts and off-scale breakdown) and the
// RED-state demonstration transcript (temporarily reverting one fixed
// literal, confirming this test fails, then reverting back to green).

const SRC_ROOT = path.join(__dirname, "..");

// HEL-909: `features/dataTypes/**`, `features/metrics/**`, and
// `features/pipelines/ui/computedFields/**` were deleted outright (Axis A) —
// their swept CSS files and pinned baseline entries below go with them, not
// left as a stale ENOENT reference.
const SWEPT_FILES = [
  "features/dashboards/ui/DashboardAppearanceEditor.css",
  "features/panels/ui/ImagePanel.css",
  "features/pipelines/ui/PipelineDetailHeader.css",
  "features/pipelines/ui/PipelineDetailPage.css",
  "features/pipelines/ui/PipelinesPage.css",
  "features/pipelines/ui/RunHistoryModal.css",
  "features/settings/ui/AgentMemoryList.css",
  "features/sources/ui/AddSourceModal.css",
  "features/sources/ui/SourceDetailPanel.css",
];

interface BaselineEntry {
  file: string;
  line: number;
}

function baselineKeys(baseline: BaselineEntry[]): Set<string> {
  return new Set(baseline.map((b) => `${b.file}:${b.line}`));
}

function findRawHits(
  fileRelPath: string,
  pattern: RegExp,
  isDisallowed: (line: string) => boolean,
): number[] {
  const absPath = path.join(SRC_ROOT, fileRelPath);
  const text = fs.readFileSync(absPath, "utf-8");
  const lines = text.split("\n");
  const hits: number[] = [];
  lines.forEach((line, idx) => {
    if (pattern.test(line) && isDisallowed(line)) {
      hits.push(idx + 1);
    }
  });
  return hits;
}

/** Runs one category's guard: every raw hit in every swept file must be a
 *  pinned baseline entry (no new violation, and no reverted fix). */
function runCategoryGuard(
  categoryName: string,
  pattern: RegExp,
  isDisallowed: (line: string) => boolean,
  baseline: BaselineEntry[],
): void {
  const keys = baselineKeys(baseline);

  describe(`HEL-439 token audit sweep — ${categoryName}`, () => {
    it.each(SWEPT_FILES)(`%s has no unexpected raw ${categoryName} literal`, (fileRelPath) => {
      const hits = findRawHits(fileRelPath, pattern, isDisallowed);
      const unexpected = hits.filter((line) => !keys.has(`${fileRelPath}:${line}`));
      expect(unexpected).toEqual([]);
    });

    if (baseline.length > 0) {
      it(`every ${categoryName} baseline entry still exists in its file (baseline isn't stale)`, () => {
        for (const entry of baseline) {
          const hits = findRawHits(entry.file, pattern, isDisallowed);
          expect(hits).toContain(entry.line);
        }
      });
    }
  });
}

// --- Spacing ---------------------------------------------------------------
// design.md's widened spacing pattern: includes em/% (not just px/rem).
const SPACING_PATTERN = /(margin|padding|gap)(-[a-z]+)?:\s*[0-9.]+(px|rem|em|%)/;
const spacingIsDisallowed = (line: string): boolean => !line.includes("var(--space");

// Pinned baseline of the off-scale / optical-tweak spacing residual that
// legitimately remains in the swept files after HEL-439's exact-value-only
// fix pass (no matching `--space-*` token, or already within the <=4px
// optical-tweak allowance). Generated from the final mechanical enumeration
// (design.md's widened grep, comment-stripped) — see `enumeration.md` in
// this change dir for the full repo-wide table.
const SPACING_BASELINE: BaselineEntry[] = [
  // Regenerated from scratch (HEL-830) by running this file's own
  // SPACING_PATTERN/spacingIsDisallowed against SWEPT_FILES on the
  // post-snap tree, per design.md's "no line-shift arithmetic" procedure —
  // HEL-830 snapped all 102 off-scale (>4px) literals this baseline
  // previously pinned to --space-* tokens. The 10 remaining entries are
  // all within the <=4px optical-tweak allowance (untouched by HEL-830,
  // which only targets values > 4px) and were not independently re-traced
  // line-by-line against the prior 62-entry baseline; this list is the
  // fresh, reviewable regeneration, diffed against the prior baseline as
  // this change's artifact rather than hand-adjusted from it.
  //
  // Re-regenerated (same script, same procedure) after the evaluator's
  // cycle-2 CR1 fix to the OutputsRail/PipelineDetailPage 14px->16px
  // cluster comment inserted 2 extra comment lines above `.pipeline-
  // detail-page__add-tail-row`, shifting every PipelineDetailPage.css
  // entry below line ~453 down by one — confirmed identical to a
  // from-scratch re-run, not a manual +1 offset.
  { file: "features/pipelines/ui/PipelineDetailPage.css", line: 28 },
  { file: "features/pipelines/ui/PipelineDetailPage.css", line: 231 },
  { file: "features/pipelines/ui/PipelineDetailPage.css", line: 883 },
  { file: "features/pipelines/ui/PipelineDetailPage.css", line: 977 },
  { file: "features/pipelines/ui/PipelineDetailPage.css", line: 1007 },
  { file: "features/pipelines/ui/PipelineDetailPage.css", line: 1216 },
  { file: "features/pipelines/ui/PipelineDetailPage.css", line: 1447 },
  { file: "features/pipelines/ui/RunHistoryModal.css", line: 136 },
  { file: "features/sources/ui/AddSourceModal.css", line: 144 },
  { file: "features/sources/ui/AddSourceModal.css", line: 254 },
];

const COLOR_PATTERN = /#[0-9a-fA-F]{3,8}\b|rgba?\(/;
const colorIsDisallowed = (): boolean => true; // any hit is a raw literal; no var()-based exclusion applies
const COLOR_BASELINE: BaselineEntry[] = [];

// design.md's widened font-size pattern: includes em/% (not just px/rem).
const FONT_SIZE_PATTERN = /font-size:\s*[0-9.]+(px|rem|em|%)/;
const fontSizeIsDisallowed = (line: string): boolean => !line.includes("var(--text-");
const FONT_SIZE_BASELINE: BaselineEntry[] = [];

const FONT_WEIGHT_PATTERN = /font-weight:\s*[0-9]+/;
const fontWeightIsDisallowed = (line: string): boolean => !line.includes("var(--weight-");
const FONT_WEIGHT_BASELINE: BaselineEntry[] = [];

const FONT_FAMILY_PATTERN = /font-family:/;
const fontFamilyIsDisallowed = (line: string): boolean =>
  !/var\(--font-sans\)|var\(--font-display\)|var\(--font-mono\)|inherit|initial|unset/.test(line);
const FONT_FAMILY_BASELINE: BaselineEntry[] = [];

runCategoryGuard(
  "spacing (margin/padding/gap)",
  SPACING_PATTERN,
  spacingIsDisallowed,
  SPACING_BASELINE,
);
runCategoryGuard("color (hex/rgb/rgba)", COLOR_PATTERN, colorIsDisallowed, COLOR_BASELINE);
runCategoryGuard("font-size", FONT_SIZE_PATTERN, fontSizeIsDisallowed, FONT_SIZE_BASELINE);
runCategoryGuard("font-weight", FONT_WEIGHT_PATTERN, fontWeightIsDisallowed, FONT_WEIGHT_BASELINE);
runCategoryGuard("font-family", FONT_FAMILY_PATTERN, fontFamilyIsDisallowed, FONT_FAMILY_BASELINE);
