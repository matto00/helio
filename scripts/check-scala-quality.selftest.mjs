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

// Pin a `'"'` char literal: today it confuses the string blanking (documented false negative in
// the guard's header). The assertion pins current behaviour so a future change is deliberate.
record(
  "char literal '\"' currently hides a following hit (documented limit)",
  hits(`val q = '"'; val t = java.time.Instant.now() // "`).length === 0,
);

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
