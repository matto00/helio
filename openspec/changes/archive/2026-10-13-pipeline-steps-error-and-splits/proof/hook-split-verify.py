#!/usr/bin/env python3
"""HEL-1501 commit 3 byte-move proof (independent of the generators). Asserts:
 (1) each moved SPLIT_BASE range appears verbatim in its new hook file;
 (2) every SPLIT_BASE line of usePipelineDetailPage.ts outside the moved ranges (and past the import
     header, L1-35) survives in the host in order, verbatim; the only differences are the
     inserted call sites and the enumerated ALLOWED_EDITS."""
import subprocess, difflib, sys
BASE = "f63ab8365"; H = "frontend/src/features/pipelines/hooks/"
base = subprocess.check_output(["git", "show", f"{BASE}:{H}usePipelineDetailPage.ts"], text=True).split("\n")
CL = {(49,91):"usePipelineOwnPipeline",(93,119):"usePipelineAnalyzeState",(123,220):"usePipelineEditorState",
      (287,310):"usePipelineStepsFingerprint",(346,355):"usePipelineClearRunOnLeave",(371,400):"usePipelineDirtyAndOwner"}
ALLOWED_EDITS = {  # base line -> host line (deps array of onStepsSettled; setStepsFetch is now a hook result)
    "    [],": "    [setStepsFetch],",
}
ok = True
for (a, b), name in CL.items():
    body = "\n".join(base[a-1:b]) + "\n"
    hit = body in open(H + name + ".ts").read()
    print(f"{'OK  ' if hit else 'FAIL'} base L{a}-{b} verbatim in {name}.ts"); ok &= hit
moved = {n for (a, b) in CL for n in range(a, b+1)}
outside = [base[n-1] for n in range(36, len(base)+1) if n not in moved]
host = open(H + "usePipelineDetailPage.ts").read().split("\n")
start = host.index("/**")  # == SPLIT_BASE L36, the doc comment above the hook
host_body = host[start:]
sm = difflib.SequenceMatcher(None, outside, host_body, autojunk=False)
for tag, i1, i2, j1, j2 in sm.get_opcodes():
    if tag == "equal": continue
    removed, added = outside[i1:i2], host_body[j1:j2]
    # collapse blank-only differences; call sites are `const {..} = useX(...)`/`useX(...)` blocks
    if tag == "insert" and any(("use" + n[3:]) in "".join(added) or n in "".join(added) for n in CL.values()):
        print("OK   call-site insert:", " ".join(s.strip() for s in added)[:90]); continue
    if tag == "replace" and len(removed) == 1 and ALLOWED_EDITS.get(removed[0]) == (added[0] if len(added) == 1 else None):
        print(f"OK   enumerated edit: {removed[0].strip()!r} -> {added[0].strip()!r}"); continue
    print("FAIL unexpected", tag, removed[:3], added[:3]); ok = False
sys.exit(0 if ok else 1)
