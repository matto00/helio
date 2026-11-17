// Shared CSS rule parser for the hover-gating guards (HEL-1668 pipeline page, HEL-1675 `shared/`): every `:hover`
// selector must sit inside `@media (hover: hover)` (or a guard's named allowlist), so a touch tap never leaves a hover
// effect stuck. Not a full CSS parser: it understands comments, top-level selector lists and the at-rules that nest rules.

export const HOVER_MEDIA = "@media (hover: hover)";

export interface Rule {
  selectors: string[];
  ancestors: string[];
}

export function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

export function splitTop(selector: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let cur = "";
  for (const c of selector) {
    if (c === "(" || c === "[") depth++;
    if (c === ")" || c === "]") depth--;
    if (c === "," && depth === 0) {
      parts.push(cur.trim());
      cur = "";
    } else cur += c;
  }
  parts.push(cur.trim());
  return parts.filter((p) => p !== "");
}

export function parseRules(css: string, ancestors: string[] = []): Rule[] {
  const rules: Rule[] = [];
  let i = 0;
  while (i < css.length) {
    const open = css.indexOf("{", i);
    if (open === -1) break;
    let depth = 1;
    let j = open + 1;
    while (depth > 0 && j < css.length) {
      if (css[j] === "{") depth++;
      else if (css[j] === "}") depth--;
      j++;
    }
    const prelude = css
      .slice(i, open)
      .replace(/^[\s;}]+/, "")
      .trim();
    const body = css.slice(open + 1, j - 1);
    if (prelude.startsWith("@")) {
      const normalized = prelude.replace(/\s+/g, " ");
      if (/^@(media|supports|container|layer)/.test(normalized)) {
        rules.push(...parseRules(body, [...ancestors, normalized]));
      }
    } else {
      rules.push({ selectors: splitTop(prelude.replace(/\s+/g, " ")), ancestors });
    }
    i = j;
  }
  return rules;
}

export interface FileRules {
  file: string;
  rules: Rule[];
}

/** `file: selector` for every `:hover` selector outside `@media (hover: hover)` that `isAllowed` does not exempt. */
export function ungatedHoverSelectors(
  files: FileRules[],
  isAllowed: (file: string, rule: Rule, selector: string) => boolean = () => false,
): string[] {
  const out: string[] = [];
  for (const { file, rules } of files)
    for (const rule of rules)
      for (const selector of rule.selectors.filter((s) => s.includes(":hover"))) {
        if (rule.ancestors.includes(HOVER_MEDIA) || isAllowed(file, rule, selector)) continue;
        out.push(`${file}: ${selector}`);
      }
  return out;
}

/** Gated rules whose selector list mixes a `:hover` selector with a non-hover one. */
export function mixedGatedRules(files: FileRules[]): string[] {
  const out: string[] = [];
  for (const { file, rules } of files)
    for (const rule of rules) {
      if (!rule.ancestors.includes(HOVER_MEDIA)) continue;
      if (rule.selectors.some((s) => !s.includes(":hover")))
        out.push(`${file}: ${rule.selectors.join(", ")}`);
    }
  return out;
}
