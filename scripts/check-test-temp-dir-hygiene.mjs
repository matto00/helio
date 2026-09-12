#!/usr/bin/env node
// Guards against HEL-1120's leak class recurring: any backend spec that calls one of the four
// raw temp-file/dir creation spellings directly, instead of routing through the shared
// `TempDirectorySupport` helper (`backend/src/test/scala/com/helio/testkit/TempDirectorySupport.scala`),
// leaks a directory tree into `/tmp` with no teardown. `/tmp` is a tmpfs capped at 1,048,576
// inodes; it hit 100% twice on 2026-09-10/11 and stalled two delivery lanes mid-cycle.
//
// Follows scripts/check-scala-quality.mjs's walk-and-regex shape. Flags any of:
//   - Files.createTempDirectory(
//   - Files.createTempFile(
//   - java.nio.file.Files.createTempDirectory( / java.nio.file.Files.createTempFile(
//   - java.io.File.createTempFile( / File.createTempFile(
// in backend/src/test/scala/**/*.scala, UNLESS:
//   - the file is TempDirectorySupport.scala itself (the one place allowed to call the raw APIs), or
//   - the line carries a trailing `// temp-dir-hygiene: reviewed — <reason>` comment (the explicit,
//     grep-visible escape hatch for a site that already has its own working cleanup).

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const scanRoot = join(repoRoot, "backend/src/test/scala");
const exemptPath = "backend/src/test/scala/com/helio/testkit/TempDirectorySupport.scala";

const SPELLINGS = [
  /\bFiles\.createTempDirectory\(/,
  /\bFiles\.createTempFile\(/,
  /\bjava\.io\.File\.createTempFile\(/,
  /\bFile\.createTempFile\(/,
];

const REVIEWED_RE = /\/\/\s*temp-dir-hygiene:\s*reviewed\s*—/;

export function checkFile(rel, text) {
  if (rel === exemptPath) return [];
  const violations = [];
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // The escape-hatch comment may trail the call on the same line, or sit on the line directly
    // above it (the common style when the call itself is already long).
    if (REVIEWED_RE.test(line)) continue;
    if (i > 0 && REVIEWED_RE.test(lines[i - 1])) continue;
    if (SPELLINGS.some((re) => re.test(line))) {
      violations.push(
        `${rel}:${i + 1}: raw temp-file/dir creation call outside TempDirectorySupport`,
      );
    }
  }
  return violations;
}

function walk(dir, out) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (entry.endsWith(".scala")) out.push(full);
  }
}

function main() {
  const files = [];
  try {
    walk(scanRoot, files);
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
  }

  const violations = [];
  for (const absPath of files) {
    const rel = relative(repoRoot, absPath);
    const text = readFileSync(absPath, "utf8");
    violations.push(...checkFile(rel, text));
  }

  if (violations.length) {
    process.stderr.write(
      `Test temp-dir hygiene check failed — ${violations.length} violation(s):\n\n`,
    );
    for (const v of violations) process.stderr.write(`  ${v}\n`);
    process.stderr.write(
      "\nRoute temp file/dir creation through TempDirectorySupport.newTempDir/newTempFile, " +
        "or mark an already-cleaned-up site with a trailing " +
        "`// temp-dir-hygiene: reviewed — <reason>` comment.\n",
    );
    process.exit(1);
  }

  process.stdout.write("Test temp-dir hygiene check: clean\n");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
