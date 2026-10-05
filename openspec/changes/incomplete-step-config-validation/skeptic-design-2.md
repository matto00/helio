## Skeptic Report — design gate (round 2, skeptic-design-2.md)

### What I verified (with evidence)
Read ticket.md, proposal.md, design.md, tasks.md, both spec deltas, repro-findings.md, skeptic-design-1.md; checked against code at HEAD 63a0b3ea.

Round-1 change requests:
1. D1 over-classification: RESOLVED. D1 now introduces an explicit `StepConfigError extends IllegalArgumentException` marker (HEL-859 message pass-through preserved, since StepExecutionException.from keys on IAE at InProcessPipelineEngine.scala:50); flag true only for that cause; nested SEE keeps flag. D2 is a per-site class table; data/reference/external/source rows explicitly unchanged; spec delta carries a "data failure is not a config problem" scenario and a log scenario; tasks 3.4 tests datebucket-unparsable and AI fail() stay ERROR + unnamed 422.
2. Absent-field story: RESOLVED. Spec scenario split into create-reject (422, no ERROR) and stored-absent-name (listing loads, named 422); D7 + task 1.4 + 3.2 make the probe red-first.
3. Existing tests listed: RESOLVED. Tasks 3.7/D4 name PipelineRunServiceSpec :505, :920, :937, :976, :1009. Verified: :505 is the stringops failingStepConfig (config row -> deliberate update); :920/:937/:976/:1009 are REST/SQL/csv-url source failures (stay UnprocessableEntity, untouched). Other `a[UnprocessableEntity]` hits (RefinementService, DashboardAuthoring, PipelineShape, ProposalValidate specs) are unrelated paths.
4. completeError arm + body-shape test: RESOLVED. D4 states the arm is not compile-checked, task 1.5 adds it, 3.1 asserts full body and `message` byte-identical.

D2 table vs throw sites (grep of IllegalArgumentException/require under domain/steps and domain/engine): all cited lines exist and are as classified: Window:100/107/115 config, :143 "Unreachable" default (comment confirms; ISE is correct); Pivot:81; Aggregate:96/119 (unsupported fn); GroupBy:74; StringOps:100/110/113/118/162/165; FillNull:85/92; Join:71 / Union:70 (type/mode); ChunkByTokenCount:107; DateBucket:63 (floorFn Left, config) vs :80 (data); Join:96/104, Union:88/99, Lookup:116/127 (reference); Generate/Analyze/ConvertFormat fail() external; engine :534-789 root loaders. No unlisted throw site found; require() sites (InProcessExecutionBackend:39, engine:368, PipelineAnalyzeService:32) are invariants, outside the table appropriately. StepConfigTypeMismatch sites (Assert, StepCodecUtil, SecondaryInput, UpsertSourceConfig) are covered by the re-parent.

D7: Confirmed accurate. UpsertSourceConfig.decode (UpsertSourceConfig.scala:162) calls UpsertTarget.format.read, which throws StepConfigTypeMismatch for newSource without a string `name` (:99-104); requiredConfigProblems (UpsertSourceStep.scala:59) wraps decode in Try(...).toOption, so the failure is swallowed to "no problems"; PipelineStepConfigCodec.decode -> rowToDomain failure path is the IllegalStateException the design cites. Important nuance the executor must respect: `UpsertTarget.format.read` is ALSO used by write-path `decodeErrorFor` (:206), the wire protocol (PipelineStepProtocol:329) and DataSourceReferenceRepository:105, so the tolerance must go into a separate decode-only reader, not into `format.read`. D7's "If decode and validation share one reader, split them" covers this, and 3.2's create-still-422 assertion would catch a violation.

Failability: 3.1/3.3 (named body), 3.2 (stored absent name: list/preview), 3.5 (log level), 3.6 (flag) are all red on main (no StepConfigInvalid, ERROR+stack today). 3.4 are guards that pass on main (should be labelled as guards, not red proof); they fail under a "classify any IAE as config" mutation. "Flag always false" and "helper back to log.error" mutations map to 3.6/3.1 and 3.5.

### Verdict: CONFIRM

### Non-blocking notes
- 3.9 "a D2 row reverted to plain IAE turns a named test red": only the engine branch, fillnull (3.3) and stringops (:505 update) have named tests; a reverted Window/Pivot/Aggregate/etc. row would not. Executor should name which row(s) the mutation uses, or add one parametrised engine-level test asserting `isStepConfigError` for each D2 row.
- Label 3.4 as guard tests (green on main), per red-vs-guard discipline.
- D7: implement tolerance via a private tolerant target reader used only by `decode`; leave `UpsertTarget.format.read` strict.
- Window:143 -> IllegalStateException is untestable (unreachable); do not count it toward mutation coverage.
