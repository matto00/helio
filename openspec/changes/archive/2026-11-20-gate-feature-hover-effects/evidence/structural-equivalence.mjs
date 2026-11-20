// HEL-1735 D5(a): desktop-equivalence of the gating, per stylesheet.
// usage: node structural-equivalence.mjs <baseRef> <afterSrcRoot> <files.txt>   (files relative to frontend/src)
// Each stylesheet (before = git show <baseRef>, after = <afterSrcRoot>/<file>) becomes an ORDERED list of rule groups:
// (at-rule chain with `@media (hover: hover)` removed, normalized declaration block, SET of selectors). Before-entries are
// one per source rule, then the SAME merge (design skeptic note: a pair of adjacent before-rules with identical declarations, e.g. two hover rules
// side by side, would otherwise be merged only on the after side; merging both sides is cascade-equivalent because only ADJACENT entries
// merge). After-entries: a maximal run of ADJACENT entries with the same chain and byte-equal declarations is
// merged into one group (the union of selectors); this is exactly what splitting a mixed list produces. The two lists must
// be equal element by element, in order. Exit 1 and name the first difference per file otherwise.
import { execFileSync } from "node:child_process";
import fs from "node:fs";

const HOVER = "@media (hover: hover)";
const strip = (c) => c.replace(/\/\*[\s\S]*?\*\//g, "");
const collapse = (s) => s.replace(/\s+/g, " ").trim();
const loose = (s) => collapse(s).replace(/\s*([:,;(){}>+~])\s*/g, "$1");
function splitTop(s) {
  const p = []; let d = 0, c = "";
  for (const ch of s) {
    if (ch === "(" || ch === "[") d++;
    if (ch === ")" || ch === "]") d--;
    if (ch === "," && d === 0) { p.push(c.trim()); c = ""; } else c += ch;
  }
  p.push(c.trim());
  return p.filter(Boolean);
}
function parse(css, anc = []) {
  const r = []; let i = 0;
  while (i < css.length) {
    const o = css.indexOf("{", i); if (o === -1) break;
    let d = 1, j = o + 1;
    while (d > 0 && j < css.length) { if (css[j] === "{") d++; else if (css[j] === "}") d--; j++; }
    const pre = collapse(css.slice(i, o).replace(/^[\s;}]+/, "")); const body = css.slice(o + 1, j - 1);
    if (pre.startsWith("@")) {
      if (/^@(media|supports|container|layer)/.test(pre)) r.push(...parse(body, [...anc, pre]));
      else r.push({ chain: anc.filter((a) => a !== HOVER).map(loose), decl: "@" + loose(pre + "{" + body + "}"), sels: [] , raw: true });
    } else r.push({ chain: anc.filter((a) => a !== HOVER).map(loose), decl: loose(body), sels: splitTop(pre).map(collapse).sort() });
    i = j;
  }
  return r;
}
const key = (g) => JSON.stringify([g.chain, g.decl, [...g.sels].sort()]);
function mergeAdjacent(list) {
  const out = [];
  for (const g of list) {
    const last = out[out.length - 1];
    if (last && !g.raw && !last.raw && JSON.stringify(last.chain) === JSON.stringify(g.chain) && last.decl === g.decl)
      last.sels = [...new Set([...last.sels, ...g.sels])].sort();
    else out.push({ ...g, sels: [...g.sels] });
  }
  return out;
}
const [base, root, listFile] = process.argv.slice(2);
const files = fs.readFileSync(listFile, "utf8").split("\n").filter(Boolean);
let bad = 0, groups = 0;
for (const f of files) {
  const before = mergeAdjacent(parse(strip(execFileSync("git", ["show", `${base}:frontend/src/${f}`], { encoding: "utf8" }))));
  const after = mergeAdjacent(parse(strip(fs.readFileSync(`${root}/${f}`, "utf8"))));
  groups += before.length;
  let diff = null;
  if (before.length !== after.length) diff = `group count ${before.length} -> ${after.length}`;
  for (let i = 0; !diff && i < before.length; i++) if (key(before[i]) !== key(after[i])) diff = `group ${i}: before ${key(before[i]).slice(0, 220)} / after ${key(after[i]).slice(0, 220)}`;
  if (diff) { bad++; console.log(`DIFF ${f}: ${diff}`); } else console.log(`same ${f} (${before.length} groups)`);
}
console.log(`files=${files.length} groups=${groups} differing=${bad}`);
process.exit(bad ? 1 : 0);
