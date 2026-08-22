# Workflow State — HEL-633

PHASE: Evaluation (cycle 2 PASS) -> final gate
CYCLE: 2
SKEPTIC_CYCLE: 1
DESIGN_GATE_ROUND: 6  # CONFIRM (verdict recorded; design gate CLEARED)

## HOLD — repo integrity incident (2026-08-21) — CLEARED AND RESUMED
Halted by human instruction mid-Execution pending forensics on a repo integrity incident
(core.bare=true set in the main checkout by an unidentified actor).

STATE AT HALT — preserved deliberately, NOT cleaned up, do not tidy:
  branch HEAD:      19fa5a4f  (5 commits ahead of 3596b161)
  committed layers: 1 domain/, 2 infrastructure/, 3 services/, 4 api/protocols/
  uncommitted:      48 paths (47 RM + 1 M) = Layer 5 api/routes/ in progress
  files vs 3596b161: 533 committed (backend/src 513, openspec/changes 19,
                     scripts/check-schema-drift.mjs 1)
  Layers NOT started: 6 (api/ root -> api/http), 7 (delete security/)

Executor was spawned before the hold arrived and was sent an explicit abort; confirmed
halted (no commit/worktree change over a 20s sample). It was told NOT to revert or tidy.

ONE OUT-OF-PLAN FILE: scripts/check-schema-drift.mjs (commit a856df7d, +3/-1) — a hardcoded
path to a backend file moved by Layer 1. Explainable, but outside the planned scope and
NOT covered by D6; flag for review before any resume.

RESUME PRECONDITION: forensic clearance. On resume, re-verify the D6 gate from baseline
before trusting any layer already committed.  # r1-r5 all REFUTE (9,9,8,1,1 CRs), all addressed. Budget extended 5->6 by HUMAN GRANT (one-off, this run only). If r6 REFUTEs: ESCALATE, do NOT grant a 7th.
TICKET_ID: HEL-633
TICKET_TYPE: feature
CHANGE_NAME: repackage-backend-domain-subpackages
BRANCH: task/repackage-backend-domain-subpackages/HEL-633
WORKTREE_PATH: /home/matt/Development/helio/.claude/worktrees/task/repackage-backend-domain-subpackages/HEL-633
DEV_PORT: 6065
BACKEND_PORT: 8972
BASE_COMMIT: 29fc0528  # origin/main merged in at 3596b161 (CON-129); merge-base == main tip

AGENT_MERGE: true
SPEED: default
EXECUTION_CYCLES: 3
SKEPTIC_DESIGN_ROUNDS: 5
SKEPTIC_FINAL_ROUNDS: 2
DEBUG_ATTEMPTS: 2
SECOND_FINAL_GATE_SKEPTIC: false
EVALUATOR_CLEAN_WORKTREE: false
HARNESS: claude-code

# MODELS — per-spawn overrides mandated by the human, NOT the resolved all-sonnet set.
# setup-worktree.sh resolved every role to "sonnet"; the agent definitions also pin
# sonnet. The per-spawn `model` parameter is therefore the ONLY thing keeping the
# evaluator and skeptic gates on the stronger model. A dropped override downgrades a
# gate silently, with no error. Pass on every spawn AND every re-spawn.
MODELS: {"orchestrator":"opus","executor":"sonnet","evaluator":"opus","skeptic":"opus","auditor":"sonnet"}

DESIGN_QUESTIONS: null

RESOLVED_ESCALATION:
  kind: planning
  raised_at: 1787356970540
  status: ANSWERED in chat (dashboard --await timed out; timeout treated as NOT an approval)
  answers: Q1=add-domains (final naming mine; chose 13 domains, proposals/patchsets split)
           Q2=leave-untouched (+ file follow-up for ai/-as-infrastructure)
           Q3=squash-normal (+ MUST verify git log --follow after squash, escalate if broken)
  context_ref: contradiction (HEL-632 fixed-eight-domains vs. 70 unassignable files)
  sub_questions:
    1. Where do the 70 post-ticket files go?
       options: add-domains | absorb-workspace | distribute | narrow-scope
       recommendation: add-domains
    2. Are ai/, email/, spark/, app/ in scope?
       options: leave-untouched | fold-into-infrastructure
       recommendation: leave-untouched
    3. Commit granularity given Phase 3 squash?
       options: squash-normal | preserve-commits
       recommendation: (none - genuine toss-up, ticket asks for reviewable commits)

# NOTE: a timeout is NEVER an approval. No sub-question may be self-authorized.
# Planning artifacts (proposal/design/tasks) are deliberately NOT written yet: answer 1
# changes the target layout materially, so drafting them first would be guesswork.

## Spinoffs filed during planning
- HEL-802 ai/email/spark/app scope (deferred, Q2)
- HEL-803 two stale hardcoded logger names (design D9)
- HEL-804 openspec/specs FQN drift (design D11)

## Notes
- Only 5 concertino scripts are tracked in git; emit-event.sh, persist-evidence.sh,
  gather-escalation-context.sh, triage-followup.sh, check-agent-merge-permission.sh exist
  ONLY in the main checkout. Call them by absolute path from /home/matt/Development/helio.
- CON-129: merge origin/main into the branch BEFORE the evaluation gates, not at Delivery.
- Agent-merge is enabled but has failed all day on missing permissions; present PR and stop.
- Quality baseline (128 basenames) saved at:
  /tmp/claude-1000/-home-matt-Development-helio/81dca7ce-a9ca-4c3a-8451-070630f82b8d/scratchpad/hel633/quality-baseline-basenames.txt


## Resume verification (2026-08-21, after clearance)

Root cause was HEL-657's pre-commit gate shelling out to `git init`; from a linked worktree git
exports GIT_DIR=<repo>/.git/worktrees/<name>, whose basename is not `.git`, so git guessed "bare"
and re-initialised the main checkout. Not this run. Fix is on main at 649f1490.

1. MERGE (CON-129 remedy) — DONE. merge-base == origin/main == 649f1490.
   Layer 5 was mid-flight; stashed with a 49-path hash fingerprint + patch backup, merged, restored.
   Content hashes identical before/after; 47 renames + 2 modified preserved exactly.
   Backend tree hash is IDENTICAL at 29fc0528 / 3596b161 / 649f1490 (ccff8c85facc), so the merge
   changed nothing under backend/ and D6 against any of those bases is equivalent.
2. D6 RE-RUN FROM BASELINE — PASS. 540 base .scala vs 540 worktree .scala; 531 compared;
   exactly 1 content difference = `api/package.scala`, the sole allow-listed file; 0 orphans.
   The 9 "missing" are Layer 6 files not yet moved (api/ root -> api/http), as expected.
   Filter in use is the PATCHED version (separate package/import rules, package anchored to EOL);
   two-sided self-check passes: 0 residual imports; package-object bodies preserved 381->380,
   115->114, 34->31 (34 raw reflects the added DataTypeId/MetricId import, D5 prerequisite).
   Allow-list closed via NB-2 sed round-trip: byte-identical to base after normalising the domain
   segment — no body change smuggled into the one permitted file.
   NN-4 package/directory agreement: 540 checked, 0 mismatches.
3. GATES — no more `-n` from here. The 5 existing commits used it legitimately (base predated
   HEL-657's fix, so check:openspec false-positived); the merge lands that fix.
4. scripts/check-schema-drift.mjs — REVIEWED AND ACCEPTED. Path constants only, no logic change.
   CON-132 assessment: spawns no child process, invokes no git, writes nothing, derives repoRoot
   from import.meta.url — so it is NOT in CON-132's risk class and behaves identically from a
   linked worktree. All 4 hardcoded backend paths resolve; gate runs non-vacuously (66 checks
   across 47 protocol files, 7 panel-type surfaces). Updated across a856df7d/54e7f6ab/19fa5a4f.
   Not covered by D6 (outside backend/); this manual review is its coverage.

CON-132 standing rule recorded: a change to .husky/**, the gate list, or a hook-invoked script is a
live-infrastructure change requiring an explicit environment/sandbox/worktree analysis before wiring.

## Import-formatting uniformity decision (2026-08-21, pre-Evaluation)

FINDING (mine, not in the executor's report): 39 files shrank vs base because statement-oriented
rewriting collapses multi-line braced imports. D6 masks import statements, so this had to be cleared
*via* D6's guarantee rather than *with* D6: D6 passing on all 540 proves every removed line belonged
to a package/import statement, so no code was lost.

INCONSISTENCY: 3 of those files were reflowed BACK to multi-line — selected not by a formatting
principle but because they sat at 253/254/261 lines and collapsing dropped them under the 250-line
soft budget, removing them from the warned set. Gate-driven, not cause-driven.

DECISION — uniform collapse (Option B). Rule: **every import statement this change rewrites is
emitted on a single line.** Chosen over "preserve original multi-line shape" because:
  - it is stateable in one sentence and checkable by one command, the standard every other gate in
    this change meets (D6, the two-sided filter self-check, package/directory agreement);
  - "preserve original shape" is a per-file heuristic and is undefined when one multi-line import
    fans out across several new packages;
  - it touches 4 files rather than 39 at a late stage;
  - it converts a suppressed signal into documented evidence.

CONSEQUENCE, accepted deliberately: warned set 134 -> 131 (128 base + 6 additions - 3 removals).
The 3 removals are SparkJobSubmitter.scala (261->245), ApiRoutesCorsErrorHandlingSpec.scala
(254->248), UploadRoutesSpec.scala (253->247). No code removed; D6 confines the change to import
statements. Explained in baseline/quality-deltas.md rather than engineered away.

NOT touched: domain/shapes/{TimeSeriesShape,SingleRowShape}.scala — byte-identical to base, their
imports never needed rewriting.

ACCEPTED: HealthRoutes.scala at api/routes/workspace/. Domain-agnostic GET /health with no natural
domain. Accepted on the strength of its README, which names it explicitly, calls it domain-agnostic,
and states the reasoning ("rather than inventing a 14th category") — the epic exists because a README
drifted from reality, so a placement documenting its own compromise honestly is that failure inverted.
Flagged to the final-gate skeptic for an independent view; api/routes/ root beside ServiceResponse
remains the alternative.

## Correction verified (d124546b) — orchestrator re-derivation, not accepted from report
- warned set = 131 EXACTLY, composition re-derived: 6 additions / 3 removals, and the 3 removals are
  precisely the files predicted in advance (SparkJobSubmitter, ApiRoutesCorsErrorHandlingSpec,
  UploadRoutesSpec). Pre-committing the arithmetic before the run is what makes this check meaningful.
- positive grep returns EXACTLY the 2 deliberately-excluded shapes files, and both are byte-identical
  to base — confirmed untouched, not merely unlisted.
- D6 on corrected tree: 540/540, 1 allow-listed difference, 0 missing, 0 orphans.
- HEL-634 boundary: 179 test paths, all M.
- Commit contents audited: 7 files (4 source + quality-deltas.md + design.md + workflow-state.md).
  The workflow-state.md hunk is purely additive and byte-matches the orchestrator's own text
  (0 removed lines) — the executor swept in in-flight bookkeeping but did not alter it. Acceptable.

## Evaluation cycle 1: FAIL (evaluation-1.md) -> cycle 2

Evaluator re-ran all 11 gates fresh; structural core verified clean to a higher standard than my plan
required. Two cross-checks it added that the plan never specified:
  - mapping honesty: `git diff -M` detects 248 renames, byte-identical to the 248 old!=new rows in
    mapping.tsv — no unmapped move, no undetected rename.
  - BYTECODE constant-pool comparison through the rename map: 2059<->2059 main classes,
    352<->352 test, and 0 of 2411 classes differ in their referenced com.helio type set. This is the
    real answer to "what does D6 miss": if any import had re-resolved to a different symbol, implicit,
    or overload, this would show it. It does not. Strongest behaviour-preservation evidence in the run.

3 change requests, all import-line / Markdown:
  CR-1 142 unused com.helio imports across 104 files, INTRODUCED by this change (base 12 -> 175).
       Invisible to every gate in the plan: D6 masks import lines by construction, build.sbt has no
       -Wunused, and check-scala-quality only detects INLINE FQNs. A genuine plan gap, not an
       executor error. Verified the pattern myself: 141 files carry both `domain._` and
       `domain.model._`; the old wildcard was left in place beside the new import.
  CR-2 backend/README.md:12 still lists com/helio/security, deleted by this change. The
       `rg com\.helio\.security` AC passed only because that reference is in SLASH form — an AC
       that looked sufficient and was not.
  CR-3 infrastructure/README.md:5 claims crypto/ holds TOTP primitives; TotpSupport is actually at
       persistence/auth/. Exactly the README-drift failure this epic exists to correct.

## Two scope decisions at cycle 2 (orchestrator)

DECISION A — accept 9 unused com.helio imports, not 12. The executor removed 3 PRE-EXISTING dead
entries (`PipelineStepResponse` in PatchSetApplyForward.scala; `domain.panels._` in
PatchSetPreviewServiceSpec.scala; `UpdatePanelRequest` selector in
PanelServiceScatterAggregationSpec.scala) that only surfaced in a second compiler wave, before an
exclusion rule existed for them. ACCEPTED under the standing rule "trivial and provably safe -> fix
it and say so explicitly": 3 import lines, compiler-verified dead in BOTH trees, disclosed
unprompted. Restoring them would mean deliberately re-adding known-dead code and burning a full
re-verification cycle for negative value.
  Note the invariant restatement this forces, which is the real point: the safety argument is
  "every import removed is compiler-verified dead" (true of all 224 removals), NOT "unused count
  equals base count" — the latter was only ever a proxy. Corroborated by the evaluator's bytecode
  constant-pool comparison: 2411 classes, 0 differences in referenced com.helio type sets.

DECISION B — the scalac warning display cap is now VERIFIED, not inferred. `scalac -help` lists
`-Xmaxwarns <n>`, and backend/build.sbt sets no scalacOptions, so the default applies. Measured on
Scala 2.13.15 with a synthetic 150-unused-import file: default prints 100 + summary; `-Xmaxwarns
10000` prints all 150. Default = 100 per phase. This explains the first pass's Compile=99 / Test=100
and the base tree's Test=37 (never near the cap).
  BUT the artifact now states explicitly that the cap is only the EXPLANATION, not the argument:
  soundness rests on iterating to a fixed point (third pass = 0 further entries), which holds
  regardless of whether the cap hypothesis were true. This change has twice been bitten by a comment
  asserting as verified fact something that was not; the correction is written to not repeat that.
  Repo-wide consequence: any single -Wunused run here silently undercounts above 100 per phase.
  Deferred to a spinoff (add -Wunused + -Xmaxwarns to build.sbt; clean the base tree's 9).

## Evaluation cycle 2: PASS -> final gate

Evaluator re-derived everything; added a provably-import-only diff check (every changed line across
all 150 .scala files is an import line) and re-ran the bytecode constant-pool comparison on this tree:
0 of 2411 classes differ in referenced com.helio type set. That establishes all 224 import removals as
behaviour-neutral INDEPENDENTLY of any warning count, which is the right way to hold it.

Three follow-ups, all closed by the orchestrator:
NB-1 quality-deltas.md figures were wrong: base pre-existing unused com.helio is 16 (not 12) and this
     change removed 7 (not 3). Verified the 4 omitted entries myself in the base tree - all sit on
     CONTINUATION LINES of multi-line braced imports. Third occurrence of that same blind spot in this
     change (braced-import census 199 vs 240; line-oriented D6 filter; now this classifier). Corrected
     with the pattern recorded, since the pattern outlives the number. Decision to accept 9 unchanged -
     the rationale applies identically to all 7 and the bytecode check is count-independent.
NB-2 services/hooks/README.md pointed at infrastructure/persistence/hooks/, which does not exist
     (hooks owns no tables). Rewritten truthfully. Then swept ALL 67 backend READMEs: 110 path refs,
     0 unresolvable after the fix.
NB-3 stray registered worktree at scratchpad/hel633/base_worktree (detached 3596b161) REMOVED.
     Verified by result, not exit code: 0 scratchpad entries in `git worktree list`, gone from disk,
     .git/worktrees holds only HEL-633/HEL-635/setup-concertino-codex. Given tonight's incident began
     with a stray git registration, this mattered. Guidance for future runs: build a base tree with
     `git archive` into a scratch dir (as the evaluator did) so no worktree is ever registered.

## Final gate: CONFIRM (skeptic-final-1.md)

Cold skeptic wrote its OWN D6 filter, built both trees itself, and re-ran every gate. Reproduced
540/540 with the single allow-listed difference and 5,649 masked lines from a different
implementation; rebuilt the bytecode constant-pool comparison from scratch (2411<->2411 classes,
0 differing in referenced com.helio type set); sbt test 3346/212; all 10 gates exit 0; warned set 129.

Its highest-value original finding: the backend has EXACTLY ONE simple-name collision —
`ResourceType`, declared in both `com.helio.api.http` and `com.helio.domain.model`, and BOTH are
moved by this change. That is the only place an import rewrite could silently re-resolve while still
compiling green. It paired them by source-declaration evidence and hand-traced all five referencing
main files: clean. Named as the single greatest residual risk for the PR reviewer, and carried into
the PR body for that reason.

It also caught a gate this move could have silently gutted: check-schema-drift.mjs reads
api/protocols/, where a flat readdirSync would now see 3 files instead of 46. The
{recursive:true} fix is present and verified non-vacuous (66 checks / 47 protocol files).

### Post-CONFIRM doc-only delta (deliberate, and bounded)
Actioned NB-1/NB-2/NB-5/NB-6 from the report. D10 says the tree that passes the final gate must be
the tree that is squashed, so this needs justifying rather than assuming: `git status` confirms
ZERO non-.md changes. D6 iterates .scala only, the bytecode check reads .class only, and sbt test
exercises code — so every substantive verification the gate performed is provably untouched by a
markdown-only delta. The full 10-gate chain is re-run on commit regardless.
  NB-1 "every route class is a thin shell that delegates to a service" was literally false for
       ConnectorRoutes and HealthRoutes (0 service references, verified). Softened to "most" in all
       13 route READMEs, making the claim true everywhere.
  NB-2 backend/README.md still said "No service implementation is included yet. Planned structure:"
       above a list this change had just made accurate — a false header framing correct content, in
       a change whose entire purpose is documentation truth.
  NB-5 services/alerts/README.md now points at domain/engine/AlertEventStateMachine — the one part
       of the alerts stack a domain-directory grep does not surface, because domain/ is kind-split.
  NB-6 removed the empty, untracked services/layout/ directory git mv left behind.

### Deliberately NOT actioned
HealthRoutes stays at api/routes/workspace/. The skeptic independently preferred api/routes/ root
(the /health route mounts outside pathPrefix("api") and outside every auth directive; HealthResponse
already stays at api/protocols/ root, so root<->root is the established symmetry; it is the sole one
of 48 route classes whose name does not predict its directory). That is a real argument and I record
it as a dissent rather than burying it — but the skeptic explicitly recommended rather than required,
called it a genuine toss-up with zero behavioural consequence, and moving it would touch .scala and
require a full final-gate re-run. Two independent reviewers reaching different answers is itself
evidence it is a toss-up. Carried into the PR body and a follow-up ticket; cheap to change later.
