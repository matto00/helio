#!/usr/bin/env python3
"""Whitespace-normalised move check. usage: move-match.py ORIG_FILE NEW_DIR
For each moved unit, prints MATCH if the original text (comments included, def signatures from the
signature-ending '=' onward, see sig_end) appears verbatim modulo whitespace in the named new file."""
import re, sys
orig = open(sys.argv[1]).read().split("\n")
d = sys.argv[2]
norm = lambda t: re.sub(r"\s+", "", t)

def sig_end(text):
    """index just after the '=' that ends the first def signature (paren depth 0)."""
    i = text.index("def ")
    depth = 0
    j = i
    while j < len(text):
        c = text[j]
        if c in "([": depth += 1
        elif c in ")]": depth -= 1
        elif c == "=" and depth == 0 and text[j+1:j+2] != ">" and text[j-1:j] not in ":=!<>":
            # skip '=>' and comparison operators
            return j + 1
        j += 1
    raise ValueError("no sig end")

# (label, first, last, newfile, kind) -- line numbers are in ORIG (DashboardService.scala at a256261dc)
U = [
 ("insertNew", 112, 127, "DashboardWrites.scala", "def"),
 ("applyUpdate", 230, 252, "DashboardWrites.scala", "def"),
 ("writeUpdate", 254, 292, "DashboardWrites.scala", "def"),
 ("repairLayout post-ownership tail", 310, 337, "DashboardLayoutRepairWrite.scala", "block"),
 ("importSnapshot body", 372, 391, "DashboardSnapshotImport.scala", "block"),
 ("validateImportPanels doc", 393, 404, "DashboardSnapshotImport.scala", "doc"),
 ("validateImportPanels", 405, 449, "DashboardSnapshotImport.scala", "def"),
]
bad = 0
cache = {}
for label, a, b, f, kind in U:
    text = "\n".join(orig[a-1:b])
    if kind == "def":
        # D4: the signature line must match too, modulo the dropped `private` modifier
        sig = text[:sig_end(text)].replace("private def", "def")
        if f not in cache: cache[f] = norm(open(f"{d}/{f}").read())
        sok = norm(sig) in cache[f]
        bad += (not sok)
        print(f"{'MATCH' if sok else 'DIFF '}  {label} SIGNATURE")
        text = text[sig_end(text):]
    if f not in cache: cache[f] = norm(open(f"{d}/{f}").read())
    ok = norm(text) in cache[f]
    bad += (not ok)
    print(f"{'MATCH' if ok else 'DIFF '}  {label}  (orig {a}-{b} -> {f}, {kind})")
print("RESULT", "ALL MATCH" if not bad else f"{bad} DIFF")
sys.exit(1 if bad else 0)
