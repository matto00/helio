#!/usr/bin/env node
// Self-test for scripts/check-scala-quality.mjs (HEL-1332). Proves the inline-FQN guard is
// still failable: each in-scope prefix goes red, each documented exemption stays green, the
// load-time dot assertion rejects a dot-less prefix, and the real CLI exits non-zero on a red
// fixture tree. Runs as part of `npm run check:scala-quality`, so the pre-commit hook and CI
// re-prove it on every run.

import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { assertPrefixesEndInDot, scanScalaText } from "./check-scala-quality.mjs";
import { newScanState, spliceCodeOnly } from "./scala-code-only.mjs";

let passed = 0;
let failed = 0;

function record(name, ok, detail) {
  if (ok) {
    passed++;
  } else {
    failed++;
    process.stderr.write(`FAIL: ${name}${detail ? ` — ${detail}` : ""}\n`);
  }
}

const REL = "backend/src/main/scala/com/helio/example/Fixture.scala";
const hits = (text) => scanScalaText(REL, text).hardErrors;

// Red: one case per in-scope prefix, plus the two formerly-dead entries (they could never fire).
const red = [
  ["java.sql.", "val t = java.sql.Timestamp.from(i)"],
  ["java.time.", "val t = java.time.Instant.now()"],
  ["java.util.", "val s: java.util.Set[String] = null"],
  ["java.util.UUID (formerly dead)", "val id = java.util.UUID.randomUUID()"],
  ["java.util.Base64 (formerly dead)", "val b = java.util.Base64.getEncoder"],
  [
    "java.util.concurrent. (now subsumed)",
    "val m = new java.util.concurrent.ConcurrentHashMap[String, Int]()",
  ],
  ["scala.annotation.", "@scala.annotation.tailrec def loop(): Int = 1"],
  ["scala.concurrent.duration.", "val d = scala.concurrent.duration.DurationInt(1)"],
  ["scala.util.Try", "val r = scala.util.Try(x)"],
  ["scala.util.Success", "val r = scala.util.Success(1)"],
  ["scala.collection.mutable.", "val b = new scala.collection.mutable.ListBuffer[Int]()"],
  ["scala.collection.immutable.", "val s: scala.collection.immutable.Seq[Int] = Nil"],
  ["scala.io.Source", 'val src = scala.io.Source.fromFile("f")'],
  ["code before a trailing //", "val t = java.time.Instant.now() // now"],
  ["code after a mid-line /* */", "val t = /* c */ java.time.Instant.now()"],
  ['real hit after a "http://x" literal', 'val u = "http://x"; val t = java.time.Instant.now()'],
];
for (const [label, line] of red) {
  const v = hits(line);
  record(`flags ${label}`, v.length === 1, `got ${JSON.stringify(v)}`);
}

// Green: every documented exemption.
const green = [
  ["an import line", "import java.time.Instant"],
  ["a package line", "package java.util.example"],
  ["a scoped indented import", "    import java.util.UUID"],
  ["a scala.collection.mutable import", "import scala.collection.mutable"],
  ["a scala.util grouped import", "import scala.util.{Failure, Success, Try}"],
  ["a scala.util.Random string literal", 'src should not include "scala.util.Random"'],
  ["a double-quoted literal", 'val s = "java.time.Instant"'],
  ["a whole-line // comment", "// java.time.Instant is imported below"],
  ["a trailing // comment", "val x = 1 // see java.time.Instant"],
  ["a mid-line /* */ comment", "val x = foo /* java.time.Instant */ + 1"],
  ["a scaladoc opener line", "/** java.time.Instant */"],
  ["a scaladoc * line", " * java.util.UUID is generated"],
  ["a multi-line block comment", "/*\n java.time.Instant\n java.sql.Timestamp\n*/\nval x = 1"],
  ['a "http://x" literal alone', 'val u = "http://java.time.Instant"'],
];
for (const [label, text] of green) {
  const v = hits(text);
  record(`does not flag ${label}`, v.length === 0, `got ${JSON.stringify(v)}`);
}

// HEL-1386: code inside `${...}` splices of interpolated strings is code and must be scanned;
// plain string text, `$ident` references and `$$` escapes stay exempt.
const spliceRed = [
  ["a s-interpolator splice", 's"id ${java.util.UUID.randomUUID()}"'],
  ["an f-interpolator splice", 'f"${java.time.Instant.now()}%s"'],
  ["a raw-interpolator splice", 'raw"${java.time.Instant.now()}"'],
  ["a custom-interpolator splice", 'sql"select ${java.util.UUID.randomUUID()}"'],
  ["a nested-brace splice", 's"${xs.map { x => java.util.UUID.randomUUID() }}"'],
  [
    "a splice whose FQN follows an inner closing brace",
    's"${xs.map { x => 1 }.map(_ => java.util.UUID.randomUUID())}"',
  ],
  ["a splice holding a nested string", 's"${foo("a") + java.util.UUID.randomUUID()}"'],
  ["a splice whose nested string holds a brace", 's"${"}" + java.time.Instant.now()}"'],
  ["a nested interpolated literal splice", 's"${s"${java.util.UUID.randomUUID()}"}"'],
  ["a single-line triple-quoted splice", 's"""${java.util.UUID.randomUUID()}"""'],
  ["a splice after a $ident", 's"$a ${java.util.UUID.randomUUID()}"'],
  [
    "a splice on a line opening an unclosed triple-quote (C2)",
    's"""${java.util.UUID.randomUUID()} java.time.Instant',
  ],
];
for (const [label, line] of spliceRed) {
  const v = hits(line);
  record(`flags ${label}`, v.length === 1, `got ${JSON.stringify(v)}`);
}

const spliceGreen = [
  ["a plain literal with a ${} lookalike", 'val s = "${java.util.UUID.randomUUID()}"'],
  ["a $ident-prefixed FQN text", 's"$java.util.UUID"'],
  ["an escaped $$ before an FQN", 's"$$java.time.Instant"'],
  ["an FQN string passed to a call", 'foo("java.time.Instant")'],
  ["a backslash-escaped quote in an interpolated literal", 's"\\"java.time.Instant"'],
  ["an FQN in the text after a closed splice", 's"${a} java.time.Instant"'],
  ["a triple-quoted plain literal", 'val s = """${java.util.UUID.randomUUID()}"""'],
];
for (const [label, line] of spliceGreen) {
  const v = hits(line);
  record(`does not flag ${label}`, v.length === 0, `got ${JSON.stringify(v)}`);
}

// Column points at the splice code, not at an earlier identical string occurrence.
{
  const line = 'val a = "java.util.x"; val b = s"${java.util.UUID.randomUUID()}"';
  const v = hits(line);
  const col = line.indexOf("${java.util.") + 3;
  record(
    "reports the splice column, not the earlier string",
    v.length === 1 && v[0].includes(`:1:${col}:`),
    `got ${JSON.stringify(v)} want col ${col}`,
  );
}

// Unterminated literals/splices degrade safely (never throw).
for (const line of [
  's"${java.util.UUID.randomUUID(',
  's"abc ${',
  'val s = "abc',
  's"""${x',
  's"${"',
]) {
  let threw = false;
  try {
    hits(line);
  } catch {
    threw = true;
  }
  record(`does not throw on ${JSON.stringify(line)}`, !threw);
}

// HEL-1386 C4: no regression against the pre-splice guard. Code after the closing `"""` of a
// multi-line literal is code; char literals do not open strings; state survives skipped lines.
const multiRed = [
  [
    "code after an interpolated multi-line closer",
    'def q(id: Int) = sql"""SELECT o FROM t\n  WHERE id = $id""".as[java.util.UUID].headOption',
  ],
  [
    "code after a plain multi-line closer",
    'val j = """{\n  "a": 1\n}""".parseJson.convertTo[com.helio.domain.Foo]',
  ],
  [
    "a splice on a later text line of a multi-line literal",
    's"""first\n  ${java.util.UUID.randomUUID()}\n  last"""',
  ],
  [
    "code after a closer with a quote run (4 quotes)",
    'val s = """a\n  b"""" ; val t = java.time.Instant.now()',
  ],
  [
    "code after a closer whose opening line has a nested string splice",
    'sqlu"""INSERT ${s"u-$id"}, now()\n  x""".asTry; val t = java.time.Instant.now()',
  ],
  [
    "code on a later line of a multi-line splice (C4)",
    'def q(id: Int) = sql"""SELECT o FROM t WHERE id = ${\n  java.util.UUID.randomUUID()\n}""".as[Int]',
  ],
  [
    "code after a nested triple literal that crosses lines inside a splice (C4)",
    'val n = s"""a ${s"""b\nc"""} d"""\nval t = java.time.Instant.now()',
  ],
  [
    "code in a splice that follows a nested crossing literal",
    'val n = s"""a ${s"""b\nc""" + java.util.UUID.randomUUID()} d"""',
  ],
  ["a char literal quote before an FQN", `if (c == '"') java.time.Instant.now()`],
  ["a char literal brace in a splice", `s"\${if (c == '}') java.time.Instant.now() else 1}"`],
  ["an escaped char literal before an FQN", `val n = '\\n'; val t = java.time.Instant.now()`],
];
for (const [label, text] of multiRed) {
  const v = hits(text);
  record(`flags ${label}`, v.length === 1, `got ${JSON.stringify(v)}`);
}

const multiGreen = [
  [
    "text after a nested crossing literal closes",
    'val n = s"""a ${s"""b\nc"""} java.time.Instant"""',
  ],
  ["an import-looking inner text line", 'val s = """a\nimport java.time.Instant\n"""'],
  ["a // line inside an open literal", 'val s = """a\n// java.time.Instant\n"""'],
  ["a * line inside an open literal", 'val s = """a\n * java.time.Instant\n"""'],
  [
    "a triple quote inside a trailing comment",
    'val x = 1 // """\nval y = java.time.Instant'.replace("val y = java", "val y = ok // java"),
  ],
  ["a triple quote inside a block comment", '/*\n """\n*/\nval z = 1'],
  ["a triple quote in a skipped import-adjacent comment", '// """\nval s = "java.time.Instant"'],
];
for (const [label, text] of multiGreen) {
  const v = hits(text);
  record(`does not flag ${label}`, v.length === 0, `got ${JSON.stringify(v)}`);
}

// HEL-1386 C5: the guard is "pass 1 (base string-blanking guard, byte-identical) OR pass 2 (splice
// scan)". Pass 2 must be silent on plain string text, even where pass 1 (inherited from base) is not.
const pass2Findings = (text) => {
  const state = newScanState();
  return text.split("\n").filter((l) => /java\.time\.|java\.util\./.test(spliceCodeOnly(l, state)));
};
const pass2Silent = [
  ['an escaped $" quote then text (C1)', 's"a$"java.time.Instant$"b"'],
  ["text after a closed multi-line splice", 'val s = s"""a ${\n  x\n} java.time.Instant"""'],
  ["an FQN on an inner text line", 'val s = """a\n  java.time.Instant\n  b"""'],
  [
    "a closer line with only text before the quotes",
    'val s = """a\n  java.time.Instant """.stripMargin',
  ],
  ["an unclosed triple-quote with only text", 'val s = """java.time.Instant'],
  ["a mid-line block comment holding an FQN", "val a = 1 /* java.time.Instant\n java.util.UUID */"],
];
for (const [label, text] of pass2Silent) {
  record(
    `pass 2 is silent on ${label}`,
    pass2Findings(text).length === 0,
    JSON.stringify(pass2Findings(text)),
  );
}
// Pass-2-level pins (whole-guard cases cannot see these: pass 1 flags or ignores the same lines).
record(
  'pass 2 reads `$"` as text, so a later splice FQN is still found (C1)',
  pass2Findings('s"a$" ${java.util.UUID.randomUUID()}"').length === 1,
  JSON.stringify(pass2Findings('s"a$" ${java.util.UUID.randomUUID()}"')),
);
record(
  "pass 2 closes a 4-quote triple literal at its last three quotes",
  pass2Findings('val s = s"""a"""" + s"${java.util.UUID.randomUUID()}"').length === 1,
);
for (const [label, text] of [
  [
    "a multi-line block comment holding a splice FQN",
    '/* old:\n   val x = s"${java.util.UUID.randomUUID()}"\n*/\nval y = 1',
  ],
  [
    "a scaladoc line holding a splice FQN",
    '/**\n * e.g. s"${java.util.UUID.randomUUID()}"\n */\nval y = 1',
  ],
  [
    "a mid-line block comment holding a splice FQN",
    'val y = 1 /* s"${java.util.UUID.randomUUID()}" */',
  ],
]) {
  record(`does not flag ${label}`, hits(text).length === 0, JSON.stringify(hits(text)));
}

// Inherited from base (pass 1): these are base false positives and stay flagged so HEAD is a superset.
for (const [label, text] of [
  ["an FQN on an inner text line", pass2Silent[2][1]],
  ['an escaped $" quote then text', pass2Silent[0][1]],
]) {
  record(
    `pass 1 keeps flagging ${label} (base behaviour)`,
    hits(text).length === 1,
    JSON.stringify(hits(text)),
  );
}

// Comment/literal desync shapes (skeptic rounds 2 and 3): every line the base guard flags stays flagged.
const flaggedLines = (text) => hits(text).map((h) => Number(h.split(":")[1]));
const sameLines = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const desync = [
  [
    "a mid-line block comment holding a triple quote (B)",
    'val limit = 10 /* the query used to embed a\n   raw """ block; see HEL-0 */\ndef a = java.time.Instant.now()\ndef b = java.util.UUID.randomUUID()\ndef c = com.helio.domain.PanelId("x")',
    [3, 4, 5],
  ],
  [
    "a line closing a block comment then opening a triple quote (C)",
    '/* a multi-line\n   comment */ val s = """\ntext\n"""\ndef a = java.time.Instant.now()\ndef b = java.util.UUID.randomUUID()',
    [5, 6],
  ],
  [
    "a /* a */ val s = triple-quote opener variant",
    '/* a */ val s = """\ntext\n"""\ndef a = java.time.Instant.now()\ndef b = java.util.UUID.randomUUID()',
    [4, 5],
  ],
  [
    "a multi-line splice then code",
    'val q = sql"""a ${\n  java.util.UUID.randomUUID()\n}""".as[Int]\nval t = java.time.Instant.now()',
    [2, 4],
  ],
  [
    "a nested triple crossing a splice then code",
    'val n = s"""a ${s"""b\nc"""} d"""\nval t = java.time.Instant.now()',
    [3],
  ],
];
for (const [label, text, want] of desync) {
  const got = flaggedLines(text);
  record(
    `flags exactly the expected lines for ${label}`,
    sameLines(got, want),
    `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`,
  );
}

// The load-time assertion must reject a dot-less prefix and accept a dotted list.
let rejected = false;
try {
  assertPrefixesEndInDot(["java.util.UUID"]);
} catch {
  rejected = true;
}
record("assertPrefixesEndInDot rejects a dot-less prefix", rejected);
let accepted = true;
try {
  assertPrefixesEndInDot(["java.util.", "com.helio."]);
} catch {
  accepted = false;
}
record("assertPrefixesEndInDot accepts dotted prefixes", accepted);

// One spawn of the real CLI against a red fixture root: proves the CLI path itself is live.
const here = dirname(fileURLToPath(import.meta.url));
const root = mkdtempSync(join(tmpdir(), "scala-quality-selftest-"));
try {
  const dir = join(root, "backend/src/main/scala/com/helio/example");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "Red.scala"), "object Red { val id = java.util.UUID.randomUUID() }\n");
  const res = spawnSync(process.execPath, [join(here, "check-scala-quality.mjs"), root], {
    encoding: "utf8",
  });
  record("CLI exits non-zero on a red fixture root", res.status === 1, `status ${res.status}`);
  record(
    "CLI prints the violation",
    /Red\.scala:1:\d+: inline FQN 'java\.util\.…'/.test(res.stderr),
    res.stderr,
  );
} finally {
  rmSync(root, { recursive: true, force: true });
}

if (failed > 0) {
  process.stderr.write(`\ncheck-scala-quality selftest: ${failed} failed, ${passed} passed\n`);
  process.exit(1);
}
process.stdout.write(`check-scala-quality selftest: ${passed} passed\n`);
