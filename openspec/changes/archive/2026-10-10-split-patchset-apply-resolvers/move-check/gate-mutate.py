#!/usr/bin/env python3
"""Cycle-2 foreign-id gate mutations (no message string changed). usage: W=<wt> SCR=<dir> gate-mutate.py apply|revert N1..N5|G5"""
import sys, os, shutil
W = os.environ["W"]; P = W + "/backend/src/main/scala/com/helio/services/patchsets/"
mode, gid = sys.argv[1:3]
K = "PatchSetApplyResolvers.scala"
def sub(old, new, count=1):
    def f(s):
        assert s.count(old) == count, (gid, "anchor count", s.count(old))
        return s.replace(old, new)
    return f
G = {
 # panel gate in Support: a failed access check (foreign/absent dashboard) lets the edit through
 "N1": (K, sub('"Dashboard not found").map {\n      case Left(err)                    => Left(err)\n      case Right(ResourceAccess.Viewer) => Left(ServiceError.Forbidden())\n      case Right(_)                     => Right(())\n    }',
                '"Dashboard not found").map {\n      case Left(err)                    => Right(())\n      case Right(ResourceAccess.Viewer) => Left(ServiceError.Forbidden())\n      case Right(_)                     => Right(())\n    }')),
 # panel lookup in the moved resolvers: ACL-bypassing lookup, so a foreign panel is found
 "N2": ("PatchSetPanelResolvers.scala", sub("ctx.panelRepo.findById(panelId, Some(user)).flatMap {", "ctx.panelRepo.findByIdInternal(panelId).flatMap {", 2)),
 # step gate in Support.requireVisibleStep: invisible pipeline lets the step edit through
 "N3": (K, sub('case None    => Future.successful(Left(ServiceError.NotFound(s"edit $index: pipeline step not found")))\n      case Some(_) => authorizeEditorOrOwnerOnPipeline',
                'case None    => Future.successful(Right(()))\n      case Some(_) => authorizeEditorOrOwnerOnPipeline')),
 # step gate in Support.authorizeEditorOrOwnerOnPipeline: an invisible pipeline passes
 "N4": (K, sub('case None => Future.successful(Left(ServiceError.NotFound("Pipeline not found")))', 'case None => Future.successful(Right(()))')),
 # step lookup in the moved resolvers: the visibility gate call is skipped on update and delete
 "N5": ("PatchSetPipelineStepResolvers.scala", sub("requireVisibleStep(existing.pipelineId, index, user, ctx).flatMap {", "Future.successful[Either[ServiceError, Unit]](Right(())).flatMap {", 2)),
}
fn, f = G[gid]; p = P + fn; bak = os.environ["SCR"] + "/hel1479-gate-" + gid + ".bak"
if mode == "apply":
    s = open(p).read(); shutil.copy(p, bak); n = f(s); assert n != s; open(p, "w").write(n); print("applied", gid, fn)
else:
    shutil.copy(bak, p); print("reverted", gid, fn)
