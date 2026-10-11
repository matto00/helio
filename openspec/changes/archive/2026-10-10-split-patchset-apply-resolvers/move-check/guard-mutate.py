#!/usr/bin/env python3
"""D6f scratch mutations of ExistenceNotLeakedRoutesSpec's guards. usage: W=<wt> guard-mutate.py apply|revert G1..G5  (scratch only; reverted by restoring a saved copy)"""
import sys, os, shutil
W = os.environ["W"]; P = W + "/backend/src/main/scala/com/helio/services/patchsets/"
mode, gid = sys.argv[1:3]
G = {
 "G1": ("PatchSetOutputResolvers.scala", lambda s: s.rstrip("\n")[:-1].rstrip("\n") + "\n\n  private def hel1479Probe = ServiceError.Forbidden()\n}\n"),
 "G2": ("PatchSetApplyResolvers.scala", lambda s: s.replace("      case Right(ResourceAccess.Viewer) => Left(ServiceError.Forbidden())\n      case Right(_)                     => Right(())", "      case Right(ResourceAccess.Viewer) => Left(ServiceError.Conflict(\"mutated\"))\n      case Right(_)                     => Right(())", 1)),
 "G3": ("PatchSetPanelResolvers.scala", lambda s: s.rstrip("\n")[:-1].rstrip("\n") + "\n\n  private val hel1479Probe = (ctx: PatchSetApplyContext) =>\n    ctx.accessChecker.requireAccess(\"dashboard\", \"x\", None, \"x\")\n}\n"),
 "G5": ("PatchSetApplyResolvers.scala", lambda s: (lambda t: t if t != s else (_ for _ in ()).throw(AssertionError("anchor")))(s.replace("      case (\"pipeline\", \"delete\")     => resolvePipelineDelete(edit, index, user, ctx)\n", "", 1))),  # reverse direction: a row names a pair the dispatch no longer has
 "G4": ("PatchSetApplyResolvers.scala", lambda s: s.replace("      case (\"dashboard\", \"update\")    =>", "      case (\"panel\", \"rename\") => resolvePanelUpdate(edit, index, user, ctx)\n      case (\"dashboard\", \"update\")    =>", 1)),
}
fn, f = G[gid]; p = P + fn; bak = os.environ.get("SCR", "/tmp") + "/hel1479-" + gid + ".bak"
if mode == "apply":
    s = open(p).read(); shutil.copy(p, bak); n = f(s); assert n != s; open(p, "w").write(n); print("applied", gid, fn)
else:
    shutil.copy(bak, p); print("reverted", gid, fn)
