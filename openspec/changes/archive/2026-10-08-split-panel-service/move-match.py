#!/usr/bin/env python3
"""Whitespace-normalised move check. usage: match.py ORIG_FILE PANELS_DIR
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

# (label, first, last, newfile, kind) ; kind 'doc' = verbatim, 'def' = body from signature '=' on,
# 'block' = verbatim chunk (chain extraction)
U = [
 ("ResolvedPanelPatch (class+doc)", 26, 40, "ResolvedPanelPatch.scala", "doc"),
 ("submitFormWithFiles doc", 144, 153, "PanelFormFileSubmission.scala", "doc"),
 ("submitFormWithFiles", 154, 176, "PanelFormFileSubmission.scala", "def"),
 ("foldFilePlaceholders doc", 178, 181, "PanelFormFileSubmission.scala", "doc"),
 ("foldFilePlaceholders", 182, 192, "PanelFormFileSubmission.scala", "def"),
 ("storeFormFiles doc", 194, 200, "PanelFormFileSubmission.scala", "doc"),
 ("storeFormFiles", 201, 214, "PanelFormFileSubmission.scala", "def"),
 ("defaultSizesFor doc", 246, 249, "PanelBindingChecks.scala", "doc"),
 ("defaultSizesFor", 250, 264, "PanelBindingChecks.scala", "def"),
 ("HEL-904 removal note (rejectCompanionBinding)", 614, 617, "PanelBindingChecks.scala", "doc"),
 ("rejectMissingOutput doc", 619, 624, "PanelBindingChecks.scala", "doc"),
 ("rejectMissingOutput", 625, 636, "PanelBindingChecks.scala", "def"),
 ("rejectMissingDataSource doc", 638, 639, "PanelBindingChecks.scala", "doc"),
 ("rejectMissingDataSource", 640, 644, "PanelBindingChecks.scala", "def"),
 ("outputIdOf/controlsOf doc", 646, 647, "PanelBindingChecks.scala", "doc"),
 ("outputIdOf", 648, 651, "PanelBindingChecks.scala", "def"),
 ("controlsOf", 653, 656, "PanelBindingChecks.scala", "def"),
 ("patchedConfigOf doc", 658, 661, "PanelBindingChecks.scala", "doc"),
 ("patchedConfigOf", 662, 666, "PanelBindingChecks.scala", "def"),
 ("formConfigOf doc", 668, 669, "PanelBindingChecks.scala", "doc"),
 ("formConfigOf", 670, 673, "PanelBindingChecks.scala", "def"),
 ("effectiveFormConfig doc", 675, 679, "PanelBindingChecks.scala", "doc"),
 ("effectiveFormConfig", 680, 685, "PanelBindingChecks.scala", "def"),
 ("rejectInconsistentForm doc", 687, 689, "PanelBindingChecks.scala", "doc"),
 ("rejectInconsistentForm", 690, 694, "PanelBindingChecks.scala", "def"),
 ("HEL-904 removal note (rejectUnresolvableMetric)", 696, 698, "PanelBindingChecks.scala", "doc"),
 ("buildForCreate doc", 266, 276, "PanelCreateBuilder.scala", "doc"),
 ("buildForCreate", 277, 322, "PanelCreateBuilder.scala", "def"),
 ("buildAllForCreate doc", 324, 337, "PanelCreateBuilder.scala", "doc"),
 ("buildAllForCreate", 338, 357, "PanelCreateBuilder.scala", "def"),
 ("update validation chain (HEL-1203 decode .. rejectInconsistentForm)", 566, 597, "PanelUpdateValidation.scala", "block"),
 ("update HEL-1203 comment (see D4 allowed edit)", 562, 565, "PanelUpdateValidation.scala", "doc"),
 ("batchUpdate post-ACL body", 427, 459, "PanelBatchWrites.scala", "block"),
 ("batchCreate post-authorize body", 491, 521, "PanelBatchWrites.scala", "block"),
 ("create tail", 233, 242, "PanelLifecycleWrites.scala", "block"),
 ("delete tail", 368, 373, "PanelLifecycleWrites.scala", "block"),
 ("duplicate tail", 387, 393, "PanelLifecycleWrites.scala", "block"),
]
bad = 0
cache = {}
for label, a, b, f, kind in U:
    text = "\n".join(orig[a-1:b])
    if label.startswith("update HEL-1203 comment"):  # D4 allowed: positional word made false by the move
        text = text.replace("lookups above (an", "lookups in PanelService.update (an")
    if kind == "def":
        text = text[sig_end(text):]
    if f not in cache: cache[f] = norm(open(f"{d}/{f}").read())
    ok = norm(text) in cache[f]
    bad += (not ok)
    print(f"{'MATCH' if ok else 'DIFF '}  {label}  (orig {a}-{b} -> {f}, {kind})")
print("RESULT", "ALL MATCH" if not bad else f"{bad} DIFF")
sys.exit(1 if bad else 0)
