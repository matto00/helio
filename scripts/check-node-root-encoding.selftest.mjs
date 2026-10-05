#!/usr/bin/env node
// Self-test for scripts/check-node-root-encoding.mjs (HEL-913 task 5.8b-i: "prove the guard
// fires" -- a guard never observed failing against the defect it names is not evidence).
// Drives `scanTextForViolations` against in-memory fixture text and READ-ONLY copies of the real
// target files (nothing is written; mutations are applied to in-memory strings) -- and asserts
// on the VIOLATION COUNT AND CONTENT, never on "the function ran without throwing" alone.

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { scanTextForViolations, KNOWN_EXEMPTIONS } from "./check-node-root-encoding.mjs";

let failures = 0;

function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${ok ? "PASS" : "FAIL"}: ${name}`);
  if (!ok) {
    failures++;
    console.log(`  expected: ${JSON.stringify(expected)}`);
    console.log(`  actual:   ${JSON.stringify(actual)}`);
  }
}

// (a) Raw SQL standalone `node_step_id IS NULL` -- the exact form V98/R12 bans -- FIRES.
{
  const text = `sqlu"DELETE FROM node_snapshots WHERE pipeline_id = $pid AND node_step_id IS NULL"`;
  const violations = scanTextForViolations("fake/File.scala", text);
  check("raw SQL standalone fires", violations.length, 1);
}

// (b) Raw SQL WITH a same-line root_id qualifier -- does NOT fire (this is the correct,
// already-fixed shape this ticket's Stage 2 introduced).
{
  const text = `sqlu"DELETE FROM node_snapshots WHERE pipeline_id = $pid AND node_step_id IS NULL AND root_id = $rid"`;
  const violations = scanTextForViolations("fake/File.scala", text);
  check("raw SQL root-qualified does not fire", violations.length, 0);
}

// (c) Slick-lifted `.nodeStepId.isEmpty` on a table row -- FIRES.
{
  const text = `val filtered = table.filter(r => r.pipelineId === pid && r.nodeStepId.isEmpty)`;
  const violations = scanTextForViolations("fake/File.scala", text);
  check("Slick .nodeStepId.isEmpty fires", violations.length, 1);
}

// (d) Slick-lifted `.nodeStepId.isDefined` -- FIRES.
{
  const text = `if (r.nodeStepId.isDefined) doSomething()`;
  const violations = scanTextForViolations("fake/File.scala", text);
  check(".nodeStepId.isDefined fires", violations.length, 1);
}

// (e) `=== Option.empty` -- FIRES.
{
  const text = `table.filter(r => r.nodeStepId === Option.empty)`;
  const violations = scanTextForViolations("fake/File.scala", text);
  check("=== Option.empty fires", violations.length, 1);
}

// (f) Slick form WITH a same-line rootId qualifier -- does NOT fire.
{
  const text = `table.filter(r => r.nodeStepId.isEmpty && r.rootId === Option(rid))`;
  const violations = scanTextForViolations("fake/File.scala", text);
  check("Slick root-qualified does not fire", violations.length, 0);
}

// (h) The SAME banned pattern in a file with NO exemption still fires.
{
  const relPath =
    "backend/src/main/scala/com/helio/infrastructure/persistence/pipelines/OutputRepository.scala";
  const text = Array.from({ length: 10 }, (_, i) =>
    i === 4 ? `  case None => table.filter(r => r.nodeStepId.isEmpty)` : "",
  ).join("\n");
  const violations = scanTextForViolations(relPath, text);
  check("same pattern in a non-exempted file still fires", violations.length, 1);
}

// (i) A hit preceded by a `/* ... */` block comment on the same line is still a hit (only lines
// STARTING with `//` or `*` are comments) -- pins the comment rule.
{
  const text = `/* note */ sqlu"DELETE FROM node_snapshots WHERE pipeline_id = $pid AND node_step_id IS NULL"`;
  check(
    "leading /* */ comment does not hide a hit",
    scanTextForViolations("fake/File.scala", text).length,
    1,
  );
}

// ---- Content-keyed exemption proofs (HEL-1282) against the REAL files and shipped table ------

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const PERSISTENCE = "backend/src/main/scala/com/helio/infrastructure/persistence/pipelines/";
const NS = `${PERSISTENCE}NodeSnapshotRepository.scala`;
const BR = `${PERSISTENCE}BinaryRefRepository.scala`;
const real = {
  [NS]: readFileSync(join(repoRoot, NS), "utf8"),
  [BR]: readFileSync(join(repoRoot, BR), "utf8"),
};
const base = (f) => f.split("/").pop();
const norm = (l) => l.trim().replace(/\s+/g, " ");
const BANNED = /node_step_id\s+IS\s+NULL(?!\s+AND\s+root_id)/i;
const isComment = (l) => l.trim().startsWith("//") || l.trim().startsWith("*");
const isHit = (l) => !isComment(l) && BANNED.test(l) && !/root_id/i.test(l);
const hitLines = (text) => text.split("\n").filter(isHit);
const mentions = (v, file, text) => String(v).includes(file) && String(v).includes(text);
const stale = (m) => String(m).startsWith("stale exemption:");

// Mutates `text` and proves the mutation really changed it (a no-op mutation proves nothing).
function mutate(text, fn) {
  const out = fn(text);
  if (out === text) throw new Error("selftest mutation was a no-op");
  return out;
}
const insertBefore = (text, marker, block) =>
  mutate(text, (t) => t.replace(marker, block + marker));
const comments = (n) => Array.from({ length: n }, (_, i) => `  // shifted ${i}`).join("\n") + "\n";
const caseNoneNone = (text) => hitLines(text).find((l) => l.includes("case (None, None)"));

// Shipped table sanity: 6 entries, each backed by a real hit.
check("shipped table has 6 entries", KNOWN_EXEMPTIONS.length, 6);
check("real NodeSnapshotRepository has 3 raw hits", hitLines(real[NS]).length, 3);
check("real BinaryRefRepository has 3 raw hits", hitLines(real[BR]).length, 3);

// (baseline) real text -> clean.
for (const f of [NS, BR]) {
  check(`baseline: real ${base(f)} is clean`, scanTextForViolations(f, real[f]), []);
}

// (a) line shift: 40 comment lines at the top and 40 above a later declaration -> still clean.
{
  let t = comments(40) + real[NS];
  t = insertBefore(t, "  private def nodeFilterFragment", comments(40));
  check(
    "(a) line shift above exempt sites stays green (NodeSnapshotRepository)",
    scanTextForViolations(NS, t),
    [],
  );
  let b = comments(40) + real[BR];
  b = insertBefore(b, "  private def selectQuery", comments(40));
  check(
    "(a) line shift above exempt sites stays green (BinaryRefRepository)",
    scanTextForViolations(BR, b),
    [],
  );
  const c = "\n\n\n  val harmless = 1\n" + real[NS];
  check("(a) non-comment lines inserted at top stay green", scanTextForViolations(NS, c), []);
}

// (b) a NEW standalone hit in a NEW method is red, exactly one, naming file and text.
{
  const line = `    sqlu"DELETE FROM node_snapshots WHERE pipeline_id = $p AND node_step_id IS NULL AND row_index = 1"`;
  const t = real[NS] + `\n  def brandNew(p: String) = {\n${line}\n  }\n`;
  const v = scanTextForViolations(NS, t);
  check("(b) new standalone hit: exactly one violation", v.length, 1);
  check("(b) new standalone hit names file and text", mentions(v[0], NS, line.trim()), true);
}

// (b') verbatim copy of an exempt line in the SAME method: every hit of the group goes red.
{
  const exemptLine = hitLines(real[NS])[0];
  const t = mutate(real[NS], (x) => x.replace(exemptLine, exemptLine + "\n" + exemptLine));
  const v = scanTextForViolations(NS, t);
  check("(b') same-scope duplicate: both occurrences red", v.length, 2);
  check(
    "(b') same-scope duplicate names count mismatch and text",
    v.every(
      (m) => m.includes("2 occurrences, exemption covers 1") && mentions(m, NS, exemptLine.trim()),
    ),
    true,
  );
}

// (b'') verbatim copy of an exempt line in a DIFFERENT method: red, exactly one.
{
  const exemptLine = caseNoneNone(real[NS]);
  const t =
    real[NS] +
    `\n  def pasted(a: Option[String], b: Option[String]) = (a, b) match {\n${exemptLine}\n  }\n`;
  const v = scanTextForViolations(NS, t);
  check("(b'') other-scope duplicate: exactly one violation", v.length, 1);
  check(
    "(b'') other-scope duplicate names file and text",
    mentions(v[0], NS, exemptLine.trim()),
    true,
  );
}

// (b-file) the same exempt text in a different FILE is red (key includes the file).
{
  const v = scanTextForViolations(`${PERSISTENCE}OutputRepository.scala`, caseNoneNone(real[NS]));
  check("(b-file) same text in another file is red", v.length, 1);
}

// (c) removing an exemption turns exactly its site red (every entry, both files).
for (const e of KNOWN_EXEMPTIONS) {
  const without = KNOWN_EXEMPTIONS.filter((x) => x !== e);
  const v = scanTextForViolations(e.file, real[e.file], without);
  const siteText = e.text.replace(/^case \(None, None\) =>\s*/, "");
  check(`(c) removed exemption (${e.scope}) turns its site red`, v.length, 1);
  check(
    `(c) removed exemption (${e.scope}) names file and text`,
    mentions(v[0], e.file, siteText),
    true,
  );
}

// (stale) deleting an exempt line leaves a stale entry -> failure (every entry).
for (const e of KNOWN_EXEMPTIONS) {
  const scopeAt = real[e.file].indexOf(`def ${e.scope}`);
  const target = real[e.file]
    .slice(scopeAt)
    .split("\n")
    .find((l) => norm(l) === e.text);
  const t = mutate(
    real[e.file],
    (x) => x.slice(0, scopeAt) + x.slice(scopeAt).replace(target + "\n", ""),
  );
  const v = scanTextForViolations(e.file, t);
  check(`(stale) deleted site (${e.scope}) reports one stale exemption`, v.length, 1);
  check(
    `(stale) deleted site (${e.scope}) names the entry`,
    stale(v[0]) && String(v[0]).includes(e.scope),
    true,
  );
}

// (whitespace) re-indenting / re-aligning every exempt line stays exempt.
for (const f of [NS, BR]) {
  const t = real[f]
    .split("\n")
    .map((l) => (isHit(l) ? "        " + l.trim().replace(/ +/g, "   ") : l))
    .join("\n");
  check(
    `(whitespace) re-aligned exempt lines stay green (${base(f)})`,
    scanTextForViolations(f, t),
    [],
  );
}

// (arm) widening the governing arm and dropping the root-bound arm is red: the hit's arm no
// longer matches (unmatched hit) AND the entry goes stale.
{
  const t = mutate(real[BR], (x) => {
    const at = x.indexOf("private def selectQuery");
    const tail = x
      .slice(at)
      .replace(/ {4}case \(None, Some\(rid\)\) =>\n(?:.*\n){4}/, "")
      .replace("case (None, None) =>", "case (None, _) =>");
    return x.slice(0, at) + tail;
  });
  const v = scanTextForViolations(BR, t);
  const site = 'WHERE pipeline_id = $pipelineId AND node_step_id IS NULL"""';
  check("(arm) selectQuery widened: unmatched hit + stale entry", v.length, 2);
  check(
    "(arm) selectQuery: hit named",
    v.some((m) => !stale(m) && mentions(m, BR, site)),
    true,
  );
  check(
    "(arm) selectQuery: stale entry",
    v.some((m) => stale(m) && m.includes("selectQuery")),
    true,
  );
}
{
  const t = mutate(real[NS], (x) => {
    const at = x.indexOf("def overwriteRowsAction");
    const tail = x
      .slice(at)
      .replace(/ {6}case \(None, Some\(rid\)\) =>\n.*\n/, "")
      .replace("case (None, None) =>", "case (None, _) =>");
    return x.slice(0, at) + tail;
  });
  const v = scanTextForViolations(NS, t);
  const site =
    'DELETE FROM node_snapshots WHERE pipeline_id = $pipelineId AND node_step_id IS NULL"';
  check("(arm) overwriteRowsAction widened: unmatched hit + stale entry", v.length, 2);
  check(
    "(arm) overwriteRowsAction: hit named",
    v.some((m) => !stale(m) && mentions(m, NS, site)),
    true,
  );
  check(
    "(arm) overwriteRowsAction: stale entry",
    v.some((m) => stale(m) && m.includes("overwriteRowsAction")),
    true,
  );
}

// (text) weakening a multi-line exempt site's text IN PLACE (arm and scope untouched) is red:
// unmatched hit + stale entry. Pins the `text` component of the key.
{
  const old = 'WHERE pipeline_id = $pipelineId AND node_step_id IS NULL"""';
  const t = mutate(real[BR], (x) => {
    const at = x.indexOf("private def selectQuery");
    return x.slice(0, at) + x.slice(at).replace(old, 'WHERE node_step_id IS NULL"""');
  });
  const v = scanTextForViolations(BR, t);
  check("(text) weakened selectQuery text: unmatched hit + stale entry", v.length, 2);
  check(
    "(text) weakened hit named",
    v.some((m) => !stale(m) && mentions(m, BR, 'WHERE node_step_id IS NULL"""')),
    true,
  );
  check(
    "(text) stale entry reported",
    v.some((m) => stale(m) && m.includes("selectQuery")),
    true,
  );
}

// (arm-reset) the arm resets on a scope change: collapsing selectQuery's match into one
// unconditional bare query must be red, NOT inherit findByNodeAndRow's trailing
// `case (None, None) =>` arm.
{
  const t = mutate(real[BR], (x) => {
    const at = x.indexOf("private def selectQuery");
    return (
      x.slice(0, at) +
      'private def selectQuery(pipelineId: String) =\n    sql"""SELECT id FROM binary_refs\n            WHERE pipeline_id = $pipelineId AND node_step_id IS NULL"""\n}\n'
    );
  });
  const v = scanTextForViolations(BR, t);
  check("(arm-reset) collapsed selectQuery: unmatched hit + stale entry", v.length, 2);
  check(
    "(arm-reset) collapsed hit named",
    v.some((m) => !stale(m) && mentions(m, BR, 'node_step_id IS NULL"""')),
    true,
  );
  check(
    "(arm-reset) stale entry reported",
    v.some((m) => stale(m) && m.includes("selectQuery")),
    true,
  );
}

// (missing file) an absent file that still has entries reports every entry stale; one without
// entries reports nothing.
{
  check(
    "(missing file) NodeSnapshotRepository: 3 stale",
    scanTextForViolations(NS, "").filter(stale).length,
    3,
  );
  check(
    "(missing file) BinaryRefRepository: 3 stale",
    scanTextForViolations(BR, "").filter(stale).length,
    3,
  );
  check(
    "(missing file) file without entries: nothing",
    scanTextForViolations(`${PERSISTENCE}OutputRepository.scala`, ""),
    [],
  );
}

if (failures > 0) {
  console.error(`\n${failures} selftest case(s) failed.`);
  process.exit(1);
}
console.log("\nAll check-node-root-encoding selftest cases passed.");
