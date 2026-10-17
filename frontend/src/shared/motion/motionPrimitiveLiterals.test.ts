import fs from "fs";
import path from "path";

// HEL-1573 AC1: every motion primitive takes its timing from the --motion-* tokens and carries no literal duration,
// delay or curve. Scans each primitive's source (TS and CSS), comments stripped, so prose may name a number.

const SRC = path.join(__dirname, "..", "..");

/** The five primitives and their shared infrastructure, relative to frontend/src. */
export const PRIMITIVE_FILES = [
  "shared/motion/motionTokens.ts",
  "shared/motion/motion.css",
  "shared/motion/useStaggeredEntrance.ts",
  "shared/motion/useKeyedEntrance.ts",
  "shared/motion/expandFrom.ts",
  "shared/motion/useOneShot.ts",
  "shared/motion/useFirstMountForToken.ts",
  "shared/motion/useLayoutSlide.ts",
  "shared/motion/useValueTween.ts",
  "shared/motion/useIndicatorSlide.ts",
  "shared/ui/Crossfade.tsx",
  "shared/ui/Crossfade.css",
  "features/panels/ui/useChartEntranceMotion.ts",
];

const stripComments = (text: string) =>
  text.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");

/** Every literal-timing shape: a number with a time unit, a numeric timer delay, or a numeric duration/delay field. */
const LITERAL_TIMING: Array<[string, RegExp]> = [
  ["time unit", /(?<![\w-])\d*\.?\d+\s*m?s\b/g],
  ["timer delay", /set(?:Timeout|Interval)\([^)]*,\s*\d/g],
  ["duration/delay field", /\b(?:duration|delay|stagger)\s*[:=]\s*\d/g],
  ["literal easing", /cubic-bezier\(|(?<![\w-])ease(?:-in|-out|-in-out)?(?![\w-])/g],
];

export function findLiteralTimings(source: string): string[] {
  const code = stripComments(source);
  return LITERAL_TIMING.flatMap(([label, re]) =>
    [...code.matchAll(re)].map((m) => `${label}: ${m[0].trim()}`),
  );
}

describe("motion primitives carry no literal timing (HEL-1573 AC1)", () => {
  it.each(PRIMITIVE_FILES)("%s has no literal duration, delay or easing", (file) => {
    const source = fs.readFileSync(path.join(SRC, file), "utf-8");
    expect(findLiteralTimings(source)).toEqual([]);
  });

  it("scans every file under shared/motion, so a new primitive cannot be added unguarded", () => {
    const onDisk = fs
      .readdirSync(__dirname)
      .filter((name) => /\.(ts|tsx|css)$/.test(name) && !/\.test\./.test(name))
      .map((name) => `shared/motion/${name}`);
    for (const file of onDisk) expect(PRIMITIVE_FILES).toContain(file);
  });

  it("fails on a planted literal in each shape (the guard can go red)", () => {
    expect(findLiteralTimings("animation: x 280ms var(--a);")).not.toEqual([]);
    expect(findLiteralTimings("transition: opacity 0.3s;")).not.toEqual([]);
    expect(findLiteralTimings("setTimeout(done, 300);")).not.toEqual([]);
    expect(findLiteralTimings("el.animate(k, { duration: 280 });")).not.toEqual([]);
    expect(
      findLiteralTimings("transition: opacity var(--motion-duration-standard) ease;"),
    ).not.toEqual([]);
    expect(
      findLiteralTimings(
        "transition: opacity var(--motion-duration-standard) var(--motion-ease-out);",
      ),
    ).toEqual([]);
  });

  it("ignores a number named only in a comment", () => {
    expect(findLiteralTimings("/* about 400ms */ // 280ms\nconst x = 1;")).toEqual([]);
  });
});
