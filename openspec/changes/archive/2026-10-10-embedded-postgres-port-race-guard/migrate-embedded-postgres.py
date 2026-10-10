#!/usr/bin/env python3
"""HEL-1445 codemod. Run with the repo worktree as cwd.

Rewrites  EmbeddedPostgres.builder()<chain>.start()  into
          VerifiedEmbeddedPostgres.start(EmbeddedPostgres.builder()<chain>)
and adds `import com.helio.testkit.VerifiedEmbeddedPostgres` directly after the file's
`import io.zonky.test.db.postgres.embedded.EmbeddedPostgres` line (same indentation).
Exact output rule:
  1. the token `EmbeddedPostgres.builder()` becomes `VerifiedEmbeddedPostgres.start(EmbeddedPostgres.builder()`
  2. the first `.start()` at paren-depth 0 after that token becomes `)` (preceding whitespace kept)
  3. nothing else changes.
Refuses (exit 1, naming the file) on any occurrence it cannot transform.
"""
import pathlib
import sys

ROOT = pathlib.Path("backend/src/test")
TOKEN = "EmbeddedPostgres.builder()"
IMPORT_LINE = "import io.zonky.test.db.postgres.embedded.EmbeddedPostgres"
NEW_IMPORT = "import com.helio.testkit.VerifiedEmbeddedPostgres"
SKIP = {
    "VerifiedEmbeddedPostgres.scala",
    "VerifiedEmbeddedPostgresSpec.scala",
    "EmbeddedPostgresStartGuardSpec.scala",
}


def chain_end(text, pos):
    """Index of the `.start()` closing the chain that begins at pos (after the builder() token), or -1."""
    depth = 0
    i = pos
    in_str = False
    while i < len(text):
        c = text[i]
        if in_str:
            if c == "\\":
                i += 2
                continue
            if c == '"':
                in_str = False
        elif c == '"':
            in_str = True
        elif c == "(":
            depth += 1
        elif c == ")":
            depth -= 1
            if depth < 0:
                return -1
        elif depth == 0 and text.startswith(".start()", i):
            return i
        i += 1
    return -1


def transform(text):
    out = []
    pos = 0
    count = 0
    while True:
        i = text.find(TOKEN, pos)
        if i < 0:
            out.append(text[pos:])
            break
        if i > 0 and (text[i - 1] == "." or text[i - 1].isalnum() or text[i - 1] in "_$"):
            raise ValueError("builder token not a bare reference at offset %d" % i)
        j = i + len(TOKEN)
        e = chain_end(text, j)
        if e < 0:
            raise ValueError("no terminal .start() for builder at offset %d" % i)
        out.append(text[pos:i])
        out.append("VerifiedEmbeddedPostgres.start(" + TOKEN)
        out.append(text[j:e])
        out.append(")")
        pos = e + len(".start()")
        count += 1
    return "".join(out), count


def add_import(text):
    lines = text.split("\n")
    hits = [k for k, l in enumerate(lines) if l.strip() == IMPORT_LINE]
    if len(hits) != 1:
        raise ValueError("expected exactly one %r line, found %d" % (IMPORT_LINE, len(hits)))
    k = hits[0]
    indent = lines[k][: len(lines[k]) - len(lines[k].lstrip())]
    lines.insert(k + 1, indent + NEW_IMPORT)
    return "\n".join(lines)


def main():
    total = 0
    files = 0
    failures = []
    for path in sorted(ROOT.rglob("*.scala")):
        if path.name in SKIP:
            continue
        text = path.read_bytes().decode("utf-8")
        if TOKEN not in text:
            continue
        try:
            new, n = transform(text)
            new = add_import(new)
        except ValueError as exc:
            failures.append("%s: %s" % (path, exc))
            continue
        path.write_bytes(new.encode("utf-8"))
        total += n
        files += 1
    for f in failures:
        print("REFUSED " + f, file=sys.stderr)
    print("transformed %d occurrence(s) in %d file(s); %d refusal(s)" % (total, files, len(failures)))
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
