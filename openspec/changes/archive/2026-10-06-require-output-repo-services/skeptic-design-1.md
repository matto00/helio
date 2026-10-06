## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence)
- All seven `= null` defaults exist at the cited lines on HEAD e29f580cd (grep of the seven files): PanelService:73, PipelineService:66, PipelineRunService:79, DashboardService:53, DashboardContentsService:44, DashboardProposalService:43, ProposalPanelSupport:158.
- Null branches match the design list: PanelService:254, :635; DashboardService:435; ProposalPanelSupport:226; PipelineService:320, :868, :1170; PipelineRunService:420, :790, :1409, :1528. I found no additional `outputRepo == null` branches in the seven files. The only other mention is the `historyConfigs` helper (PipelineRunService:1381), which gates on `outputHistoryRepo`, not `outputRepo`.
- Constructions: `new <Service>(` in src/main occurs only in ApiRoutes (:369,377,381,384,409,458). Nothing constructs these services without `new`. ApiRoutes:83 is constructed only by Main (Main.scala:269 passes `dbContext = ctx`).
- ApiRoutes `.orNull` sites match (369/377/381/384/410/476/576/811); `dbContext: DbContext = null` at :161 is the single remaining null source.
- The 6 dbContext-less route specs are exactly: ApiTokenAuthSpec, HookRoutesSpec, ApiRoutesCorsErrorHandlingSpec, MfaApiRoutesSpec, UploadRoutesSpec, DashboardPanelAclSpec. Each builds an EmbeddedPostgres and a `DbContext` named `ctx` already.
- Mockito 5.12.0 is Test-scoped in build.sbt:261; `mock(classOf[OutputRepository])` is already used in 6 specs.
- No test asserts the three InternalError guard messages (grep of "Output creation is unavailable" / "Root removal is unavailable" / "Output preview is unavailable" / "no OutputRepository" in src/test gives nothing relevant), so D3 deleting them breaks no test.
- Fixture volume: roughly 133 `new` sites in tests (Panel 20, Pipeline 50, PipelineRun 30, Dashboard 23, Proposal 10), consistent with "~130".

### Judgement on the specific questions
1. D6 red plan: sound but with a subtlety. With a real repo, the new tests are also green on main, because main's `rejectMissingOutput` works once wired. They go red on main only when the repo is omitted, which is exactly the AC3 scenario, and the design says so (red evidence 1, run against main). Mutation evidence 2 makes the guard failable. Feasible. See note A.
2. D2 + D3: behaviour-preserving for prod, since ApiRoutes with a Main-supplied `ctx` always built a non-null repo. Compatible with the ticket's "typed error where genuinely optional" clause: no listed service is genuinely optional, so the clause is vacuous and D1/D2 explain why.
3. D4: in scope (ApiRoutes is a call site passing `.orNull`, AC2) and complete for the seven services. Other ApiRoutes sites (OutputControlsValidator :380, PanelCapabilityService, patch-set, WorkspaceSearch) become non-null as a side effect but their internal null checks stay (declared non-goal).
4. No missed call sites or null branches found.

### Verdict: CONFIRM

### Non-blocking notes
A. Add a failable test for D2 itself (e.g. constructing PanelService with `null` throws `IllegalArgumentException`). After the change, the "omit the repo" scenario no longer compiles, so the D2 `require` is the only runtime guard against `x.orNull` and has no test otherwise.
B. D4 side effect: the 6 specs gain every dbContext-derived route/service (outputs, assistant, history, etc. now Some instead of None). A spec asserting a 404/503 for a formerly absent route family could change outcome; the design's D5 "outcome change = finding" rule covers it, so the evaluator should diff those six specs' assertions in particular.
C. D6's red evidence 1 requires running the new test against main's tree (separate checkout or temporary revert); state the exact method in files-modified.md.
D. DashboardContentsService has zero direct test constructions, so D2's `require` there is exercised only through ApiRoutes.
E. The Scala `preValidateBindings` keeps `dataSourceRepo = null` default after `outputRepo` loses its default; positional callers are fine, confirm no named-arg callers after edit (compile will tell).
