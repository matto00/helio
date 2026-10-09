#!/usr/bin/env python3
"""HEL-1393 move checker. usage: check.py <worktree> <base-sha> [--preview P] [--entry E]
Positional + exact: PREVIEW must equal HEAD_SCAFFOLD + base[261..534] + TAIL_SCAFFOLD (blank lines ignored
only at the ends); ENTRY must equal base with (i) REMOVED_IMPORTS deleted, (ii) base[261..534] replaced by
DELEGATIONS, (iii) PREVIEW_VAL inserted after the `import executor.runPipeline` line. Nothing else may differ."""
import subprocess,sys,os,difflib
W=sys.argv[1]; SHA=sys.argv[2]
D="backend/src/main/scala/com/helio/services/pipelines/"
args=sys.argv[3:]
def opt(n,dflt):
    return args[args.index(n)+1] if n in args else dflt
P=opt("--preview",os.path.join(W,D+"PipelineRunPreview.scala"))
E=opt("--entry",os.path.join(W,D+"PipelineRunService.scala"))
base=subprocess.check_output(["git","-C",W,"show",f"{SHA}:{D}PipelineRunService.scala"],text=True).split("\n")
A,B=261,534
moved=base[A-1:B]
HEAD=["package com.helio.services.pipelines","",
"import com.helio.services.ServiceError",
"import com.helio.api.protocols.pipelines.{OutputPreviewEntry, PipelinePreviewResponse, RunResultResponse}",
"import com.helio.domain.model.{AssertionSink, AuthenticatedUser, OutputId, PipelineId, TruncationSink}",
"import com.helio.domain.engine.{NodeDependencyClosure, PipelineCostEstimator, PipelineExecutionBackend, PipelineRowJson, StepKey}",
"import com.helio.infrastructure.persistence.pipelines.{OutputRepository, PipelineRepository, PipelineStepRepository}",
"import com.helio.infrastructure.persistence.sources.DataSourceRepository",
"import spray.json._",
"import scala.concurrent.{ExecutionContext, Future}",
"",
"/** Read-only dry-run previews (step, Output, source-level). Split out of `PipelineRunService` (HEL-1393). */",
"private[pipelines] final class PipelineRunPreview(",
"    pipelineRepo: PipelineRepository,",
"    pipelineStepRepo: PipelineStepRepository,",
"    dataSourceRepo: DataSourceRepository,",
"    outputRepo: OutputRepository,",
"    backend: PipelineExecutionBackend,",
"    support: PipelineRunSupport",
")(implicit ec: ExecutionContext) {",
"",
"  import support.{executionFailureError, logExecutionFailure, resolveAllRootDataSourcesInternal, truncationFields}",
""]
TAIL=["}"]
DELEG=[
"  /** Delegates to [[PipelineRunPreview.previewStep]], where the method and its documentation live. */",
"  def previewStep(pipelineId: PipelineId, stepId: String, user: AuthenticatedUser): Future[Either[ServiceError, RunResultResponse]] =",
"    preview.previewStep(pipelineId, stepId, user)",
"",
"  /** Delegates to [[PipelineRunPreview.previewOutputs]], where the method and its documentation live. */",
"  def previewOutputs(pipelineId: PipelineId, outputId: Option[OutputId], user: AuthenticatedUser): Future[Either[ServiceError, PipelinePreviewResponse]] =",
"    preview.previewOutputs(pipelineId, outputId, user)",
]
PREVIEW_VAL=["  private val preview   = new PipelineRunPreview(pipelineRepo, pipelineStepRepo, dataSourceRepo, outputRepo, backend, support)"]
import json
EDITS=json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)),"edits.json")))
fails=[]
def rd(p):
    l=open(p).read().split("\n")
    if l and l[-1]=="": l=l[:-1]
    return l
pv=rd(P); exp=HEAD+moved+TAIL
if pv!=exp:
    fails.append("PREVIEW differs from HEAD+moved+TAIL:")
    fails+=list(difflib.unified_diff(exp,pv,"expected","actual",lineterm="",n=0))[:40]
# entry expected
ent=[]
i=0
bi=list(base)
if bi and bi[-1]=="": bi=bi[:-1]
for n,l in enumerate(bi,1):
    if n==A:
        ent+=DELEG
    if A<=n<=B: continue
    if l in EDITS:
        if EDITS[l] is None: continue
        l=EDITS[l]
    ent.append(l)
    if l=="  import executor.runPipeline": ent+=PREVIEW_VAL
# the blank line between previewStep deleg and previewOutputs deleg: base had blank at B+1 (kept) -> expect handled below
en=rd(E)
if en!=ent:
    fails.append("ENTRY differs from expected:")
    fails+=list(difflib.unified_diff(ent,en,"expected","actual",lineterm="",n=0))[:60]
print(f"preview: {len(pv)} lines ({len(moved)} moved verbatim base lines {A}-{B}, {len(HEAD)+len(TAIL)} scaffold); entry: {len(en)} lines (base {len(bi)})")
if fails:
    print("FAIL"); print("\n".join(fails)); sys.exit(1)
print("PASS")
