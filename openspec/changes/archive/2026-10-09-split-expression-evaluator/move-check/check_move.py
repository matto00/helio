#!/usr/bin/env python3
"""HEL-1404 D6a move checker. usage: check_move.py <base.scala> <dir-with-5-new-files> [--inventory]
Forward: each member's base text (+ listed D3 edits) appears verbatim, contiguous, in its destination, in order.
Reverse: every line of the five resulting files is claimed by exactly one member span or is blank / an allow-listed
scaffolding line (tagged with its D3 category). Also: every base line is assigned exactly once."""
import re, sys, os

E, T, P, I, X = ("ExpressionEvaluator.scala", "ExpressionTokenizer.scala", "ExpressionParser.scala",
                 "ExpressionInterpreter.scala", "ExpressionTypeInference.scala")
# (name, base_start, base_end, dest, {base_line: (old, new, D3 category)})
M = [
 ("EvaluationError + object doc", 4, 59, E, {}),
 ("fn lists SupportedFunctions/NumericFunctions", 209, 216, E, {}),
 ("parseProblem", 373, 400, E, {}),
 ("unknownFieldMessage", 402, 417, E, {}),
 ("validate + validateTolerant", 420, 451, E, {}),
 ("checkRefs", 453, 463, E, {}),
 ("inferType", 466, 475, E, {}),
 ("CompiledExpression", 523, 530, E, {}),
 ("compile", 532, 552, E, {}),
 ("evaluate", 554, 572, E, {}),
 ("Token ADT", 63, 78, T, {63: ("private sealed trait Token", "private[engine] sealed trait Token", "D3b"),
                           64: ("private object Token", "private[engine] object Token", "D3b")}),
 ("tokenizer header + tokenize", 86, 199, T, {88: ("private def tokenize", "private[engine] def tokenize", "D3b"),
     89: ("scala.collection.mutable.ArrayBuffer.empty", "ArrayBuffer.empty", "D3c")}),
 ("DollarPrefixRequiredMsg", 80, 84, P, {}),
 ("AST Expr + 5 cases", 202, 207, P, {
     202: ("private sealed trait Expr", "private[engine] sealed trait Expr", "D3b"),
     203: ("private final case class", "private[engine] final case class", "D3b"),
     204: ("private final case class", "private[engine] final case class", "D3b"),
     205: ("private final case class", "private[engine] final case class", "D3b"),
     206: ("private final case class", "private[engine] final case class", "D3b"),
     207: ("private final case class", "private[engine] final case class", "D3b")}),
 ("checkArity", 218, 231, P, {}),
 ("StrictParser + LegacyParser (with header comments)", 233, 360, P, {}),
 ("parse/parseLegacy/isDollarPrefixError", 363, 371, P, {
     363: ("private def parse(", "private[engine] def parse(", "D3b"),
     367: ("private def parseLegacy(", "private[engine] def parseLegacy(", "D3b"),
     371: ("private def isDollarPrefixError(", "private[engine] def isDollarPrefixError(", "D3b")}),
 ("inferTypeOf + coalesceType", 477, 515, X, {477: ("private def inferTypeOf(", "private[engine] def inferTypeOf(", "D3b")}),
 ("Val ADT", 517, 521, I, {518: ("private sealed trait Val", "private[engine] sealed trait Val", "D3b")}),
 ("evalExpr", 574, 607, I, {574: ("private def evalExpr(", "private[engine] def evalExpr(", "D3b")}),
 ("applyOp", 609, 629, I, {}),
 ("applyFn", 631, 708, I, {}),
 ("numericUnary", 710, 713, I, {}),
 ("roundTo", 715, 719, I, {}),
 ("concatStr", 721, 725, I, {}),
 ("numStr", 727, 728, I, {}),
 ("typeName", 730, 734, I, {}),
 ("valToJs", 736, 740, I, {736: ("private def valToJs(", "private[engine] def valToJs(", "D3b")}),
]
# base lines that are scaffolding, not members: (start, end, description)
BASE_SCAFFOLD = [(1, 3, "package + `import spray.json._` (entry; interpreter re-imports spray.json._)"),
                 (60, 60, "object opener (entry)"), (741, 741, "object closer (entry)")]
# allow-listed NEW scaffolding lines per file: regex -> category
ALLOW = {
 E: [(r"^package com\.helio\.domain\.engine$", "D3a package"), (r"^import spray\.json\._$", "D3a import"),
     (r"^import Expression(Interpreter|Parser|TypeInference)\.", "D3a import (named, D1)"),
     (r"^object ExpressionEvaluator \{$", "D3a object opener"), (r"^\}$", "D3a object closer")],
 T: [(r"^package com\.helio\.domain\.engine$", "D3a package"), (r"^import scala\.collection\.mutable\.ArrayBuffer$", "D3c import"),
     (r"^// Tokenizer for the expression language", "D3e header comment"),
     (r"^private\[engine\] object ExpressionTokenizer \{$", "D3a object opener"), (r"^\}$", "D3a object closer")],
 P: [(r"^package com\.helio\.domain\.engine$", "D3a package"), (r"^import Expression(Evaluator|Tokenizer)\.", "D3a import (named, D1)"),
     (r"^// Strict and legacy recursive-descent parsers", "D3e header comment"),
     (r"^private\[engine\] object ExpressionParser \{$", "D3a object opener"), (r"^\}$", "D3a object closer")],
 X: [(r"^package com\.helio\.domain\.engine$", "D3a package"), (r"^import Expression(Evaluator|Parser)\.", "D3a import (named, D1)"),
     (r"^// Static result-type inference", "D3e header comment"),
     (r"^private\[engine\] object ExpressionTypeInference \{$", "D3a object opener"), (r"^\}$", "D3a object closer")],
 I: [(r"^package com\.helio\.domain\.engine$", "D3a package"), (r"^import spray\.json\._$", "D3a import"),
     (r"^import ExpressionParser\.", "D3a import (named, D1)"),
     (r"^// Row evaluation and function dispatch", "D3e header comment"),
     (r"^private\[engine\] object ExpressionInterpreter \{$", "D3a object opener"), (r"^\}$", "D3a object closer")],
}

def main():
    base = open(sys.argv[1]).read().split("\n")
    if base and base[-1] == "": base.pop()
    d = sys.argv[2]; show = "--inventory" in sys.argv
    new = {f: (open(os.path.join(d, f)).read().split("\n")) for f in (E, T, P, I, X)}
    for f in new:
        if new[f][-1] == "": new[f].pop()
    fails = []; inv = []
    # base-side: every base line exactly once
    owner = {}
    for (name, a, b, dest, _) in M:
        for n in range(a, b + 1):
            if n in owner: fails.append(f"base line {n} claimed twice: {owner[n]} / {name}")
            owner[n] = name
    for a, b, desc in BASE_SCAFFOLD:
        for n in range(a, b + 1):
            if n in owner: fails.append(f"base line {n} claimed twice: {owner[n]} / scaffold")
            owner[n] = "scaffold: " + desc
    for n in range(1, len(base) + 1):
        if n not in owner:
            if base[n - 1].strip() == "": owner[n] = "blank separator (D3a)"
            else: fails.append(f"base line {n} unassigned: {base[n-1]!r}")
    claimed = {f: [None] * len(new[f]) for f in new}
    last_end = {f: -1 for f in new}; edits_used = []
    for (name, a, b, dest, edits) in M:
        block = list(base[a - 1:b])
        for ln, (old, nw, cat) in edits.items():
            i = ln - a
            if old not in block[i]: fails.append(f"{name}: edit anchor {old!r} not on base line {ln}"); continue
            block[i] = block[i].replace(old, nw, 1); edits_used.append((ln, old, nw, cat, dest))
        dl = new[dest]; pos = None
        for s in range(last_end[dest] + 1, len(dl) - len(block) + 1):
            if dl[s:s + len(block)] == block: pos = s; break
        if pos is None:
            fails.append(f"FORWARD: {name} (base {a}-{b}) not found verbatim, in order, in {dest}"); continue
        for k in range(pos, pos + len(block)): claimed[dest][k] = name
        last_end[dest] = pos + len(block) - 1
        inv.append((name, a, b, dest, pos + 1, pos + len(block)))
    allowed_hits = []
    for f in new:
        for i, line in enumerate(new[f]):
            if claimed[f][i] is not None: continue
            if line.strip() == "": continue
            cat = next((c for rx, c in ALLOW[f] if re.match(rx, line)), None)
            if cat is None: fails.append(f"REVERSE: {f}:{i+1} unclaimed line: {line!r}")
            else: allowed_hits.append((f, i + 1, cat, line))
    if show:
        print("## Member inventory (base span -> destination span)\n")
        print("| member | base lines | destination | dest lines |\n|---|---|---|---|")
        for (name, a, b, dest, s, e) in inv: print(f"| {name} | {a}-{b} | {dest} | {s}-{e} |")
        print("\n## Base lines that are scaffolding or blank\n")
        for a, b, desc in BASE_SCAFFOLD: print(f"- base {a}-{b}: {desc}")
        blanks = sorted(n for n, o in owner.items() if o.startswith("blank"))
        print(f"- {len(blanks)} blank separator base lines (D3a): {blanks}")
        print("\n## D3 edits applied (base line -> new text)\n")
        for ln, old, nw, cat, dest in edits_used: print(f"- base {ln} [{cat}] -> {dest}: `{old}` => `{nw}`")
        print("\n## Allow-listed new lines (reverse check)\n")
        for f, n, cat, line in allowed_hits: print(f"- {f}:{n} [{cat}] `{line}`")
        print("\n## File sizes\n")
        for f in new: print(f"- {f}: {len(new[f])} lines")
    if fails:
        print("FAIL"); [print(" ", x) for x in fails]; sys.exit(1)
    print("PASS forward + reverse (%d members, %d edits, %d allow-listed lines)" % (len(inv), len(edits_used), len(allowed_hits)))
main()
