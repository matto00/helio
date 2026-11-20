#!/usr/bin/env python3
"""HEL-1735 D5(a) detection mutations: each must make structural-equivalence.mjs FAIL (exit 1). Works on a scratch copy of
the after-files; the tree is never touched. usage: structural-mutations.py <repo> <scope.txt> <scratch-dir>"""
import os, re, shutil, subprocess, sys

repo, scope, scratch = sys.argv[1:4]
E = f"{repo}/openspec/changes/gate-feature-hover-effects/evidence"
files = [l.strip() for l in open(scope) if l.strip()]


def fresh():
    shutil.rmtree(scratch, ignore_errors=True)
    for f in files:
        os.makedirs(os.path.dirname(f"{scratch}/{f}"), exist_ok=True)
        shutil.copy(f"{repo}/frontend/src/{f}", f"{scratch}/{f}")


def run(label):
    p = subprocess.run(["node", f"{E}/structural-equivalence.mjs", "894a72c56", scratch, scope],
                       capture_output=True, text=True, cwd=repo)
    lines = [l for l in p.stdout.splitlines() if not l.startswith("same")]
    print(f"--- {label}: exit={p.returncode}")
    print("\n".join(l[:260] for l in lines))
    return p.returncode


def edit(f, fn):
    path = f"{scratch}/{f}"; s = open(path).read(); n = fn(s); assert n != s, "mutation did not change the file"
    open(path, "w").write(n)


fresh(); assert run("control (unmutated after-files)") == 0

fresh()
edit("app/App.css", lambda s: s.replace(".cmd-btn--primary:hover {\n    background: var(--app-accent-strong);\n    border-color: transparent;\n    color: var(--app-accent-ink);", ".cmd-btn--primary:hover {\n    background: var(--app-accent-strong);\n    border-color: transparent;\n    color: var(--app-text);", 1))
assert run("(i) one declaration changed in one gated rule (App.css .cmd-btn--primary:hover)") == 1

fresh()
def move(s):
    m = re.search(r"(\.cmd-btn--primary \{[^}]*\}\n\n)(@media \(hover: hover\) \{\n  \.cmd-btn--primary:hover \{[^}]*\}\n\})", s)
    assert m
    return s[:m.start()] + m.group(2) + "\n\n" + m.group(1).rstrip("\n") + s[m.end():]
edit("app/App.css", move)
assert run("(ii) a gated rule moved past an unrelated neighbouring rule (App.css .cmd-btn--primary:hover above .cmd-btn--primary)") == 1

fresh()
edit("app/App.css", lambda s: s.replace("@media (hover: hover) {\n  .app-command-bar__logo:hover {", ".zz-unrelated {\n  color: red;\n}\n\n@media (hover: hover) {\n  .app-command-bar__logo:hover {", 1))
assert run("(iii) an unrelated rule inserted between the two halves of a split mixed list (App.css logo focus-visible / hover)") == 1
shutil.rmtree(scratch, ignore_errors=True)
print("ALL THREE MUTATIONS FAILED THE CHECK AS REQUIRED; control passed")
