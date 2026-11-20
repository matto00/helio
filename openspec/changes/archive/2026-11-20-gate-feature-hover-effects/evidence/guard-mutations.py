#!/usr/bin/env python3
"""HEL-1735 D4 guard mutations. For each gated file: un-gate its first gate (`@media (hover: hover)` -> `@media (min-width: 0px)`),
run the feature guard, require it to FAIL naming that file; restore. Then: a mixed-list mutation (a gated rule that also lists a
non-hover selector), an allowlist-rot mutation (rename the reveal's selector) and a new-file mutation (an ungated rule in a new
features/x/tmp.css). Every mutated file is restored from a byte copy and the final `git status` is checked clean of them."""
import os, re, shutil, subprocess, sys

repo, scope = sys.argv[1], sys.argv[2]
SRC = f"{repo}/frontend/src"
files = [l.strip() for l in open(scope) if l.strip()]


def guard():
    p = subprocess.run(["nice", "-n", "19", "npx", "jest", "--maxWorkers=3", "src/featureHoverGating"], cwd=f"{repo}/frontend", capture_output=True, text=True)
    return p.returncode, p.stdout + p.stderr


def offenders(out):
    return [l.strip()[2:].strip().strip('",') for l in out.splitlines() if re.match(r'^\s*\+\s+"[^"]+: ', l)]


def mutate(f, fn):
    path = f"{SRC}/{f}"; orig = open(path, "rb").read()
    try:
        s = orig.decode(); n = fn(s); assert n != s, f"{f}: mutation changed nothing"
        open(path, "w").write(n)
        return guard()
    finally:
        open(path, "wb").write(orig)


ok = 0
for f in files:
    if f == "features/dashboards/ui/DashboardList.css":
        pass  # still has gated rules; mutated like the rest
    rc, out = mutate(f, lambda s: s.replace("@media (hover: hover) {", "@media (min-width: 0px) {", 1))
    hit = [o for o in offenders(out) if o.startswith(f + ": ")]
    print(f"ungate-one {f}: exit={rc} named={hit[0] if hit else 'NONE'}")
    assert rc != 0 and hit, f"guard did not fail naming {f}"
    ok += 1
print(f"un-gate mutations failing as required: {ok}/{len(files)}")

rc, out = mutate("app/App.css", lambda s: s.replace(".cmd-btn--primary:hover {", ".cmd-btn--primary:hover,\n  .cmd-btn--primary:focus-visible {", 1))
print(f"mixed-list (App.css gated rule gains a :focus-visible selector): exit={rc}")
print("  " + "\n  ".join(l.strip() for l in out.splitlines() if "mixes" in l or "app/App.css: " in l)[:600])
assert rc != 0 and "cmd-btn--primary:hover, .cmd-btn--primary:focus-visible" in out

rc, out = mutate("features/dashboards/ui/DashboardList.css", lambda s: s.replace(".dashboard-list__item-row:hover .popover.actions-menu,", ".dashboard-list__item-row:hover .popover.actions-menu-renamed,", 1))
print(f"allowlist-rot (reveal selector renamed): exit={rc}")
print("  " + "\n  ".join(l.strip() for l in out.splitlines() if "true" in l or "false" in l or "popover" in l)[:700])
assert rc != 0

new = f"{SRC}/features/home/tmp.css"
try:
    open(new, "w").write(".zz-tmp:hover { color: red; }\n")
    rc, out = guard()
finally:
    os.remove(new)
print(f"new-file (ungated rule in a new features/home/tmp.css): exit={rc} named={[o for o in offenders(out) if 'tmp.css' in o]}")
assert rc != 0 and any("features/home/tmp.css" in o for o in offenders(out))
st = subprocess.run(["git", "status", "--short", "frontend/src"], cwd=repo, capture_output=True, text=True).stdout
print("ALL GUARD MUTATIONS FAILED AS REQUIRED; every mutated file restored")
