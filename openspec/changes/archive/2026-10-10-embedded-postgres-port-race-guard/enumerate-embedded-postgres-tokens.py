#!/usr/bin/env python3
"""HEL-1445: classify every standalone `EmbeddedPostgres` token in backend/src/test/scala (comments stripped)
as (a) plain import, (b) type position, (c) wrapped builder; anything else is listed as UNCLASSIFIED.
Independent re-implementation of the guard's allowlist (python lexer, not the Scala one). Run with the worktree as cwd."""
import pathlib, re, sys, collections
ROOT = pathlib.Path("backend/src/test/scala")
EXEMPT = {"com/helio/testkit/VerifiedEmbeddedPostgres.scala"}
MARK = "// embedded-pg-guard: deliberate unverified start (port-steal repro)"
TOK = re.compile(r"(?<![A-Za-z0-9_$])EmbeddedPostgres(?![A-Za-z0-9_$])")

class Unbalanced(Exception):
    pass


def strip(t):
    """Splice-aware comment stripper (independent port of the guard's lexer). Raises Unbalanced -> caller scans raw."""
    n, out, st = len(t), [], {"i": 0}

    def idc(c): return c.isalnum() or c in "_$"

    def block():
        d = 0
        while st["i"] < n:
            i = st["i"]
            if t.startswith("/*", i): d += 1; out.append("  "); st["i"] += 2
            elif t.startswith("*/", i):
                d -= 1; out.append("  "); st["i"] += 2
                if d == 0: return
            else: out.append("\n" if t[i] == "\n" else " "); st["i"] += 1
        raise Unbalanced()

    def string(interp, raw):
        i = st["i"]; triple = t.startswith('"""', i)
        out.append('"""' if triple else '"'); st["i"] += 3 if triple else 1
        while True:
            i = st["i"]
            if i >= n: raise Unbalanced()
            c = t[i]
            if triple and t.startswith('"""', i):
                while st["i"] < n and t[st["i"]] == '"': out.append('"'); st["i"] += 1
                return
            if not triple and c == '"': out.append(c); st["i"] += 1; return
            if not triple and c == "\n": raise Unbalanced()
            if not triple and not raw and c == "\\":
                out.append(t[i:i + 2]); st["i"] += 2
                if st["i"] > n: raise Unbalanced()
            elif interp and c == "$" and t[i + 1:i + 2] == "$": out.append("$$"); st["i"] += 2
            elif interp and c == "$" and t[i + 1:i + 2] == "{": out.append("${"); st["i"] += 2; code(True)
            else: out.append(c); st["i"] += 1

    def code(splice):
        depth = 0
        while st["i"] < n:
            i = st["i"]; c = t[i]
            if t.startswith("//", i):
                e = t.find("\n", i); e = n if e < 0 else e
                out.append(" " * (e - i)); st["i"] = e
            elif t.startswith("/*", i): block()
            elif c == '"':
                k = i
                while k > 0 and idc(t[k - 1]): k -= 1
                pre = t[k:i]; interp = bool(pre) and (pre[0].isalpha() or pre[0] == "_")
                string(interp, interp and pre == "raw")
            elif c == "'":
                if t[i + 1:i + 2] == "\\":
                    close = t.find("'", i + 3)
                    if close < 0: raise Unbalanced()
                    out.append(t[i:close + 1]); st["i"] = close + 1
                elif t[i + 2:i + 3] == "'": out.append(t[i:i + 3]); st["i"] += 3
                else: out.append(c); st["i"] += 1
            elif c == "{": depth += 1; out.append(c); st["i"] += 1
            elif c == "}":
                if splice and depth == 0: out.append(c); st["i"] += 1; return
                depth = max(0, depth - 1); out.append(c); st["i"] += 1
            else: out.append(c); st["i"] += 1
        if splice: raise Unbalanced()

    code(False)
    return "".join(out)

PLAIN = re.compile(r"import\s+io\.zonky\.test\.db\.postgres\.embedded\.\s*EmbeddedPostgres(?![A-Za-z0-9_$])(?!\s*\.)")
SEL = re.compile(r"import\s+io\.zonky\.test\.db\.postgres\.embedded\.\s*\{([^}]*)\}")
cls = collections.Counter(); bad = []; raw_files = []
for f in sorted(ROOT.rglob("*.scala")):
    rel = f.relative_to(ROOT).as_posix()
    if rel in EXEMPT: continue
    text = f.read_text(encoding="utf-8")
    if rel == "com/helio/testkit/VerifiedEmbeddedPostgresSpec.scala":
        text = "\n".join("" if MARK in l else l for l in text.split("\n"))
    try: code = strip(text)
    except Unbalanced: code = text; cls['RAW-FALLBACK files'] += 0; raw_files.append(rel)
    plain = {m.start() + m.group(0).index("EmbeddedPostgres", len("import")) for m in PLAIN.finditer(code)}
    sel = set()
    for m in SEL.finditer(code):
        off = m.start(1)
        for item in m.group(1).split(","):
            if item.strip() == "EmbeddedPostgres": sel.add(off + len(item) - len(item.lstrip()))
            off += len(item) + 1
    for m in TOK.finditer(code):
        b, a = code[max(0, m.start() - 200):m.start()], code[m.end():m.end() + 200]
        if m.start() in plain: cls["a:plain import"] += 1
        elif m.start() in sel: cls["a:selector item"] += 1
        elif re.search(r"VerifiedEmbeddedPostgres\s*\.\s*(start|startWith)\s*\(\s*$", b) and re.match(r"\s*\.\s*builder\b", a): cls["c:wrapped builder"] += 1
        elif not re.match(r"\s*[.(]", a) and (re.search(r"[:\[]\s*$", b) or (re.search(r",\s*$", b) and re.match(r"\s*\]", a))): cls["b:type position"] += 1
        else: bad.append("%s:%d: %s" % (rel, code[:m.start()].count("\n") + 1, code.splitlines()[code[:m.start()].count("\n")].strip()))
total = sum(cls.values()) + len(bad)
for k in sorted(cls): print("%-20s %d" % (k, cls[k]))
print("raw-fallback files   ", len(raw_files), raw_files)
print("UNCLASSIFIED        ", len(bad)); [print("  " + b) for b in bad]
print("total tokens        ", total)
sys.exit(1 if bad else 0)
