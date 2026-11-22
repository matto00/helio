// HEL-1807 calibration of the start-anchor refinement of the regex cost model (design D3). Method as HEL-1697: reference
// machine, node/V8, `nice -n 19`, best of N `RegExp.exec` passes over distinct cells, cost from the real
// `compileJavaRegex(...).work`. Cells are sized so a case costs about the budget (rows = clamp(4e6 / cost of one cell,
// 1,000, 20,000)): the measured time is then the time at the budget, not an extrapolation.
//
// Usage: nice -n 19 node calibrate-anchored.mjs <group> [outDir]   group = A|B|C|D|E|F|G|H   (one group per run, each < 10 min)
// The evaluator modules are transpiled from the worktree's frontend/src so the shipped code is what is measured. Until
// `RegexWork.anchored` exists, the anchored charge is the reference implementation below (design D2, the code HEL-1807 ships)
// and the declared eligibility is used; once it exists the shipped `cellWork` and `anchored` are used and any
// disagreement with the declaration is printed as MISMATCH.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../../..");
const out = process.argv[3] ?? "/home/matt/Development/helio/.concertino/scratch/HEL-1807/cal-js";
const req = createRequire(path.join(root, "frontend/package.json"));
const ts = req("typescript");
const srcDir = path.join(root, "frontend/src/features/pipelines/evaluator");
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, "package.json"), '{"type":"commonjs"}');
for (const f of ["javaRegex", "javaRegexClass", "javaRegexCost", "javaRegexSets", "regexInputCost"]) {
  const js = ts.transpileModule(fs.readFileSync(path.join(srcDir, f + ".ts"), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  fs.writeFileSync(path.join(out, f + ".js"), js);
}
const R = createRequire(path.join(out, "x.js"));
const { compileJavaRegex } = R("./javaRegex.js");
const shipped = R("./regexInputCost.js");
const BUDGET = shipped.REGEX_WORK_BUDGET;
const LONE = 2;

// ---- reference implementation of the anchored charge (design D2), used while the shipped one does not exist ----------------
function inRanges(r, cp) {
  let lo = 0, hi = r.length - 1;
  while (lo <= hi) { const mid = (lo + hi) >> 1; if (cp < r[mid][0]) hi = mid - 1; else if (cp > r[mid][1]) lo = mid + 1; else return true; }
  return false;
}
/** One pass: the first U-run gives R0 and the anchored charge; return it unless the per-position charge could be lower. */
function refCellWork(text, w) {
  const { A, W, m, f, chars } = w;
  let len = 0, run = 0, total = 0, first = true, ac = 0;
  const endFirst = () => { first = false; ac = f * (A * (1 + W) + run * (A + m)); };
  const endRun = () => { total += run * A * Math.min(run, W) + m * run * run; run = 0; };
  for (let i = 0; i < text.length; ) {
    const cp = text.codePointAt(i);
    const pair = cp > 0xffff, lone = !pair && cp >= 0xd800 && cp <= 0xdfff;
    const units = pair ? 2 : lone ? LONE : 1;
    len += units;
    if (inRanges(chars, cp)) run += units;
    else { if (first) { endFirst(); if (ac <= f * A * text.length) return ac; } endRun(); }
    i += pair ? 2 : 1;
  }
  if (first) endFirst();
  endRun();
  return Math.min(ac, f * (A * len + total));
}
const LS = /[\ud800-\udfff]/u;
/** sf = true: the surrogate-free bound (L = 2 x length) instead of the per-cell lone-surrogate test. */
function refBound(text, w, sf) {
  const L = sf ? 2 * text.length : LS.test(text) ? LONE * text.length : text.length;
  const today = w.f * (w.A * L + L * w.A * Math.min(L, w.W) + w.m * L * L);
  return w.anchored ? Math.min(today, w.f * (w.A * (1 + w.W) + L * (w.A + w.m))) : today;
}
const hasShipped = (w) => Object.hasOwn(w, "anchoredShipped");
const charge = (text, w) => (w.anchored && !hasShipped(w) ? refCellWork(text, w) : shipped.cellWork(text, w));
/** The decision as the shipped `workExceedsBudget` takes it (reference form, with the bound variant switch). */
function exceeds(texts, w, sf) {
  let bound = 0;
  for (const t of texts) { bound += refBound(t, w, sf); if (bound > BUDGET) break; }
  if (bound <= BUDGET) return false;
  let total = 0;
  for (const t of texts) { total += charge(t, w); if (total > BUDGET) return true; }
  return false;
}

// ---- harness --------------------------------------------------------------------------------------------------------------
const flat = (s) => JSON.parse(JSON.stringify(s)); // flat one-/two-byte strings, never ropes/slices
const sfx = (i) => String(1000 + i);
const tag = (i) => String.fromCharCode(0x41 + (i % 26));
const tail = (i) => String.fromCharCode(0x430 + (i % 26));
const pts = (n, base = 0x100) => Array.from({ length: n }, (_, k) => String.fromCharCode(base + 2 * k)).join("");
function timeOnce(re, cells) { const t = process.hrtime.bigint(); for (const c of cells) re.exec(c); return Number(process.hrtime.bigint() - t) / 1e6; }
function best(fn, k = 5) {
  fn(); const t0 = fn(); if (t0 > 800) return Math.min(t0, fn());
  let b = t0; for (let i = 0; i < k; i++) b = Math.min(b, fn()); return b;
}
const lines = [];
const P = (s) => { console.log(s); lines.push(s); };
const short = (p) => (p.length > 60 ? p.slice(0, 28) + "..." + p.slice(-24) + ` (${p.length} chars)` : p);
const HEAD = "| row | A W m f anch | cells | cost (units) | best ms | ns/unit | ms@4e6 | verdict |\n|---|---|---|---|---|---|---|---|";
P(HEAD);
let worst = { v: 0, row: "" };
function verdictOf(v) { return v <= 20 ? "ok" : v <= 50 ? "ACCEPTED RISK (20-50 ms)" : "OVER 50 ms: DEFECT"; }
/** cell(i, len) -> string. rows scale to the budget unless `rows` is given. */
function row(label, pat, cell, { len = 2000, rows, declared, flags = "u" } = {}) {
  const c = compileJavaRegex(pat);
  if (!c.ok) { P(`| ${label} \`${short(pat)}\` | REJECTED (declined) | | | | | | |`); return; }
  const w = { ...c.work };
  if (Object.hasOwn(c.work, "anchored")) { w.anchoredShipped = true; }
  else w.anchored = declared ?? false;
  const mismatch = declared !== undefined && Object.hasOwn(c.work, "anchored") && c.work.anchored !== declared ? " MISMATCH" : "";
  const re = flags === "u" ? c.regex : new RegExp(c.regex.source, flags);
  const probe = flat(cell(0, len));
  const one = Math.max(1, charge(probe, w));
  const n = rows ?? Math.min(20000, Math.max(1000, Math.ceil(BUDGET / one)));
  const cells = Array.from({ length: n }, (_, i) => flat(cell(i, len)));
  const cost = cells.reduce((s, t) => s + charge(t, w), 0);
  const ms = best(() => timeOnce(re, cells));
  const atBudget = cost > 0 ? (ms * BUDGET) / cost : 0;
  const v = cost >= 2e6 ? atBudget : ms; // below 2e6 the frame is capped by the row count: the measured time is the answer
  const measureOnly = flags !== "u"; // multiline is never client-reachable: the number is evidence, not a verdict
  if (!measureOnly && v > worst.v) worst = { v, row: label + " " + pat };
  P(`| ${label} \`${short(pat)}\` | ${w.A} ${w.W} ${w.m} ${w.f} ${w.anchored ? "Y" : "n"}${mismatch} | ${n}x${len} | ${cost.toExponential(2)} | ${ms.toFixed(2)} | ${cost ? ((ms * 1e6) / cost).toFixed(3) : "-"} | ${atBudget.toFixed(1)} | ${measureOnly ? "measurement only (m flag)" : verdictOf(v)} |`);
}
const done = () => P(`\nWORST row (ms at budget, or measured ms when capped by the row count): ${worst.v.toFixed(1)} ms -- ${worst.row}`);
const anch = (p) => p.split("|").map((a) => "^" + a).join("|"); // `^` before EVERY top-level alternative

// ---- cell shapes (HEL-1697) -----------------------------------------------------------------------------------------------
const shapes = {
  "a...": (i, L) => "a".repeat(L - 4) + sfx(i),
  "1...": (i, L) => "1".repeat(L - 4) + sfx(i),
  "abcd...": (i, L) => "abcd".repeat((L - 4) / 4) + sfx(i),
  "a..!": (i, L) => "a".repeat(L - 5) + "!" + sfx(i),
  "<a...": (i, L) => "<" + "a".repeat(L - 5) + sfx(i),
  "(a*999!)x2": (i, L) => ("a".repeat(999) + "!").repeat(2).slice(0, L - 4) + sfx(i),
  astral: (i, L) => "\u{1F600}".repeat((L - 4) / 2) + sfx(i),
};
const shapes2 = {
  cyr: (i, L) => "привет".repeat(400).slice(0, L - 1) + tag(i),
  cjk: (i, L) => "数据分析".repeat(600).slice(0, L - 1) + tag(i),
  emdash: (i, L) => "a".repeat(L - 2) + "—" + tag(i),
  slice: (i, L) => ("—" + "a".repeat(L - 1) + tag(i)).slice(1),
  lonehi: (i, L) => "\uD800".repeat(L - 1) + tag(i),
  lonelo: (i, L) => "\uDC00".repeat(L - 1) + tag(i),
  mixHa: (i, L) => "\uD800a".repeat(L / 2 - 1) + "b" + tag(i),
  mixaH: (i, L) => "a\uD800".repeat(L / 2 - 1) + "b" + tag(i),
};
const basePats = ["a*b", "([a-z]+)-([a-z]+)", "(\\d+\\.\\d+)", "(a*)abcd", "(a*)$", "<(.+?)>", "(a+)", "(a{1000})b", "(a{1000,1015})b", "(.{1000})x", "(\\w{100})x", "(a{1000,})", "(a{0,7})b", "(\\S{16})x", "(.{500})x", "(a?)(b?)(c?)(d?)", "(a*)bcd", "(a*)b?c", "(a?)(b?)(c?)(d?)e", "(\\d+)", "(.{16})x", "(.*)x", "(.{8})(.{8})x"];
const group = process.argv[2];

if (group === "A") { // anchored form of every HEL-1697 pattern on the one-byte shapes
  for (const p of basePats) for (const [name, f] of Object.entries(shapes)) row(`${name} /`, "^" + p, f, { declared: true });
}
if (group === "B") { // two-byte and lone-surrogate shapes
  for (const p of ["(.{8})x", "(.{12})x", "(.{16})x", "(\\S{16})x", "(\\D{16})x", "[^a]{16}x", "(.{100})x", "(.*)x", "(.{500})x", "(.{8})(.{8})x"])
    for (const [s, f] of Object.entries(shapes2)) {
      if (p === "[^a]{16}x" && /emdash|slice|mixHa|mixaH/.test(s)) continue;
      row(`${s} /`, "^" + p, f, { declared: true });
    }
}
if (group === "C") { // class width, short runs, alternatives, characters outside U, the 64-alternative outlier
  const rr = (unit, Rn, sep) => (i, L) => (unit.repeat(Rn) + sep).repeat(L).slice(0, L - 1) + tail(i);
  for (const n of [15, 31, 63]) for (const form of [`([^${pts(n)}]{16})x`, `([^${pts(n)}]*)x`]) {
    const t = `r=${n + 1} ${form.endsWith("*)x") ? "*" : "{16}"}`;
    row(`${t} a`, "^" + form, (i, L) => "a".repeat(L - 1) + tag(i), { declared: true });
    row(`${t} cyr`, "^" + form, (i, L) => "привет".repeat(400).slice(0, L - 1) + tail(i), { declared: true });
    row(`${t} a+emdash`, "^" + form, (i, L) => "a".repeat(L - 2) + "—" + tag(i), { declared: true });
    for (const Rn of [1, 4, 16]) row(`${t} short R=${Rn} cyr`, "^" + form, rr("ж", Rn, "Ā"), { declared: true });
  }
  const S63 = pts(63);
  for (const [pat, name] of [[`[^${S63}]{16}x|[^${S63}]{16}y|[^${S63}]{16}z`, "3x[^<64>]{16}"], [`[^${S63}]{16}x|[^${S63}]{16}y`, "2x[^<64>]{16}"], [`[^${S63}]{8}x|[^${S63}]{8}y`, "2x[^<64>]{8}"]])
    for (const Rn of [1, 4, 16]) row(`${name} R=${Rn}`, anch(pat), rr("ж", Rn, "Ā"), { declared: true });
  for (const [pat, sep, unit] of [["(.{16})x|(.{16})y|(.{16})z", "\n", "ж"], ["(.{16})x|(.{16})y|(.{16})z", "\n", "b"], [".{16}x|.{16}y|.{16}z", "\n", "ж"], ["[^a]{16}x|[^a]{16}y|[^a]{16}z", "a", "ж"], ["(\\S{16})x|(\\S{16})y|(\\S{16})z", " ", "ж"], ["(\\w{16})x|(\\w{16})y|(\\w{16})z", "-", "b"]])
    for (const Rn of [1, 4]) for (const L of [1000, 2000]) row(`${pat.slice(0, 14)} R=${Rn} ${unit} L=${L}`, anch(pat), rr(unit, Rn, sep), { len: L, declared: true });
  const S7 = pts(7), ends = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const cellsFrom = (alphabet) => (i, L) => Array.from({ length: L }, (_, k) => alphabet[(k * 7 + i) % alphabet.length]).join("");
  const alts = (n, atom) => Array.from({ length: n }, (_, k) => `${atom}${ends[k]}`).join("|");
  for (const [p, l, alpha] of [[alts(16, `[^${S63}]{3}`), "16x [^<64>]{3}E all-nonU", S63], [alts(16, `[^${S7}]{3}`), "16x [^<8>]{3}E all-nonU", S7], [alts(16, "[^a]{3}"), "16x [^a]{3}E cell a", "a"], [alts(16, "\\S{3}"), "16x \\S{3}E cell spaces", " "], [alts(32, `[^${S63}]`), "32x [^<64>]E all-nonU", S63], [alts(32, `[^${S7}]`), "32x [^<8>]E all-nonU", S7], [alts(8, "[^a]{7}"), "8x [^a]{7}E cell a", "a"], [alts(3, "[^a]{16}"), "3x [^a]{16}E cell a", "a"], [alts(16, "\\w{3}"), "16x \\w{3}E spaces", " "]])
    row(l, anch(p), cellsFrom(alpha), { declared: true });
  { const six = pts(6); const alt64 = Array.from({ length: 64 }, (_, k) => `([^${six}k${String.fromCharCode(0x3b1 + k)}])`).join("|");
    row("64x ([^<6 pts>k_]) two-byte excluded (accepted-risk outlier)", anch(alt64), cellsFrom(six), { declared: true }); }
}
if (group === "D") { // the new anchored shapes, partly anchored, controls, multiline
  const a = (i, L) => "a".repeat(L - 4) + sfx(i);
  const lines50 = (i) => ("a".repeat(40) + "\n").repeat(50) + i;
  for (const p of ["^(.*)$", "^(.*)x", "(^a*)b", "()^(a*)b", "(^(.*))$", "^a*b|^c", "(^(a*)|^(c))b", "(^a|^b)c", "^(a*)b", "^(\\d+)"]) {
    row("a... /", p, a, { declared: true });
    row("non-U /", p, (i, L) => "z".repeat(L - 4) + sfx(i), { declared: true });
    row("1... /", p, (i, L) => "1".repeat(L - 4) + sfx(i), { declared: true });
  }
  row("AC frame 1000x500 /", "^(.*)$", a, { len: 500, rows: 1000, declared: true });
  // partly anchored: charged with today's per-position formula (confirm)
  for (const p of ["^(.*)x|y", "^a*b|c", "^(a*)b|(c)", "(a)^b", "(.*)^(x)"]) row("partly (LEN 500) a... /", p, a, { len: 500, rows: 1000, declared: false });
  // multiline (JS `m` flag, measurement only; client code never produces it: inline flags decline)
  for (const p of ["^(.*)$", "^(a*)b"]) {
    row("multiline m-flag lines /", p, lines50, { len: 2050, rows: 1000, declared: true, flags: "um" });
    row("same, no m flag /", p, lines50, { len: 2050, rows: 1000, declared: true });
    row("same, unanchored form /", p.replace("^", ""), lines50, { len: 2050, rows: 1000, declared: false });
  }
  // HEL-1697 control rows
  row("CONTROL a... /", "a*b", (i, L) => "a".repeat(L - 4) + sfx(i), { rows: 1000, declared: false });
  row("CONTROL cyr /", "(.{16})x", shapes2.cyr, { rows: 1000, declared: false });
  row("CONTROL a... /", "(a+)", (i, L) => "a".repeat(L - 4) + sfx(i), { rows: 1000, declared: false });
}
if (group === "F") { // per-call overhead: judged by the measured time itself, decision + exec
  const DT = (label, pat, cell, n) => {
    const c = compileJavaRegex(pat);
    if (!c.ok) { P(`| ${label} \`${short(pat)}\` | REJECTED | | | | | | |`); return; }
    const w = { ...c.work };
    if (Object.hasOwn(c.work, "anchored")) w.anchoredShipped = true; else w.anchored = true;
    const cells = Array.from({ length: n }, (_, i) => flat(cell(i)));
    const cost = cells.reduce((s, t) => s + charge(t, w), 0);
    const td = best(() => { const t = performance.now(); exceeds(cells, w, false); return performance.now() - t; });
    const tx = best(() => timeOnce(c.regex, cells));
    const total = td + tx;
    if (total > worst.v) worst = { v: total, row: label + " " + pat };
    P(`| ${label} \`${short(pat)}\` | ${w.A} ${w.W} ${w.m} ${w.f} ${w.anchored ? "Y" : "n"} | ${n} cells | ${cost.toExponential(2)} | decision ${td.toFixed(2)} + exec ${tx.toFixed(2)} = ${total.toFixed(2)} | | | ${verdictOf(total)} |`);
  };
  for (const n of [10000, 20000]) for (const pat of ["^()", "^(.*)$", "^(a{0,7})b"]) for (const k of [0, 1, 2, 4])
    DT(`${k}-char cells`, pat, (i) => "abcd".slice(0, k), n);
}
const agg0 = { false: { all: 0, two: 0 }, true: { all: 0, two: 0 } };
if (group === "E") { // decision-scan rows (C2) plus the two-byte worst case; both bound variants
  const DOT = [[0, 9], [11, 12], [14, 0x84], [0x86, 0x2027], [0x202a, 0x10ffff]];
  const AB = { A: 1, W: 2, m: 1, f: 1, chars: [[97, 98]], anchored: true };
  const D = { A: 1, W: 1, m: 0, f: 1, chars: [[48, 57]], anchored: true };
  const live = (pat, fallback) => { const c = compileJavaRegex(pat); return c.ok ? { ...c.work, anchored: Object.hasOwn(c.work, "anchored") ? c.work.anchored : true, ...(Object.hasOwn(c.work, "anchored") ? { anchoredShipped: true } : {}) } : fallback; };
  const prose = (n, i) => ("Order line ABC " + i + " shipped on 2026-11-21 for $129.99. ").repeat(Math.ceil(n / 40) + 1).slice(0, n);
  const cyr = (n, i) => ("Заказ номер " + i + " отправлен покупателю. ").repeat(Math.ceil(n / 30) + 1).slice(0, n);
  const cjk = (n, i) => ("订单" + i + "已发货给客户。").repeat(Math.ceil(n / 8) + 1).slice(0, n);
  const astral = (n, i) => ("\u{1F600}\u{1F680}x" + i).repeat(Math.ceil(n / 6) + 1).slice(0, n - (n % 2));
  const x4 = (i) => String(i).padStart(4, "0");
  const cases = [
    ["^(a*)b on c+a*", "^(a*)b", (n, i) => "c" + "a".repeat(n - 5) + x4(i), [[1000, 20000], [10000, 2000]]],
    // one-byte frames just under the budget: the surrogate-free bound (2 x len) crosses it, so the exact scan runs
    ["^(a*)b on a* (exact charge just under budget)", "^(a*)b", (n, i) => "a".repeat(n - 4) + x4(i), [[1000, 1990], [10000, 199], [20000, 99]]],
    ["^(.*)$ on a (exact charge just under budget)", "^(.*)$", (n, i) => "a".repeat(n - 4) + x4(i), [[1000, 1330], [10000, 133], [20000, 66]]],
    ["^(\\d+) on digits", "^(\\d+)", (n, i) => "1".repeat(n - 4) + x4(i), [[1000, 3998], [20000, 197]]],
    ["^(\\d+) on prose", "^(\\d+)", prose, [[1000, 20000], [10000, 2000]]],
    ["^(.*)$ on a (AC)", "^(.*)$", (n, i) => "a".repeat(n - 4) + x4(i), [[1000, 500], [1000, 2000], [10000, 2000]]],
    // two-byte worst cases (skeptic-design-3.md): first U-run covers almost the whole cell
    ["^([^x]*)x on cyr R0=len-5", "^([^x]*)x", (n, i) => "ж".repeat(n - 5) + "x" + x4(i), [[1000, 1990], [20000, 98]]],
    ["^([а-я]*)x on cyr+!6", "^([а-я]*)x", (n, i) => "ж".repeat(n - 10) + "!!!!!!" + x4(i), [[1000, 2000], [20000, 100]]],
    ["^(\\d+) on Cyrillic prose", "^(\\d+)", cyr, [[1000, 20000], [20000, 200]]],
    ["^(\\d+) on CJK prose", "^(\\d+)", cjk, [[1000, 20000], [20000, 200]]],
    ["^(\\d+) on astral", "^(\\d+)", astral, [[1000, 20000], [20000, 200]]],
  ];
  const agg = agg0;
  for (const [name, pat, cell, frames] of cases)
    for (const [rows, len] of frames) {
      const w = live(pat, AB);
      const c = compileJavaRegex(pat);
      const texts = Array.from({ length: rows }, (_, i) => flat(cell(len, i)));
      const res = {};
      for (const sf of [false, true]) {
        let over;
        const td = best(() => { const t = performance.now(); over = exceeds(texts, w, sf); return performance.now() - t; });
        const tx = over || !c.ok ? 0 : best(() => timeOnce(c.regex, texts));
        res[sf] = { td, tx, over };
      }
      // With the shipped anchored model: the real `workExceedsBudget` (bound + exact scan as shipped), decision + exec.
      let realCol = "";
      if (hasShipped(w)) {
        let realOver;
        const tr = best(() => { const t = performance.now(); realOver = shipped.workExceedsBudget(texts, w); return performance.now() - t; });
        const trx = realOver || !c.ok ? 0 : best(() => timeOnce(c.regex, texts));
        realCol = ` shipped workExceedsBudget: decision ${tr.toFixed(2)} + exec ${trx.toFixed(2)} = ${(tr + trx).toFixed(2)}${realOver ? " (declined)" : ""};`;
        agg0.real = Math.max(agg0.real ?? 0, tr + trx);
      }
      const f = (k) => `decision ${res[k].td.toFixed(2)} + exec ${res[k].tx.toFixed(2)} = ${(res[k].td + res[k].tx).toFixed(2)}${res[k].over ? " (declined)" : ""}`;
      const v = Math.min(res[false].td + res[false].tx, res[true].td + res[true].tx);
      const wv = Math.max(res[false].td + res[false].tx, res[true].td + res[true].tx);
      if (wv > worst.v) worst = { v: wv, row: name + " " + rows + "x" + len };
      const twoByte = /cyr|Cyrillic|CJK|astral/.test(name);
      for (const k of [false, true]) {
        const t = res[k].td + res[k].tx;
        agg[k].all = Math.max(agg[k].all, t);
        if (twoByte) agg[k].two = Math.max(agg[k].two, t);
      }
      P(`| ${name} | ${w.A} ${w.W} ${w.m} ${w.f} Y | ${rows}x${len} | per-cell LS test: ${f(false)} | surrogate-free L=2xlen: ${f(true)} |${realCol} | ${verdictOf(Math.max(v, 0))} (best variant) |`);
    }
}
if (group === "E") P(`\nMax decision+exec: per-cell LS test: two-byte rows ${agg0.false.two.toFixed(2)} ms, all rows ${agg0.false.all.toFixed(2)} ms; surrogate-free L=2xlen: two-byte rows ${agg0.true.two.toFixed(2)} ms, all rows ${agg0.true.all.toFixed(2)} ms` + (agg0.real === undefined ? "" : `; shipped workExceedsBudget (SF bound): all rows ${agg0.real.toFixed(2)} ms`));
if (group === "G") { // final-gate round 1: no-tail anchored wide classes (m = 0, one unit per character) at the budget
  // The worst decision-scan case of the anchored model: the charge is one unit per character, so the exact scan would read about
  // 4.00e6 / f characters, twice what the per-position charge allowed. Every frame is sized to the longest cell length whose
  // exact charge stays at or under the budget (all admitted), 1,000 and 20,000 rows, shipped workExceedsBudget + exec together.
  const neg = (n) => `[^${pts(n)}]`;
  const patterns = [];
  for (const n of [15, 31, 63]) for (const q of ["+", "*"]) patterns.push([`^(${neg(n)}${q})`, `^([^<${n + 1} ranges>]${q})`, "neg"]);
  patterns.push(["^(.+)", "^(.+)", "any"], ["^(\\S+)", "^(\\S+)", "any"], ["^(\\d+)", "^(\\d+)", "digit"]);
  patterns.push([`^([${pts(63)}]+)`, "^([<63 ranges>]+) positive", "pos"]);
  const shapesG = { cyr: "ж", cjk: "数", astral: "\u{1F600}", lone: "\ud800", "one-byte": "a" };
  const unit = (kind, name) => (kind === "digit" ? (name === "one-byte" ? "1" : null) : kind === "pos" ? (name === "cyr" ? "Ā" : null) : shapesG[name]);
  for (const [pat, label, kind] of patterns) {
    const c = compileJavaRegex(pat);
    if (!c.ok) { P(`| ${label} | REJECTED | | | | | | |`); continue; }
    const w = { ...c.work };
    if (Object.hasOwn(c.work, "anchored")) w.anchoredShipped = true; else w.anchored = true;
    for (const name of Object.keys(shapesG)) {
      const u = unit(kind, name);
      if (u === null || u === undefined) continue;
      for (const rows of [1000, 20000]) {
        const cellOf = (units, i) => u.repeat(units) + (i % 2 ? "" : "");
        const chargeOf = (n) => rows * charge(cellOf(n, 0), w);
        let lo = 1, hi = 40000;
        while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (chargeOf(mid) <= BUDGET) lo = mid; else hi = mid - 1; }
        const cells = Array.from({ length: rows }, (_, i) => flat(u.repeat(lo - 1) + (i % 2 ? u : String.fromCharCode(0x41 + (i % 26)))));
        const cost = cells.reduce((acc, t) => acc + charge(t, w), 0);
        let over;
        const td = best(() => { const t = performance.now(); over = shipped.workExceedsBudget(cells, w); return performance.now() - t; }, 7);
        const tx = best(() => timeOnce(c.regex, cells), 7);
        const total = td + tx;
        if (total > worst.v) worst = { v: total, row: `${label} ${name} ${rows}x${lo}` };
        P(`| ${label} on ${name} | ${w.A} ${w.W} ${w.m} ${w.f} Y | ${rows}x${lo} | ${cost.toExponential(3)} | decision ${td.toFixed(2)} + exec ${tx.toFixed(2)} = ${total.toFixed(2)}${over ? " (DECLINED: sizing error)" : ""} | | | ${verdictOf(total)} |`);
      }
    }
  }
}
if (group === "H") { // final-gate round 2: the loosest input of EACH stage of the staged decision
  // Stage 1 (surrogate-free bound, 2 x length) is loosest on any cell whose exact charge is near the budget: it is 2x too high, so
  // stage 2 always runs (rows of group G, one-byte and two-byte). Stage 2 (tested bound) doubles the WHOLE cell for ONE unpaired
  // surrogate: loosest on two-byte/astral cells with exactly one lone surrogate (rows below, high and low, at the start and at
  // the end), where it is 2x too high and the exact scan (stage 3) reads every character at the speed of `inRanges`. Stage 3 is
  // loosest where the exact scan reads the whole cell for the least charge: one unit per character (m = 0), the wide classes
  // (64 ranges, f = 2) and `.`/`\S` on two-byte cells, plus the cells of group E whose first run ends before the cell does. The
  // unanchored path's bound (HEL-1697, per-cell lone-surrogate test) is loosest for `(x)`/`(\d+)` on cells without a match
  // character: bound 2 x len against exact len, so the exact scan always runs (rows "unanchored" below, with and without one lone
  // surrogate). Every frame: longest cell length with exact charge at or under 4.00e6, 1,000 and 20,000 rows, shipped
  // workExceedsBudget + exec together, best of 7.
  const neg = (n) => `[^${pts(n)}]`;
  const patterns = [];
  for (const n of [15, 31, 63]) for (const q of ["+", "*"]) patterns.push([`^(${neg(n)}${q})`, `^([^<${n + 1} ranges>]${q})`]);
  patterns.push(["^(.+)", "^(.+)"], ["^(\\S+)", "^(\\S+)"], ["^(\\d+)", "^(\\d+) digits+lone"]);
  patterns.push(["(x)", "unanchored (x)"], ["(\\d+)", "unanchored (\\d+)"]);
  const bodies = { cyr: "ж", cjk: "数", astral: "\u{1F600}" };
  const lones = { "high@start": ["\ud800", "start"], "high@end": ["\ud800", "end"], "low@start": ["\udc00", "start"], "low@end": ["\udc00", "end"] };
  for (const [pat, label] of patterns) {
    const c = compileJavaRegex(pat);
    if (!c.ok) { P(`| ${label} | REJECTED | | | | | | |`); continue; }
    const w = { ...c.work };
    if (Object.hasOwn(c.work, "anchored")) w.anchoredShipped = true; else w.anchored = true;
    for (const [bn, u] of Object.entries(bodies)) for (const [ln, [lone, at]] of Object.entries(lones)) for (const rows of [1000, 20000]) {
      if (/digits/.test(label) && bn !== "cyr") continue;
      const mk = (len, k) => { const body = (/digits|\(.d/.test(label) ? "1" : u).repeat(len) + String.fromCharCode(0x4e00 + (k % 20000)); return flat(at === "end" ? body + lone : lone + body); };
      const tot = (len) => { let t = 0; for (let k = 0; k < Math.min(rows, 64); k++) t += charge(mk(len, k), w); return (t / Math.min(rows, 64)) * rows; };
      if (tot(1) > BUDGET) continue;
      let lo = 1, hi = 100000;
      while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (tot(mid) <= BUDGET) lo = mid; else hi = mid - 1; }
      const cells = Array.from({ length: rows }, (_, k) => mk(lo, k));
      const cost = cells.reduce((acc, t) => acc + charge(t, w), 0);
      let over;
      const td = best(() => { const t = performance.now(); over = shipped.workExceedsBudget(cells, w); return performance.now() - t; }, 7);
      const tx = over ? 0 : best(() => timeOnce(c.regex, cells), 7);
      const total = td + tx;
      if (total > worst.v) worst = { v: total, row: `${label} ${bn}+${ln} ${rows}x${lo}` };
      P(`| ${label} on ${bn} + ${ln} | ${w.A} ${w.W} ${w.m} ${w.f} ${w.anchored ? "Y" : "n"} | ${rows}x${cells[0].length} | ${cost.toExponential(3)} | decision ${td.toFixed(2)} + exec ${tx.toFixed(2)} = ${total.toFixed(2)}${over ? " (DECLINED: sizing error)" : ""} | | | ${verdictOf(total)} |`);
    }
  }
}
done();
fs.writeFileSync(path.join(out, `result-${group}.md`), lines.join("\n") + "\n");
