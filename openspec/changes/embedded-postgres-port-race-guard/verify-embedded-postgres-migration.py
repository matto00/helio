#!/usr/bin/env python3
"""HEL-1445 independent verifier (does not import the codemod). Run with the worktree as cwd.
usage: verify-embedded-postgres-migration.py <base-sha>
Compares the CURRENT working tree against <base-sha>.
Inverse transform of a migrated file: drop the one inserted import line, then turn each
`VerifiedEmbeddedPostgres.start(` + `EmbeddedPostgres.builder()...` + balancing `)` back into
`EmbeddedPostgres.builder()...` + `.start()`. The result must be byte-equal to the base blob.
"""
import re
import subprocess
import sys

ALLOW_NEW = {
    "backend/src/test/scala/com/helio/testkit/VerifiedEmbeddedPostgres.scala",
    "backend/src/test/scala/com/helio/testkit/VerifiedEmbeddedPostgresSpec.scala",
    "backend/src/test/scala/com/helio/testkit/EmbeddedPostgresStartGuardSpec.scala",
}
IMPORT = "import com.helio.testkit.VerifiedEmbeddedPostgres"
WRAP = "VerifiedEmbeddedPostgres.start(EmbeddedPostgres.builder()"
BARE_BUILDER = re.compile(r"EmbeddedPostgres\.builder")


def sh(*args):
    return subprocess.run(args, check=True, capture_output=True).stdout


def balancing_close(text, open_idx):
    """Index of the ')' matching the '(' at open_idx, skipping string literals."""
    depth, i, in_str = 0, open_idx, False
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
            if depth == 0:
                return i
        i += 1
    raise ValueError("unbalanced parentheses")


def inverse(new):
    lines = new.split("\n")
    idx = [k for k, l in enumerate(lines) if l.strip() == IMPORT]
    if len(idx) != 1:
        raise ValueError("expected exactly one inserted import line, found %d" % len(idx))
    del lines[idx[0]]
    text = "\n".join(lines)
    while True:
        i = text.rfind(WRAP)  # innermost-last is fine: sites never nest
        if i < 0:
            return text
        open_idx = i + len("VerifiedEmbeddedPostgres.start")
        close = balancing_close(text, open_idx)
        text = text[:i] + text[open_idx + 1 : close] + ".start()" + text[close + 1 :]


def main():
    base = sys.argv[1]
    base_files = [
        p for p in sh("git", "grep", "-l", "EmbeddedPostgres.builder()", base, "--", "backend/src/test").decode().split("\n") if p
    ]
    base_files = {p.split(":", 1)[1] for p in base_files}
    tracked = set(sh("git", "diff", "--name-only", base, "--", "backend").decode().split("\n")) - {""}
    untracked = set(sh("git", "ls-files", "--others", "--exclude-standard", "--", "backend").decode().split("\n")) - {""}
    changed = tracked | untracked
    errors = []
    expected = base_files | ALLOW_NEW
    if changed != expected:
        errors.append("changed-file set mismatch: extra=%s missing=%s" % (sorted(changed - expected), sorted(expected - changed)))
    wrapped_total = unwrapped_total = base_total = imports = 0
    for path in sorted(base_files):
        old = sh("git", "show", "%s:%s" % (base, path)).decode("utf-8")
        new = open(path, "rb").read().decode("utf-8")
        n_base = old.count("EmbeddedPostgres.builder()")
        n_wrapped = new.count(WRAP)
        n_any = len(BARE_BUILDER.findall(new))
        base_total += n_base
        wrapped_total += n_wrapped
        unwrapped_total += n_any - n_wrapped
        if n_wrapped != n_base or n_any != n_wrapped:
            errors.append("%s: base=%d wrapped=%d any-builder=%d" % (path, n_base, n_wrapped, n_any))
        imports += new.count(IMPORT + "\n")
        try:
            if inverse(new) != old:
                errors.append("%s: inverse transform is not byte-equal to base" % path)
        except ValueError as exc:
            errors.append("%s: %s" % (path, exc))
    for path in sorted(ALLOW_NEW):
        if IMPORT in open(path).read() and path.endswith("VerifiedEmbeddedPostgres.scala"):
            errors.append("%s: helper must not import itself" % path)
    print("files with builder at base: %d" % len(base_files))
    print("changed backend files (tracked diff + untracked): %d (expected %d = %d + %d new)" % (len(changed), len(expected), len(base_files), len(ALLOW_NEW)))
    print("base occurrences: %d  wrapped: %d  unwrapped: %d  inserted imports: %d" % (base_total, wrapped_total, unwrapped_total, imports))
    if (base_total, wrapped_total, unwrapped_total) != (226, 226, 0) or imports != len(base_files):
        errors.append("totals are not 226/226/0 with one import per file")
    for e in errors:
        print("FAIL " + e)
    print("RESULT: %s" % ("FAIL" if errors else "PASS (byte-equal under inverse for every migrated file)"))
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
