# HEL-1429 behaviour proof: sbt testFull, base 2fb8deb5 vs head

## head (delivery worktree, nice -n 19 sbt -J-Xmx3g testFull)
[info] - should fail validation once expires_at has elapsed
[info] Total number of tests run: 6440
[info] Suites: completed 462, aborted 0
[info] Tests: succeeded 6440, failed 0, canceled 4, ignored 0, pending 0
[info] All tests passed.
[success] elapsed time: 823 s (0:13:43.0), cache 36%, 179 disk cache hits, 313 onsite tasks
exit=0

## base 2fb8deb5, throwaway detached worktree, FIRST testFull (no backend/.env in the fresh worktree -> CONNECTOR_MASTER_KEY unset)
[info] Total number of tests run: 6440
[info] Suites: completed 462, aborted 0
[info] Tests: succeeded 6406, failed 34, canceled 4, ignored 0, pending 0
exit=1
34 failures, all 'ConnectorCredentialEncryptionFailed: NoKeyConfigured', in 10 suites: ApiRoutesSpec 2, AuditMutationInstrumentationSpec 2, DataSourceRoutesSpec 1, PipelineApplyProposalRollbackSpec 4, PipelineApplyProposalSpec 1, RestConnectorEgressGuardSpec 10, SourceServiceBareUrlParametersSpec 1, SourceServiceBareUrlQueryParamsSpec 1, SourceServiceSpec 11, WorkspaceContextServiceSpec 2. sbt 2 cached Test/envVars=Map() in that worktree (copying .env afterwards did not change it: 'show Test/envVars' -> Map()), and reruns of testFull replayed it.

## base, those 10 suites re-run with the .env variables exported into the sbt process environment (testOnly ... -- -oD)
[info] Total number of tests run: 560
[info] Suites: completed 12, aborted 0
[info] Tests: succeeded 560, failed 0, canceled 0, ignored 0, pending 0
[info] All tests passed.
exit=0

base effective: 6406 + 34 (the env-only failures, now passing) = 6440 passed, 0 failed, 4 canceled; head: 6440 passed, 0 failed, 4 canceled. Total tests run 6440 = 6440; suites 462 = 462.
Per-suite leaf counts (suitecounts.py over each log): base and head JSON identical (cmp exit 0): suite-counts-base-2fb8deb5.json vs suite-counts-head.json (462 suites, 6444 leaf lines).
AutoRunGuardBurstProofSpec (HEL-1439 flake): passed on the first attempt on both base and head; no re-run needed.
