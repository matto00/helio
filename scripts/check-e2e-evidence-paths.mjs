#!/usr/bin/env node
// HEL-1363: guards against e2e evidence screenshots landing anywhere but the one gitignored
// per-worktree location. Two shapes caused the incident this closes (a spec writing into
// openspec/changes/<change>/screenshots re-created a change directory in whichever worktree ran
// it, and `check:openspec` then failed "change has no tasks"):
//   (a) any non-comment reference to the `openspec/` tree in e2e source (the substring `openspec/`, or a
//       standalone quoted path segment such as "openspec" passed to join/resolve);
//   (b) any `.screenshot(...)` call whose `path` value is not produced by `evidencePath(` from
//       e2e/support/evidencePath.ts (this also rejects cwd-relative strings, template literals and
//       indirection through a variable, so it fails closed).
// A `.screenshot()` with no `path` (returns a buffer) is allowed. A reviewed site can carry
// `// e2e-evidence-path: reviewed — <reason>` on the offending line (matched on the raw line,
// before comment stripping). Usage: node scripts/check-e2e-evidence-paths.mjs [targetRoot]

import { readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { join, relative, dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HELPER_REL = "e2e/support/evidencePath.ts";
const EXTENSIONS = [".ts", ".mts", ".js", ".mjs"];
const REVIEWED_RE = /\/\/\s*e2e-evidence-path:\s*reviewed\s*—/;

// Blank out comments (keeping newlines so line numbers survive) while leaving string and template
// literal contents intact, so `//` inside a string is not mistaken for a comment.
export function stripComments(text) {
  let out = "";
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    const n = text[i + 1];
    if (c === "/" && n === "/") {
      while (i < text.length && text[i] !== "\n") {
        out += " ";
        i++;
      }
    } else if (c === "/" && n === "*") {
      out += "  ";
      i += 2;
      while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) {
        out += text[i] === "\n" ? "\n" : " ";
        i++;
      }
      if (i < text.length) {
        out += "  ";
        i += 2;
      }
    } else if (c === '"' || c === "'" || c === "`") {
      out += c;
      i++;
      while (i < text.length && text[i] !== c) {
        if (text[i] === "\\") {
          out += text[i++];
        }
        if (i < text.length) out += text[i++];
      }
      if (i < text.length) out += text[i++];
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

// Index just past the `)` that closes the `(` at openIdx, ignoring parens inside string literals.
function matchingParen(text, openIdx) {
  let depth = 0;
  for (let i = openIdx; i < text.length; i++) {
    const c = text[i];
    if (c === '"' || c === "'" || c === "`") {
      i++;
      while (i < text.length && text[i] !== c) {
        if (text[i] === "\\") i++;
        i++;
      }
    } else if (c === "(") depth++;
    else if (c === ")") {
      depth--;
      if (depth === 0) return i + 1;
    }
  }
  return -1;
}

const lineOf = (text, idx) => text.slice(0, idx).split("\n").length;

export function checkSource(rel, raw) {
  if (rel === HELPER_REL) return [];
  const rawLines = raw.split("\n");
  const reviewed = (line) => REVIEWED_RE.test(rawLines[line - 1] ?? "");
  const stripped = stripComments(raw);
  const violations = [];

  const seen = new Set();
  for (const re of [/openspec\//g, /(["'`])openspec\1/g]) {
    for (const m of stripped.matchAll(re)) {
      const line = lineOf(stripped, m.index);
      if (seen.has(line) || reviewed(line)) continue;
      seen.add(line);
      violations.push(
        `${rel}:${line}: e2e source references the openspec/ tree (evidence must go through evidencePath)`,
      );
    }
  }

  for (const m of stripped.matchAll(/\.screenshot\s*\(/g)) {
    const open = m.index + m[0].length - 1;
    const close = matchingParen(stripped, open);
    const line = lineOf(stripped, m.index);
    if (reviewed(line)) continue;
    if (close < 0) {
      violations.push(`${rel}:${line}: unterminated screenshot call (cannot verify its path)`);
      continue;
    }
    const args = stripped.slice(open + 1, close - 1);
    if (args.trim() === "") continue;
    if (!args.trim().startsWith("{")) {
      violations.push(
        `${rel}:${line}: screenshot options are not an object literal (cannot verify its path)`,
      );
      continue;
    }
    if (/\.\.\./.test(args)) {
      violations.push(
        `${rel}:${line}: screenshot options contain a spread (cannot verify its path)`,
      );
      continue;
    }
    if (/[{,]\s*path\s*[,}]/.test(args)) {
      violations.push(
        `${rel}:${line}: screenshot uses shorthand \`path\` (must be path: evidencePath(...))`,
      );
      continue;
    }
    for (const p of args.matchAll(/\bpath\s*:\s*/g)) {
      const value = args.slice(p.index + p[0].length);
      if (!value.startsWith("evidencePath(")) {
        violations.push(`${rel}:${line}: screenshot path is not produced by evidencePath(...)`);
        break;
      }
    }
  }
  return violations;
}

function walk(dir, out) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (entry !== "node_modules") walk(full, out);
    } else if (EXTENSIONS.some((e) => entry.endsWith(e))) out.push(full);
  }
}

export function checkTree(root) {
  const files = [];
  try {
    walk(join(root, "e2e"), files);
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
  }
  const violations = [];
  for (const abs of files) {
    violations.push(...checkSource(relative(root, abs), readFileSync(abs, "utf8")));
  }
  return { violations, fileCount: files.length };
}

function main() {
  const root = process.argv[2]
    ? resolve(process.argv[2])
    : join(dirname(fileURLToPath(import.meta.url)), "..");
  const { violations, fileCount } = checkTree(root);
  if (violations.length) {
    process.stderr.write(`E2E evidence-path check failed — ${violations.length} violation(s):\n\n`);
    for (const v of violations) process.stderr.write(`  ${v}\n`);
    process.stderr.write(
      "\nResolve every screenshot path with evidencePath(ticket, file) from e2e/support/evidencePath.ts, " +
        "or mark a reviewed site with `// e2e-evidence-path: reviewed — <reason>` on the offending line.\n",
    );
    process.exit(1);
  }
  process.stdout.write(`E2E evidence-path check: clean (${fileCount} e2e files scanned)\n`);
}

// Realpath + pathToFileURL: the raw `file://${argv[1]}` comparison is fail-open (never runs main()
// for a percent-encodable path or a symlinked invocation), as check-no-credential-in-agent-surface.mjs documents.
const entryArg = process.argv[1];
if (entryArg && import.meta.url === pathToFileURL(realpathSync(entryArg)).href) {
  main();
}
